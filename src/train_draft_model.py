import json
import math
import random
from pathlib import Path
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

SEED = 42
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)

# 18 canonical draft steps in tournament mode:
# (step_idx, phase, action_type, side)  where action_type: 0=BAN, 1=PICK; side: 0=BLUE, 1=RED
DRAFT_STEPS = [
    # Phase 1 Bans (0..3)
    (0, 1, 0, 0),   # Blue Ban 1
    (1, 1, 0, 1),   # Red Ban 1
    (2, 1, 0, 0),   # Blue Ban 2
    (3, 1, 0, 1),   # Red Ban 2
    # Phase 1 Picks (4..9)
    (4, 1, 1, 0),   # Blue Pick 1
    (5, 1, 1, 1),   # Red Pick 1
    (6, 1, 1, 1),   # Red Pick 2
    (7, 1, 1, 0),   # Blue Pick 2
    (8, 1, 1, 0),   # Blue Pick 3
    (9, 1, 1, 1),   # Red Pick 3
    # Phase 2 Bans (10..13)
    (10, 2, 0, 1),  # Red Ban 3
    (11, 2, 0, 0),  # Blue Ban 3
    (12, 2, 0, 1),  # Red Ban 4
    (13, 2, 0, 0),  # Blue Ban 4
    # Phase 2 Picks (14..17)
    (14, 2, 1, 1),  # Red Pick 4
    (15, 2, 1, 0),  # Blue Pick 4
    (16, 2, 1, 0),  # Blue Pick 5
    (17, 2, 1, 1),  # Red Pick 5
]


