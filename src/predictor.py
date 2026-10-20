import collections
import json
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from src.config import config
from src.schemas import (
    DraftPredictionResponse,
    DraftStateRequest,
    HeroRecommendation,
)
from src.search.draft_mcts import DraftMinimaxSearch, DraftSearchState
from src.train_sota_model import MAX_HISTORY_LEN, RoVDraftGNNTransformer

LANE_LABELS = [
    "DS_Lane (ออฟเลน)",
    "Jungle (ป่า)",
    "Mid (เมจ)",
    "Dragon_Lane (แครี่)",
    "Roam (โรมมิ่ง)",
]


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
        self._lookup = self._build_alias_lookup()
        self.ban_to_pick_score, self.pick_to_ban_score = self._build_ban_pick_intel_tables()
        self.search_engine = DraftMinimaxSearch(self)

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

        ban_cnt: collections.Counter[int] = collections.Counter()
        p2ban_cnt: collections.Counter[int] = collections.Counter()
        pick_cnt: collections.Counter[int] = collections.Counter()
        co_ban_pick = np.zeros((num_heroes, num_heroes), dtype=np.int32)
        co_pick_p2ban = np.zeros((num_heroes, num_heroes), dtype=np.int32)
        vs_wins = np.zeros((num_heroes, num_heroes), dtype=np.int32)
        vs_games = np.zeros((num_heroes, num_heroes), dtype=np.int32)

        for m in matches:
            for side, opp in (("blue", "red"), ("red", "blue")):
                won = bool(m.get("blue_win")) if side == "blue" else not bool(m.get("blue_win"))
                bans = [self.hero_to_id[h] for h in set(m.get(f"{side}_bans", [])) if h in self.hero_to_id]
                p2_bans = [self.hero_to_id[h] for h in set(m.get(f"{side}_bans", [])[2:4]) if h in self.hero_to_id]
                picks = [self.hero_to_id[h] for h in set(m.get(f"{side}_picks", [])) if h in self.hero_to_id]
                opp_picks = [self.hero_to_id[h] for h in set(m.get(f"{opp}_picks", [])) if h in self.hero_to_id]

                for b in bans:
                    ban_cnt[b] += 1
                for b in p2_bans:
                    p2ban_cnt[b] += 1
                for p in picks:
                    pick_cnt[p] += 1

                for b in bans:
                    for p in picks:
                        co_ban_pick[b, p] += 1
                for p in picks:
                    for b in p2_bans:
                        co_pick_p2ban[p, b] += 1
                for p in picks:
                    for e in opp_picks:
                        vs_games[p, e] += 1
                        if won:
                            vs_wins[p, e] += 1

        for b in range(num_heroes):
            if ban_cnt[b] < 20:
                continue
            for p in range(num_heroes):
                if b == p or pick_cnt[p] < 30:
                    continue
                co = int(co_ban_pick[b, p])
                if co < 5:
                    continue
                lift = (co * n_team_games) / float(pick_cnt[p] * ban_cnt[b])
                if lift < 1.15:
                    continue
                g = int(vs_games[p, b])
                loss_rate = 1.0 - (vs_wins[p, b] / g) if g >= 5 else 0.5
                ban_to_pick[b, p] = float(lift * (1.0 + max(0.0, loss_rate - 0.48) * 3.0) * math.log1p(co))

        for p in range(num_heroes):
            if pick_cnt[p] < 25:
                continue
            for b in range(num_heroes):
                if p == b or p2ban_cnt[b] < 20:
                    continue
                co_p2 = int(co_pick_p2ban[p, b])
                if co_p2 < 5:
                    continue
                lift_p2 = (co_p2 * n_team_games) / float(pick_cnt[p] * p2ban_cnt[b])
                if lift_p2 < 1.15:
                    continue
                pick_to_ban[p, b] = float((co_p2**0.75) * lift_p2)

        return ban_to_pick, pick_to_ban

    def _compute_ban_unlocked_scores(
        self,
        bans: list[str],
        unavail_row: np.ndarray,
    ) -> tuple[np.ndarray, dict[int, list[str]]]:
        """Compute statistical unlock/pick scores and triggering bans for each available hero."""
        num_heroes = len(self.hero_names)
        scores = np.zeros(num_heroes, dtype=np.float32)
        triggers: dict[int, list[str]] = {}
        unique_bans = list(dict.fromkeys(bans))
        if not unique_bans:
            return scores, triggers

        for p_idx in range(num_heroes):
            if unavail_row[p_idx]:
                continue
            contribs: list[tuple[float, str]] = []
            for b_name in unique_bans:
                b_idx = self.hero_to_id[b_name]
                val = float(self.ban_to_pick_score[b_idx, p_idx])
                if val > 0:
                    contribs.append((val, b_name))
            if contribs:
                contribs.sort(reverse=True)
                scores[p_idx] = sum(v for v, _ in contribs)
                triggers[p_idx] = [name for _, name in contribs[:2]]

        return scores, triggers

    def _compute_pick_to_ban_scores(
        self,
        picks: list[str],
        unavail_row: np.ndarray,
    ) -> tuple[np.ndarray, dict[int, list[str]]]:
        """Compute statistical Phase-2 target ban scores and triggering picks for each available hero."""
        num_heroes = len(self.hero_names)
        scores = np.zeros(num_heroes, dtype=np.float32)
        triggers: dict[int, list[str]] = {}
        unique_picks = list(dict.fromkeys(picks))
        if not unique_picks:
            return scores, triggers

        for b_idx in range(num_heroes):
            if unavail_row[b_idx]:
                continue
            contribs: list[tuple[float, str]] = []
            for p_name in unique_picks:
                p_idx = self.hero_to_id[p_name]
                val = float(self.pick_to_ban_score[p_idx, b_idx])
                if val > 0:
                    contribs.append((val, p_name))
            if contribs:
                contribs.sort(reverse=True)
                scores[b_idx] = sum(v for v, _ in contribs)
                triggers[b_idx] = [name for _, name in contribs[:2]]

        return scores, triggers

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

    def _build_sequence_tokens(
        self,
        ally_picks: list[str],
        enemy_picks: list[str],
        ally_bans: list[str],
        enemy_bans: list[str],
    ):
        events = []
        for h in ally_bans[:2]:
            events.append((self.hero_to_id[h], 3))
        for h in enemy_bans[:2]:
            events.append((self.hero_to_id[h], 4))
        for h in ally_picks[:3]:
            events.append((self.hero_to_id[h], 1))
        for h in enemy_picks[:3]:
            events.append((self.hero_to_id[h], 2))
        for h in ally_bans[2:]:
            events.append((self.hero_to_id[h], 3))
        for h in enemy_bans[2:]:
            events.append((self.hero_to_id[h], 4))
        for h in ally_picks[3:]:
            events.append((self.hero_to_id[h], 1))
        for h in enemy_picks[3:]:
            events.append((self.hero_to_id[h], 2))

        tok_heroes = np.zeros((1, MAX_HISTORY_LEN), dtype=np.int64)
        tok_types = np.zeros((1, MAX_HISTORY_LEN), dtype=np.int64)
        tok_steps = np.zeros((1, MAX_HISTORY_LEN), dtype=np.int64)
        tok_pad_mask = np.ones((1, MAX_HISTORY_LEN), dtype=np.bool_)

        for idx, (hid, ttype) in enumerate(events[:MAX_HISTORY_LEN]):
            tok_heroes[0, idx] = hid
            tok_types[0, idx] = ttype
            tok_steps[0, idx] = idx
            tok_pad_mask[0, idx] = False

        return tok_heroes, tok_types, tok_steps, tok_pad_mask

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
        h_name = self.hero_names[h_idx]
        h_info = self.heroes_df.loc[h_name]
        s_info = self.stats_df.loc[h_name]
        syn_mat = self.ckpt["graphs"]["synergy_mat"]
        cnt_mat = self.ckpt["graphs"]["counter_mat"]

        syn_edge = float(ap_row @ syn_mat[h_idx]) * 100.0
        cnt_edge = float(ep_row @ cnt_mat[h_idx]) * 100.0

        caps = []
        if h_info["has_suppress"]:
            caps.append("Suppress")
        elif h_info["has_hard_cc"]:
            caps.append("Hard CC")
        if h_info["has_mobility"]:
            caps.append("Mobility")
        if h_info["has_true_damage"]:
            caps.append("True Dmg")
        if h_info["has_immunity"]:
            caps.append("Iron Body/Immune")
        if h_info["has_heal_sustain"] or h_info["has_shield"]:
            caps.append("Sustain/Shield")

        return HeroRecommendation(
            rank=rank_idx,
            hero_name=h_name,
            probability_pct=round(float(probs[h_idx] * 100.0), 2),
            predicted_win_rate_pct=round(float(win_probs[h_idx] * 100.0), 2),
            lookahead_win_rate_pct=lookahead_val,
            primary_lane=str(s_info["main_pro_lane"]),
            primary_role=str(h_info["primary_role"]),
            synergy_edge_pct=round(syn_edge, 2),
            counter_edge_pct=round(cnt_edge, 2),
            capabilities=caps,
            triggered_by=triggered_by or [],
        )

    def _predict_team_next_picks(
        self,
        team_side: str,
        team_picks: list[str],
        opp_picks: list[str],
        team_bans: list[str],
        opp_bans: list[str],
        global_bans: list[str],
        max_slots: int = 2,
    ) -> list[HeroRecommendation]:
        """Autoregressively forecast up to `max_slots` upcoming picks for `team_side` (starts from Ban 1)."""
        if (len(team_picks) == 0 and len(team_bans) == 0) or len(team_picks) >= 5:
            return []

        steps_to_predict = min(max_slots, 5 - len(team_picks))
        sim_team_picks = list(team_picks)
        num_heroes = len(self.hero_names)
        lane_probs = self.ckpt["lane_probs"]
        syn_mat = self.ckpt["graphs"]["synergy_mat"]
        side_val = 0 if team_side == "blue" else 1
        forecast: list[HeroRecommendation] = []

        for step_offset in range(steps_to_predict):
            ap_vec = np.zeros((1, num_heroes), dtype=np.float32)
            ep_vec = np.zeros((1, num_heroes), dtype=np.float32)
            ab_vec = np.zeros((1, num_heroes), dtype=np.float32)
            eb_vec = np.zeros((1, num_heroes), dtype=np.float32)
            unavail = np.zeros((1, num_heroes), dtype=np.bool_)

            for h in sim_team_picks:
                idx = self.hero_to_id[h]
                ap_vec[0, idx] = 1.0
                unavail[0, idx] = True
            for h in opp_picks:
                idx = self.hero_to_id[h]
                ep_vec[0, idx] = 1.0
                unavail[0, idx] = True
            for h in team_bans:
                idx = self.hero_to_id[h]
                ab_vec[0, idx] = 1.0
                unavail[0, idx] = True
            for h in opp_bans:
                idx = self.hero_to_id[h]
                eb_vec[0, idx] = 1.0
                unavail[0, idx] = True
            for h in global_bans:
                idx = self.hero_to_id[h]
                unavail[0, idx] = True

            sim_phase = 1 if len(sim_team_picks) < 3 else 2
            total_done = len(sim_team_picks) + len(opp_picks) + len(team_bans) + len(opp_bans)
            step_idx = min(total_done, 17)

            meta_ctx = np.array(
                [
                    [
                        step_idx / 17.0,
                        float(sim_phase == 2),
                        1.0,
                        float(side_val == 1),
                        1.0,
                        len(sim_team_picks) / 5.0,
                        len(opp_picks) / 5.0,
                    ]
                ],
                dtype=np.float32,
            )

            th, tt, ts, tpad = self._build_sequence_tokens(sim_team_picks, opp_picks, team_bans, opp_bans)
            with torch.no_grad():
                logits, q_win_logits = self.model(
                    torch.from_numpy(ap_vec),
                    torch.from_numpy(ep_vec),
                    torch.from_numpy(ab_vec),
                    torch.from_numpy(eb_vec),
                    torch.from_numpy(unavail),
                    torch.from_numpy(th),
                    torch.from_numpy(tt),
                    torch.from_numpy(ts),
                    torch.from_numpy(tpad),
                    torch.from_numpy(meta_ctx),
                    torch.tensor([1], dtype=torch.int64),
                    torch.tensor([sim_phase], dtype=torch.int64),
                )
                probs = torch.softmax(logits[0], dim=-1).numpy()
                win_probs = torch.sigmoid(q_win_logits[0]).numpy()

            ban_scores, ban_triggers = self._compute_ban_unlocked_scores(team_bans, unavail[0])
            if ban_scores.max() > 0:
                sharpened = np.power(ban_scores / float(ban_scores.max()), 2.5)
                ban_dist = sharpened / float(sharpened.sum())
                blend_w = 0.75 if len(team_picks) == 0 else 0.35
                blended_probs = (1.0 - blend_w) * probs + blend_w * ban_dist
            else:
                blended_probs = probs

            ally_lane_cov = ap_vec[0] @ lane_probs
            open_lanes = {LANE_LABELS[i].split(" ")[0] for i in range(5) if ally_lane_cov[i] < 0.65}
            taken_primary_lanes = {str(self.stats_df.loc[h]["main_pro_lane"]).split(" ")[0] for h in sim_team_picks}
            needed_lanes = open_lanes - taken_primary_lanes

            sorted_indices = np.argsort(blended_probs)[::-1]
            chosen_idx: int | None = None
            for cand_idx in sorted_indices[:25]:
                if blended_probs[cand_idx] <= 0:
                    break
                cand_name = self.hero_names[int(cand_idx)]
                cand_lane = str(self.stats_df.loc[cand_name]["main_pro_lane"]).split(" ")[0]
                if not needed_lanes or cand_lane in needed_lanes:
                    chosen_idx = int(cand_idx)
                    break

            if chosen_idx is None:
                chosen_idx = int(sorted_indices[0])

            triggers = list(ban_triggers.get(chosen_idx, []))
            if not triggers and sim_team_picks:
                best_ally = max(
                    sim_team_picks,
                    key=lambda a: float(syn_mat[self.hero_to_id[a], chosen_idx]),
                )
                if float(syn_mat[self.hero_to_id[best_ally], chosen_idx]) > 0:
                    triggers = [best_ally]

            rec = self._build_hero_recommendation(
                rank_idx=step_offset + 1,
                h_idx=chosen_idx,
                probs=blended_probs,
                win_probs=win_probs,
                ap_row=ap_vec[0],
                ep_row=ep_vec[0],
                triggered_by=triggers,
            )
            forecast.append(rec)
            sim_team_picks.append(rec.hero_name)

        return forecast

    def _predict_team_next_bans(
        self,
        team_side: str,
        team_picks: list[str],
        opp_picks: list[str],
        team_bans: list[str],
        opp_bans: list[str],
        global_bans: list[str],
        max_slots: int = 2,
    ) -> list[HeroRecommendation]:
        """Forecast up to `max_slots` upcoming bans for `team_side` based on their picked heroes."""
        if len(team_picks) == 0 or len(team_bans) >= 4:
            return []

        steps_to_predict = min(max_slots, 4 - len(team_bans))
        num_heroes = len(self.hero_names)
        ap_vec = np.zeros((1, num_heroes), dtype=np.float32)
        ep_vec = np.zeros((1, num_heroes), dtype=np.float32)
        ab_vec = np.zeros((1, num_heroes), dtype=np.float32)
        eb_vec = np.zeros((1, num_heroes), dtype=np.float32)
        unavail = np.zeros((1, num_heroes), dtype=np.bool_)

        for h in team_picks:
            idx = self.hero_to_id[h]
            ap_vec[0, idx] = 1.0
            unavail[0, idx] = True
        for h in opp_picks:
            idx = self.hero_to_id[h]
            ep_vec[0, idx] = 1.0
            unavail[0, idx] = True
        for h in team_bans:
            idx = self.hero_to_id[h]
            ab_vec[0, idx] = 1.0
            unavail[0, idx] = True
        for h in opp_bans:
            idx = self.hero_to_id[h]
            eb_vec[0, idx] = 1.0
            unavail[0, idx] = True
        for h in global_bans:
            idx = self.hero_to_id[h]
            unavail[0, idx] = True

        side_val = 0 if team_side == "blue" else 1
        sim_phase = 1 if len(team_bans) < 2 else 2
        total_done = len(team_picks) + len(opp_picks) + len(team_bans) + len(opp_bans)
        step_idx = min(total_done, 17)

        meta_ctx = np.array(
            [
                [
                    step_idx / 17.0,
                    float(sim_phase == 2),
                    0.0,
                    float(side_val == 1),
                    1.0,
                    len(team_picks) / 5.0,
                    len(opp_picks) / 5.0,
                ]
            ],
            dtype=np.float32,
        )

        th, tt, ts, tpad = self._build_sequence_tokens(team_picks, opp_picks, team_bans, opp_bans)
        with torch.no_grad():
            logits, q_win_logits = self.model(
                torch.from_numpy(ap_vec),
                torch.from_numpy(ep_vec),
                torch.from_numpy(ab_vec),
                torch.from_numpy(eb_vec),
                torch.from_numpy(unavail),
                torch.from_numpy(th),
                torch.from_numpy(tt),
                torch.from_numpy(ts),
                torch.from_numpy(tpad),
                torch.from_numpy(meta_ctx),
                torch.tensor([0], dtype=torch.int64),
                torch.tensor([sim_phase], dtype=torch.int64),
            )
            probs = torch.softmax(logits[0], dim=-1).numpy()
            win_probs = torch.sigmoid(q_win_logits[0]).numpy()

        p2b_scores, p2b_triggers = self._compute_pick_to_ban_scores(team_picks, unavail[0])
        if p2b_scores.max() > 0:
            p2b_dist = p2b_scores / float(p2b_scores.sum())
            blended_probs = 0.25 * probs + 0.75 * p2b_dist
        else:
            blended_probs = probs

        sorted_indices = np.argsort(blended_probs)[::-1]
        forecast: list[HeroRecommendation] = []
        for rank_idx, cand_idx in enumerate(sorted_indices[:steps_to_predict], start=1):
            if blended_probs[cand_idx] <= 0:
                break
            c_idx = int(cand_idx)
            forecast.append(
                self._build_hero_recommendation(
                    rank_idx=rank_idx,
                    h_idx=c_idx,
                    probs=blended_probs,
                    win_probs=win_probs,
                    ap_row=ap_vec[0],
                    ep_row=ep_vec[0],
                    triggered_by=p2b_triggers.get(c_idx, list(team_picks[:1])),
                )
            )

        return forecast

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
                    probs=0.30 * probs + 0.70 * ban_dist,
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

        num_heroes = len(self.hero_names)
        ap_vec = np.zeros((1, num_heroes), dtype=np.float32)
        ep_vec = np.zeros((1, num_heroes), dtype=np.float32)
        ab_vec = np.zeros((1, num_heroes), dtype=np.float32)
        eb_vec = np.zeros((1, num_heroes), dtype=np.float32)
        unavail = np.zeros((1, num_heroes), dtype=np.bool_)

        for h in ally_picks:
            idx = self.hero_to_id[h]
            ap_vec[0, idx] = 1.0
            unavail[0, idx] = True
        for h in enemy_picks:
            idx = self.hero_to_id[h]
            ep_vec[0, idx] = 1.0
            unavail[0, idx] = True
        for h in ally_bans:
            idx = self.hero_to_id[h]
            ab_vec[0, idx] = 1.0
            unavail[0, idx] = True
        for h in enemy_bans:
            idx = self.hero_to_id[h]
            eb_vec[0, idx] = 1.0
            unavail[0, idx] = True
        for h in global_bans:
            idx = self.hero_to_id[h]
            unavail[0, idx] = True

        act_type = 1 if req.mode == "pick" else 0
        side_val = 0 if req.side == "blue" else 1
        total_done = len(ally_picks) + len(enemy_picks) + len(ally_bans) + len(enemy_bans)
        step_idx = min(total_done, 17)

        meta_ctx = np.array(
            [
                [
                    step_idx / 17.0,
                    float(req.phase == 2),
                    float(act_type == 1),
                    float(side_val == 1),
                    1.0,
                    len(ally_picks) / 5.0,
                    len(enemy_picks) / 5.0,
                ]
            ],
            dtype=np.float32,
        )

        th, tt, ts, tpad = self._build_sequence_tokens(ally_picks, enemy_picks, ally_bans, enemy_bans)

        with torch.no_grad():
            logits, q_win_logits = self.model(
                torch.from_numpy(ap_vec),
                torch.from_numpy(ep_vec),
                torch.from_numpy(ab_vec),
                torch.from_numpy(eb_vec),
                torch.from_numpy(unavail),
                torch.from_numpy(th),
                torch.from_numpy(tt),
                torch.from_numpy(ts),
                torch.from_numpy(tpad),
                torch.from_numpy(meta_ctx),
                torch.tensor([act_type], dtype=torch.int64),
                torch.tensor([req.phase], dtype=torch.int64),
            )
            probs = torch.softmax(logits[0], dim=-1).numpy()
            win_probs = torch.sigmoid(q_win_logits[0]).numpy()

        lane_probs = self.ckpt["lane_probs"]
        ally_lane_cov = ap_vec[0] @ lane_probs
        missing_lanes = [LANE_LABELS[i] for i in range(5) if ally_lane_cov[i] < 0.65]

        all_bans = ally_bans + enemy_bans
        ban_unlocked_heroes, unlocked_triggers = self._compute_ban_unlocked_heroes(
            all_bans=all_bans,
            unavail_row=unavail[0],
            probs=probs,
            win_probs=win_probs,
            ap_row=ap_vec[0],
            ep_row=ep_vec[0],
            top_n=5,
        )
        _, p2b_triggers = self._compute_pick_to_ban_scores(ally_picks, unavail[0]) if req.mode == "ban" else (None, {})

        lookahead_win_rates: dict[int, float] = {}
        if req.use_lookahead:
            b_p = (
                [self.hero_to_id[h] for h in ally_picks] if side_val == 0 else [self.hero_to_id[h] for h in enemy_picks]
            )
            r_p = (
                [self.hero_to_id[h] for h in enemy_picks] if side_val == 0 else [self.hero_to_id[h] for h in ally_picks]
            )
            b_b = [self.hero_to_id[h] for h in ally_bans] if side_val == 0 else [self.hero_to_id[h] for h in enemy_bans]
            r_b = [self.hero_to_id[h] for h in enemy_bans] if side_val == 0 else [self.hero_to_id[h] for h in ally_bans]
            g_b = [self.hero_to_id[h] for h in global_bans]

            step_idx = self.search_engine.find_matching_step(
                side_val, act_type, req.phase, len(b_p), len(r_p), len(b_b), len(r_b)
            )
            root_state = DraftSearchState(
                blue_picks=tuple(b_p),
                red_picks=tuple(r_p),
                blue_bans=tuple(b_b),
                red_bans=tuple(r_b),
                global_bans=tuple(g_b),
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
                    h_idx=h_idx,
                    probs=probs,
                    win_probs=win_probs,
                    ap_row=ap_vec[0],
                    ep_row=ep_vec[0],
                    lookahead_val=lookahead_val,
                    triggered_by=triggers,
                )
            )

        if req.side == "blue":
            blue_picks, red_picks = ally_picks, enemy_picks
            blue_bans, red_bans = ally_bans, enemy_bans
        else:
            blue_picks, red_picks = enemy_picks, ally_picks
            blue_bans, red_bans = enemy_bans, ally_bans

        blue_next_picks = self._predict_team_next_picks(
            team_side="blue",
            team_picks=blue_picks,
            opp_picks=red_picks,
            team_bans=blue_bans,
            opp_bans=red_bans,
            global_bans=global_bans,
            max_slots=2,
        )
        red_next_picks = self._predict_team_next_picks(
            team_side="red",
            team_picks=red_picks,
            opp_picks=blue_picks,
            team_bans=red_bans,
            opp_bans=blue_bans,
            global_bans=global_bans,
            max_slots=2,
        )
        blue_next_bans = self._predict_team_next_bans(
            team_side="blue",
            team_picks=blue_picks,
            opp_picks=red_picks,
            team_bans=blue_bans,
            opp_bans=red_bans,
            global_bans=global_bans,
            max_slots=2,
        )
        red_next_bans = self._predict_team_next_bans(
            team_side="red",
            team_picks=red_picks,
            opp_picks=blue_picks,
            team_bans=red_bans,
            opp_bans=blue_bans,
            global_bans=global_bans,
            max_slots=2,
        )

        return DraftPredictionResponse(
            architecture=self.architecture,
            mode=req.mode,
            side=req.side,
            phase=req.phase,
            missing_ally_lanes=missing_lanes,
            recommendations=recs,
            blue_next_picks=blue_next_picks,
            red_next_picks=red_next_picks,
            blue_next_bans=blue_next_bans,
            red_next_bans=red_next_bans,
            ban_unlocked_heroes=ban_unlocked_heroes,
        )
