import argparse
import json
import logging
import math
import random
import sqlite3
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

# Suppress PyTorch prototype nested tensor warning in TransformerEncoder
warnings.filterwarnings("ignore", message=".*nested tensors.*")
warnings.filterwarnings("ignore", category=UserWarning, module="torch.nn.modules.transformer")

try:
    import mlflow

    # MLflow SQL-based backend requires SQLite >= 3.31.0; silence and disable if incompatible
    sqlite_ver = tuple(map(int, sqlite3.sqlite_version.split(".")[:2]))
    if sqlite_ver < (3, 31):
        logging.getLogger("mlflow").setLevel(logging.ERROR)
        HAS_MLFLOW = False
    else:
        HAS_MLFLOW = True
except Exception:
    HAS_MLFLOW = False

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "models"
BEST_PARAMS_DIR = BASE_DIR / "best_params"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
BEST_PARAMS_DIR.mkdir(parents=True, exist_ok=True)

SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)

# 18 canonical draft steps in tournament mode:
# (step_idx, phase, action_type, side)  where action_type: 0=BAN, 1=PICK; side: 0=BLUE, 1=RED
DRAFT_STEPS = [
    (0, 1, 0, 0),  # Blue Ban 1
    (1, 1, 0, 1),  # Red Ban 1
    (2, 1, 0, 0),  # Blue Ban 2
    (3, 1, 0, 1),  # Red Ban 2
    (4, 1, 1, 0),  # Blue Pick 1
    (5, 1, 1, 1),  # Red Pick 1
    (6, 1, 1, 1),  # Red Pick 2
    (7, 1, 1, 0),  # Blue Pick 2
    (8, 1, 1, 0),  # Blue Pick 3
    (9, 1, 1, 1),  # Red Pick 3
    (10, 2, 0, 1),  # Red Ban 3
    (11, 2, 0, 0),  # Blue Ban 3
    (12, 2, 0, 1),  # Red Ban 4
    (13, 2, 0, 0),  # Blue Ban 4
    (14, 2, 1, 1),  # Red Pick 4
    (15, 2, 1, 0),  # Blue Pick 4
    (16, 2, 1, 0),  # Blue Pick 5
    (17, 2, 1, 1),  # Red Pick 5
]

MAX_HISTORY_LEN = 17

# Regional League Conditioning Constants (Option 1: Performance-Adjusted Global)
# Order: 0 = RPL (TH), 1 = AOG (VN), 2 = GCS (TW), 3 = INTL (APL / AIC)
LEAGUE_NAMES = ("RPL", "AOG", "GCS", "INTL")
# Grounded in APL+AIC 2025-2026 international win rates: RPL (53.7%), GCS (52.3%), AOG (44.7%)
PERFORMANCE_GLOBAL_LEAGUE_WEIGHTS = (0.32, 0.20, 0.30, 0.18)
# Rebalances domestic match volume (AOG=34.5%, RPL=31.0%, GCS=19.0% 6-team league, INTL=15.5%)
LEAGUE_SAMPLE_WEIGHTS = (1.05, 0.75, 1.35, 1.15)


def encode_league_id(league_str: str) -> int:
    """Map tournament/league string to canonical index: 0=RPL, 1=AOG, 2=GCS, 3=INTL."""
    s = str(league_str or "").strip().upper()
    if "RPL" in s or "ROV PRO LEAGUE" in s:
        return 0
    if "AOG" in s or "ARENA OF GLORY" in s:
        return 1
    if "GCS" in s or "GARENA CHALLENGER" in s:
        return 2
    return 3


def get_league_vector(league_mode: str = "GLOBAL") -> tuple[float, float, float, float]:
    """Return 4-dim regional conditioning vector (RPL, AOG, GCS, INTL)."""
    mode = str(league_mode or "GLOBAL").strip().upper()
    if mode in ("RPL", "TH", "ROV PRO LEAGUE"):
        return (1.0, 0.0, 0.0, 0.0)
    if mode in ("AOG", "VN", "ARENA OF GLORY"):
        return (0.0, 1.0, 0.0, 0.0)
    if mode in ("GCS", "TW", "GARENA CHALLENGER SERIES"):
        return (0.0, 0.0, 1.0, 0.0)
    if mode in ("INTL", "APL", "AIC"):
        return (0.0, 0.0, 0.0, 1.0)
    return PERFORMANCE_GLOBAL_LEAGUE_WEIGHTS


def row_normalize_adj(mat: np.ndarray) -> np.ndarray:
    pos = np.maximum(mat, 0.0)
    row_sum = pos.sum(axis=1, keepdims=True)
    return (pos / np.maximum(row_sum, 1e-6)).astype(np.float32)