def load_hero_features_and_matrices():
    """Load 130 heroes features, lane distributions, synergy matrix, and counter matrix."""
    heroes_df = pd.read_csv(DATA_DIR / "heroes_130_summary.csv").sort_values("name").reset_index(drop=True)
    stats_df = pd.read_csv(DATA_DIR / "hero_draft_stats.csv").sort_values("name").reset_index(drop=True)

    hero_names = heroes_df["name"].tolist()
    hero_to_id = {name: i for i, name in enumerate(hero_names)}
    num_heroes = len(hero_names)

    roles = ["Warrior", "Mage", "Marksman", "Tank", "Assassin", "Support"]
    feature_list = []
    lane_probs_list = []
    priority_scores = np.zeros(num_heroes, dtype=np.float32)

    for i in range(num_heroes):
        h_row = heroes_df.iloc[i]
        s_row = stats_df.iloc[i]

        # Role one-hot (primary + 0.5 secondary)
        r_vec = [0.0] * len(roles)
        if h_row["primary_role"] in roles:
            r_vec[roles.index(h_row["primary_role"])] = 1.0
        if pd.notna(h_row["secondary_role"]) and h_row["secondary_role"] in roles:
            r_vec[roles.index(h_row["secondary_role"])] = 0.5

        # 5-lane probability distribution [DS, JG, Mid, Dragon, Roam]
        lane_counts = np.array([
            s_row["ds_lane_picks"],
            s_row["jungle_picks"],
            s_row["mid_picks"],
            s_row["dragon_lane_picks"],
            s_row["roam_picks"],
        ], dtype=np.float32)
        total_p = lane_counts.sum()
        if total_p > 0:
            l_prob = lane_counts / total_p
        else:
            # Fallback prior from primary_role
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

        # Skill boolean flags (10 dims)
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

        # Normalized meta & tournament rates (4 dims)
        meta_stats = [
            float(s_row["pick_rate_pct"]) / 50.0,
            float(s_row["ban_rate_pct"]) / 50.0,
            float(s_row["presence_pct"]) / 100.0,
            (float(s_row["smoothed_win_rate_pct"]) - 50.0) / 20.0,
        ]

        priority_scores[i] = float(s_row["presence_pct"]) + 0.5 * float(s_row["bans_phase1"]) / 42.08
        feat_vec = np.concatenate([r_vec, l_prob, skill_flags, meta_stats]).astype(np.float32)
        feature_list.append(feat_vec)

    hero_features = np.stack(feature_list, axis=0)      # (130, 25)
    lane_probs = np.stack(lane_probs_list, axis=0)      # (130, 5)

    # Build empirical Synergy & Counter matrices (130 x 130)
    synergy_mat = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    co_pick_mat = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    counter_mat = np.zeros((num_heroes, num_heroes), dtype=np.float32)

    with open(DATA_DIR / "matches_draft_full.json", "r", encoding="utf-8") as f:
        games = json.load(f)

    # Split games chronologically/deterministically: first 85% train, last 15% val
    n_train_games = int(len(games) * 0.85)
    train_games = games[:n_train_games]
    val_games = games[n_train_games:]

    # Compute matrices strictly on train_games to prevent any data leakage
    syn_g = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    syn_w = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    cnt_g = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    cnt_w = np.zeros((num_heroes, num_heroes), dtype=np.float32)
    pick_counts = np.zeros(num_heroes, dtype=np.float32)
    ban_p1_counts = np.zeros(num_heroes, dtype=np.float32)
    ban_p2_counts = np.zeros(num_heroes, dtype=np.float32)

    for g in train_games:
        bw = g["blue_win"]
        bp = [hero_to_id[h] for h in g["blue_picks"] if h in hero_to_id]
        rp = [hero_to_id[h] for h in g["red_picks"] if h in hero_to_id]
        bb = [hero_to_id[h] for h in g["blue_bans"] if h in hero_to_id]
        rb = [hero_to_id[h] for h in g["red_bans"] if h in hero_to_id]

        for h in bp + rp:
            pick_counts[h] += 1.0
        for h in bb[:2] + rb[:2]:
            ban_p1_counts[h] += 1.0
        for h in bb[2:] + rb[2:]:
            ban_p2_counts[h] += 1.0

        for i in bp:
            for j in bp:
                if i != j:
                    syn_g[i, j] += 1.0
                    if bw == 1:
                        syn_w[i, j] += 1.0
        for i in rp:
            for j in rp:
                if i != j:
                    syn_g[i, j] += 1.0
                    if bw == 0:
                        syn_w[i, j] += 1.0
        for i in bp:
            for j in rp:
                cnt_g[i, j] += 1.0
                cnt_g[j, i] += 1.0
                if bw == 1:
                    cnt_w[i, j] += 1.0
                elif bw == 0:
                    cnt_w[j, i] += 1.0

    # Log-smoothed co-pick rate and win-rate synergy
    for i in range(num_heroes):
        for j in range(num_heroes):
            if i == j:
                continue
            co_pick_mat[i, j] = math.log1p(syn_g[i, j]) / math.log1p(max(1.0, pick_counts[j]))
            synergy_mat[i, j] = ((syn_w[i, j] + 3.0) / (syn_g[i, j] + 6.0)) - 0.5
            counter_mat[i, j] = ((cnt_w[i, j] + 3.0) / (cnt_g[i, j] + 6.0)) - 0.5

    priors = {
        "pick_log_prior": np.log((pick_counts + 1.0) / (pick_counts.sum() + num_heroes)).astype(np.float32),
        "ban_p1_log_prior": np.log((ban_p1_counts + 1.0) / (ban_p1_counts.sum() + num_heroes)).astype(np.float32),
        "ban_p2_log_prior": np.log((ban_p2_counts + 1.0) / (ban_p2_counts.sum() + num_heroes)).astype(np.float32),
    }

    return (
        hero_names,
        hero_to_id,
        hero_features,
        lane_probs,
        priority_scores,
        co_pick_mat,
        synergy_mat,
        counter_mat,
        priors,
        train_games,
        val_games,
    )


