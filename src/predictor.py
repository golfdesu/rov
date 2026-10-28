import json
import re
from pathlib import Path
from typing import NamedTuple

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
from src.train_sota_model import RoVDraftGNNTransformer

LANE_LABELS = [
    "DS_Lane (ออฟเลน)",
    "Jungle (ป่า)",
    "Mid (เมจ)",
    "Dragon_Lane (แครี่)",
    "Roam (โรมมิ่ง)",
]


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

        matches = json.loads(matches_path.read_text(encoding="utf-8"))
        n_team_games = max(1, len(matches) * 2)

        # One row per (game, team): one-hot matrices turn every pairwise count into a matrix product
        n_rows = len(matches) * 2
        bans = np.zeros((n_rows, num_heroes), dtype=np.float32)
        p2_bans = np.zeros((n_rows, num_heroes), dtype=np.float32)
        picks = np.zeros((n_rows, num_heroes), dtype=np.float32)
        opp_picks = np.zeros((n_rows, num_heroes), dtype=np.float32)
        won = np.zeros(n_rows, dtype=np.bool_)
        ids = self.hero_to_id

        for g, m in enumerate(matches):
            for row, side, opp in ((2 * g, "blue", "red"), (2 * g + 1, "red", "blue")):
                won[row] = bool(m.get("blue_win")) == (side == "blue")
                side_bans = m.get(f"{side}_bans", [])
                bans[row, [ids[h] for h in side_bans if h in ids]] = 1.0
                p2_bans[row, [ids[h] for h in side_bans[2:4] if h in ids]] = 1.0
                picks[row, [ids[h] for h in m.get(f"{side}_picks", []) if h in ids]] = 1.0
                opp_picks[row, [ids[h] for h in m.get(f"{opp}_picks", []) if h in ids]] = 1.0

        # float32 sums of 0/1 values are exact well past this dataset's size (< 2**24)
        ban_cnt = bans.sum(axis=0).astype(np.int64)
        p2ban_cnt = p2_bans.sum(axis=0).astype(np.int64)
        pick_cnt = picks.sum(axis=0).astype(np.int64)
        co_ban_pick = (bans.T @ picks).astype(np.int64)  # [b, p] = team games with ban b and pick p
        co_pick_p2ban = (picks.T @ p2_bans).astype(np.int64)
        vs_games = (picks.T @ opp_picks).astype(np.int64)  # [p, e] = games where p faced e
        vs_wins = (picks[won].T @ opp_picks[won]).astype(np.int64)

        not_self = ~np.eye(num_heroes, dtype=np.bool_)

        # Ban b -> pick p: teams pick p more often after banning b; boosted when p tends to lose to b
        co = co_ban_pick.astype(np.float64)
        with np.errstate(divide="ignore", invalid="ignore"):
            lift = co * n_team_games / (ban_cnt[:, None] * pick_cnt[None, :])
            games_vs_ban = vs_games.T  # [b, p] = games where p faced b
            loss_rate = np.where(games_vs_ban >= 5, 1.0 - vs_wins.T / np.maximum(games_vs_ban, 1), 0.5)
        keep = (ban_cnt[:, None] >= 20) & (pick_cnt[None, :] >= 30) & (co_ban_pick >= 5) & not_self & (lift >= 1.15)
        score = lift * (1.0 + np.maximum(0.0, loss_rate - 0.48) * 3.0) * np.log1p(co)
        ban_to_pick[keep] = score[keep]

        # Pick p -> phase-2 ban b: what teams that picked p go on to ban in phase 2
        co_p2 = co_pick_p2ban.astype(np.float64)
        with np.errstate(divide="ignore", invalid="ignore"):
            lift_p2 = co_p2 * n_team_games / (pick_cnt[:, None] * p2ban_cnt[None, :])
        keep = (
            (pick_cnt[:, None] >= 25) & (p2ban_cnt[None, :] >= 20) & (co_pick_p2ban >= 5) & not_self & (lift_p2 >= 1.15)
        )
        score = (co_p2**0.75) * lift_p2
        pick_to_ban[keep] = score[keep]

        return ban_to_pick, pick_to_ban

    def _sum_contributions(
        self,
        table: np.ndarray,
        source_names: list[str],
        unavail_row: np.ndarray,
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
        scores[:] = sorted_rows.sum(axis=0)

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
        return self._sum_contributions(self.ban_to_pick_score, bans, unavail_row)

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
        )

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

    def _next_pick_input(self, team: TeamDraft, sim_picks: list[str], global_bans: list[str]) -> ModelInput:
        return self._model_input(
            sim_picks,
            team.opp_picks,
            team.bans,
            team.opp_bans,
            global_bans,
            is_pick=True,
            is_red=team.side == "red",
            phase=1 if len(sim_picks) < 3 else 2,
        )

    def _next_ban_input(self, team: TeamDraft, global_bans: list[str]) -> ModelInput:
        return self._model_input(
            team.picks,
            team.opp_picks,
            team.bans,
            team.opp_bans,
            global_bans,
            is_pick=False,
            is_red=team.side == "red",
            phase=1 if len(team.bans) < 2 else 2,
        )

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
        """Picks the likeliest hero that fills a still-open lane, blending in ban-unlock statistics."""
        ban_scores, ban_triggers = self._compute_ban_unlocked_scores(team.bans, unavail_row)
        if ban_scores.max() > 0:
            sharpened = np.power(ban_scores / float(ban_scores.max()), 2.5)
            ban_dist = sharpened / float(sharpened.sum())
            blend_w = 0.75 if len(team.picks) == 0 else 0.35
            blended_probs = (1.0 - blend_w) * probs + blend_w * ban_dist
        else:
            blended_probs = probs

        ally_lane_cov = ap_row @ self.ckpt["lane_probs"]
        open_lanes = {LANE_LABELS[i].split(" ")[0] for i in range(5) if ally_lane_cov[i] < 0.65}
        taken_primary_lanes = {self._lane_key[self.hero_to_id[h]] for h in sim_picks}
        needed_lanes = open_lanes - taken_primary_lanes

        sorted_indices = np.argsort(blended_probs)[::-1]
        chosen_idx = int(sorted_indices[0])
        for cand_idx in sorted_indices[:25]:
            if blended_probs[cand_idx] <= 0:
                break
            if not needed_lanes or self._lane_key[cand_idx] in needed_lanes:
                chosen_idx = int(cand_idx)
                break

        triggers = list(ban_triggers.get(chosen_idx, []))
        if not triggers and sim_picks:
            syn_mat = self.ckpt["graphs"]["synergy_mat"]
            best_ally = max(sim_picks, key=lambda a: float(syn_mat[self.hero_to_id[a], chosen_idx]))
            if float(syn_mat[self.hero_to_id[best_ally], chosen_idx]) > 0:
                triggers = [best_ally]

        return self._build_hero_recommendation(
            rank_idx=rank,
            h_idx=chosen_idx,
            probs=blended_probs,
            win_probs=win_probs,
            ap_row=ap_row,
            ep_row=ep_row,
            triggered_by=triggers,
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
            blended_probs = 0.25 * probs + 0.75 * (p2b_scores / float(p2b_scores.sum()))
        else:
            blended_probs = probs

        forecast: list[HeroRecommendation] = []
        for rank_idx, cand_idx in enumerate(np.argsort(blended_probs)[::-1][:slots], start=1):
            if blended_probs[cand_idx] <= 0:
                break
            c_idx = int(cand_idx)
            forecast.append(
                self._build_hero_recommendation(
                    rank_idx=rank_idx,
                    h_idx=c_idx,
                    probs=blended_probs,
                    win_probs=win_probs,
                    ap_row=ap_row,
                    ep_row=ep_row,
                    triggered_by=p2b_triggers.get(c_idx, list(team.picks[:1])),
                )
            )
        return forecast

    def _evaluate_with_forecasts(
        self,
        main_input: ModelInput,
        teams: list[TeamDraft],
        global_bans: list[str] | dict[str, list[str]],
        max_slots: int = 2,
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
                inputs.append(self._next_ban_input(t, gb_by_side.get(opp_side, [])))
                jobs.append(("ban", t))
        main_arrays: tuple[np.ndarray, ...] | None = None
        main_probs = main_win = np.empty(0)

        for rank in range(1, max_slots + 1):
            for t in teams:
                if rank == 1:
                    forecasts[f"{t.side}_next_picks"] = []
                if pick_slots[t.side] >= rank:
                    inputs.append(self._next_pick_input(t, sim_picks[t.side], gb_by_side.get(t.side, [])))
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
        top_n: int = 5,
    ) -> tuple[list[HeroRecommendation], dict[int, list[str]]]:
        """Return top heroes unlocked / made stronger by current bans on the board."""
        ban_scores, ban_triggers = self._compute_ban_unlocked_scores(all_bans, unavail_row)
        if ban_scores.max() <= 0:
            return [], {}

        ban_dist = ban_scores / float(ban_scores.sum())
        blended_probs = 0.30 * probs + 0.70 * ban_dist
        sorted_indices = np.argsort(ban_scores)[::-1]
        unlocked: list[HeroRecommendation] = []
        for rank_idx, cand_idx in enumerate(sorted_indices[:top_n], start=1):
            c_idx = int(cand_idx)
            if ban_scores[c_idx] <= 0:
                break
            unlocked.append(
                self._build_hero_recommendation(
                    rank_idx=rank_idx,
                    h_idx=c_idx,
                    probs=blended_probs,
                    win_probs=win_probs,
                    ap_row=ap_row,
                    ep_row=ep_row,
                    triggered_by=ban_triggers.get(c_idx, []),
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
        )
        arrays, probs, win_probs, forecasts = self._evaluate_with_forecasts(
            main_input, teams, {"blue": blue_effective_gb, "red": red_effective_gb}
        )
        ap_row, ep_row, unavail_row = arrays[0][0], arrays[1][0], arrays[4][0]

        ally_lane_cov = ap_row @ self.ckpt["lane_probs"]
        missing_lanes = [LANE_LABELS[i] for i in range(5) if ally_lane_cov[i] < 0.65]

        ban_unlocked_heroes, unlocked_triggers = self._compute_ban_unlocked_heroes(
            all_bans=ally_bans + enemy_bans,
            unavail_row=unavail_row,
            probs=probs,
            win_probs=win_probs,
            ap_row=ap_row,
            ep_row=ep_row,
            top_n=5,
        )
        _, p2b_triggers = self._compute_pick_to_ban_scores(ally_picks, unavail_row) if req.mode == "ban" else (None, {})

        lookahead_win_rates: dict[int, float] = {}
        if req.use_lookahead:
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
            )
            candidate_pool = np.argsort(probs)[::-1][: max(req.top_k * 2, 8)].tolist()
            candidate_pool = [c for c in candidate_pool if probs[c] > 0]
            lookahead_win_rates = self.search_engine.search_lookahead_win_rates(
                root_state,
                candidate_pool,
                depth=req.lookahead_depth,
                branch_factor=5,
            )

            # Re-rank candidates by blending policy prior and adversarial lookahead win rate
            def rank_score(h_idx: int) -> float:
                p_score = float(probs[h_idx])
                l_score = lookahead_win_rates.get(h_idx, float(win_probs[h_idx] * 100.0)) / 100.0
                return 0.40 * p_score + 0.60 * l_score

            top_indices = sorted(candidate_pool, key=rank_score, reverse=True)[: req.top_k]
        else:
            top_indices = np.argsort(probs)[::-1][: req.top_k]

        recs: list[HeroRecommendation] = []
        for rank_idx, h_idx in enumerate(top_indices, start=1):
            lookahead_val = (
                lookahead_win_rates.get(h_idx, round(float(win_probs[h_idx] * 100.0), 2)) if req.use_lookahead else None
            )
            triggers = p2b_triggers.get(int(h_idx), []) if req.mode == "ban" else unlocked_triggers.get(int(h_idx), [])
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
