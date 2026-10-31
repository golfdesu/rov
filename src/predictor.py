import json
import re
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
from src.search.draft_mcts import DraftMinimaxSearch, DraftSearchState, ModelInput, encode_batch, run_model
from src.train_sota_model import RoVDraftGNNTransformer, get_league_vector

LANE_LABELS = [
    "DS_Lane (ออฟเลน)",
    "Jungle (ป่า)",
    "Mid (เมจ)",
    "Dragon_Lane (แครี่)",
    "Roam (โรมมิ่ง)",
]
ALL_LANE_KEYS = frozenset(label.split(" ")[0] for label in LANE_LABELS)


class TeamDraft(NamedTuple):
    """One team's view of the board (canonical hero names)."""

    side: str
    picks: list[str]
    opp_picks: list[str]
    bans: list[str]
    opp_bans: list[str]


class RoVDraftPredictor:
    """Production OOP Inference Engine for SOTA RoVDraftGNNTransformer."""

    def __init__(self, model_path: Path | None = None):
        if model_path is not None:
            self.model_path = model_path
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
        self.hero_to_id: dict[str, int] = self.ckpt["hero_to_id"]
        self.architecture: str = self.ckpt.get("architecture", "RoVDraftGNNTransformer")
        self.val_loss: float = float(self.ckpt.get("val_loss", 0.0))

        model_cfg = self.ckpt.get("model_config", {"d_model": 128, "nhead": 4, "num_layers": 2})
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

        self.heroes_df = pd.read_csv(config.paths.heroes_csv_path).set_index("name")
        self.stats_df = pd.read_csv(config.paths.hero_stats_csv_path).set_index("name")
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
        self._primary_role: list[str] = [str(v) for v in heroes["primary_role"]]
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

        matches_path = config.paths.matches_json_path
        if not matches_path.exists():
            return ban_to_pick, pick_to_ban

        raw_matches = json.loads(matches_path.read_text(encoding="utf-8"))
        matches = [
            m
            for m in raw_matches
            if not (
                "2024" in m.get("tournament", "") or "2024" in m.get("series_id", "") or "2024" in m.get("date", "")
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
            is_2026 = (
                "2026" in m.get("tournament", "") or "2026" in m.get("series_id", "") or "2026" in m.get("date", "")
            )
            for row, side, opp in ((2 * g, "blue", "red"), (2 * g + 1, "red", "blue")):
                won[row] = bool(m.get("blue_win")) == (side == "blue")
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
        for k in list(self.hero_to_id.keys()):
            lookup[re.sub(r"[^a-z0-9]", "", k.lower())] = k
        lookup.update(
            {
                "riktor": "Richter",
                "diaochan": "Diao Chan",
                "flowborn": "Flowborn (Marksman)",
                "flowborn mm": "Flowborn (Marksman)",
                "flowborn mage": "Flowborn (Mage)",
            }
        )
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
    ) -> ModelInput:
        """Encodes one draft position from the acting team's point of view."""
        step_idx = min(len(ally_picks) + len(enemy_picks) + len(ally_bans) + len(enemy_bans), 17)
        meta = (
            step_idx / 17.0,
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
        if (not team.picks and not team.bans) or len(team.picks) >= 5:
            return 0
        return min(max_slots, 5 - len(team.picks))

    @staticmethod
    def _next_ban_slots(team: TeamDraft, max_slots: int) -> int:
        """Bans to forecast; needs at least one pick to reason from and stops at 4 bans."""
        if not team.picks or len(team.bans) >= 4:
            return 0
        return min(max_slots, 4 - len(team.bans))

    def _next_pick_input(
        self, team: TeamDraft, sim_picks: list[str], global_bans: list[str], league: str = "GLOBAL"
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

    def _next_ban_input(self, team: TeamDraft, global_bans: list[str], league: str = "GLOBAL") -> ModelInput:
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

    def _needed_lanes_for_picks(
        self,
        picks: list[str],
        pick_vec_row: np.ndarray | None = None,
    ) -> set[str]:
        """Return the set of lane keys still needed by a team given its current picks."""
        if not picks:
            return set(ALL_LANE_KEYS)
        taken_primary_lanes = {self._lane_key[self.hero_to_id[h]] for h in picks}
        if pick_vec_row is None:
            pick_vec_row = np.zeros(len(self.hero_names), dtype=np.float32)
            for h in picks:
                pick_vec_row[self.hero_to_id[h]] = 1.0
        lane_cov = pick_vec_row @ self.ckpt["lane_probs"]
        open_lanes = {LANE_LABELS[i].split(" ")[0] for i in range(5) if lane_cov[i] < 0.65}
        needed = open_lanes - taken_primary_lanes
        remaining_slots = max(0, len(ALL_LANE_KEYS) - len(picks))
        unfilled_primary = set(ALL_LANE_KEYS - taken_primary_lanes)
        if len(needed) < min(remaining_slots, len(unfilled_primary)):
            needed = unfilled_primary
        return needed

    def _apply_lane_filter(
        self,
        probs: np.ndarray,
        needed_lanes: set[str],
        penalty: float = 0.05,
    ) -> np.ndarray:
        """Down-weight heroes whose primary lane is not in `needed_lanes` and re-normalize."""
        if not needed_lanes or len(needed_lanes) >= len(ALL_LANE_KEYS):
            return probs
        filtered = probs.copy()
        for idx, lk in enumerate(self._lane_key):
            if lk not in needed_lanes:
                filtered[idx] *= penalty
        total = float(filtered.sum())
        if total > 0:
            filtered = filtered / total * float(probs.sum())
        return filtered

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

        needed_lanes = self._needed_lanes_for_picks(sim_picks, ap_row)
        blended_probs = self._apply_lane_filter(blended_probs, needed_lanes)

        sorted_indices = np.argsort(blended_probs)[::-1]
        chosen_idx = int(sorted_indices[0])
        for cand_idx in sorted_indices:
            if blended_probs[cand_idx] <= 0:
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
    ) -> list[HeroRecommendation]:
        """Top `slots` ban targets, blending the policy with pick -> phase-2 ban statistics."""
        p2b_scores, p2b_triggers = self._compute_pick_to_ban_scores(team.picks, unavail_row)
        if p2b_scores.max() > 0:
            p2b_dist = p2b_scores / float(p2b_scores.sum())
            p2b_weight = 0.15 if team.opp_picks else 0.75
            blended_probs = (1.0 - p2b_weight) * probs + p2b_weight * p2b_dist
        else:
            blended_probs = probs

        opp_needed_lanes = self._needed_lanes_for_picks(team.opp_picks, ep_row)
        blended_probs = self._apply_lane_filter(blended_probs, opp_needed_lanes)

        forecast: list[HeroRecommendation] = []
        for cand_idx in np.argsort(blended_probs)[::-1]:
            if blended_probs[cand_idx] <= 0 or len(forecast) >= slots:
                break
            c_idx = int(cand_idx)
            if opp_needed_lanes and self._lane_key[c_idx] not in opp_needed_lanes:
                continue
            triggers = p2b_triggers.get(c_idx, list(team.picks[:1]))
            reason: Literal["counter", "combo", "ban_unlock", "protect"] | None = "protect" if triggers else None
            forecast.append(
                self._build_hero_recommendation(
                    rank_idx=len(forecast) + 1,
                    h_idx=c_idx,
                    probs=blended_probs,
                    win_probs=win_probs,
                    ap_row=ap_row,
                    ep_row=ep_row,
                    triggered_by=triggers,
                    trigger_reason=reason,
                )
            )
        return forecast

    def _evaluate_with_forecasts(
        self,
        main_input: ModelInput,
        teams: list[TeamDraft],
        global_bans: list[str] | dict[str, list[str]],
        max_slots: int = 2,
        league: str = "GLOBAL",
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
            probs_t, win_t = run_model(self.model, arrays, self.device)
            probs, win = probs_t.cpu().numpy(), win_t.cpu().numpy()
            ap, ep, unavail = arrays[0], arrays[1], arrays[4]

            offset = 0
            if main_arrays is None:
                main_arrays = tuple(a[:1] for a in arrays)
                main_probs, main_win = probs[0], win[0]
                offset = 1
            for row, (kind, t) in enumerate(jobs, start=offset):
                if kind == "ban":
                    forecasts[f"{t.side}_next_bans"] = self._forecast_bans(
                        t, self._next_ban_slots(t, max_slots), probs[row], win[row], ap[row], ep[row], unavail[row]
                    )
                else:
                    rec = self._choose_next_pick(
                        t, sim_picks[t.side], rank, probs[row], win[row], ap[row], ep[row], unavail[row]
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

    def predict(self, req: DraftStateRequest) -> DraftPredictionResponse:
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
        side_val = 0 if req.side == "blue" else 1

        if act_type == 0:  # ban mode: unavailable to ban are opponent's used heroes
            acting_gb = red_effective_gb if req.side == "blue" else blue_effective_gb
        else:  # pick mode: unavailable to pick are acting team's used heroes
            acting_gb = blue_effective_gb if req.side == "blue" else red_effective_gb

        if req.side == "blue":
            blue_picks, red_picks = ally_picks, enemy_picks
            blue_bans, red_bans = ally_bans, enemy_bans
        else:
            blue_picks, red_picks = enemy_picks, ally_picks
            blue_bans, red_bans = enemy_bans, ally_bans
        teams = [
            TeamDraft("blue", blue_picks, red_picks, blue_bans, red_bans),
            TeamDraft("red", red_picks, blue_picks, red_bans, blue_bans),
        ]

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
        )
        arrays, probs, win_probs, forecasts = self._evaluate_with_forecasts(
            main_input, teams, {"blue": blue_effective_gb, "red": red_effective_gb}, league=req.league
        )
        ap_row, ep_row, unavail_row = arrays[0][0], arrays[1][0], arrays[4][0]

        # Completed 5v5 board (Step 18): evaluate exact 5v5 win rate at Step 17 (Red Pick 5)
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
            )
            step17_arrays = encode_batch([step17_input], len(self.hero_names))
            _, step17_win_t = run_model(self.model, step17_arrays, self.device)
            red_final_win = float(step17_win_t[0, self.hero_to_id[red_picks[4]]].item())
            acting_final_win = (1.0 - red_final_win) if req.side == "blue" else red_final_win
            win_probs = np.full(len(self.hero_names), acting_final_win, dtype=np.float32)

        ally_needed_lanes = self._needed_lanes_for_picks(ally_picks, ap_row)
        enemy_needed_lanes = self._needed_lanes_for_picks(enemy_picks, ep_row)
        target_needed_lanes = ally_needed_lanes if req.mode == "pick" else enemy_needed_lanes
        probs = self._apply_lane_filter(probs, target_needed_lanes)

        def is_needed_lane(h_idx: int) -> int:
            return int(not target_needed_lanes or self._lane_key[h_idx] in target_needed_lanes)

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

            step_idx = self.search_engine.find_matching_step(
                side_val, act_type, req.phase, len(b_p), len(r_p), len(b_b), len(r_b)
            )
            root_state = DraftSearchState(
                blue_picks=b_p,
                red_picks=r_p,
                blue_bans=b_b,
                red_bans=r_b,
                global_bans=tuple(ids[h] for h in global_bans),
                blue_global_bans=tuple(ids[h] for h in blue_gb),
                red_global_bans=tuple(ids[h] for h in red_gb),
                step_idx=step_idx,
                league=req.league,
            )
            candidate_pool = avail_sorted[: max(req.top_k * 2, 8)]
            lookahead_win_rates = self.search_engine.search_lookahead_win_rates(
                root_state,
                candidate_pool,
                depth=req.lookahead_depth,
                branch_factor=5,
            )

            # Re-rank candidates by blending policy prior and adversarial lookahead win rate,
            # while strictly keeping needed-lane candidates ahead of already-filled lanes.
            def rank_score(h_idx: int) -> tuple[int, float]:
                p_score = float(probs[h_idx])
                l_score = lookahead_win_rates.get(h_idx, float(win_probs[h_idx] * 100.0)) / 100.0
                return (is_needed_lane(h_idx), 0.40 * p_score + 0.60 * l_score)

            top_indices = sorted(candidate_pool, key=rank_score, reverse=True)[: req.top_k]
        else:
            top_indices = avail_sorted[: req.top_k]

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

        ally_needed_lanes = self._needed_lanes_for_picks(ally_picks, ap_row)
        enemy_needed_lanes = self._needed_lanes_for_picks(enemy_picks, ep_row)
        target_needed_lanes = ally_needed_lanes if req.mode == "pick" else enemy_needed_lanes
        missing_lanes = [label for label in LANE_LABELS if label.split(" ")[0] in ally_needed_lanes]

        stats_subset = self.stats_df.loc[self.hero_names]
        presence = stats_subset["presence_pct"].values.astype(np.float32) / 100.0
        base_win = (stats_subset["smoothed_win_rate_pct"].values.astype(np.float32) - 50.0) / 100.0

        # Matrix Synergy & Counter scores
        syn_scores = ap_row @ syn_mat  # (130,)
        cnt_scores = ep_row @ cnt_mat  # (130,) advantages over enemy picks
        cnt_risks = cnt_mat @ ep_row  # (130,) how much enemies counter this candidate

        if req.mode == "pick":
            # Score candidate by Base Meta + Synergy + Counter - Risk
            scores = presence * 1.5 + syn_scores * 2.5 + cnt_scores * 2.0 - cnt_risks * 1.2
            for i in range(num_heroes):
                if target_needed_lanes and self._lane_key[i] not in target_needed_lanes:
                    scores[i] -= 20.0
        else:
            # Threat to our picks + Synergy to enemy's picks + Meta Priority
            threat_to_us = cnt_mat @ ap_row
            enemy_synergy = ep_row @ syn_mat
            scores = presence * 2.0 + threat_to_us * 3.0 + enemy_synergy * 2.0
            for i in range(num_heroes):
                if enemy_needed_lanes and self._lane_key[i] not in enemy_needed_lanes:
                    scores[i] -= 10.0

        scores[unavail] = -1e9
        valid_mask = ~unavail
        probs = np.zeros(num_heroes, dtype=np.float32)
        if valid_mask.any():
            max_s = np.max(scores[valid_mask])
            exp_s = np.exp(np.clip(scores - max_s, -30.0, 0.0))
            exp_s[unavail] = 0.0
            sum_exp = exp_s.sum()
            if sum_exp > 0:
                probs = exp_s / sum_exp

        # Current matchup win rate estimation
        if req.side == "blue":
            b_picks, r_picks = ally_picks, enemy_picks
        else:
            b_picks, r_picks = enemy_picks, ally_picks

        b_syn = sum(float(syn_mat[ids[b1], ids[b2]]) for i, b1 in enumerate(b_picks) for b2 in b_picks[i + 1 :])
        r_syn = sum(float(syn_mat[ids[r1], ids[r2]]) for i, r1 in enumerate(r_picks) for r2 in r_picks[i + 1 :])
        b_cnt = sum(float(cnt_mat[ids[b], ids[r]]) for b in b_picks for r in r_picks)
        base_matchup_win = float(np.clip(0.50 + (b_syn - r_syn + b_cnt), 0.30, 0.70))

        # Hero win prob when chosen
        win_probs = np.zeros(num_heroes, dtype=np.float32)
        for i in range(num_heroes):
            delta = float(base_win[i] + syn_scores[i] + cnt_scores[i] - cnt_risks[i])
            if req.side == "blue":
                win_probs[i] = float(np.clip(base_matchup_win + delta * 0.5, 0.30, 0.70))
            else:
                acting_win = 1.0 - base_matchup_win
                win_probs[i] = float(np.clip(acting_win + delta * 0.5, 0.30, 0.70))

        if len(b_picks) == 5 and len(r_picks) == 5:
            # Completed draft: evaluate exact 5v5 board win rate
            acting_win = base_matchup_win if req.side == "blue" else (1.0 - base_matchup_win)
            win_probs = np.full(num_heroes, acting_win, dtype=np.float32)

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
            (int(i) for i in np.flatnonzero(probs > 0)),
            key=lambda h_idx: (is_needed_lane(h_idx), float(probs[h_idx])),
            reverse=True,
        )
        top_indices = avail_sorted[: req.top_k]

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

        # Quick simulated forecasts for next picks
        for t in teams:
            t_ap = np.zeros(num_heroes, dtype=np.float32)
            for h in t.picks:
                if h in ids:
                    t_ap[ids[h]] = 1.0
            t_ep = np.zeros(num_heroes, dtype=np.float32)
            for h in t.opp_picks:
                if h in ids:
                    t_ep[ids[h]] = 1.0
            t_unavail = unavail.copy()
            for h in [*t.picks, *t.opp_picks, *t.bans, *t.opp_bans]:
                if h in ids:
                    t_unavail[ids[h]] = True

            t_needed = self._needed_lanes_for_picks(t.picks, t_ap)
            t_scores = presence * 1.5 + (t_ap @ syn_mat) * 2.5 + (t_ep @ cnt_mat) * 2.0 - (cnt_mat @ t_ep) * 1.2
            for i in range(num_heroes):
                if t_needed and self._lane_key[i] not in t_needed:
                    t_scores[i] -= 20.0
            t_scores[t_unavail] = -1e9

            valid = ~t_unavail
            if valid.any():
                m_val = np.max(t_scores[valid])
                e_val = np.exp(np.clip(t_scores - m_val, -30.0, 0.0))
                e_val[t_unavail] = 0.0
                s_sum = e_val.sum()
                t_probs = (e_val / s_sum) if s_sum > 0 else np.zeros(num_heroes, dtype=np.float32)
                top_cand = sorted(
                    (int(i) for i in np.flatnonzero(t_probs > 0)),
                    key=lambda idx: (int(not t_needed or self._lane_key[idx] in t_needed), float(t_probs[idx])),
                    reverse=True,
                )[:2]
                for r_idx, c_idx in enumerate(top_cand, start=1):
                    trigs, reas = self._find_pick_triggers_and_reason(c_idx, t.picks, t.opp_picks, {})
                    rec = self._build_hero_recommendation(
                        rank_idx=r_idx,
                        h_idx=c_idx,
                        probs=t_probs,
                        win_probs=win_probs,
                        ap_row=t_ap,
                        ep_row=t_ep,
                        triggered_by=trigs,
                        trigger_reason=reas,
                    )
                    forecasts[f"{t.side}_next_picks"].append(rec)

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