def order_team_picks_by_draft_logic(team_picks_ids, enemy_phase2_ban_ids, lane_probs, priority_scores):
    """
    Reconstruct realistic Phase 1 (P1..P3) vs Phase 2 (P4..P5) pick order for a team's 5 heroes:
    - Heroes whose primary lane was targeted by Enemy Phase 2 Bans (b3, b4) were not picked yet in Phase 1,
      so they belong in Phase 2 (P4, P5).
    - Otherwise, higher-priority meta heroes (e.g. Rouie, Eland'orr, Billow, TeeMee, Valhein, Marja)
      are drafted earlier in Phase 1 (P1..P3).
    """
    enemy_p2_lanes = set()
    for b_id in enemy_phase2_ban_ids:
        enemy_p2_lanes.add(int(np.argmax(lane_probs[b_id])))

    scored = []
    for slot_idx, h_id in enumerate(team_picks_ids):
        # Penalize priority if hero's lane matches an enemy Phase 2 targeted ban
        targeted_in_p2 = 1 if slot_idx in enemy_p2_lanes else 0
        score = priority_scores[h_id] - (50.0 if targeted_in_p2 else 0.0)
        scored.append((score, h_id))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [h_id for _, h_id in scored]


def build_step_samples(games, hero_to_id, lane_probs, priority_scores, augment_random_orders=False):
    """Convert games into 18-step sequential decision states."""
    samples = []
    num_heroes = len(hero_to_id)

    for g in games:
        b_picks_raw = [hero_to_id[h] for h in g["blue_picks"] if h in hero_to_id]
        r_picks_raw = [hero_to_id[h] for h in g["red_picks"] if h in hero_to_id]
        b_bans = [hero_to_id[h] for h in g["blue_bans"] if h in hero_to_id]
        r_bans = [hero_to_id[h] for h in g["red_bans"] if h in hero_to_id]
        if len(b_picks_raw) < 5 or len(r_picks_raw) < 5 or len(b_bans) < 4 or len(r_bans) < 4:
            continue

        b_gban = [hero_to_id[h] for h in g.get("blue_global_bans", []) if h in hero_to_id]
        r_gban = [hero_to_id[h] for h in g.get("red_global_bans", []) if h in hero_to_id]
        year_val = int(g.get("year", 2026)) if str(g.get("year", "2026")).isdigit() else 2026

        b_picks_ordered = order_team_picks_by_draft_logic(b_picks_raw, r_bans[2:4], lane_probs, priority_scores)
        r_picks_ordered = order_team_picks_by_draft_logic(r_picks_raw, b_bans[2:4], lane_probs, priority_scores)

        orderings = [(b_picks_ordered, r_picks_ordered)]
        if augment_random_orders:
            # Also add a randomly permuted pick order so the model generalizes to ANY partial subset of picks
            bp_rand = list(b_picks_raw)
            rp_rand = list(r_picks_raw)
            random.shuffle(bp_rand)
            random.shuffle(rp_rand)
            orderings.append((bp_rand, rp_rand))

        for bp_seq, rp_seq in orderings:
            step_targets = [
                b_bans[0], r_bans[0], b_bans[1], r_bans[1],
                bp_seq[0], rp_seq[0], rp_seq[1], bp_seq[1], bp_seq[2], rp_seq[2],
                r_bans[2], b_bans[2], r_bans[3], b_bans[3],
                rp_seq[3], bp_seq[3], bp_seq[4], rp_seq[4],
            ]

            cur_b_bans, cur_r_bans = [], []
            cur_b_picks, cur_r_picks = [], []

            for step_idx, phase, action_type, side in DRAFT_STEPS:
                target_hero = step_targets[step_idx]
                if side == 0:
                    ally_picks, enemy_picks = list(cur_b_picks), list(cur_r_picks)
                    ally_bans, enemy_bans = list(cur_b_bans), list(cur_r_bans)
                    ally_gbans, enemy_gbans = b_gban, r_gban
                else:
                    ally_picks, enemy_picks = list(cur_r_picks), list(cur_b_picks)
                    ally_bans, enemy_bans = list(cur_r_bans), list(cur_b_bans)
                    ally_gbans, enemy_gbans = r_gban, b_gban

                samples.append({
                    "step_idx": step_idx,
                    "phase": phase,
                    "action_type": action_type,  # 0=BAN, 1=PICK
                    "side": side,                # 0=BLUE, 1=RED
                    "year": year_val,
                    "ally_picks": ally_picks,
                    "enemy_picks": enemy_picks,
                    "ally_bans": ally_bans,
                    "enemy_bans": enemy_bans,
                    "ally_gbans": ally_gbans,
                    "enemy_gbans": enemy_gbans,
                    "target": target_hero,
                })

                # Advance state
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

    return samples