def load_sota_data_and_graphs(dataset_path: Path | str | None = None):
    """Load 130 heroes, build multi-relational GNN adjacency matrices, and split train/val."""
    heroes_df = pd.read_csv(DATA_DIR / "heroes_130_summary.csv").sort_values("name").reset_index(drop=True)
    stats_df = pd.read_csv(DATA_DIR / "hero_draft_stats.csv").sort_values("name").reset_index(drop=True)

    hero_names = heroes_df["name"].tolist()
    hero_to_id = {name: i for i, name in enumerate(hero_names)}
    num_heroes = len(hero_names)

    roles = ["Warrior", "Mage", "Marksman", "Tank", "Assassin", "Support"]
    feature_list = []
    lane_probs_list = []
    skill_flags_list = []
    priority_scores = np.zeros(num_heroes, dtype=np.float32)

    for i in range(num_heroes):
        h_row = heroes_df.iloc[i]
        s_row = stats_df.iloc[i]

        r_vec = [0.0] * len(roles)
        if h_row["primary_role"] in roles:
            r_vec[roles.index(h_row["primary_role"])] = 1.0
        if pd.notna(h_row["secondary_role"]) and h_row["secondary_role"] in roles:
            r_vec[roles.index(h_row["secondary_role"])] = 0.5

        lane_counts = np.array(
            [
                s_row["ds_lane_picks"],
                s_row["jungle_picks"],
                s_row["mid_picks"],
                s_row["dragon_lane_picks"],
                s_row["roam_picks"],
            ],
            dtype=np.float32,
        )
        total_p = lane_counts.sum()
        if total_p > 0:
            l_prob = lane_counts / total_p
        else:
            role_to_lane = {
                "Warrior": [0.7, 0.2, 0.0, 0.0, 0.1],
                "Assassin": [0.15, 0.8, 0.05, 0.0, 0.0],
                "Mage": [0.05, 0.0, 0.85, 0.0, 0.1],
                "Marksman": [0.0, 0.1, 0.0, 0.9, 0.0],
                "Tank": [0.2, 0.0, 0.0, 0.0, 0.8],
                "Support": [0.0, 0.0, 0.1, 0.0, 0.9],
            }
            l_prob = np.array(role_to_lane.get(h_row["primary_role"], [0.2] * 5), dtype=np.float32)
        lane_probs_list.append(l_prob)

        skill_flags = [
            float(h_row["has_true_damage"]),
            float(h_row["has_physical_damage"]),
            float(h_row["has_magic_damage"]),
            float(h_row["has_hard_cc"]),
            float(h_row["has_soft_cc"]),
            float(h_row["has_suppress"]),
            float(h_row["has_mobility"]),
            float(h_row["has_immunity"]),
            float(h_row["has_heal_sustain"]),
            float(h_row["has_shield"]),
        ]
        skill_flags_list.append(skill_flags)

        meta_stats = [
            float(s_row["pick_rate_pct"]) / 50.0,
            float(s_row["ban_rate_pct"]) / 50.0,
            float(s_row["presence_pct"]) / 100.0,
            (float(s_row["smoothed_win_rate_pct"]) - 50.0) / 20.0,
        ]

        priority_scores[i] = float(s_row["presence_pct"]) + 0.5 * float(s_row["bans_phase1"]) / 42.08
        feat_vec = np.concatenate([r_vec, l_prob, skill_flags, meta_stats]).astype(np.float32)
        feature_list.append(feat_vec)

    hero_features = np.stack(feature_list, axis=0)  # (130, 25)
    lane_probs = np.stack(lane_probs_list, axis=0)  # (130, 5)
    skill_matrix = np.array(skill_flags_list, dtype=np.float32)  # (130, 10)

    if dataset_path is None:
        training_file = DATA_DIR / "matches_training.json"
        dataset_path = training_file if training_file.exists() else DATA_DIR / "matches_draft_full.json"
    else:
        dataset_path = Path(dataset_path)

    with open(dataset_path, "r", encoding="utf-8") as f:
        games = json.load(f)

    print(f"Loaded {len(games)} draft games from {dataset_path.name}", flush=True)

    # Chronological sort (2024 -> 2025 -> 2026) so validation set is strictly current 2026 pro meta
    games = sorted(
        games,
        key=lambda g: (
            int(g.get("year", 2025)) if str(g.get("year", "2025")).isdigit() else 2025,
            str(g.get("date", "")),
        ),
    )

    n_train_games = int(len(games) * 0.85)
    train_games = games[:n_train_games]
    val_games = games[n_train_games:]

    syn_g = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    syn_w = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    cnt_g = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    cnt_w = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    ban_response_mat = np.zeros((num_heroes, num_heroes), dtype=np.float32)

    pick_counts = np.zeros(num_heroes, dtype=np.float32)
    ban_p1_counts = np.zeros(num_heroes, dtype=np.float32)
    ban_p2_counts = np.zeros(num_heroes, dtype=np.float32)

    pick_2026 = np.zeros(num_heroes, dtype=np.float32)
    ban_p1_2026 = np.zeros(num_heroes, dtype=np.float32)
    ban_p2_2026 = np.zeros(num_heroes, dtype=np.float32)
    raw_pick_counts = np.zeros(num_heroes, dtype=np.float32)
    hero_wins_train = np.zeros(num_heroes, dtype=np.float32)

    num_leagues = len(LEAGUE_NAMES)
    lg_pick_counts = np.zeros((num_leagues, num_heroes), dtype=np.float32)
    lg_ban_p1_counts = np.zeros((num_leagues, num_heroes), dtype=np.float32)
    lg_ban_p2_counts = np.zeros((num_leagues, num_heroes), dtype=np.float32)

    for g in train_games:
        bw = g["blue_win"]
        yr = int(g.get("year", 2025)) if str(g.get("year", "2025")).isdigit() else 2025
        lg_id = encode_league_id(g.get("league", ""))
        lg_mult = LEAGUE_SAMPLE_WEIGHTS[lg_id]
        w = (1.0 if yr >= 2026 else (0.5 if yr == 2025 else 0.2)) * lg_mult
        w_2026 = (1.0 if yr >= 2026 else 0.35) * lg_mult
        blue_win_mult = 1.25 if bw == 1 else 0.75
        red_win_mult = 1.25 if bw == 0 else 0.75
        bp = [hero_to_id[h] for h in g["blue_picks"] if h in hero_to_id]
        rp = [hero_to_id[h] for h in g["red_picks"] if h in hero_to_id]
        bb = [hero_to_id[h] for h in g["blue_bans"] if h in hero_to_id]
        rb = [hero_to_id[h] for h in g["red_bans"] if h in hero_to_id]

        for h in bp:
            raw_pick_counts[h] += w
            pick_counts[h] += w * blue_win_mult
            lg_pick_counts[lg_id, h] += w_2026 * blue_win_mult
            if bw == 1:
                hero_wins_train[h] += w
            if yr >= 2026:
                pick_2026[h] += lg_mult * blue_win_mult
        for h in rp:
            raw_pick_counts[h] += w
            pick_counts[h] += w * red_win_mult
            lg_pick_counts[lg_id, h] += w_2026 * red_win_mult
            if bw == 0:
                hero_wins_train[h] += w
            if yr >= 2026:
                pick_2026[h] += lg_mult * red_win_mult

        for h in bb[:2] + rb[:2]:
            ban_p1_counts[h] += w
            lg_ban_p1_counts[lg_id, h] += w_2026
            if yr >= 2026:
                ban_p1_2026[h] += lg_mult
        for h in bb[2:] + rb[2:]:
            ban_p2_counts[h] += w
            lg_ban_p2_counts[lg_id, h] += w_2026
            if yr >= 2026:
                ban_p2_2026[h] += lg_mult

        for eb_h in rb[2:]:
            for bp_h in bp:
                ban_response_mat[eb_h, bp_h] += w
        for bb_h in bb[2:]:
            for rp_h in rp:
                ban_response_mat[bb_h, rp_h] += w

        for i in bp:
            for j in bp:
                if i != j:
                    syn_g[i, j] += w
                    if bw == 1:
                        syn_w[i, j] += w
        for i in rp:
            for j in rp:
                if i != j:
                    syn_g[i, j] += w
                    if bw == 0:
                        syn_w[i, j] += w
        for i in bp:
            for j in rp:
                cnt_g[i, j] += w
                cnt_g[j, i] += w
                if bw == 1:
                    cnt_w[i, j] += w
                elif bw == 0:
                    cnt_w[j, i] += w

    co_pick_mat = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    synergy_mat = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    counter_mat = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    counter_pick_mat = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    ban_target_mat = np.zeros((num_heroes, num_heroes), dtype=np.float32)

    for i in range(num_heroes):
        for j in range(num_heroes):
            if i == j:
                continue
            co_pick_mat[i, j] = math.log1p(syn_g[i, j]) / math.log1p(max(1.0, raw_pick_counts[j]))
            counter_pick_mat[i, j] = math.log1p(cnt_g[i, j]) / math.log1p(max(1.0, raw_pick_counts[j]))
            ban_target_mat[i, j] = math.log1p(ban_response_mat[i, j]) / math.log1p(max(1.0, raw_pick_counts[j]))
            synergy_mat[i, j] = ((syn_w[i, j] + 3.0) / (syn_g[i, j] + 6.0)) - 0.5
            counter_mat[i, j] = ((cnt_w[i, j] + 3.0) / (cnt_g[i, j] + 6.0)) - 0.5

    adj_copick = row_normalize_adj(co_pick_mat)
    adj_synergy = row_normalize_adj(np.maximum(synergy_mat, 0.0) * np.log1p(syn_g))
    adj_counter = row_normalize_adj(np.maximum(counter_mat, 0.0) * np.log1p(cnt_g))
    adj_countered_by = row_normalize_adj(np.maximum(-counter_mat, 0.0) * np.log1p(cnt_g))

    hero_base_win_adv = (((hero_wins_train + 5.0) / (raw_pick_counts + 10.0)) - 0.5).astype(np.float32)

    global_pick_prob = (pick_2026 + 0.5) / (pick_2026.sum() + 0.5 * num_heroes)
    global_ban1_prob = (ban_p1_2026 + 0.5) / (ban_p1_2026.sum() + 0.5 * num_heroes)
    global_ban2_prob = (ban_p2_2026 + 0.5) / (ban_p2_2026.sum() + 0.5 * num_heroes)

    # Hierarchical Dirichlet smoothing toward performance-adjusted global 2026 distribution
    prior_strength = 25.0
    league_pick_log_priors = np.zeros((num_leagues, num_heroes), dtype=np.float32)
    league_ban_p1_log_priors = np.zeros((num_leagues, num_heroes), dtype=np.float32)
    league_ban_p2_log_priors = np.zeros((num_leagues, num_heroes), dtype=np.float32)
    for lg_i in range(num_leagues):
        p_cnt = lg_pick_counts[lg_i] + prior_strength * global_pick_prob
        b1_cnt = lg_ban_p1_counts[lg_i] + prior_strength * global_ban1_prob
        b2_cnt = lg_ban_p2_counts[lg_i] + prior_strength * global_ban2_prob
        league_pick_log_priors[lg_i] = np.log(p_cnt / p_cnt.sum())
        league_ban_p1_log_priors[lg_i] = np.log(b1_cnt / b1_cnt.sum())
        league_ban_p2_log_priors[lg_i] = np.log(b2_cnt / b2_cnt.sum())

    priors = {
        "pick_log_prior": np.log((pick_counts + 1.0) / (pick_counts.sum() + num_heroes)).astype(np.float32),
        "ban_p1_log_prior": np.log((ban_p1_counts + 1.0) / (ban_p1_counts.sum() + num_heroes)).astype(np.float32),
        "ban_p2_log_prior": np.log((ban_p2_counts + 1.0) / (ban_p2_counts.sum() + num_heroes)).astype(np.float32),
        "pick_2026_log_prior": np.log(global_pick_prob).astype(np.float32),
        "ban_p1_2026_log_prior": np.log(global_ban1_prob).astype(np.float32),
        "ban_p2_2026_log_prior": np.log(global_ban2_prob).astype(np.float32),
        "league_pick_log_priors": league_pick_log_priors,
        "league_ban_p1_log_priors": league_ban_p1_log_priors,
        "league_ban_p2_log_priors": league_ban_p2_log_priors,
        "hero_base_win_adv": hero_base_win_adv,
    }

    graphs = {
        "adj_copick": adj_copick,
        "adj_synergy": adj_synergy,
        "adj_counter": adj_counter,
        "adj_countered_by": adj_countered_by,
        "co_pick_mat": co_pick_mat,
        "counter_pick_mat": counter_pick_mat,
        "ban_target_mat": ban_target_mat,
        "synergy_mat": synergy_mat,
        "counter_mat": counter_mat,
        "skill_matrix": skill_matrix,
    }

    return (
        hero_names,
        hero_to_id,
        hero_features,
        lane_probs,
        priority_scores,
        graphs,
        priors,
        train_games,
        val_games,
    )


