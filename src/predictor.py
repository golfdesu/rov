import json
import math
import os
import re
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Literal, NamedTuple

import numpy as np
import pandas as pd
import torch

from src.config import config
from src.schemas import (
    DraftPredictionResponse,
    DraftStateRequest,
    HeroRecommendation,
)
from src.search.draft_mcts import (
    DraftMinimaxSearch,
    DraftSearchState,
    ModelInput,
    OnnxDraftModel,
    encode_batch,
    run_model,
)
from src.train_sota_model import RoVDraftGNNTransformer, get_league_vector

LANE_LABELS = [
    "DS_Lane (ออฟเลน)",
    "Jungle (ป่า)",
    "Mid (เมจ)",
    "Dragon_Lane (แครี่)",
    "Roam (โรมมิ่ง)",
]
LANE_KEYS = [label.split(" ")[0] for label in LANE_LABELS]
_LANE_INDEX = {key: idx for idx, key in enumerate(LANE_KEYS)}
ALL_LANE_KEYS = frozenset(LANE_KEYS)
FLEX_MIN_LANE_PROB = 0.04


class TeamDraft(NamedTuple):
    """One team's view of the board (canonical hero names)."""

    side: str
    picks: list[str]
    opp_picks: list[str]
    bans: list[str]
    opp_bans: list[str]