class DraftDataset(Dataset):
    def __init__(self, samples, num_heroes=130):
        self.samples = samples
        self.num_heroes = num_heroes

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        n = self.num_heroes

        ally_picks_vec = np.zeros(n, dtype=np.float32)
        enemy_picks_vec = np.zeros(n, dtype=np.float32)
        ally_bans_vec = np.zeros(n, dtype=np.float32)
        enemy_bans_vec = np.zeros(n, dtype=np.float32)
        unavailable_mask = np.zeros(n, dtype=np.bool_)

        for h in s["ally_picks"]:
            ally_picks_vec[h] = 1.0
            unavailable_mask[h] = True
        for h in s["enemy_picks"]:
            enemy_picks_vec[h] = 1.0
            unavailable_mask[h] = True
        for h in s["ally_bans"]:
            ally_bans_vec[h] = 1.0
            unavailable_mask[h] = True
        for h in s["enemy_bans"]:
            enemy_bans_vec[h] = 1.0
            unavailable_mask[h] = True

        # Global ban masking:
        # - If PICK: acting team cannot pick its own global-banned heroes
        # - If BAN: teams do not waste a ban on a hero the enemy team is already global-banned from picking
        if s["action_type"] == 1:
            for h in s["ally_gbans"]:
                unavailable_mask[h] = True
        else:
            for h in s["enemy_gbans"]:
                unavailable_mask[h] = True

        # Guard against rare Liquipedia editor typos where a hero appears twice in the same game
        unavailable_mask[s["target"]] = False

        meta_ctx = np.array([
            s["step_idx"] / 17.0,
            float(s["phase"] == 2),
            float(s["action_type"] == 1),
            float(s["side"] == 1),
            float(s["year"] >= 2026),
            len(s["ally_picks"]) / 5.0,
            len(s["enemy_picks"]) / 5.0,
        ], dtype=np.float32)

        return (
            torch.from_numpy(ally_picks_vec),
            torch.from_numpy(enemy_picks_vec),
            torch.from_numpy(ally_bans_vec),
            torch.from_numpy(enemy_bans_vec),
            torch.from_numpy(unavailable_mask),
            torch.from_numpy(meta_ctx),
            torch.tensor(s["action_type"], dtype=torch.long),
            torch.tensor(s["phase"], dtype=torch.long),
            torch.tensor(s["target"], dtype=torch.long),
        )