def order_team_picks_by_draft_logic(team_picks_ids, enemy_phase2_ban_ids, lane_probs, priority_scores):
    enemy_p2_lanes = set()
    for b_id in enemy_phase2_ban_ids:
        enemy_p2_lanes.add(int(np.argmax(lane_probs[b_id])))

    scored = []
    for slot_idx, h_id in enumerate(team_picks_ids):
        targeted_in_p2 = 1 if slot_idx in enemy_p2_lanes else 0
        score = priority_scores[h_id] - (50.0 if targeted_in_p2 else 0.0)
        scored.append((score, h_id))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [h_id for _, h_id in scored]


def build_tensor_dataset(games, hero_to_id, lane_probs, priority_scores, augment_factor=1):
    """
    Pre-build contiguous PyTorch TensorDataset in memory.
    When augment_factor >= 2, only swaps simultaneous double-pick turns within the SAME phase
    (e.g., Blue P2<->P3, Blue P4<->P5, Red P1<->P2) without corrupting Phase 1 vs Phase 2 boundaries.
    """
    num_heroes = len(hero_to_id)
    valid_games = []
    for g in games:
        bp = [hero_to_id[h] for h in g["blue_picks"] if h in hero_to_id]
        rp = [hero_to_id[h] for h in g["red_picks"] if h in hero_to_id]
        bb = [hero_to_id[h] for h in g["blue_bans"] if h in hero_to_id]
        rb = [hero_to_id[h] for h in g["red_bans"] if h in hero_to_id]
        if len(bp) == 5 and len(rp) == 5 and len(bb) == 4 and len(rb) == 4:
            valid_games.append((g, bp, rp, bb, rb))

    eff_aug = max(1, min(int(augment_factor), 2))
    total_steps = len(valid_games) * 18 * eff_aug
    ap_arr = np.zeros((total_steps, num_heroes), dtype=np.float32)
    ep_arr = np.zeros((total_steps, num_heroes), dtype=np.float32)
    ab_arr = np.zeros((total_steps, num_heroes), dtype=np.float32)
    eb_arr = np.zeros((total_steps, num_heroes), dtype=np.float32)
    mask_arr = np.zeros((total_steps, num_heroes), dtype=np.bool_)

    th_arr = np.zeros((total_steps, MAX_HISTORY_LEN), dtype=np.int64)
    tt_arr = np.zeros((total_steps, MAX_HISTORY_LEN), dtype=np.int64)
    ts_arr = np.zeros((total_steps, MAX_HISTORY_LEN), dtype=np.int64)
    tpad_arr = np.ones((total_steps, MAX_HISTORY_LEN), dtype=np.bool_)

    mctx_arr = np.zeros((total_steps, 11), dtype=np.float32)
    act_arr = np.zeros(total_steps, dtype=np.int64)
    ph_arr = np.zeros(total_steps, dtype=np.int64)
    target_arr = np.zeros(total_steps, dtype=np.int64)
    win_arr = np.zeros(total_steps, dtype=np.float32)
    pol_weight_arr = np.zeros(total_steps, dtype=np.float32)
    win_weight_arr = np.zeros(total_steps, dtype=np.float32)

    row_idx = 0
    for g, b_picks_raw, r_picks_raw, b_bans, r_bans in valid_games:
        b_gban = [hero_to_id[h] for h in g.get("blue_global_bans", []) if h in hero_to_id]
        r_gban = [hero_to_id[h] for h in g.get("red_global_bans", []) if h in hero_to_id]
        year_val = int(g.get("year", 2026)) if str(g.get("year", "2026")).isdigit() else 2026
        lg_id = encode_league_id(g.get("league", ""))
        lg_vec = [1.0 if i == lg_id else 0.0 for i in range(4)]
        recency_w = (1.0 if year_val >= 2026 else (0.5 if year_val == 2025 else 0.2)) * LEAGUE_SAMPLE_WEIGHTS[lg_id]
        blue_win = 1 if int(g.get("blue_win", 1)) == 1 else 0
        is_true_order = bool(g.get("is_true_order", False))

        if is_true_order:
            bp_canonical = list(b_picks_raw)
            rp_canonical = list(r_picks_raw)
        else:
            bp_canonical = order_team_picks_by_draft_logic(b_picks_raw, r_bans[2:4], lane_probs, priority_scores)
            rp_canonical = order_team_picks_by_draft_logic(r_picks_raw, b_bans[2:4], lane_probs, priority_scores)

        orderings = [(bp_canonical, rp_canonical)]
        if eff_aug >= 2:
            # Swap only simultaneous double-pick turns within the same phase:
            # Blue simultaneous: (P2, P3) and (P4, P5); Red simultaneous: (P1, P2)
            bp_swap = [bp_canonical[0], bp_canonical[2], bp_canonical[1], bp_canonical[4], bp_canonical[3]]
            rp_swap = [rp_canonical[1], rp_canonical[0], rp_canonical[2], rp_canonical[3], rp_canonical[4]]
            orderings.append((bp_swap, rp_swap))

        for bp_seq, rp_seq in orderings:
            step_targets = [
                b_bans[0],
                r_bans[0],
                b_bans[1],
                r_bans[1],
                bp_seq[0],
                rp_seq[0],
                rp_seq[1],
                bp_seq[1],
                bp_seq[2],
                rp_seq[2],
                r_bans[2],
                b_bans[2],
                r_bans[3],
                b_bans[3],
                rp_seq[3],
                bp_seq[3],
                bp_seq[4],
                rp_seq[4],
            ]

            cur_b_bans, cur_r_bans = [], []
            cur_b_picks, cur_r_picks = [], []
            history_events = []

            for step_idx, phase, action_type, side in DRAFT_STEPS:
                target_hero = step_targets[step_idx]
                if side == 0:
                    ally_picks, enemy_picks = cur_b_picks, cur_r_picks
                    ally_bans, enemy_bans = cur_b_bans, cur_r_bans
                    ally_gbans, enemy_gbans = b_gban, r_gban
                    acting_win = float(blue_win == 1)
                else:
                    ally_picks, enemy_picks = cur_r_picks, cur_b_picks
                    ally_bans, enemy_bans = cur_r_bans, cur_b_bans
                    ally_gbans, enemy_gbans = r_gban, b_gban
                    acting_win = float(blue_win == 0)

                for h in ally_picks:
                    ap_arr[row_idx, h] = 1.0
                    mask_arr[row_idx, h] = True
                for h in enemy_picks:
                    ep_arr[row_idx, h] = 1.0
                    mask_arr[row_idx, h] = True
                for h in ally_bans:
                    ab_arr[row_idx, h] = 1.0
                    mask_arr[row_idx, h] = True
                for h in enemy_bans:
                    eb_arr[row_idx, h] = 1.0
                    mask_arr[row_idx, h] = True

                if action_type == 1:
                    for h in ally_gbans:
                        mask_arr[row_idx, h] = True
                else:
                    for h in enemy_gbans:
                        mask_arr[row_idx, h] = True
                mask_arr[row_idx, target_hero] = False

                for i, (h_ev, act_ev, side_ev, s_ev) in enumerate(history_events):
                    same_side = side_ev == side
                    ttype = (1 if same_side else 2) if act_ev == 1 else (3 if same_side else 4)
                    th_arr[row_idx, i] = h_ev
                    tt_arr[row_idx, i] = ttype
                    ts_arr[row_idx, i] = s_ev
                    tpad_arr[row_idx, i] = False

                mctx_arr[row_idx] = [
                    step_idx / 17.0,
                    float(phase == 2),
                    float(action_type == 1),
                    float(side == 1),
                    float(year_val >= 2026),
                    len(ally_picks) / 5.0,
                    len(enemy_picks) / 5.0,
                    *lg_vec,
                ]
                act_arr[row_idx] = action_type
                ph_arr[row_idx] = phase
                target_arr[row_idx] = target_hero
                win_arr[row_idx] = acting_win

                # Decoupled supervision:
                # 1. Win-value loss applies to all actions across all games (unbiased 1.0 outcome balance)
                win_weight_arr[row_idx] = recency_w

                # 2. Policy loss applies to all bans (chronological on Liquipedia) and verified picks,
                #    with Advantage-Weighted Policy Imitation (1.25x for winning side picks, 0.75x for losing side picks)
                if action_type == 0:
                    pol_weight_arr[row_idx] = recency_w
                elif is_true_order:
                    win_mult = 1.25 if acting_win >= 0.5 else 0.75
                    pol_weight_arr[row_idx] = recency_w * win_mult
                else:
                    pol_weight_arr[row_idx] = 0.0

                history_events.append((target_hero, action_type, side, step_idx))
                if action_type == 0:
                    if side == 0:
                        cur_b_bans.append(target_hero)
                    else:
                        cur_r_bans.append(target_hero)
                else:
                    if side == 0:
                        cur_b_picks.append(target_hero)
                    else:
                        cur_r_picks.append(target_hero)
                row_idx += 1

    return TensorDataset(
        torch.from_numpy(ap_arr),
        torch.from_numpy(ep_arr),
        torch.from_numpy(ab_arr),
        torch.from_numpy(eb_arr),
        torch.from_numpy(mask_arr),
        torch.from_numpy(th_arr),
        torch.from_numpy(tt_arr),
        torch.from_numpy(ts_arr),
        torch.from_numpy(tpad_arr),
        torch.from_numpy(mctx_arr),
        torch.from_numpy(act_arr),
        torch.from_numpy(ph_arr),
        torch.from_numpy(target_arr),
        torch.from_numpy(win_arr),
        torch.from_numpy(pol_weight_arr),
        torch.from_numpy(win_weight_arr),
    )