class RoVDraftPredictor:
    """Production OOP Inference Engine for SOTA RoVDraftGNNTransformer."""

    def __init__(self, model_path: Path | str | None = None):
        if model_path is not None:
            self.model_path = Path(model_path)
        elif config.paths.sota_model_path.exists():
            self.model_path = config.paths.sota_model_path
        elif (config.paths.models_dir / "archive" / "sota_draft_gnn_transformer.pt").exists():
            self.model_path = config.paths.models_dir / "archive" / "sota_draft_gnn_transformer.pt"
        else:
            self.model_path = config.paths.sota_model_path

        if not self.model_path.exists():
            raise FileNotFoundError(
                f"SOTA model artifact not found at {self.model_path}. Please run training on HPC first."
            )

        self.ckpt = torch.load(self.model_path, map_location="cpu", weights_only=False)
        self.hero_names: list[str] = self.ckpt["hero_names"]
        self.hero_to_id: dict[str, int] = dict(self.ckpt["hero_to_id"])
        canonical_to_legacy = {"Mortos": "Arthur", "Celica": "Brunhilda", "Riktor": "Richter"}
        for can, leg in canonical_to_legacy.items():
            if leg in self.hero_to_id and can not in self.hero_to_id:
                self.hero_to_id[can] = self.hero_to_id[leg]
            elif can in self.hero_to_id and leg not in self.hero_to_id:
                self.hero_to_id[leg] = self.hero_to_id[can]

        self.architecture: str = self.ckpt.get("architecture", "RoVDraftGNNTransformer")
        self.val_loss: float = float(self.ckpt.get("val_loss", 0.0))

        model_cfg = self.ckpt.get(
            "model_config",
            {"d_model": config.model.d_model, "nhead": config.model.nhead, "num_layers": config.model.num_layers},
        )
        self.model = RoVDraftGNNTransformer(
            num_heroes=len(self.hero_names),
            hero_features=self.ckpt["hero_features"],
            lane_probs=self.ckpt["lane_probs"],
            graphs=self.ckpt["graphs"],
            priors=self.ckpt["priors"],
            **model_cfg,
        )
        self.model.load_state_dict(self.ckpt["model_state_dict"])
        self.device = torch.device("cpu")
        self.model.to(self.device)
        self.model.eval()
        self.model.precompute_gnn_embeddings()
        raw_threads = os.getenv("ROV_TORCH_NUM_THREADS", "").strip()
        num_threads = int(raw_threads) if raw_threads.isdigit() and int(raw_threads) > 0 else None
        if num_threads is not None:
            torch.set_num_threads(num_threads)

        backend = os.getenv("ROV_INFERENCE_BACKEND", "auto").strip().lower() or "auto"
        if backend not in ("auto", "onnx", "torch"):
            raise ValueError(f"Unsupported ROV_INFERENCE_BACKEND={backend!r}; expected 'auto', 'onnx', or 'torch'")
        onnx_path = self.model_path.with_suffix(".onnx")
        self.onnx_model: OnnxDraftModel | None = None
        self.inference_backend = "torch"
        self.inference_model: torch.nn.Module | OnnxDraftModel = self.model
        if backend in ("auto", "onnx"):
            if onnx_path.exists():
                try:
                    ort_threads = num_threads
                    if ort_threads is None:
                        omp_raw = os.getenv("OMP_NUM_THREADS", "").strip()
                        ort_threads = int(omp_raw) if omp_raw.isdigit() and int(omp_raw) > 0 else 1
                    self.onnx_model = OnnxDraftModel(onnx_path, num_threads=ort_threads)
                    self.inference_model = self.onnx_model
                    self.inference_backend = "onnx"
                except Exception:
                    if backend == "onnx":
                        raise
            elif backend == "onnx":
                raise FileNotFoundError(f"ONNX model artifact not found at {onnx_path}")
        self._predict_cache: OrderedDict[tuple, DraftPredictionResponse] = OrderedDict()
        self._predict_cache_lock = threading.Lock()
        self._predict_cache_maxsize = 512

        self.heroes_df = pd.read_csv(config.paths.heroes_csv_path).set_index("name")
        self.stats_df = pd.read_csv(config.paths.hero_stats_csv_path).set_index("name")
        for can, leg in canonical_to_legacy.items():
            if leg in self.heroes_df.index and can not in self.heroes_df.index:
                self.heroes_df.loc[can] = self.heroes_df.loc[leg]
            elif can in self.heroes_df.index and leg not in self.heroes_df.index:
                self.heroes_df.loc[leg] = self.heroes_df.loc[can]
            if leg in self.stats_df.index and can not in self.stats_df.index:
                self.stats_df.loc[can] = self.stats_df.loc[leg]
            elif can in self.stats_df.index and leg not in self.stats_df.index:
                self.stats_df.loc[leg] = self.stats_df.loc[can]

        self._build_hero_tables()
        self._lookup = self._build_alias_lookup()
        self.ban_to_pick_score, self.pick_to_ban_score = self._build_ban_pick_intel_tables()
        self.search_engine = DraftMinimaxSearch(self)

    def _build_hero_tables(self) -> None:
        """Per-hero display fields as lists indexed by hero id, so hot paths avoid pandas row lookups."""
        heroes = self.heroes_df.loc[self.hero_names]
        stats = self.stats_df.loc[self.hero_names]
        self._main_lane: list[str] = [str(v) for v in stats["main_pro_lane"]]
        self._lane_key: list[str] = [lane.split(" ")[0] for lane in self._main_lane]
        self._lane_hero_mask: dict[str, np.ndarray] = {
            lk: np.array([h_lk == lk for h_lk in self._lane_key], dtype=np.bool_) for lk in LANE_KEYS
        }
        role_aliases = {"Warrior": "Fighter", "Marksman": "Carry"}
        self._primary_role: list[str] = [role_aliases.get(str(v), str(v)) for v in heroes["primary_role"]]
        self._capabilities: list[list[str]] = []
        for row in heroes.itertuples():
            caps = []
            if row.has_suppress:
                caps.append("Suppress")
            elif row.has_hard_cc:
                caps.append("Hard CC")
            if row.has_mobility:
                caps.append("Mobility")
            if row.has_true_damage:
                caps.append("True Dmg")
            if row.has_immunity:
                caps.append("Iron Body/Immune")
            if row.has_heal_sustain or row.has_shield:
                caps.append("Sustain/Shield")
            self._capabilities.append(caps)

    def _build_ban_pick_intel_tables(self) -> tuple[np.ndarray, np.ndarray]:
        """Build statistical Ban->Pick Lift and Pick->Phase2-Ban Lift matrices from pro matches."""
        num_heroes = len(self.hero_names)
        ban_to_pick = np.zeros((num_heroes, num_heroes), dtype=np.float32)
        pick_to_ban = np.zeros((num_heroes, num_heroes), dtype=np.float32)

        training_path = getattr(config.paths, "matches_training_path", None)
        matches_path = training_path if (training_path and training_path.exists()) else config.paths.matches_json_path
        if not matches_path.exists():
            return ban_to_pick, pick_to_ban

        raw_matches = json.loads(matches_path.read_text(encoding="utf-8"))
        matches = [
            m
            for m in raw_matches
            if (
                int(m["year"]) >= 2025
                if "year" in m
                else not ("2024" in m.get("series_id", "") or "2024" in m.get("date", ""))
            )
        ]
        if not matches:
            matches = raw_matches
        n_team_games = max(1, len(matches) * 2)

        # One row per (game, team): one-hot matrices turn every pairwise count into a matrix product
        n_rows = len(matches) * 2
        bans = np.zeros((n_rows, num_heroes), dtype=np.float32)
        p2_bans = np.zeros((n_rows, num_heroes), dtype=np.float32)
        picks = np.zeros((n_rows, num_heroes), dtype=np.float32)
        opp_picks = np.zeros((n_rows, num_heroes), dtype=np.float32)
        won = np.zeros(n_rows, dtype=np.bool_)
        picks_2026 = np.zeros(num_heroes, dtype=np.int64)
        ids = self.hero_to_id

        for g, m in enumerate(matches):
            is_2026 = int(m.get("year", 0)) == 2026 or "2026" in m.get("series_id", "") or "2026" in m.get("date", "")
            for row, side, opp in ((2 * g, "blue", "red"), (2 * g + 1, "red", "blue")):
                bw = m.get("blue_win")
                won[row] = (bw == 1) if side == "blue" else (bw == 0)
                side_bans = m.get(f"{side}_bans", [])
                side_picks = m.get(f"{side}_picks", [])
                bans[row, [ids[h] for h in side_bans if h in ids]] = 1.0
                p2_bans[row, [ids[h] for h in side_bans[2:4] if h in ids]] = 1.0
                picks[row, [ids[h] for h in side_picks if h in ids]] = 1.0
                opp_picks[row, [ids[h] for h in m.get(f"{opp}_picks", []) if h in ids]] = 1.0
                if is_2026:
                    for h in side_picks:
                        if h in ids:
                            picks_2026[ids[h]] += 1

        # float32 sums of 0/1 values are exact well past this dataset's size (< 2**24)
        ban_cnt = bans.sum(axis=0).astype(np.int64)
        p2ban_cnt = p2_bans.sum(axis=0).astype(np.int64)
        pick_cnt = picks.sum(axis=0).astype(np.int64)
        co_ban_pick = (bans.T @ picks).astype(np.int64)  # [b, p] = team games with ban b and pick p
        co_pick_p2ban = (picks.T @ p2_bans).astype(np.int64)
        vs_games = (picks.T @ opp_picks).astype(np.int64)  # [p, e] = games where p faced e
        vs_wins = (picks[won].T @ opp_picks[won]).astype(np.int64)

        not_self = ~np.eye(num_heroes, dtype=np.bool_)
        active_2026 = picks_2026 >= 15 if picks_2026.max() >= 15 else np.ones(num_heroes, dtype=np.bool_)

        # Ban b -> pick p: teams pick p more often after banning b; boosted when p tends to lose to b
        co = co_ban_pick.astype(np.float64)
        with np.errstate(divide="ignore", invalid="ignore"):
            lift = co * n_team_games / (ban_cnt[:, None] * pick_cnt[None, :])
            games_vs_ban = vs_games.T  # [b, p] = games where p faced b
            loss_rate = np.where(games_vs_ban >= 5, 1.0 - vs_wins.T / np.maximum(games_vs_ban, 1), 0.5)
        keep = (
            (ban_cnt[:, None] >= 20)
            & (pick_cnt[None, :] >= 30)
            & active_2026[None, :]
            & (co_ban_pick >= 5)
            & not_self
            & (lift >= 1.15)
        )
        score = lift * (1.0 + np.maximum(0.0, loss_rate - 0.48) * 3.0) * np.log1p(co)
        ban_to_pick[keep] = score[keep]

        # Pick p -> phase-2 ban b: what teams that picked p go on to ban in phase 2
        co_p2 = co_pick_p2ban.astype(np.float64)
        with np.errstate(divide="ignore", invalid="ignore"):
            lift_p2 = co_p2 * n_team_games / (pick_cnt[:, None] * p2ban_cnt[None, :])
        keep = (
            (pick_cnt[:, None] >= 25)
            & (p2ban_cnt[None, :] >= 20)
            & active_2026[None, :]
            & (co_pick_p2ban >= 5)
            & not_self
            & (lift_p2 >= 1.15)
        )
        score = (co_p2**0.75) * lift_p2
        pick_to_ban[keep] = score[keep]

        return ban_to_pick, pick_to_ban

    def _sum_contributions(
        self,
        table: np.ndarray,
        source_names: list[str],
        unavail_row: np.ndarray,
        multi_source_bonus: float = 1.0,
    ) -> tuple[np.ndarray, dict[int, list[str]]]:
        """Sums table[source, target] over the source heroes for every available target.

        Returns per-target scores plus, for each scored target, its top-2 source heroes
        (largest contribution first, ties broken by name descending).
        """
        num_heroes = len(self.hero_names)
        scores = np.zeros(num_heroes, dtype=np.float32)
        triggers: dict[int, list[str]] = {}
        sources = list(dict.fromkeys(source_names))
        if not sources:
            return scores, triggers

        rows = table[[self.hero_to_id[h] for h in sources]].astype(np.float64)  # (sources, targets)
        rows[:, unavail_row] = 0.0
        name_rank = np.argsort(np.argsort(sources))[:, None]  # alphabetical position of each source
        order = np.lexsort((np.broadcast_to(-name_rank, rows.shape), -rows), axis=0)
        sorted_rows = np.take_along_axis(rows, order, axis=0)
        raw_sum = sorted_rows.sum(axis=0)
        if multi_source_bonus != 1.0 and rows.shape[0] >= 2:
            n_pos = (rows > 0).sum(axis=0)
            raw_sum = raw_sum * np.where(n_pos >= 2, multi_source_bonus, 1.0)
        scores[:] = raw_sum

        for target in np.flatnonzero(sorted_rows[0] > 0):
            triggers[int(target)] = [
                sources[i] for i, v in zip(order[:2, target], sorted_rows[:2, target], strict=True) if v > 0
            ]
        return scores, triggers

    def _compute_ban_unlocked_scores(
        self,
        bans: list[str],
        unavail_row: np.ndarray,
    ) -> tuple[np.ndarray, dict[int, list[str]]]:
        """Compute statistical unlock/pick scores and triggering bans for each available hero."""
        return self._sum_contributions(self.ban_to_pick_score, bans, unavail_row, multi_source_bonus=1.5)

    def _compute_pick_to_ban_scores(
        self,
        picks: list[str],
        unavail_row: np.ndarray,
    ) -> tuple[np.ndarray, dict[int, list[str]]]:
        """Compute statistical Phase-2 target ban scores and triggering picks for each available hero."""
        return self._sum_contributions(self.pick_to_ban_score, picks, unavail_row)

    def _build_alias_lookup(self) -> dict[str, str]:
        lookup = {k.lower(): k for k in self.hero_to_id}
        lookup.update(
            {
                "riktor": "Riktor",
                "richter": "Riktor",
                "mortos": "Mortos",
                "arthur": "Mortos",
                "celica": "Celica",
                "brunhilda": "Celica",
                "diaochan": "Diao Chan",
                "diao chan": "Diao Chan",
                "kaine": "Kaine",
                "batman": "Kaine",
                "stuart": "Stuart",
                "joker": "Stuart",
                "the joker": "Stuart",
                "helen": "Helen",
                "payna": "Helen",
                "peura": "Helen",
                "kilgroth": "Kil'Groth",
                "kil'groth": "Kil'Groth",
                "kilgrooth": "Kil'Groth",
                "kil'grooth": "Kil'Groth",
                "lubu": "Lu Bu",
                "telannas": "Tel'Annas",
                "flowborn": "Flowborn (Marksman)",
                "flowborn mm": "Flowborn (Marksman)",
                "flowborn archer": "Flowborn (Marksman)",
                "flowborn (archer)": "Flowborn (Marksman)",
                "flowborn marksman": "Flowborn (Marksman)",
                "flowborn (marksman)": "Flowborn (Marksman)",
                "flowborn mage": "Flowborn (Mage)",
                "flowborn (mage)": "Flowborn (Mage)",
                "doria": "Dolia",
                "jinna": "Jinnar",
                "illumia": "Ilumia",
                "wiro sableng": "Wiro",
                "ming shiyin": "Ming",
                "sikong zhen": "Bolt Baron",
            }
        )
        for k, v in list(lookup.items()):
            lookup[re.sub(r"[^a-z0-9]", "", k.lower())] = v
        return lookup

    def resolve_heroes(self, names: list[str]) -> list[str]:
        resolved = []
        for raw in names:
            s = raw.strip().lower()
            if not s:
                continue
            alnum = re.sub(r"[^a-z0-9]", "", s)
            if s in self._lookup:
                resolved.append(self._lookup[s])
            elif alnum in self._lookup:
                resolved.append(self._lookup[alnum])
            else:
                raise ValueError(f"Unknown hero name: '{raw}'")
        return resolved

    def _model_input(
        self,
        ally_picks: list[str],
        enemy_picks: list[str],
        ally_bans: list[str],
        enemy_bans: list[str],
        global_bans: list[str],
        *,
        is_pick: bool,
        is_red: bool,
        phase: int,
        league: str = "GLOBAL",
        step_idx: int | None = None,
    ) -> ModelInput:
        """Encodes one draft position from the acting team's point of view."""
        if step_idx is None:
            step_idx = len(ally_picks) + len(enemy_picks) + len(ally_bans) + len(enemy_bans)
        model_step = min(step_idx, 17)
        meta = (
            model_step / 17.0,
            float(phase == 2),
            float(is_pick),
            float(is_red),
            1.0,
            len(ally_picks) / 5.0,
            len(enemy_picks) / 5.0,
            *get_league_vector(league),
        )
        ids = self.hero_to_id
        return ModelInput(
            [ids[h] for h in ally_picks],
            [ids[h] for h in enemy_picks],
            [ids[h] for h in ally_bans],
            [ids[h] for h in enemy_bans],
            [ids[h] for h in global_bans],
            meta,
            int(is_pick),
            phase,
        )

    def _build_hero_recommendation(
        self,
        rank_idx: int,
        h_idx: int,
        probs: np.ndarray,
        win_probs: np.ndarray,
        ap_row: np.ndarray,
        ep_row: np.ndarray,
        lookahead_val: float | None = None,
        triggered_by: list[str] | None = None,
        trigger_reason: Literal["counter", "combo", "ban_unlock", "protect"] | None = None,
    ) -> HeroRecommendation:
        syn_mat = self.ckpt["graphs"]["synergy_mat"]
        cnt_mat = self.ckpt["graphs"]["counter_mat"]

        syn_edge = float(ap_row @ syn_mat[h_idx]) * 100.0
        cnt_edge = float(ep_row @ cnt_mat[h_idx]) * 100.0

        return HeroRecommendation(
            rank=rank_idx,
            hero_name=self.hero_names[h_idx],
            probability_pct=round(float(probs[h_idx] * 100.0), 2),
            predicted_win_rate_pct=round(float(win_probs[h_idx] * 100.0), 2),
            lookahead_win_rate_pct=lookahead_val,
            primary_lane=self._main_lane[h_idx],
            primary_role=self._primary_role[h_idx],
            synergy_edge_pct=round(syn_edge, 2),
            counter_edge_pct=round(cnt_edge, 2),
            capabilities=list(self._capabilities[h_idx]),
            triggered_by=triggered_by or [],
            trigger_reason=trigger_reason,
        )

    def _find_pick_triggers_and_reason(
        self,
        h_idx: int,
        ally_picks: list[str],
        enemy_picks: list[str],
        ban_triggers: dict[int, list[str]],
    ) -> tuple[list[str], Literal["counter", "combo", "ban_unlock", "protect"] | None]:
        cnt_mat = self.ckpt["graphs"]["counter_mat"]
        syn_mat = self.ckpt["graphs"]["synergy_mat"]
        ids = self.hero_to_id

        # 1. Counter priority: Check if this hero counters any picked enemy hero
        if enemy_picks:
            enemy_edges = [(e, float(cnt_mat[h_idx, ids[e]])) for e in enemy_picks if e in ids]
            enemy_edges.sort(key=lambda x: x[1], reverse=True)
            if enemy_edges and enemy_edges[0][1] >= 0.02:
                top_counters = [e for e, edge in enemy_edges if edge >= 0.02][:2]
                return top_counters, "counter"

        # 2. Synergy/Combo priority: Check if this hero synergizes well with any picked ally
        if ally_picks:
            ally_edges = [(a, float(syn_mat[h_idx, ids[a]])) for a in ally_picks if a in ids]
            ally_edges.sort(key=lambda x: x[1], reverse=True)
            if ally_edges and ally_edges[0][1] >= 0.02:
                top_allies = [a for a, edge in ally_edges if edge >= 0.02][:2]
                return top_allies, "combo"

        # 3. Ban-unlock priority: Check if this hero was unlocked by bans
        unlocked = ban_triggers.get(h_idx, [])
        if unlocked:
            return unlocked, "ban_unlock"

        return [], None

    # ------------------------------------------------------------------
    # Next-pick / next-ban forecasts for both teams
    # ------------------------------------------------------------------

    @staticmethod
    def _next_pick_slots(team: TeamDraft, max_slots: int) -> int:
        """Picks to forecast; starts once the team has acted (Ban 1) and stops at 5 picks."""
        if len(team.picks) >= 5 or (not team.picks and not team.bans):
            return 0
        return min(max_slots, 5 - len(team.picks))

    @staticmethod
    def _next_ban_slots(team: TeamDraft, max_slots: int) -> int:
        """Bans to forecast; needs at least one pick to reason from and stops at 4 bans."""
        if not team.picks or len(team.bans) >= 4:
            return 0
        return min(max_slots, 4 - len(team.bans))

    def _next_pick_input(
        self,
        team: TeamDraft,
        sim_picks: list[str],
        global_bans: list[str],
        league: str = "GLOBAL",
    ) -> ModelInput:
        return self._model_input(
            sim_picks,
            team.opp_picks,
            team.bans,
            team.opp_bans,
            global_bans,
            is_pick=True,
            is_red=team.side == "red",
            phase=1 if len(sim_picks) < 3 else 2,
            league=league,
        )

    def _next_ban_input(
        self,
        team: TeamDraft,
        global_bans: list[str],
        league: str = "GLOBAL",
    ) -> ModelInput:
        return self._model_input(
            team.picks,
            team.opp_picks,
            team.bans,
            team.opp_bans,
            global_bans,
            is_pick=False,
            is_red=team.side == "red",
            phase=1 if len(team.bans) < 2 else 2,
            league=league,
        )

    def _resolve_pick_lanes(self, raw_lanes: dict[str, str], valid_picks: set[str]) -> dict[str, str]:
        """Resolve hero keys in a manual pick-lane map, enforcing <=1 hero per lane on the team."""
        resolved: dict[str, str] = {}
        used_lanes: set[str] = set()
        for raw_hero, lane in (raw_lanes or {}).items():
            if lane not in ALL_LANE_KEYS or lane in used_lanes:
                continue
            matches = self.resolve_heroes([raw_hero])
            if matches and matches[0] in valid_picks and matches[0] not in resolved:
                resolved[matches[0]] = lane
                used_lanes.add(lane)
        return resolved

    def _resolve_pool_hero_lanes(self, raw_pool_lanes: dict[str, list[str]] | None) -> dict[str, set[str]]:
        """Map canonical hero name -> set of lane keys assigned in the team's Hero Pool."""
        out: dict[str, set[str]] = {}
        for lane, raw_heroes in (raw_pool_lanes or {}).items():
            if lane not in ALL_LANE_KEYS or not raw_heroes:
                continue
            for hero in self.resolve_heroes(raw_heroes):
                out.setdefault(hero, set()).add(lane)
        return out

    def _solve_flex_lane_assignment(
        self,
        picks: list[str],
        explicit_lanes: dict[str, str] | None = None,
        pool_hero_lanes: dict[str, set[str]] | None = None,
    ) -> set[str]:
        """Assign picked heroes to distinct lanes maximizing coverage then log-probability."""
        explicit = explicit_lanes or {}
        covered: set[str] = {explicit[h] for h in picks if h in explicit and explicit[h] in ALL_LANE_KEYS}
        auto_picks = [h for h in picks if h not in explicit]
        if not auto_picks or len(covered) >= len(LANE_KEYS):
            return covered

        lane_probs = self.ckpt["lane_probs"]
        options_per_hero: list[list[tuple[str, float]]] = []
        for h in auto_picks:
            hid = self.hero_to_id[h]
            primary = self._lane_key[hid]
            pool_lanes = (pool_hero_lanes or {}).get(h)
            cands: list[tuple[str, float]] = []
            for lane_idx, lane_key in enumerate(LANE_KEYS):
                if lane_key in covered:
                    continue
                prob = float(lane_probs[hid, lane_idx])
                in_pool_lane = bool(pool_lanes and lane_key in pool_lanes)
                if in_pool_lane or lane_key == primary or prob >= FLEX_MIN_LANE_PROB:
                    eff_prob = max(prob, 0.35 if in_pool_lane else 1e-4)
                    score = math.log(eff_prob) + (0.5 if in_pool_lane else 0.0) + (1e-3 if lane_key == primary else 0.0)
                    cands.append((lane_key, score))
            cands.sort(key=lambda item: item[1], reverse=True)
            options_per_hero.append(cands)

        best_key: tuple[int, float] = (-1, float("-inf"))
        best_lanes: set[str] = set()
        used: set[str] = set()

        def dfs(idx: int, cur_count: int, cur_score: float) -> None:
            nonlocal best_key, best_lanes
            if idx == len(options_per_hero):
                key = (cur_count, cur_score)
                if key > best_key:
                    best_key = key
                    best_lanes = set(used)
                return
            if cur_count + (len(options_per_hero) - idx) < best_key[0]:
                return
            took_any = False
            for lane_key, score in options_per_hero[idx]:
                if lane_key in used:
                    continue
                took_any = True
                used.add(lane_key)
                dfs(idx + 1, cur_count + 1, cur_score + score)
                used.remove(lane_key)
            if not took_any or len(options_per_hero) > len(LANE_KEYS) - len(covered):
                dfs(idx + 1, cur_count, cur_score)

        dfs(0, 0, 0.0)
        return covered | best_lanes

    def _needed_lanes_for_picks(
        self,
        picks: list[str],
        pick_vec_row: np.ndarray | None = None,
        explicit_lanes: dict[str, str] | None = None,
        pool_hero_lanes: dict[str, set[str]] | None = None,
    ) -> set[str]:
        """Return the set of lane keys still needed by a team given flex, Hero Pool, and manual lane coverage."""
        if not picks:
            return set(ALL_LANE_KEYS)
        explicit = explicit_lanes or {}
        has_pool_override = bool(pool_hero_lanes and any(h in pool_hero_lanes for h in picks))
        covered_lanes = self._solve_flex_lane_assignment(picks, explicit, pool_hero_lanes=pool_hero_lanes)
        if explicit or has_pool_override or pick_vec_row is None:
            lane_cov = np.zeros(len(LANE_KEYS), dtype=np.float32)
            lane_probs = self.ckpt["lane_probs"]
            for h in picks:
                if h in explicit and explicit[h] in _LANE_INDEX:
                    lane_cov[_LANE_INDEX[explicit[h]]] += 1.0
                elif pool_hero_lanes and h in pool_hero_lanes:
                    valid_pool_lanes = [lk for lk in pool_hero_lanes[h] if lk in _LANE_INDEX]
                    share = 1.0 / len(valid_pool_lanes) if valid_pool_lanes else 0.0
                    for lk in valid_pool_lanes:
                        lane_cov[_LANE_INDEX[lk]] += share
                else:
                    lane_cov += lane_probs[self.hero_to_id[h]]
        else:
            lane_cov = pick_vec_row @ self.ckpt["lane_probs"]
        open_lanes = {LANE_KEYS[i] for i in range(5) if lane_cov[i] < 0.65}
        needed = open_lanes - covered_lanes
        remaining_slots = max(0, len(ALL_LANE_KEYS) - len(picks))
        unfilled = set(ALL_LANE_KEYS - covered_lanes)
        if len(needed) < min(remaining_slots, len(unfilled)):
            needed = unfilled
        return needed

    def _apply_lane_filter(
        self,
        probs: np.ndarray,
        needed_lanes: set[str],
        penalty: float = 0.05,
        pool_lanes_by_id: dict[int, set[str]] | None = None,
    ) -> np.ndarray:
        """Down-weight heroes whose primary (or Hero Pool) lane is not in `needed_lanes` and re-normalize."""
        if not needed_lanes or len(needed_lanes) >= len(ALL_LANE_KEYS):
            return probs
        mask_map = getattr(self, "_lane_hero_mask", None)
        if mask_map is not None:
            keep = np.zeros(len(self._lane_key), dtype=np.bool_)
            for lk in needed_lanes:
                mask = mask_map.get(lk)
                if mask is not None:
                    keep |= mask
        else:
            keep = np.array([lk in needed_lanes for lk in self._lane_key], dtype=np.bool_)
        if pool_lanes_by_id:
            for idx, p_lanes in pool_lanes_by_id.items():
                keep[idx] = bool(p_lanes & needed_lanes)
        filtered = np.where(keep, probs, probs * penalty)
        total = float(filtered.sum())
        if total > 0:
            filtered = filtered / total * float(probs.sum())
        return filtered

    def _ensure_lane_quota(
        self,
        top_indices: list[int],
        avail_sorted: list[int],
        top_k: int,
        min_per_lane: int = 5,
    ) -> list[int]:
        """Guarantee at least `min_per_lane` candidates per lane when `top_k >= 25` without evicting scarce lanes."""
        if top_k < min_per_lane * len(ALL_LANE_KEYS):
            return top_indices

        selected_set = set(top_indices)
        lane_counts: dict[str, int] = {lk: 0 for lk in ALL_LANE_KEYS}
        for i in top_indices:
            lk = self._lane_key[i]
            lane_counts[lk] = lane_counts.get(lk, 0) + 1

        lane_extras: list[int] = []
        for lk in ALL_LANE_KEYS:
            needed_count = min_per_lane - lane_counts.get(lk, 0)
            if needed_count > 0:
                for cand_i in avail_sorted:
                    if cand_i not in selected_set and self._lane_key[cand_i] == lk:
                        lane_extras.append(cand_i)
                        selected_set.add(cand_i)
                        lane_counts[lk] = lane_counts.get(lk, 0) + 1
                        needed_count -= 1
                        if needed_count <= 0:
                            break

        if not lane_extras:
            return top_indices

        to_evict = max(0, len(top_indices) + len(lane_extras) - top_k)
        if to_evict > 0:
            evicted_positions: set[int] = set()
            for pos in range(len(top_indices) - 1, -1, -1):
                if to_evict <= 0:
                    break
                lk = self._lane_key[top_indices[pos]]
                if lane_counts.get(lk, 0) > min_per_lane:
                    evicted_positions.add(pos)
                    lane_counts[lk] -= 1
                    to_evict -= 1
            top_indices = [idx for pos, idx in enumerate(top_indices) if pos not in evicted_positions]

        combined = top_indices + lane_extras
        if len(combined) > top_k:
            overflow = len(combined) - top_k
            top_indices = top_indices[:-overflow] if overflow < len(top_indices) else []
            combined = top_indices + lane_extras
        return combined[:top_k]

    def _choose_next_pick(
        self,
        team: TeamDraft,
        sim_picks: list[str],
        rank: int,
        probs: np.ndarray,
        win_probs: np.ndarray,
        ap_row: np.ndarray,
        ep_row: np.ndarray,
        unavail_row: np.ndarray,
        explicit_lanes: dict[str, str] | None = None,
    ) -> HeroRecommendation:
        """Picks the likeliest hero that fills a still-open lane, anchored on the SOTA GNN-Transformer policy."""
        ban_scores, ban_triggers = self._compute_ban_unlocked_scores(team.bans, unavail_row)
        max_ban_score = float(ban_scores.max())
        top_ban_idx = int(np.argmax(ban_scores)) if max_ban_score > 0 else -1
        is_targeted_combo = (
            max_ban_score >= 30.0
            and len(sim_picks) == 0
            and not team.opp_picks
            and len(ban_triggers.get(top_ban_idx, [])) >= 2
        )
        if is_targeted_combo:
            sharpened = np.power(ban_scores / max_ban_score, 2.5)
            ban_dist = sharpened / float(sharpened.sum())
            blended_probs = 0.25 * probs + 0.75 * ban_dist
        else:
            blended_probs = probs

        needed_lanes = self._needed_lanes_for_picks(sim_picks, ap_row, explicit_lanes=explicit_lanes)
        blended_probs = self._apply_lane_filter(blended_probs, needed_lanes)

        sorted_indices = np.argsort(blended_probs)[::-1]
        avail_indices = np.flatnonzero(~unavail_row)
        chosen_idx = (
            int(sorted_indices[0])
            if not unavail_row[sorted_indices[0]]
            else (int(avail_indices[0]) if len(avail_indices) else 0)
        )
        for cand_idx in sorted_indices:
            if unavail_row[cand_idx] or blended_probs[cand_idx] <= 0:
                break
            if not needed_lanes or self._lane_key[cand_idx] in needed_lanes:
                chosen_idx = int(cand_idx)
                break

        triggers, reason = self._find_pick_triggers_and_reason(chosen_idx, sim_picks, team.opp_picks, ban_triggers)

        return self._build_hero_recommendation(
            rank_idx=rank,
            h_idx=chosen_idx,
            probs=blended_probs,
            win_probs=win_probs,
            ap_row=ap_row,
            ep_row=ep_row,
            triggered_by=triggers,
            trigger_reason=reason,
        )

    def _forecast_bans(
        self,
        team: TeamDraft,
        slots: int,
        probs: np.ndarray,
        win_probs: np.ndarray,
        ap_row: np.ndarray,
        ep_row: np.ndarray,
        unavail_row: np.ndarray,
        opp_explicit_lanes: dict[str, str] | None = None,
    ) -> list[HeroRecommendation]:
        """Top `slots` ban targets, blending the policy with pick -> phase-2 ban statistics."""
        p2b_scores, p2b_triggers = self._compute_pick_to_ban_scores(team.picks, unavail_row)
        if p2b_scores.max() > 0:
            p2b_dist = p2b_scores / float(p2b_scores.sum())
            p2b_weight = 0.15 if team.opp_picks else 0.75
            blended_probs = (1.0 - p2b_weight) * probs + p2b_weight * p2b_dist
        else:
            blended_probs = probs

        opp_needed_lanes = self._needed_lanes_for_picks(team.opp_picks, ep_row, explicit_lanes=opp_explicit_lanes)
        filtered_probs = self._apply_lane_filter(blended_probs, opp_needed_lanes)

        sorted_order = np.argsort(filtered_probs)[::-1]
        chosen_set: set[int] = set()
        forecast: list[HeroRecommendation] = []

        def _append_ban_cand(c_idx: int, score_probs: np.ndarray) -> None:
            triggers = p2b_triggers.get(c_idx, list(team.picks[:1]))
            reason: Literal["counter", "combo", "ban_unlock", "protect"] | None = "protect" if triggers else None
            forecast.append(
                self._build_hero_recommendation(
                    rank_idx=len(forecast) + 1,
                    h_idx=c_idx,
                    probs=score_probs,
                    win_probs=win_probs,
                    ap_row=ap_row,
                    ep_row=ep_row,
                    triggered_by=triggers,
                    trigger_reason=reason,
                )
            )
            chosen_set.add(c_idx)

        for cand_idx in sorted_order:
            if filtered_probs[cand_idx] <= 0 or len(forecast) >= slots:
                break
            c_idx = int(cand_idx)
            if opp_needed_lanes and self._lane_key[c_idx] not in opp_needed_lanes:
                continue
            _append_ban_cand(c_idx, filtered_probs)

        # Fallback if opponent's strictly needed lanes are all banned/picked
        if len(forecast) < slots:
            for cand_idx in np.argsort(blended_probs)[::-1]:
                if len(forecast) >= slots or blended_probs[cand_idx] <= 0:
                    break
                c_idx = int(cand_idx)
                if c_idx in chosen_set or unavail_row[c_idx]:
                    continue
                _append_ban_cand(c_idx, blended_probs)
        return forecast

    def _evaluate_with_forecasts(
        self,
        main_input: ModelInput,
        teams: list[TeamDraft],
        global_bans: list[str] | dict[str, list[str]],
        max_slots: int = 2,
        league: str = "GLOBAL",
        series_winning_heroes: list[str] | None = None,
        pick_lanes_by_side: dict[str, dict[str, str]] | None = None,
    ) -> tuple[tuple[np.ndarray, ...], np.ndarray, np.ndarray, dict[str, list[HeroRecommendation]]]:
        """Runs the main position and every team's pick/ban forecasts in as few batched passes as possible.

        Bans and the first forecast pick of each team only depend on the current board, so they share
        one batch with the main position; each later pick depends on the previous one and gets its own
        batch (shared between teams). Returns (main arrays, main probs, main win probs, forecasts).
        """
        forecasts: dict[str, list[HeroRecommendation]] = {}
        sim_picks = {t.side: list(t.picks) for t in teams}
        pick_slots = {t.side: self._next_pick_slots(t, max_slots) for t in teams}
        gb_by_side = global_bans if isinstance(global_bans, dict) else {t.side: global_bans for t in teams}
        win_hero_ids = [
            self.hero_to_id[h] for h in set(self.resolve_heroes(series_winning_heroes or [])) if h in self.hero_to_id
        ]

        inputs = [main_input]
        jobs: list[tuple[str, TeamDraft]] = []
        for t in teams:
            forecasts[f"{t.side}_next_bans"] = []
            if self._next_ban_slots(t, max_slots):
                opp_side = "red" if t.side == "blue" else "blue"
                inputs.append(self._next_ban_input(t, gb_by_side.get(opp_side, []), league=league))
                jobs.append(("ban", t))
        main_arrays: tuple[np.ndarray, ...] | None = None
        main_probs = main_win = np.empty(0)

        for rank in range(1, max_slots + 1):
            for t in teams:
                if rank == 1:
                    forecasts[f"{t.side}_next_picks"] = []
                if pick_slots[t.side] >= rank:
                    inputs.append(
                        self._next_pick_input(t, sim_picks[t.side], gb_by_side.get(t.side, []), league=league)
                    )
                    jobs.append(("pick", t))
            if not inputs:
                break

            arrays = encode_batch(inputs, len(self.hero_names))
            probs_t, win_t = run_model(self.inference_model, arrays, self.device)
            probs, win = probs_t.cpu().numpy(), win_t.cpu().numpy()
            ap, ep, unavail = arrays[0], arrays[1], arrays[4]

            offset = 0
            if main_arrays is None:
                main_arrays = tuple(a[:1] for a in arrays)
                main_probs, main_win = probs[0], win[0]
                offset = 1
            for row, (kind, t) in enumerate(jobs, start=offset):
                row_probs = probs[row]
                if win_hero_ids:
                    row_probs = row_probs.copy()
                    for h_id in win_hero_ids:
                        if not unavail[row, h_id]:
                            row_probs[h_id] *= 1.12
                    row_sum = float(row_probs.sum())
                    if row_sum > 0:
                        row_probs = row_probs / row_sum
                opp_side = "red" if t.side == "blue" else "blue"
                side_pick_lanes = (pick_lanes_by_side or {}).get(t.side)
                opp_pick_lanes = (pick_lanes_by_side or {}).get(opp_side)
                if kind == "ban":
                    forecasts[f"{t.side}_next_bans"] = self._forecast_bans(
                        t,
                        self._next_ban_slots(t, max_slots),
                        row_probs,
                        win[row],
                        ap[row],
                        ep[row],
                        unavail[row],
                        opp_explicit_lanes=opp_pick_lanes,
                    )
                else:
                    rec = self._choose_next_pick(
                        t,
                        sim_picks[t.side],
                        rank,
                        row_probs,
                        win[row],
                        ap[row],
                        ep[row],
                        unavail[row],
                        explicit_lanes=side_pick_lanes,
                    )
                    forecasts[f"{t.side}_next_picks"].append(rec)
                    sim_picks[t.side].append(rec.hero_name)
            inputs, jobs = [], []

        assert main_arrays is not None
        return main_arrays, main_probs, main_win, forecasts

    def _compute_ban_unlocked_heroes(
        self,
        all_bans: list[str],
        unavail_row: np.ndarray,
        probs: np.ndarray,
        win_probs: np.ndarray,
        ap_row: np.ndarray,
        ep_row: np.ndarray,
        needed_lanes: set[str] | None = None,
        top_n: int = 5,
    ) -> tuple[list[HeroRecommendation], dict[int, list[str]]]:
        """Return top heroes unlocked / made stronger by current bans on the board."""
        ban_scores, ban_triggers = self._compute_ban_unlocked_scores(all_bans, unavail_row)
        if ban_scores.max() <= 0:
            return [], {}

        filtered_ban_scores = (
            self._apply_lane_filter(ban_scores, needed_lanes) if needed_lanes is not None else ban_scores
        )
        if filtered_ban_scores.max() <= 0:
            return [], ban_triggers

        ban_dist = filtered_ban_scores / float(filtered_ban_scores.sum())
        blended_probs = 0.30 * probs + 0.70 * ban_dist
        sorted_indices = np.argsort(filtered_ban_scores)[::-1]
        unlocked: list[HeroRecommendation] = []
        for cand_idx in sorted_indices:
            c_idx = int(cand_idx)
            if filtered_ban_scores[c_idx] <= 0 or len(unlocked) >= top_n:
                break
            if needed_lanes and self._lane_key[c_idx] not in needed_lanes:
                continue
            unlocked.append(
                self._build_hero_recommendation(
                    rank_idx=len(unlocked) + 1,
                    h_idx=c_idx,
                    probs=blended_probs,
                    win_probs=win_probs,
                    ap_row=ap_row,
                    ep_row=ep_row,
                    triggered_by=ban_triggers.get(c_idx, []),
                    trigger_reason="ban_unlock",
                )
            )
        return unlocked, ban_triggers

    @staticmethod
    def _predict_cache_key(req: DraftStateRequest) -> tuple:
        return (
            req.mode,
            req.side,
            req.phase,
            tuple(req.ally_picks),
            tuple(req.enemy_picks),
            tuple(req.ally_bans),
            tuple(req.enemy_bans),
            tuple(req.global_bans),
            tuple(req.blue_global_bans),
            tuple(req.red_global_bans),
            req.top_k,
            req.use_lookahead,
            req.lookahead_depth,
            req.league,
            tuple(req.series_winning_heroes),
            tuple(sorted(req.ally_pick_lanes.items())),
            tuple(sorted(req.enemy_pick_lanes.items())),
            tuple(req.ally_pool),
            tuple(req.enemy_pool),
            req.pool_only,
            req.pool_mode,
            tuple((k, tuple(v)) for k, v in sorted(req.ally_pool_lanes.items())),
        )

    def predict(self, req: DraftStateRequest) -> DraftPredictionResponse:
        cache_key = self._predict_cache_key(req)
        with self._predict_cache_lock:
            cached = self._predict_cache.get(cache_key)
            if cached is not None:
                self._predict_cache.move_to_end(cache_key)
                return cached.model_copy(deep=True)
        result = self._predict_uncached(req)
        with self._predict_cache_lock:
            self._predict_cache[cache_key] = result.model_copy(deep=True)
            self._predict_cache.move_to_end(cache_key)
            while len(self._predict_cache) > self._predict_cache_maxsize:
                self._predict_cache.popitem(last=False)
        return result

    def _predict_uncached(self, req: DraftStateRequest) -> DraftPredictionResponse:
        ally_picks = self.resolve_heroes(req.ally_picks)
        enemy_picks = self.resolve_heroes(req.enemy_picks)
        ally_bans = self.resolve_heroes(req.ally_bans)
        enemy_bans = self.resolve_heroes(req.enemy_bans)
        global_bans = self.resolve_heroes(req.global_bans)
        blue_gb = self.resolve_heroes(req.blue_global_bans)
        red_gb = self.resolve_heroes(req.red_global_bans)

        blue_effective_gb = list(dict.fromkeys([*global_bans, *blue_gb]))
        red_effective_gb = list(dict.fromkeys([*global_bans, *red_gb]))
        ally_pick_lanes = self._resolve_pick_lanes(req.ally_pick_lanes, set(ally_picks))
        enemy_pick_lanes = self._resolve_pick_lanes(req.enemy_pick_lanes, set(enemy_picks))

        act_type = 1 if req.mode == "pick" else 0
        side_val = 0 if req.side == "blue" else 1

        if act_type == 0:  # ban mode: unavailable to ban are opponent's used heroes
            acting_gb = red_effective_gb if req.side == "blue" else blue_effective_gb
        else:  # pick mode: unavailable to pick are acting team's used heroes
            acting_gb = blue_effective_gb if req.side == "blue" else red_effective_gb

        if req.side == "blue":
            blue_picks, red_picks = ally_picks, enemy_picks
            blue_bans, red_bans = ally_bans, enemy_bans
            pick_lanes_by_side = {"blue": ally_pick_lanes, "red": enemy_pick_lanes}
        else:
            blue_picks, red_picks = enemy_picks, ally_picks
            blue_bans, red_bans = enemy_bans, ally_bans
            pick_lanes_by_side = {"blue": enemy_pick_lanes, "red": ally_pick_lanes}
        teams = [
            TeamDraft("blue", blue_picks, red_picks, blue_bans, red_bans),
            TeamDraft("red", red_picks, blue_picks, red_bans, blue_bans),
        ]

        step_idx = self.search_engine.find_matching_step(
            side_val,
            act_type,
            req.phase,
            len(blue_picks),
            len(red_picks),
            len(blue_bans),
            len(red_bans),
        )
        win_heroes_resolved = (
            list(dict.fromkeys(self.resolve_heroes(req.series_winning_heroes))) if req.series_winning_heroes else []
        )
        main_input = self._model_input(
            ally_picks,
            enemy_picks,
            ally_bans,
            enemy_bans,
            acting_gb,
            is_pick=act_type == 1,
            is_red=side_val == 1,
            phase=req.phase,
            league=req.league,
            step_idx=step_idx,
        )
        arrays, probs, win_probs, forecasts = self._evaluate_with_forecasts(
            main_input,
            teams,
            {"blue": blue_effective_gb, "red": red_effective_gb},
            league=req.league,
            series_winning_heroes=win_heroes_resolved,
            pick_lanes_by_side=pick_lanes_by_side,
        )
        ap_row, ep_row, unavail_row = arrays[0][0], arrays[1][0], arrays[4][0]

        # Completed 5v5 board: evaluate exact 5v5 win rate at the final Red Pick 5 turn
        # so the 10th picked hero is never truncated by MAX_HISTORY_LEN = 17.
        if len(blue_picks) == 5 and len(red_picks) == 5:
            step17_input = self._model_input(
                red_picks[:4],
                blue_picks,
                red_bans,
                blue_bans,
                red_effective_gb,
                is_pick=True,
                is_red=True,
                phase=2,
                league=req.league,
                step_idx=17,
            )
            step17_arrays = encode_batch([step17_input], len(self.hero_names))
            _, step17_win_t = run_model(self.inference_model, step17_arrays, self.device)
            red_final_win = float(step17_win_t[0, self.hero_to_id[red_picks[4]]].item())
            acting_final_win = (1.0 - red_final_win) if req.side == "blue" else red_final_win
            win_probs = np.full(len(self.hero_names), acting_final_win, dtype=np.float32)

        has_pool_input = bool(req.ally_pool or req.enemy_pool or req.ally_pool_lanes)
        if req.pool_mode is not None:
            effective_pool_mode = req.pool_mode
        elif req.pool_only:
            effective_pool_mode = "high"
        elif has_pool_input:
            effective_pool_mode = "low"
        else:
            effective_pool_mode = "off"

        pool_hero_lanes = (
            self._resolve_pool_hero_lanes(req.ally_pool_lanes)
            if (req.mode == "pick" and effective_pool_mode != "off")
            else {}
        )
        pool_lanes_by_id = {self.hero_to_id[h]: lanes for h, lanes in pool_hero_lanes.items() if h in self.hero_to_id}

        ally_needed_lanes = self._needed_lanes_for_picks(
            ally_picks,
            ap_row,
            explicit_lanes=ally_pick_lanes,
            pool_hero_lanes=pool_hero_lanes,
        )
        enemy_needed_lanes = self._needed_lanes_for_picks(enemy_picks, ep_row, explicit_lanes=enemy_pick_lanes)
        target_needed_lanes = ally_needed_lanes if req.mode == "pick" else enemy_needed_lanes

        def hero_fits_needed_lanes(h_idx: int) -> bool:
            if not target_needed_lanes or len(target_needed_lanes) >= len(ALL_LANE_KEYS):
                return True
            if req.mode == "pick" and h_idx in pool_lanes_by_id:
                return bool(pool_lanes_by_id[h_idx] & target_needed_lanes)
            return self._lane_key[h_idx] in target_needed_lanes

        # Outcome-weighted policy modulation:
        # 1. Weight pick policy by predicted win-value advantage so outdraft/comfort-trap picks are penalized
        if req.mode == "pick" and (len(blue_picks) < 5 or len(red_picks) < 5):
            win_adv = np.clip(win_probs - 0.5, -0.20, 0.20)
            probs = probs * np.exp(0.60 * win_adv)

        # 2. In-series winner adaptation boost (steal-pick / target-ban heroes that won earlier games in the series)
        if win_heroes_resolved:
            for h_win in win_heroes_resolved:
                h_id = self.hero_to_id[h_win]
                if not unavail_row[h_id]:
                    probs[h_id] *= 1.12

        total_p = float(probs.sum())
        if total_p > 0:
            probs = probs / total_p

        probs = self._apply_lane_filter(
            probs,
            target_needed_lanes,
            pool_lanes_by_id=pool_lanes_by_id if req.mode == "pick" else None,
        )

        # 3. Hero Pool prioritization (HIGH = strict pool filter in pick/ban mode, LOW = mixture prior boost, OFF = pure meta)
        raw_pool = req.ally_pool if req.mode == "pick" else req.enemy_pool
        pool_only_active = False
        active_pool_ids: list[int] = []
        if effective_pool_mode != "off" and (raw_pool or (req.mode == "pick" and pool_lanes_by_id)):
            resolved_pool = self.resolve_heroes(raw_pool) if raw_pool else []
            ordered_ids = [self.hero_to_id[h] for h in dict.fromkeys(resolved_pool)]
            if req.mode == "pick":
                for h_id in pool_lanes_by_id:
                    if h_id not in ordered_ids:
                        ordered_ids.append(h_id)
            active_pool_ids = [h_id for h_id in ordered_ids if not unavail_row[h_id]]

        needed_pool_ids = (
            [h_id for h_id in active_pool_ids if hero_fits_needed_lanes(h_id)]
            if req.mode == "pick" and target_needed_lanes
            else active_pool_ids
        )

        if effective_pool_mode != "off" and active_pool_ids:
            if effective_pool_mode == "high":
                # Pick mode: restrict strictly to pool heroes fitting a missing lane (graceful open-lane fallback).
                # Ban mode: restrict strictly to available enemy_pool target-ban candidates.
                strict_ids = needed_pool_ids if req.mode == "pick" else active_pool_ids
                if strict_ids:
                    pool_only_active = True
                    masked = np.zeros_like(probs)
                    for h_id in strict_ids:
                        masked[h_id] = max(float(probs[h_id]), 1e-9)
                    masked_total = float(masked.sum())
                    if masked_total > 0:
                        probs = masked / masked_total
            else:
                boost_ids = needed_pool_ids if (req.mode == "pick" and target_needed_lanes) else active_pool_ids
                if boost_ids:
                    pool_dist = np.zeros_like(probs)
                    for h_id in boost_ids:
                        pool_dist[h_id] = max(float(probs[h_id]), 1e-9) ** 0.35
                    pool_total = float(pool_dist.sum())
                    if pool_total > 0:
                        pool_dist = pool_dist / pool_total
                        probs = 0.75 * probs + 0.25 * pool_dist
                        mixed_total = float(probs.sum())
                        if mixed_total > 0:
                            probs = probs / mixed_total

        def is_needed_lane(h_idx: int) -> int:
            return int(hero_fits_needed_lanes(h_idx))

        missing_lanes = [label for label in LANE_LABELS if label.split(" ")[0] in ally_needed_lanes]

        ban_unlocked_heroes, unlocked_triggers = self._compute_ban_unlocked_heroes(
            all_bans=ally_bans + enemy_bans,
            unavail_row=unavail_row,
            probs=probs,
            win_probs=win_probs,
            ap_row=ap_row,
            ep_row=ep_row,
            needed_lanes=target_needed_lanes,
            top_n=5,
        )
        _, p2b_triggers = self._compute_pick_to_ban_scores(ally_picks, unavail_row) if req.mode == "ban" else (None, {})

        avail_sorted = sorted(
            (int(i) for i in np.flatnonzero(probs > 0)),
            key=lambda h_idx: (is_needed_lane(h_idx), float(probs[h_idx])),
            reverse=True,
        )

        lookahead_win_rates: dict[int, float] = {}
        if req.use_lookahead and len(blue_picks) + len(red_picks) < 10:
            ids = self.hero_to_id
            b_p = tuple(ids[h] for h in blue_picks)
            r_p = tuple(ids[h] for h in red_picks)
            b_b = tuple(ids[h] for h in blue_bans)
            r_b = tuple(ids[h] for h in red_bans)

            root_state = DraftSearchState(
                blue_picks=b_p,
                red_picks=r_p,
                blue_bans=b_b,
                red_bans=r_b,
                global_bans=tuple(ids[h] for h in global_bans),
                blue_global_bans=tuple(ids[h] for h in blue_gb),
                red_global_bans=tuple(ids[h] for h in red_gb),
                series_winning_heroes=tuple(ids[h] for h in win_heroes_resolved if h in ids),
                blue_pick_lanes=tuple(sorted(pick_lanes_by_side["blue"].items())),
                red_pick_lanes=tuple(sorted(pick_lanes_by_side["red"].items())),
                step_idx=step_idx,
                league=req.league,
            )
            search_pool = avail_sorted[: min(max(req.top_k * 2, 8), 60)]
            lookahead_win_rates = self.search_engine.search_lookahead_win_rates(
                root_state,
                search_pool,
                depth=req.lookahead_depth,
                branch_factor=5,
                root_win_probs=win_probs,
                pool_hero_lanes=pool_hero_lanes if req.mode == "pick" else None,
                pool_lanes_by_id=pool_lanes_by_id if req.mode == "pick" else None,
            )

            # Re-rank candidates by blending policy prior and adversarial lookahead win rate,
            # while strictly keeping needed-lane candidates ahead of already-filled lanes.
            def rank_score(h_idx: int) -> tuple[int, float]:
                p_score = float(probs[h_idx])
                l_score = lookahead_win_rates.get(h_idx, float(win_probs[h_idx] * 100.0)) / 100.0
                return (is_needed_lane(h_idx), 0.40 * p_score + 0.60 * l_score)

            pool_for_top_k = avail_sorted[: max(req.top_k, len(search_pool))]
            top_indices = sorted(pool_for_top_k, key=rank_score, reverse=True)[: req.top_k]
        else:
            top_indices = avail_sorted[: req.top_k]

        if not pool_only_active:
            top_indices = self._ensure_lane_quota(top_indices, avail_sorted, req.top_k)

        recs: list[HeroRecommendation] = []
        for rank_idx, h_idx in enumerate(top_indices, start=1):
            lookahead_val = (
                lookahead_win_rates.get(h_idx, round(float(win_probs[h_idx] * 100.0), 2)) if req.use_lookahead else None
            )
            if req.mode == "ban":
                triggers = p2b_triggers.get(int(h_idx), [])
                reason: Literal["counter", "combo", "ban_unlock", "protect"] | None = "protect" if triggers else None
            else:
                triggers, reason = self._find_pick_triggers_and_reason(
                    int(h_idx), ally_picks, enemy_picks, unlocked_triggers
                )
            recs.append(
                self._build_hero_recommendation(
                    rank_idx=rank_idx,
                    h_idx=int(h_idx),
                    probs=probs,
                    win_probs=win_probs,
                    ap_row=ap_row,
                    ep_row=ep_row,
                    lookahead_val=lookahead_val,
                    triggered_by=triggers,
                    trigger_reason=reason,
                )
            )

        return DraftPredictionResponse(
            architecture=self.architecture,
            mode=req.mode,
            side=req.side,
            phase=req.phase,
            missing_ally_lanes=missing_lanes,
            recommendations=recs,
            ban_unlocked_heroes=ban_unlocked_heroes,
            **forecasts,
        )

    def predict_matrix(self, req: DraftStateRequest) -> DraftPredictionResponse:
        """Pure Empirical Matrix & Rule-Based Draft Engine.

        Executes ZERO neural network inference. Directly evaluates pairwise synergy_matrix,
        counter_matrix, and empirical match frequencies.
        """
        num_heroes = len(self.hero_names)
        ids = self.hero_to_id
        syn_mat = self.ckpt["graphs"]["synergy_mat"]
        cnt_mat = self.ckpt["graphs"]["counter_mat"]

        ally_picks = self.resolve_heroes(req.ally_picks)
        enemy_picks = self.resolve_heroes(req.enemy_picks)
        ally_bans = self.resolve_heroes(req.ally_bans)
        enemy_bans = self.resolve_heroes(req.enemy_bans)
        global_bans = self.resolve_heroes(req.global_bans)
        blue_gb = self.resolve_heroes(req.blue_global_bans)
        red_gb = self.resolve_heroes(req.red_global_bans)

        blue_effective_gb = list(dict.fromkeys([*global_bans, *blue_gb]))
        red_effective_gb = list(dict.fromkeys([*global_bans, *red_gb]))

        act_type = 1 if req.mode == "pick" else 0

        if act_type == 0:  # ban mode: unavailable to ban are opponent's used heroes
            acting_gb = red_effective_gb if req.side == "blue" else blue_effective_gb
        else:  # pick mode: unavailable to pick are acting team's used heroes
            acting_gb = blue_effective_gb if req.side == "blue" else red_effective_gb

        ap_row = np.zeros(num_heroes, dtype=np.float32)
        ep_row = np.zeros(num_heroes, dtype=np.float32)
        for h in ally_picks:
            if h in ids:
                ap_row[ids[h]] = 1.0
        for h in enemy_picks:
            if h in ids:
                ep_row[ids[h]] = 1.0

        unavail = np.zeros(num_heroes, dtype=bool)
        for h in [*ally_picks, *enemy_picks, *ally_bans, *enemy_bans, *acting_gb]:
            if h in ids:
                unavail[ids[h]] = True

        ally_pick_lanes = self._resolve_pick_lanes(req.ally_pick_lanes, set(ally_picks))
        enemy_pick_lanes = self._resolve_pick_lanes(req.enemy_pick_lanes, set(enemy_picks))
        ally_needed_lanes = self._needed_lanes_for_picks(ally_picks, ap_row, explicit_lanes=ally_pick_lanes)
        enemy_needed_lanes = self._needed_lanes_for_picks(enemy_picks, ep_row, explicit_lanes=enemy_pick_lanes)
        target_needed_lanes = ally_needed_lanes if req.mode == "pick" else enemy_needed_lanes
        missing_lanes = [label for label in LANE_LABELS if label.split(" ")[0] in ally_needed_lanes]

        stats_subset = self.stats_df.loc[self.hero_names]
        presence = stats_subset["presence_pct"].values.astype(np.float32) / 100.0
        base_win = (stats_subset["smoothed_win_rate_pct"].values.astype(np.float32) - 50.0) / 100.0

        # Matrix Synergy & Counter scores
        syn_scores = ap_row @ syn_mat  # (130,)
        cnt_scores = cnt_mat @ ep_row  # (130,) advantages over enemy picks: sum_e cnt_mat[c, e] * ep_row[e]
        cnt_risks = ep_row @ cnt_mat  # (130,) how much enemies counter this candidate: sum_e ep_row[e] * cnt_mat[e, c]

        if req.mode == "pick":
            # Score candidate by Base Meta + Synergy + Counter - Risk
            scores = presence * 1.5 + syn_scores * 2.5 + cnt_scores * 2.0 - cnt_risks * 1.2
            unfiltered_scores = scores.copy()
            for i in range(num_heroes):
                if target_needed_lanes and self._lane_key[i] not in target_needed_lanes:
                    scores[i] -= 3.0
        else:
            # Threat to our picks + Synergy to enemy's picks + Meta Priority
            threat_to_us = cnt_mat @ ap_row
            enemy_synergy = ep_row @ syn_mat
            scores = presence * 2.0 + threat_to_us * 3.0 + enemy_synergy * 2.0
            unfiltered_scores = scores.copy()
            for i in range(num_heroes):
                if enemy_needed_lanes and self._lane_key[i] not in enemy_needed_lanes:
                    scores[i] -= 3.0

        scores[unavail] = -1e9
        unfiltered_scores[unavail] = -1e9
        valid_mask = ~unavail
        probs = np.zeros(num_heroes, dtype=np.float32)
        unfiltered_probs = np.zeros(num_heroes, dtype=np.float32)
        if valid_mask.any():
            max_s = np.max(scores[valid_mask])
            exp_s = np.exp(np.clip(scores - max_s, -30.0, 0.0))
            exp_s[unavail] = 0.0
            if req.series_winning_heroes:
                for h_win in set(self.resolve_heroes(req.series_winning_heroes)):
                    h_id = ids[h_win]
                    if not unavail[h_id]:
                        exp_s[h_id] *= 1.12
            sum_exp = exp_s.sum()
            if sum_exp > 0:
                probs = exp_s / sum_exp

            max_u = np.max(unfiltered_scores[valid_mask])
            exp_u = np.exp(np.clip(unfiltered_scores - max_u, -30.0, 0.0))
            exp_u[unavail] = 0.0
            if req.series_winning_heroes:
                for h_win in set(self.resolve_heroes(req.series_winning_heroes)):
                    h_id = ids[h_win]
                    if not unavail[h_id]:
                        exp_u[h_id] *= 1.12
            sum_u = exp_u.sum()
            if sum_u > 0:
                unfiltered_probs = exp_u / sum_u

        # Current matchup win rate estimation
        if req.side == "blue":
            b_picks, r_picks = ally_picks, enemy_picks
        else:
            b_picks, r_picks = enemy_picks, ally_picks

        b_syn = sum(float(syn_mat[ids[b1], ids[b2]]) for i, b1 in enumerate(b_picks) for b2 in b_picks[i + 1 :])
        r_syn = sum(float(syn_mat[ids[r1], ids[r2]]) for i, r1 in enumerate(r_picks) for r2 in r_picks[i + 1 :])
        b_cnt = sum(float(cnt_mat[ids[b], ids[r]]) for b in b_picks for r in r_picks)
        base_matchup_win = float(np.clip(0.50 + (b_syn - r_syn + b_cnt) * 0.20, 0.30, 0.70))

        # Expected win prob when taking action (Pick adds hero for ally; Ban removes threat from enemy)
        acting_matchup_win = base_matchup_win if req.side == "blue" else (1.0 - base_matchup_win)
        win_probs = np.zeros(num_heroes, dtype=np.float32)
        if req.mode == "pick":
            for i in range(num_heroes):
                delta = float(base_win[i] + syn_scores[i] + cnt_scores[i] - cnt_risks[i])
                win_probs[i] = float(np.clip(acting_matchup_win + delta * 0.5, 0.30, 0.70))
        else:
            threat_to_us_vec = cnt_mat @ ap_row
            enemy_syn_vec = ep_row @ syn_mat
            for i in range(num_heroes):
                ban_relief = float(base_win[i] * 0.5 + threat_to_us_vec[i] + enemy_syn_vec[i])
                win_probs[i] = float(np.clip(acting_matchup_win + ban_relief * 0.35, 0.30, 0.70))

        if len(b_picks) == 5 and len(r_picks) == 5:
            # Completed draft: evaluate exact 5v5 board win rate
            win_probs = np.full(num_heroes, acting_matchup_win, dtype=np.float32)

        ban_unlocked_heroes, unlocked_triggers = self._compute_ban_unlocked_heroes(
            all_bans=ally_bans + enemy_bans,
            unavail_row=unavail,
            probs=probs,
            win_probs=win_probs,
            ap_row=ap_row,
            ep_row=ep_row,
            needed_lanes=target_needed_lanes,
            top_n=5,
        )
        _, p2b_triggers = self._compute_pick_to_ban_scores(ally_picks, unavail) if req.mode == "ban" else (None, {})

        def is_needed_lane(h_idx: int) -> int:
            return int(not target_needed_lanes or self._lane_key[h_idx] in target_needed_lanes)

        avail_sorted = sorted(
            (int(i) for i in np.flatnonzero(~unavail)),
            key=lambda h_idx: (is_needed_lane(h_idx), float(probs[h_idx]), float(unfiltered_probs[h_idx])),
            reverse=True,
        )
        top_indices = self._ensure_lane_quota(avail_sorted[: req.top_k], avail_sorted, req.top_k)

        recs: list[HeroRecommendation] = []
        for rank_idx, h_idx in enumerate(top_indices, start=1):
            if req.mode == "ban":
                triggers = p2b_triggers.get(int(h_idx), [])
                reason = "protect" if triggers else None
            else:
                triggers, reason = self._find_pick_triggers_and_reason(
                    int(h_idx), ally_picks, enemy_picks, unlocked_triggers
                )
            recs.append(
                self._build_hero_recommendation(
                    rank_idx=rank_idx,
                    h_idx=int(h_idx),
                    probs=probs,
                    win_probs=win_probs,
                    ap_row=ap_row,
                    ep_row=ep_row,
                    lookahead_val=None,
                    triggered_by=triggers,
                    trigger_reason=reason,
                )
            )

        # Build simulated next picks/bans using empirical matrix scores
        teams = [
            TeamDraft(
                "blue",
                b_picks,
                r_picks,
                ally_bans if req.side == "blue" else enemy_bans,
                enemy_bans if req.side == "blue" else ally_bans,
            ),
            TeamDraft(
                "red",
                r_picks,
                b_picks,
                enemy_bans if req.side == "blue" else ally_bans,
                ally_bans if req.side == "blue" else enemy_bans,
            ),
        ]
        forecasts: dict[str, list[HeroRecommendation]] = {
            "blue_next_picks": [],
            "red_next_picks": [],
            "blue_next_bans": [],
            "red_next_bans": [],
        }

        # Simulated forecasts for next picks and next bans using empirical matrix scores
        series_win_resolved = (
            list(set(self.resolve_heroes(req.series_winning_heroes))) if req.series_winning_heroes else []
        )
        matrix_pick_lanes_by_side = (
            {"blue": ally_pick_lanes, "red": enemy_pick_lanes}
            if req.side == "blue"
            else {"blue": enemy_pick_lanes, "red": ally_pick_lanes}
        )
        for t in teams:
            opp_side = "red" if t.side == "blue" else "blue"
            t_pick_lanes = matrix_pick_lanes_by_side[t.side]
            opp_pick_lanes = matrix_pick_lanes_by_side[opp_side]
            t_ep = np.zeros(num_heroes, dtype=np.float32)
            for h in t.opp_picks:
                if h in ids:
                    t_ep[ids[h]] = 1.0

            # 1. Next bans forecast
            ban_slots = self._next_ban_slots(t, 2)
            if ban_slots > 0:
                t_ap_ban = np.zeros(num_heroes, dtype=np.float32)
                for h in t.picks:
                    if h in ids:
                        t_ap_ban[ids[h]] = 1.0
                opp_gb = red_effective_gb if t.side == "blue" else blue_effective_gb
                b_unavail = np.zeros(num_heroes, dtype=bool)
                for h in [*t.picks, *t.opp_picks, *t.bans, *t.opp_bans, *opp_gb]:
                    if h in ids:
                        b_unavail[ids[h]] = True
                b_scores = presence * 2.0 + (cnt_mat @ t_ap_ban) * 3.0 + (t_ep @ syn_mat) * 2.0
                b_scores[b_unavail] = -1e9
                b_valid = ~b_unavail
                if b_valid.any():
                    m_b = np.max(b_scores[b_valid])
                    e_b = np.exp(np.clip(b_scores - m_b, -30.0, 0.0))
                    e_b[b_unavail] = 0.0
                    for h_win in series_win_resolved:
                        h_id = ids[h_win]
                        if not b_unavail[h_id]:
                            e_b[h_id] *= 1.12
                    s_b = e_b.sum()
                    b_probs = (e_b / s_b) if s_b > 0 else np.zeros(num_heroes, dtype=np.float32)
                    t_matchup_win = base_matchup_win if t.side == "blue" else (1.0 - base_matchup_win)
                    t_threat = cnt_mat @ t_ap_ban
                    t_esyn = t_ep @ syn_mat
                    t_ban_win = np.clip(t_matchup_win + (base_win * 0.5 + t_threat + t_esyn) * 0.35, 0.30, 0.70).astype(
                        np.float32
                    )
                    forecasts[f"{t.side}_next_bans"] = self._forecast_bans(
                        t,
                        ban_slots,
                        b_probs,
                        t_ban_win,
                        t_ap_ban,
                        t_ep,
                        b_unavail,
                        opp_explicit_lanes=opp_pick_lanes,
                    )

            # 2. Next picks forecast (sequentially updated so rank 1 and rank 2 fill distinct lanes)
            pick_slots = self._next_pick_slots(t, 2)
            sim_picks = list(t.picks)
            own_gb = blue_effective_gb if t.side == "blue" else red_effective_gb
            t_matchup_win = base_matchup_win if t.side == "blue" else (1.0 - base_matchup_win)
            for rank in range(1, pick_slots + 1):
                t_ap = np.zeros(num_heroes, dtype=np.float32)
                for h in sim_picks:
                    if h in ids:
                        t_ap[ids[h]] = 1.0
                t_unavail = np.zeros(num_heroes, dtype=bool)
                for h in [*sim_picks, *t.opp_picks, *t.bans, *t.opp_bans, *own_gb]:
                    if h in ids:
                        t_unavail[ids[h]] = True

                t_syn_vec = t_ap @ syn_mat
                t_cnt_vec = cnt_mat @ t_ep
                t_risk_vec = t_ep @ cnt_mat
                t_scores = presence * 1.5 + t_syn_vec * 2.5 + t_cnt_vec * 2.0 - t_risk_vec * 1.2
                t_scores[t_unavail] = -1e9
                valid = ~t_unavail
                if not valid.any():
                    break
                m_val = np.max(t_scores[valid])
                e_val = np.exp(np.clip(t_scores - m_val, -30.0, 0.0))
                e_val[t_unavail] = 0.0
                for h_win in series_win_resolved:
                    h_id = ids[h_win]
                    if not t_unavail[h_id]:
                        e_val[h_id] *= 1.12
                s_sum = e_val.sum()
                t_probs = (e_val / s_sum) if s_sum > 0 else np.zeros(num_heroes, dtype=np.float32)
                t_pick_win = np.clip(
                    t_matchup_win + (base_win + t_syn_vec + t_cnt_vec - t_risk_vec) * 0.5, 0.30, 0.70
                ).astype(np.float32)
                rec = self._choose_next_pick(
                    t,
                    sim_picks,
                    rank,
                    t_probs,
                    t_pick_win,
                    t_ap,
                    t_ep,
                    t_unavail,
                    explicit_lanes=t_pick_lanes,
                )
                forecasts[f"{t.side}_next_picks"].append(rec)
                sim_picks.append(rec.hero_name)

        return DraftPredictionResponse(
            architecture="EmpiricalMatrixRules",
            mode=req.mode,
            side=req.side,
            phase=req.phase,
            missing_ally_lanes=missing_lanes,
            recommendations=recs,
            ban_unlocked_heroes=ban_unlocked_heroes,
            **forecasts,
        )