class DraftPredictorNet(nn.Module):
    """
    Hybrid Neural + Domain-Aware Draft Prediction Network:
    Combines:
    1. Deep Set / Attention Context Encoder over current Ally Picks, Enemy Picks, Ally Bans, Enemy Bans
    2. Explicit Team Composition & Missing-Lane Deficit Modeling (5 RoV Lanes + 10 Skill Capabilities)
    3. Empirical + Learned Pairwise Co-Pick, Synergy, and Counter-Matchup Scoring
    4. Strict Action Masking (already picked/banned + Global Ban Pool)
    """
    def __init__(
        self,
        num_heroes,
        hero_features,
        lane_probs,
        co_pick_mat,
        synergy_mat,
        counter_mat,
        priors,
        embed_dim=64,
    ):
        super().__init__()
        self.num_heroes = num_heroes

        # Register static domain buffers
        self.register_buffer("hero_features", torch.tensor(hero_features, dtype=torch.float32))
        self.register_buffer("lane_probs", torch.tensor(lane_probs, dtype=torch.float32))
        self.register_buffer("co_pick_mat", torch.tensor(co_pick_mat, dtype=torch.float32))
        self.register_buffer("synergy_mat", torch.tensor(synergy_mat, dtype=torch.float32))
        self.register_buffer("counter_mat", torch.tensor(counter_mat, dtype=torch.float32))
        self.register_buffer("pick_log_prior", torch.tensor(priors["pick_log_prior"], dtype=torch.float32))
        self.register_buffer("ban_p1_log_prior", torch.tensor(priors["ban_p1_log_prior"], dtype=torch.float32))
        self.register_buffer("ban_p2_log_prior", torch.tensor(priors["ban_p2_log_prior"], dtype=torch.float32))

        feat_dim = hero_features.shape[1]
        self.hero_embed = nn.Embedding(num_heroes, embed_dim)
        self.feat_proj = nn.Linear(feat_dim, embed_dim)

        # Context MLP over (4 set embeddings + team composition deficits + meta_ctx)
        # 4 * embed_dim + 5 (ally lane coverage) + 5 (enemy lane coverage) + 7 (meta_ctx)
        ctx_in_dim = 4 * embed_dim + 5 + 5 + 7
        self.ctx_net = nn.Sequential(
            nn.Linear(ctx_in_dim, 128),
            nn.LayerNorm(128),
            nn.GELU(),
            nn.Dropout(0.15),
            nn.Linear(128, embed_dim),
            nn.LayerNorm(embed_dim),
            nn.GELU(),
        )

        # Separate scoring heads for PICK vs BAN so the network learns distinct strategies
        self.pick_scorer = nn.Linear(embed_dim, embed_dim)
        self.ban_scorer = nn.Linear(embed_dim, embed_dim)

        # Learnable weights for explicit domain terms (priors, missing-lane fit, co-pick, synergy, counter)
        self.domain_weights_pick = nn.Parameter(torch.tensor([0.8, 2.2, 1.2, 0.8, 0.8], dtype=torch.float32))
        self.domain_weights_ban1 = nn.Parameter(torch.tensor([1.0, 0.2, 0.3, 0.3, 0.5], dtype=torch.float32))
        self.domain_weights_ban2 = nn.Parameter(torch.tensor([0.9, 1.8, 0.5, 0.4, 0.8], dtype=torch.float32))

    def get_all_hero_repr(self):
        ids = torch.arange(self.num_heroes, device=self.hero_features.device)
        return self.hero_embed(ids) + self.feat_proj(self.hero_features)  # (130, D)

    def forward(
        self,
        ally_picks_vec,
        enemy_picks_vec,
        ally_bans_vec,
        enemy_bans_vec,
        unavailable_mask,
        meta_ctx,
        action_type,
        phase,
    ):
        H = self.get_all_hero_repr()  # (N, D)

        # Pool set representations
        ally_p_emb = torch.matmul(ally_picks_vec, H)
        enemy_p_emb = torch.matmul(enemy_picks_vec, H)
        ally_b_emb = torch.matmul(ally_bans_vec, H)
        enemy_b_emb = torch.matmul(enemy_bans_vec, H)

        # Compute 5-lane coverage of ally and enemy teams: (B, 5)
        ally_lanes = torch.matmul(ally_picks_vec, self.lane_probs)
        enemy_lanes = torch.matmul(enemy_picks_vec, self.lane_probs)

        # Unfilled lanes: clamp(1 - coverage, 0, 1)
        ally_missing_lanes = torch.clamp(1.0 - ally_lanes, min=0.0, max=1.0)
        enemy_missing_lanes = torch.clamp(1.0 - enemy_lanes, min=0.0, max=1.0)

        ctx_input = torch.cat(
            [ally_p_emb, enemy_p_emb, ally_b_emb, enemy_b_emb, ally_missing_lanes, enemy_missing_lanes, meta_ctx],
            dim=-1,
        )
        ctx_hidden = self.ctx_net(ctx_input)  # (B, D)

        # Neural compatibility logits: (B, N)
        pick_neural_logits = torch.matmul(self.pick_scorer(ctx_hidden), H.t())
        ban_neural_logits = torch.matmul(self.ban_scorer(ctx_hidden), H.t())

        # Explicit Domain Scores for all candidate heroes: (B, N)
        # 1. Missing-lane fit for Ally (when picking) and Enemy (when Phase 2 banning)
        ally_lane_fit = torch.matmul(ally_missing_lanes, self.lane_probs.t())    # (B, N)
        enemy_lane_fit = torch.matmul(enemy_missing_lanes, self.lane_probs.t())  # (B, N)

        # 2. Pairwise Co-Pick, Synergy with Ally Picks, and Counter against Enemy Picks
        co_pick_score = torch.matmul(ally_picks_vec, self.co_pick_mat.t())
        synergy_score = torch.matmul(ally_picks_vec, self.synergy_mat.t())
        counter_score = torch.matmul(enemy_picks_vec, self.counter_mat.t())
        enemy_synergy_threat = torch.matmul(enemy_picks_vec, self.co_pick_mat.t())

        # Combine for PICK actions
        w_p = self.domain_weights_pick
        pick_logits = (
            pick_neural_logits
            + w_p[0] * self.pick_log_prior.unsqueeze(0)
            + w_p[1] * ally_lane_fit
            + w_p[2] * co_pick_score
            + w_p[3] * synergy_score
            + w_p[4] * counter_score
        )

        # Combine for BAN Phase 1 vs BAN Phase 2 actions
        w_b1 = self.domain_weights_ban1
        ban1_logits = (
            ban_neural_logits
            + w_b1[0] * self.ban_p1_log_prior.unsqueeze(0)
            + w_b1[1] * enemy_lane_fit
            + w_b1[2] * enemy_synergy_threat
            - w_b1[4] * counter_score
        )

        w_b2 = self.domain_weights_ban2
        ban2_logits = (
            ban_neural_logits
            + w_b2[0] * self.ban_p2_log_prior.unsqueeze(0)
            + w_b2[1] * enemy_lane_fit
            + w_b2[2] * enemy_synergy_threat
            - w_b2[4] * counter_score
        )

        is_pick = (action_type == 1).unsqueeze(-1)
        is_phase2 = (phase == 2).unsqueeze(-1)
        ban_logits = torch.where(is_phase2, ban2_logits, ban1_logits)
        logits = torch.where(is_pick, pick_logits, ban_logits)

        # Mask out unavailable heroes (already picked/banned + global bans)
        logits = logits.masked_fill(unavailable_mask, -1e9)
        return logits