class GPUTensorBatcher:
    """Zero-overhead in-VRAM mini-batcher for fast H100 training and Optuna HPO."""

    def __init__(self, dataset: TensorDataset, batch_size: int, shuffle: bool, device: torch.device):
        self.tensors = [t.to(device, non_blocking=True) for t in dataset.tensors]
        self.n = self.tensors[0].size(0)
        self.batch_size = batch_size
        self.shuffle = shuffle
        self.device = device

    def __len__(self):
        return (self.n + self.batch_size - 1) // self.batch_size

    def __iter__(self):
        if self.shuffle:
            perm = torch.randperm(self.n, device=self.device)
            for i in range(0, self.n, self.batch_size):
                idx = perm[i : i + self.batch_size]
                yield [t[idx] for t in self.tensors]
        else:
            for i in range(0, self.n, self.batch_size):
                yield [t[i : i + self.batch_size] for t in self.tensors]


class RelationalHeroGNN(nn.Module):
    """
    2-Layer Multi-Relational Graph Neural Network (R-GCN) over the 130-Hero Graph.
    """

    def __init__(self, num_heroes, feat_dim, d_model, dropout=0.20):
        super().__init__()
        self.num_heroes = num_heroes
        self.hero_embed = nn.Embedding(num_heroes, d_model)
        self.feat_proj = nn.Sequential(
            nn.Linear(feat_dim, d_model),
            nn.LayerNorm(d_model),
            nn.GELU(),
        )
        self.drop = nn.Dropout(dropout)

        self.w1_self = nn.Linear(d_model, d_model)
        self.w1_cp = nn.Linear(d_model, d_model, bias=False)
        self.w1_syn = nn.Linear(d_model, d_model, bias=False)
        self.w1_cnt = nn.Linear(d_model, d_model, bias=False)
        self.w1_cby = nn.Linear(d_model, d_model, bias=False)
        self.ln1 = nn.LayerNorm(d_model)

        self.w2_self = nn.Linear(d_model, d_model)
        self.w2_cp = nn.Linear(d_model, d_model, bias=False)
        self.w2_syn = nn.Linear(d_model, d_model, bias=False)
        self.w2_cnt = nn.Linear(d_model, d_model, bias=False)
        self.w2_cby = nn.Linear(d_model, d_model, bias=False)
        self.ln2 = nn.LayerNorm(d_model)

        self.gate = nn.Parameter(torch.tensor(0.0))

    def forward(self, hero_features, adj_cp, adj_syn, adj_cnt, adj_cby):
        ids = torch.arange(self.num_heroes, device=hero_features.device)
        h0 = self.hero_embed(ids) + self.feat_proj(hero_features)

        m1 = (
            self.w1_self(h0)
            + torch.matmul(adj_cp, self.w1_cp(h0))
            + torch.matmul(adj_syn, self.w1_syn(h0))
            + torch.matmul(adj_cnt, self.w1_cnt(h0))
            + torch.matmul(adj_cby, self.w1_cby(h0))
        )
        h1 = self.ln1(h0 + self.drop(F.gelu(m1)))

        m2 = (
            self.w2_self(h1)
            + torch.matmul(adj_cp, self.w2_cp(h1))
            + torch.matmul(adj_syn, self.w2_syn(h1))
            + torch.matmul(adj_cnt, self.w2_cnt(h1))
            + torch.matmul(adj_cby, self.w2_cby(h1))
        )
        h2 = self.ln2(h1 + self.drop(F.gelu(m2)))

        g = torch.sigmoid(self.gate)
        return (1.0 - g) * h0 + g * h2


class RoVDraftGNNTransformer(nn.Module):
    """
    State-of-the-Art MOBA Draft AI Architecture:
      1. Multi-Relational Hero Graph Neural Network (RelationalHeroGNN)
      2. Contextual Multi-Head Self-Attention Draft Transformer
      3. Bounded Cosine-Gated Neural Residual + Explicit Role/Skill & Graph Priors
      4. Dual Policy Head (Next-Pick/Ban) & Action-Value Head (Counterfactual Win-Probability Q(s, a))
    """

    def __init__(
        self,
        num_heroes,
        hero_features,
        lane_probs,
        graphs,
        priors,
        d_model=64,
        nhead=4,
        num_layers=2,
        dropout=0.20,
        neural_scale=0.65,
    ):
        super().__init__()
        self.num_heroes = num_heroes
        self.d_model = d_model
        self.dropout_rate = dropout
        self.neural_scale_init = neural_scale

        self.register_buffer("hero_features", torch.tensor(hero_features, dtype=torch.float32))
        self.register_buffer("lane_probs", torch.tensor(lane_probs, dtype=torch.float32))
        self.register_buffer("skill_matrix", torch.tensor(graphs["skill_matrix"], dtype=torch.float32))
        self.register_buffer("adj_copick", torch.tensor(graphs["adj_copick"], dtype=torch.float32))
        self.register_buffer("adj_synergy", torch.tensor(graphs["adj_synergy"], dtype=torch.float32))
        self.register_buffer("adj_counter", torch.tensor(graphs["adj_counter"], dtype=torch.float32))
        self.register_buffer("adj_countered_by", torch.tensor(graphs["adj_countered_by"], dtype=torch.float32))

        self.register_buffer("co_pick_mat", torch.tensor(graphs["co_pick_mat"], dtype=torch.float32))
        self.register_buffer("counter_pick_mat", torch.tensor(graphs["counter_pick_mat"], dtype=torch.float32))
        self.register_buffer("ban_target_mat", torch.tensor(graphs["ban_target_mat"], dtype=torch.float32))
        self.register_buffer("synergy_mat", torch.tensor(graphs["synergy_mat"], dtype=torch.float32))
        self.register_buffer("counter_mat", torch.tensor(graphs["counter_mat"], dtype=torch.float32))

        self.register_buffer("pick_log_prior", torch.tensor(priors["pick_log_prior"], dtype=torch.float32))
        self.register_buffer("ban_p1_log_prior", torch.tensor(priors["ban_p1_log_prior"], dtype=torch.float32))
        self.register_buffer("ban_p2_log_prior", torch.tensor(priors["ban_p2_log_prior"], dtype=torch.float32))
        self.register_buffer("pick_2026_log_prior", torch.tensor(priors["pick_2026_log_prior"], dtype=torch.float32))
        self.register_buffer(
            "ban_p1_2026_log_prior", torch.tensor(priors["ban_p1_2026_log_prior"], dtype=torch.float32)
        )
        self.register_buffer(
            "ban_p2_2026_log_prior", torch.tensor(priors["ban_p2_2026_log_prior"], dtype=torch.float32)
        )
        self.register_buffer("hero_base_win_adv", torch.tensor(priors["hero_base_win_adv"], dtype=torch.float32))
        self.has_league_conditioning = "league_pick_log_priors" in priors
        if self.has_league_conditioning:
            self.register_buffer(
                "league_pick_log_priors",
                torch.tensor(priors["league_pick_log_priors"], dtype=torch.float32),
            )
            self.register_buffer(
                "league_ban_p1_log_priors",
                torch.tensor(priors["league_ban_p1_log_priors"], dtype=torch.float32),
            )
            self.register_buffer(
                "league_ban_p2_log_priors",
                torch.tensor(priors["league_ban_p2_log_priors"], dtype=torch.float32),
            )

        self.gnn = RelationalHeroGNN(num_heroes, hero_features.shape[1], d_model, dropout=dropout)

        self.token_type_embed = nn.Embedding(5, d_model, padding_idx=0)
        self.step_pos_embed = nn.Embedding(18, d_model)

        self.meta_dim = 11 if self.has_league_conditioning else 7
        macro_dim = 4 * d_model + 10 + 20 + self.meta_dim
        self.cls_proj = nn.Sequential(
            nn.Linear(macro_dim, d_model * 2),
            nn.LayerNorm(d_model * 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model * 2, d_model),
            nn.LayerNorm(d_model),
        )

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=d_model * 2,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=False,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.joint_drop = nn.Dropout(dropout)

        self.pick_query = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(d_model * 2, d_model),
            nn.LayerNorm(d_model),
            nn.GELU(),
        )
        self.ban1_query = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(d_model * 2, d_model),
            nn.LayerNorm(d_model),
            nn.GELU(),
        )
        self.ban2_query = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(d_model * 2, d_model),
            nn.LayerNorm(d_model),
            nn.GELU(),
        )

        self.neural_temp = nn.Parameter(torch.tensor([neural_scale, neural_scale, neural_scale], dtype=torch.float32))

        if self.has_league_conditioning:
            self.w_pick = nn.Parameter(
                torch.tensor([0.35, 0.35, 2.30, 0.00, 1.25, 0.85, 0.00, 0.90, 0.35], dtype=torch.float32)
            )
            self.w_ban1 = nn.Parameter(
                torch.tensor([0.30, 0.45, 0.00, 0.15, 0.20, 0.20, 0.30, -0.40, 0.35], dtype=torch.float32)
            )
            self.w_ban2 = nn.Parameter(
                torch.tensor([0.25, 0.40, 0.00, 1.95, 0.35, 0.30, 1.15, -0.60, 0.30], dtype=torch.float32)
            )
        else:
            self.w_pick = nn.Parameter(
                torch.tensor([0.45, 0.55, 2.30, 0.00, 1.25, 0.85, 0.00, 0.90], dtype=torch.float32)
            )
            self.w_ban1 = nn.Parameter(
                torch.tensor([0.40, 0.65, 0.00, 0.15, 0.20, 0.20, 0.30, -0.40], dtype=torch.float32)
            )
            self.w_ban2 = nn.Parameter(
                torch.tensor([0.35, 0.55, 0.00, 1.95, 0.35, 0.30, 1.15, -0.60], dtype=torch.float32)
            )

        self.state_value_head = nn.Sequential(
            nn.Linear(d_model * 2, 64),
            nn.LayerNorm(64),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(64, 1),
        )
        self.action_adv_proj = nn.Linear(d_model * 2, d_model)

    def forward(
        self,
        ally_picks_vec,
        enemy_picks_vec,
        ally_bans_vec,
        enemy_bans_vec,
        unavailable_mask,
        tok_heroes,
        tok_types,
        tok_steps,
        tok_pad_mask,
        meta_ctx,
        action_type,
        phase,
    ):
        B = ally_picks_vec.size(0)
        device = ally_picks_vec.device

        if meta_ctx.size(-1) > self.meta_dim:
            meta_ctx_macro = meta_ctx[:, : self.meta_dim]
        elif meta_ctx.size(-1) < self.meta_dim:
            default_lg = (
                torch.tensor(
                    PERFORMANCE_GLOBAL_LEAGUE_WEIGHTS,
                    dtype=meta_ctx.dtype,
                    device=device,
                )
                .unsqueeze(0)
                .expand(B, -1)
            )
            meta_ctx_macro = torch.cat([meta_ctx, default_lg], dim=-1)
        else:
            meta_ctx_macro = meta_ctx

        H_gnn = self.gnn(
            self.hero_features,
            self.adj_copick,
            self.adj_synergy,
            self.adj_counter,
            self.adj_countered_by,
        )

        ally_p_emb = torch.matmul(ally_picks_vec, H_gnn)
        enemy_p_emb = torch.matmul(enemy_picks_vec, H_gnn)
        ally_b_emb = torch.matmul(ally_bans_vec, H_gnn)
        enemy_b_emb = torch.matmul(enemy_bans_vec, H_gnn)

        ally_lanes = torch.matmul(ally_picks_vec, self.lane_probs)
        enemy_lanes = torch.matmul(enemy_picks_vec, self.lane_probs)
        ally_missing_lanes = torch.clamp(1.0 - ally_lanes, min=0.0, max=1.0)
        enemy_missing_lanes = torch.clamp(1.0 - enemy_lanes, min=0.0, max=1.0)

        ally_skills = torch.matmul(ally_picks_vec, self.skill_matrix) * 0.2
        enemy_skills = torch.matmul(enemy_picks_vec, self.skill_matrix) * 0.2

        macro_in = torch.cat(
            [
                ally_p_emb,
                enemy_p_emb,
                ally_b_emb,
                enemy_b_emb,
                ally_missing_lanes,
                enemy_missing_lanes,
                ally_skills,
                enemy_skills,
                meta_ctx_macro,
            ],
            dim=-1,
        )
        cls_tok = self.cls_proj(macro_in)

        hist_tokens = (H_gnn[tok_heroes] + self.token_type_embed(tok_types) + self.step_pos_embed(tok_steps)) * (
            (~tok_pad_mask).unsqueeze(-1).float()
        )
        seq_in = torch.cat([cls_tok.unsqueeze(1), hist_tokens], dim=1)
        cls_mask = torch.zeros((B, 1), dtype=torch.bool, device=device)
        full_pad_mask = torch.cat([cls_mask, tok_pad_mask], dim=1)

        seq_out = self.transformer(seq_in, src_key_padding_mask=full_pad_mask)
        trans_cls = seq_out[:, 0, :]
        joint_state = self.joint_drop(torch.cat([trans_cls, cls_tok], dim=-1))

        scale = 1.0 / math.sqrt(self.d_model)
        temps = torch.clamp(self.neural_temp, min=0.10, max=1.50)
        neural_pick_logits = torch.matmul(self.pick_query(joint_state), H_gnn.t()) * (scale * temps[0])
        neural_ban1_logits = torch.matmul(self.ban1_query(joint_state), H_gnn.t()) * (scale * temps[1])
        neural_ban2_logits = torch.matmul(self.ban2_query(joint_state), H_gnn.t()) * (scale * temps[2])

        ally_lane_fit = torch.matmul(ally_missing_lanes, self.lane_probs.t())
        enemy_lane_fit = torch.matmul(enemy_missing_lanes, self.lane_probs.t())
        copick_score = torch.matmul(ally_picks_vec, self.co_pick_mat.t())
        counter_pick_score = torch.matmul(enemy_picks_vec, self.counter_pick_mat.t())
        ban_target_score = torch.matmul(enemy_picks_vec, self.ban_target_mat.t())
        syn_score = torch.matmul(ally_picks_vec, self.synergy_mat.t())
        cnt_score = torch.matmul(enemy_picks_vec, self.counter_mat.t())
        syn_plus_cnt = syn_score + cnt_score

        wp = self.w_pick
        pick_logits = (
            neural_pick_logits
            + wp[0] * self.pick_log_prior.unsqueeze(0)
            + wp[1] * self.pick_2026_log_prior.unsqueeze(0)
            + wp[2] * ally_lane_fit
            + wp[3] * enemy_lane_fit
            + wp[4] * copick_score
            + wp[5] * counter_pick_score
            + wp[6] * ban_target_score
            + wp[7] * syn_plus_cnt
        )

        wb1 = self.w_ban1
        ban1_logits = (
            neural_ban1_logits
            + wb1[0] * self.ban_p1_log_prior.unsqueeze(0)
            + wb1[1] * self.ban_p1_2026_log_prior.unsqueeze(0)
            + wb1[2] * ally_lane_fit
            + wb1[3] * enemy_lane_fit
            + wb1[4] * copick_score
            + wb1[5] * counter_pick_score
            + wb1[6] * ban_target_score
            + wb1[7] * syn_plus_cnt
        )

        wb2 = self.w_ban2
        ban2_logits = (
            neural_ban2_logits
            + wb2[0] * self.ban_p2_log_prior.unsqueeze(0)
            + wb2[1] * self.ban_p2_2026_log_prior.unsqueeze(0)
            + wb2[2] * ally_lane_fit
            + wb2[3] * enemy_lane_fit
            + wb2[4] * copick_score
            + wb2[5] * counter_pick_score
            + wb2[6] * ban_target_score
            + wb2[7] * syn_plus_cnt
        )

        if self.has_league_conditioning and wp.numel() >= 9:
            league_weights = meta_ctx_macro[:, 7:11]
            lg_pick_prior = torch.matmul(league_weights, self.league_pick_log_priors)
            lg_ban1_prior = torch.matmul(league_weights, self.league_ban_p1_log_priors)
            lg_ban2_prior = torch.matmul(league_weights, self.league_ban_p2_log_priors)
            pick_logits = pick_logits + wp[8] * lg_pick_prior
            ban1_logits = ban1_logits + wb1[8] * lg_ban1_prior
            ban2_logits = ban2_logits + wb2[8] * lg_ban2_prior

        is_pick = (action_type == 1).unsqueeze(-1)
        is_phase2 = (phase == 2).unsqueeze(-1)
        ban_logits = torch.where(is_phase2, ban2_logits, ban1_logits)
        policy_logits = torch.where(is_pick, pick_logits, ban_logits)
        policy_logits = policy_logits.masked_fill(unavailable_mask, -1e9)

        v_state = self.state_value_head(joint_state)
        neural_adv = torch.matmul(self.action_adv_proj(joint_state), H_gnn.t()) * scale
        pick_win_edge = self.hero_base_win_adv.unsqueeze(0) + 1.5 * syn_score + 1.5 * cnt_score
        ban_win_edge = -0.5 * self.hero_base_win_adv.unsqueeze(0) - 1.0 * cnt_score
        domain_win_edge = torch.where(is_pick, pick_win_edge, ban_win_edge)

        q_win_logits = v_state + 0.35 * torch.tanh(neural_adv) + domain_win_edge
        return policy_logits, q_win_logits