def evaluate_model(model, loader, device):
    model.eval()
    metrics = {
        "pick_p1": {"top1": 0, "top3": 0, "top5": 0, "top10": 0, "total": 0},
        "pick_p2": {"top1": 0, "top3": 0, "top5": 0, "top10": 0, "total": 0},
        "ban_p1": {"top1": 0, "top3": 0, "top5": 0, "top10": 0, "total": 0},
        "ban_p2": {"top1": 0, "top3": 0, "top5": 0, "top10": 0, "total": 0},
        "overall": {"top1": 0, "top3": 0, "top5": 0, "top10": 0, "total": 0},
    }
    total_loss = 0.0
    total_count = 0

    with torch.no_grad():
        for batch in loader:
            ap, ep, ab, eb, mask, mctx, act, ph, target = [x.to(device) for x in batch]
            logits = model(ap, ep, ab, eb, mask, mctx, act, ph)
            loss = F.cross_entropy(logits, target, reduction="sum")
            total_loss += loss.item()
            total_count += target.size(0)

            top10_preds = torch.topk(logits, k=10, dim=-1).indices  # (B, 10)
            for i in range(target.size(0)):
                t = target[i].item()
                preds = top10_preds[i].tolist()
                a_val = act[i].item()
                p_val = ph[i].item()
                key = f"{'pick' if a_val == 1 else 'ban'}_p{p_val}"

                for bucket in [key, "overall"]:
                    metrics[bucket]["total"] += 1
                    if t == preds[0]:
                        metrics[bucket]["top1"] += 1
                    if t in preds[:3]:
                        metrics[bucket]["top3"] += 1
                    if t in preds[:5]:
                        metrics[bucket]["top5"] += 1
                    if t in preds[:10]:
                        metrics[bucket]["top10"] += 1

    avg_loss = total_loss / max(1, total_count)
    return avg_loss, metrics