def evaluate_sota_model(model, loader, device):
    """Fully vectorized GPU evaluation (zero per-sample Python loops or CUDA syncs)."""
    model.eval()
    bucket_defs = [
        ("ban_p1", 0, 1),
        ("pick_p1", 1, 1),
        ("ban_p2", 0, 2),
        ("pick_p2", 1, 2),
    ]
    metrics = {
        k: {"top1": 0, "top3": 0, "top5": 0, "top10": 0, "total": 0}
        for k in ["ban_p1", "pick_p1", "ban_p2", "pick_p2", "overall"]
    }
    total_loss = 0.0
    total_count = 0
    win_correct_late = 0
    win_total_late = 0

    with torch.no_grad():
        for batch in loader:
            if batch[0].device != device:
                batch = [x.to(device, non_blocking=True) for x in batch]
            ap, ep, ab, eb, mask, th, tt, ts, tpad, mctx, act, ph, target, win_lbl = batch[:14]
            pol_w = batch[14] if len(batch) > 14 else torch.ones_like(win_lbl)

            policy_logits, q_win_logits = model(ap, ep, ab, eb, mask, th, tt, ts, tpad, mctx, act, ph)

            # Evaluate policy loss and top-k on clean ground-truth steps (pol_w > 0)
            eval_mask = pol_w > 0
            n_eval = int(eval_mask.sum().item())
            if n_eval > 0:
                loss = F.cross_entropy(policy_logits[eval_mask], target[eval_mask], reduction="sum")
                total_loss += loss.item()
                total_count += n_eval

            chosen_q = q_win_logits.gather(1, target.unsqueeze(1)).squeeze(1)
            pred_win = (torch.sigmoid(chosen_q) >= 0.5).float()

            late_mask = (act == 1) & (ph == 2)
            n_late = int(late_mask.sum().item())
            if n_late > 0:
                win_total_late += n_late
                win_correct_late += int((pred_win[late_mask] == win_lbl[late_mask]).sum().item())

            top10_preds = torch.topk(policy_logits, k=10, dim=-1).indices
            hits = top10_preds == target.unsqueeze(1)
            h1 = hits[:, :1].any(dim=1) & eval_mask
            h3 = hits[:, :3].any(dim=1) & eval_mask
            h5 = hits[:, :5].any(dim=1) & eval_mask
            h10 = hits.any(dim=1) & eval_mask

            metrics["overall"]["total"] += n_eval
            metrics["overall"]["top1"] += int(h1.sum().item())
            metrics["overall"]["top3"] += int(h3.sum().item())
            metrics["overall"]["top5"] += int(h5.sum().item())
            metrics["overall"]["top10"] += int(h10.sum().item())

            for b_key, a_val, p_val in bucket_defs:
                b_mask = (act == a_val) & (ph == p_val) & eval_mask
                cnt = int(b_mask.sum().item())
                if cnt > 0:
                    metrics[b_key]["total"] += cnt
                    metrics[b_key]["top1"] += int(h1[b_mask].sum().item())
                    metrics[b_key]["top3"] += int(h3[b_mask].sum().item())
                    metrics[b_key]["top5"] += int(h5[b_mask].sum().item())
                    metrics[b_key]["top10"] += int(h10[b_mask].sum().item())

    avg_loss = total_loss / max(1, total_count)
    win_acc = (win_correct_late / max(1, win_total_late)) * 100.0
    return avg_loss, metrics, win_acc


def parse_args():
    parser = argparse.ArgumentParser(description="Train SOTA RoVDraftGNNTransformer (Local CPU or ERAWAN H100 GPU)")
    parser.add_argument("--preset", choices=["local", "h100"], default="local", help="Hardware preset configuration")
    parser.add_argument("--d-model", type=int, default=None, help="Transformer & GNN embedding dimension")
    parser.add_argument("--nhead", type=int, default=None, help="Number of attention heads")
    parser.add_argument("--num-layers", type=int, default=None, help="Number of Transformer encoder layers")
    parser.add_argument("--dropout", type=float, default=None, help="Dropout rate")
    parser.add_argument("--neural-scale", type=float, default=None, help="Initial cosine neural logit temperature")
    parser.add_argument("--epochs", type=int, default=None, help="Training epochs")
    parser.add_argument("--batch-size", type=int, default=None, help="Mini-batch size")
    parser.add_argument("--augment-factor", type=int, default=None, help="Simultaneous pick-pair augmentation (1 or 2)")
    parser.add_argument("--lr", type=float, default=None, help="Peak learning rate")
    parser.add_argument("--weight-decay", type=float, default=None, help="AdamW weight decay")
    parser.add_argument("--label-smoothing", type=float, default=None, help="Cross-entropy label smoothing")
    parser.add_argument("--win-loss-weight", type=float, default=None, help="Weight of auxiliary win-value loss")
    parser.add_argument(
        "--top-rank",
        type=int,
        default=None,
        choices=[1, 2, 3, 4, 5],
        help="Select rank 1..5 from sota_rov_top5_trials.json",
    )
    parser.add_argument("--use-safest", action="store_true", help="Automatically use safest_recommended_trial from HPO")
    parser.add_argument(
        "--dataset-path",
        type=Path,
        default=None,
        help="Path to training matches JSON (default: data/matches_training.json or data/matches_draft_full.json)",
    )
    return parser.parse_args()