def main():
    (
        hero_names,
        hero_to_id,
        hero_features,
        lane_probs,
        priority_scores,
        co_pick_mat,
        synergy_mat,
        counter_mat,
        priors,
        train_games,
        val_games,
    ) = load_hero_features_and_matrices()

    print(f"Building draft step samples from {len(train_games)} train games and {len(val_games)} val games...")
    train_samples = build_step_samples(train_games, hero_to_id, lane_probs, priority_scores, augment_random_orders=True)
    val_samples = build_step_samples(val_games, hero_to_id, lane_probs, priority_scores, augment_random_orders=False)
    print(f"Train decision steps: {len(train_samples):,} | Val decision steps: {len(val_samples):,}")

    train_ds = DraftDataset(train_samples, num_heroes=len(hero_names))
    val_ds = DraftDataset(val_samples, num_heroes=len(hero_names))

    train_loader = DataLoader(train_ds, batch_size=256, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=512, shuffle=False)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = DraftPredictorNet(
        num_heroes=len(hero_names),
        hero_features=hero_features,
        lane_probs=lane_probs,
        co_pick_mat=co_pick_mat,
        synergy_mat=synergy_mat,
        counter_mat=counter_mat,
        priors=priors,
        embed_dim=64,
    ).to(device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=12)

    best_val_loss = float("inf")
    best_metrics = None
    epochs = 12

    print(f"Training DraftPredictorNet on {device} for {epochs} epochs...")
    for epoch in range(1, epochs + 1):
        model.train()
        train_loss_sum = 0.0
        train_n = 0
        for batch in train_loader:
            ap, ep, ab, eb, mask, mctx, act, ph, target = [x.to(device) for x in batch]
            optimizer.zero_grad()
            logits = model(ap, ep, ab, eb, mask, mctx, act, ph)
            loss = F.cross_entropy(logits, target)
            loss.backward()
            optimizer.step()
            train_loss_sum += loss.item() * target.size(0)
            train_n += target.size(0)
        scheduler.step()

        val_loss, val_metrics = evaluate_model(model, val_loader, device)
        ov = val_metrics["overall"]
        t1 = ov["top1"] / ov["total"] * 100
        t3 = ov["top3"] / ov["total"] * 100
        t5 = ov["top5"] / ov["total"] * 100
        t10 = ov["top10"] / ov["total"] * 100
        print(
            f"  Epoch {epoch:02d}/{epochs:02d} | Train Loss: {train_loss_sum/train_n:.4f} | "
            f"Val Loss: {val_loss:.4f} | Top-1: {t1:.2f}% | Top-3: {t3:.2f}% | Top-5: {t5:.2f}% | Top-10: {t10:.2f}%"
        )

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_metrics = val_metrics
            checkpoint = {
                "model_state_dict": model.state_dict(),
                "hero_names": hero_names,
                "hero_to_id": hero_to_id,
                "hero_features": hero_features,
                "lane_probs": lane_probs,
                "co_pick_mat": co_pick_mat,
                "synergy_mat": synergy_mat,
                "counter_mat": counter_mat,
                "priors": priors,
                "val_loss": best_val_loss,
            }
            torch.save(checkpoint, MODEL_DIR / "draft_predictor.pt")

    print("\n=== Best Validation Metrics by Draft Phase (Out of 130 Heroes) ===")
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
            f"{label:28s} -> Top-1: {m['top1']/tot*100:5.2f}% | Top-3: {m['top3']/tot*100:5.2f}% | "
            f"Top-5: {m['top5']/tot*100:5.2f}% | Top-10: {m['top10']/tot*100:5.2f}%"
        )
    print(f"\nSaved trained model checkpoint to: {MODEL_DIR / 'draft_predictor.pt'}")


if __name__ == "__main__":
    main()