def main():
    global HAS_MLFLOW
    args = parse_args()

    # Load Optuna best_params / top_5_trials if available
    best_params_file = BEST_PARAMS_DIR / "sota_rov_best_params.json"
    top5_file = BEST_PARAMS_DIR / "sota_rov_top5_trials.json"
    tuned = {}
    if top5_file.exists() and (args.top_rank is not None or args.use_safest):
        try:
            with open(top5_file, "r", encoding="utf-8") as f:
                t5_data = json.load(f)
            if args.use_safest and t5_data.get("safest_recommended_trial"):
                chosen = t5_data["safest_recommended_trial"]
                tuned = chosen.get("params", {})
                print(
                    f"Loaded [SAFEST] HPO candidate (Rank #{chosen.get('rank')}, Trial #{chosen.get('trial_number')}, "
                    f"Val={chosen.get('val_loss')}, Gap={chosen.get('overfit_gap')}): {tuned}",
                    flush=True,
                )
            elif args.top_rank is not None:
                candidates = t5_data.get("top_5_trials", [])
                idx = min(max(0, args.top_rank - 1), len(candidates) - 1)
                if candidates:
                    chosen = candidates[idx]
                    tuned = chosen.get("params", {})
                    print(
                        f"Loaded Top-{args.top_rank} HPO candidate (Trial #{chosen.get('trial_number')}, "
                        f"Val={chosen.get('val_loss')}, Gap={chosen.get('overfit_gap')}): {tuned}",
                        flush=True,
                    )
        except Exception as e:
            print(f"Warning: could not read {top5_file}: {e}", flush=True)
    elif best_params_file.exists():
        try:
            with open(best_params_file, "r", encoding="utf-8") as f:
                bp_data = json.load(f)
                if bp_data.get("safest_recommended_trial"):
                    chosen = bp_data["safest_recommended_trial"]
                    tuned = chosen.get("params", bp_data.get("best_params", {}))
                    print(
                        f"Loaded safest tuned hyperparameters from {best_params_file.name} "
                        f"(Rank #{chosen.get('rank')}, Val={chosen.get('val_loss')}, Gap={chosen.get('overfit_gap')}): {tuned}",
                        flush=True,
                    )
                else:
                    tuned = bp_data.get("best_params", {})
                    print(f"Loaded tuned hyperparameters from {best_params_file.name}: {tuned}", flush=True)
        except Exception as e:
            print(f"Warning: could not read {best_params_file}: {e}", flush=True)

    if args.preset == "h100":
        # Production locked architecture: d_model=256, nhead=4, num_layers=1 (Trial #14 Safest)
        d_model = args.d_model or tuned.get("d_model", 256)
        nhead = args.nhead or tuned.get("nhead", 4)
        num_layers = args.num_layers or tuned.get("num_layers", 1)
        dropout = args.dropout if args.dropout is not None else tuned.get("dropout", 0.1941)
        neural_scale = args.neural_scale if args.neural_scale is not None else tuned.get("neural_scale", 1.0746)
        epochs = args.epochs or 30
        batch_size = args.batch_size or tuned.get("batch_size", 1024)
        augment_factor = args.augment_factor or tuned.get("augment_factor", 1)
        lr = args.lr or tuned.get("lr", 1.93e-3)
        weight_decay = args.weight_decay if args.weight_decay is not None else tuned.get("weight_decay", 6.89e-4)
        label_smoothing = (
            args.label_smoothing if args.label_smoothing is not None else tuned.get("label_smoothing", 0.0397)
        )
        win_loss_weight = (
            args.win_loss_weight if args.win_loss_weight is not None else tuned.get("win_loss_weight", 0.2186)
        )
    else:
        d_model = args.d_model or tuned.get("d_model", 128)
        nhead = args.nhead or tuned.get("nhead", 4)
        num_layers = args.num_layers or tuned.get("num_layers", 1)
        dropout = args.dropout if args.dropout is not None else tuned.get("dropout", 0.20)
        neural_scale = args.neural_scale if args.neural_scale is not None else tuned.get("neural_scale", 0.65)
        epochs = args.epochs or 8
        batch_size = args.batch_size or 512
        augment_factor = args.augment_factor or 1
        lr = args.lr or 2.0e-3
        weight_decay = args.weight_decay if args.weight_decay is not None else 5e-3
        label_smoothing = args.label_smoothing if args.label_smoothing is not None else 0.04
        win_loss_weight = args.win_loss_weight if args.win_loss_weight is not None else 0.20

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = True

    t0 = time.time()
    (
        hero_names,
        hero_to_id,
        hero_features,
        lane_probs,
        priority_scores,
        graphs,
        priors,
        train_games,
        val_games,
    ) = load_sota_data_and_graphs(args.dataset_path)

    print(
        f"[{args.preset.upper()}] Building vectorized SOTA tensors (augment_factor={augment_factor}) "
        f"from {len(train_games)} train games & {len(val_games)} val games...",
        flush=True,
    )
    train_ds = build_tensor_dataset(train_games, hero_to_id, lane_probs, priority_scores, augment_factor=augment_factor)
    val_ds = build_tensor_dataset(val_games, hero_to_id, lane_probs, priority_scores, augment_factor=1)
    print(
        f"Train decision steps: {len(train_ds):,} | Val decision steps: {len(val_ds):,} (built in {time.time() - t0:.1f}s)",
        flush=True,
    )

    if device.type == "cuda":
        train_loader = GPUTensorBatcher(train_ds, batch_size=batch_size, shuffle=True, device=device)
        val_loader = GPUTensorBatcher(val_ds, batch_size=2048, shuffle=False, device=device)
    else:
        train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
        val_loader = DataLoader(val_ds, batch_size=1024, shuffle=False)

    model_config = {
        "d_model": d_model,
        "nhead": nhead,
        "num_layers": num_layers,
        "dropout": dropout,
        "neural_scale": neural_scale,
    }
    model = RoVDraftGNNTransformer(
        num_heroes=len(hero_names),
        hero_features=hero_features,
        lane_probs=lane_probs,
        graphs=graphs,
        priors=priors,
        **model_config,
    ).to(device)

    total_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(
        f"Initialized RoVDraftGNNTransformer (d_model={d_model}, nhead={nhead}, layers={num_layers}, "
        f"dropout={dropout:.2f}, neural_scale={neural_scale:.2f} | {total_params:,} params) on {device}",
        flush=True,
    )

    if HAS_MLFLOW:
        try:
            mlflow.set_experiment("RoV_Draft_Intelligence")
            mlflow.start_run(run_name=f"sota_train_{args.preset}_{int(time.time())}")
            mlflow.log_params(model_config)
            mlflow.log_params(
                {
                    "lr": lr,
                    "weight_decay": weight_decay,
                    "label_smoothing": label_smoothing,
                    "win_loss_weight": win_loss_weight,
                    "batch_size": batch_size,
                    "preset": args.preset,
                    "total_params": total_params,
                    "recency_weighting": "2026=1.0,2025=0.5,2024=0.2",
                    "val_split": "100% 2026 matches",
                }
            )
            print("MLflow tracking active (Experiment: 'RoV_Draft_Intelligence')", flush=True)
        except Exception as e:
            print(f"Warning: MLflow start_run error: {e}. Disabling MLflow.", flush=True)
            logging.getLogger("mlflow").setLevel(logging.ERROR)
            HAS_MLFLOW = False

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    use_amp = device.type == "cuda" and torch.cuda.is_bf16_supported()

    best_val_loss = float("inf")
    best_metrics = None
    best_win_acc = 0.0
    patience = 8
    bad_epochs = 0

    for epoch in range(1, epochs + 1):
        ep_start = time.time()
        model.train()
        train_pol_loss = 0.0
        train_n = 0

        for batch in train_loader:
            if batch[0].device != device:
                batch = [x.to(device, non_blocking=True) for x in batch]
            ap, ep, ab, eb, mask, th, tt, ts, tpad, mctx, act, ph, target, win_lbl = batch[:14]
            sw_pol = batch[14] if len(batch) > 14 else torch.ones_like(win_lbl)
            sw_win = batch[15] if len(batch) > 15 else sw_pol
            optimizer.zero_grad(set_to_none=True)

            if use_amp:
                with torch.amp.autocast("cuda", dtype=torch.bfloat16):
                    policy_logits, q_win_logits = model(ap, ep, ab, eb, mask, th, tt, ts, tpad, mctx, act, ph)
                    pol_raw = F.cross_entropy(policy_logits, target, label_smoothing=label_smoothing, reduction="none")
                    pol_loss = (pol_raw * sw_pol).sum() / torch.clamp(sw_pol.sum(), min=1e-5)
                    chosen_q = q_win_logits.gather(1, target.unsqueeze(1)).squeeze(1)
                    win_raw = F.binary_cross_entropy_with_logits(chosen_q, win_lbl, reduction="none")
                    win_loss = (win_raw * sw_win).sum() / torch.clamp(sw_win.sum(), min=1e-5)
                    loss = pol_loss + win_loss_weight * win_loss
            else:
                policy_logits, q_win_logits = model(ap, ep, ab, eb, mask, th, tt, ts, tpad, mctx, act, ph)
                pol_raw = F.cross_entropy(policy_logits, target, label_smoothing=label_smoothing, reduction="none")
                pol_loss = (pol_raw * sw_pol).sum() / torch.clamp(sw_pol.sum(), min=1e-5)
                chosen_q = q_win_logits.gather(1, target.unsqueeze(1)).squeeze(1)
                win_raw = F.binary_cross_entropy_with_logits(chosen_q, win_lbl, reduction="none")
                win_loss = (win_raw * sw_win).sum() / torch.clamp(sw_win.sum(), min=1e-5)
                loss = pol_loss + win_loss_weight * win_loss

            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            # Track unsmoothed cross-entropy on verified steps for apples-to-apples comparison with Val Loss
            with torch.no_grad():
                train_mask = sw_pol > 0
                if train_mask.any():
                    raw_ce = F.cross_entropy(policy_logits[train_mask], target[train_mask], reduction="sum")
                    train_pol_loss += raw_ce.item()
                    train_n += int(train_mask.sum().item())

        scheduler.step()

        val_loss, val_metrics, val_win_acc = evaluate_sota_model(model, val_loader, device)
        ov = val_metrics["overall"]
        t1 = ov["top1"] / ov["total"] * 100
        t3 = ov["top3"] / ov["total"] * 100
        t5 = ov["top5"] / ov["total"] * 100
        t10 = ov["top10"] / ov["total"] * 100
        is_best = val_loss < best_val_loss
        marker = " *BEST*" if is_best else ""
        print(
            f"  Epoch {epoch:02d}/{epochs:02d} ({time.time() - ep_start:.1f}s) | Pol Loss: {train_pol_loss / train_n:.4f} | "
            f"Val Loss: {val_loss:.4f} | Top-1: {t1:.2f}% | Top-3: {t3:.2f}% | Top-5: {t5:.2f}% | Top-10: {t10:.2f}% | WinAcc: {val_win_acc:.1f}%{marker}",
            flush=True,
        )

        if HAS_MLFLOW:
            try:
                mlflow.log_metrics(
                    {
                        "epoch_train_pol_loss": train_pol_loss / max(1, train_n),
                        "epoch_val_loss": val_loss,
                        "epoch_top1_pct": t1,
                        "epoch_top3_pct": t3,
                        "epoch_top5_pct": t5,
                        "epoch_top10_pct": t10,
                        "epoch_win_acc_pct": val_win_acc,
                    },
                    step=epoch,
                )
            except Exception:
                pass

        if is_best:
            best_val_loss = val_loss
            best_metrics = val_metrics
            best_win_acc = val_win_acc
            bad_epochs = 0
            checkpoint = {
                "architecture": "RoVDraftGNNTransformer",
                "model_config": model_config,
                "model_state_dict": model.state_dict(),
                "hero_names": hero_names,
                "hero_to_id": hero_to_id,
                "hero_features": hero_features,
                "lane_probs": lane_probs,
                "graphs": graphs,
                "priors": priors,
                "val_loss": best_val_loss,
                "val_win_acc": best_win_acc,
            }
            torch.save(checkpoint, MODEL_DIR / "sota_draft_gnn_transformer.pt")
        else:
            bad_epochs += 1
            if bad_epochs >= patience:
                print(f"  Early stopping triggered at epoch {epoch} (best Val Loss: {best_val_loss:.4f})", flush=True)
                break

    print("\n=== SOTA RoVDraftGNNTransformer Validation Metrics (Out of 130 Heroes) ===", flush=True)
    for k, label in [
        ("ban_p1", "Ban Phase 1 (Steps 1-4)"),
        ("pick_p1", "Pick Phase 1 (Steps 5-10)"),
        ("ban_p2", "Ban Phase 2 (Steps 11-14)"),
        ("pick_p2", "Pick Phase 2 (Steps 15-18)"),
        ("overall", "Overall All 18 Steps"),
    ]:
        m = best_metrics[k]
        tot = max(1, m["total"])
        print(
            f"{label:28s} -> Top-1: {m['top1'] / tot * 100:5.2f}% | Top-3: {m['top3'] / tot * 100:5.2f}% | "
            f"Top-5: {m['top5'] / tot * 100:5.2f}% | Top-10: {m['top10'] / tot * 100:5.2f}%",
            flush=True,
        )
    print(f"Saved SOTA checkpoint to: {MODEL_DIR / 'sota_draft_gnn_transformer.pt'}", flush=True)

    if HAS_MLFLOW:
        try:
            ov = best_metrics["overall"]
            tot = max(1, ov["total"])
            mlflow.log_metrics(
                {
                    "best_val_loss": best_val_loss,
                    "best_win_acc_pct": best_win_acc,
                    "final_top1_pct": ov["top1"] / tot * 100,
                    "final_top3_pct": ov["top3"] / tot * 100,
                    "final_top5_pct": ov["top5"] / tot * 100,
                    "final_top10_pct": ov["top10"] / tot * 100,
                }
            )
            ckpt_path = MODEL_DIR / "sota_draft_gnn_transformer.pt"
            if ckpt_path.exists():
                mlflow.log_artifact(str(ckpt_path))
            mlflow.end_run()
            print("MLflow: Logged final SOTA training run and checkpoint artifact", flush=True)
        except Exception as e:
            print(f"Warning: MLflow finalize error: {e}", flush=True)


if __name__ == "__main__":
    main()
