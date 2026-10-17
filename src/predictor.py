import re
from pathlib import Path
import numpy as np
import pandas as pd
import torch

from src.config import config
from src.schemas import (
    DraftStateRequest,
    HeroRecommendation,
    DraftPredictionResponse,
)
from src.train_sota_model import RoVDraftGNNTransformer, MAX_HISTORY_LEN

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
        self.model_path: Path = model_path if model_path is not None else config.paths.sota_model_path
        if not self.model_path.exists():
            raise FileNotFoundError(
                f"SOTA model artifact not found at {self.model_path}. Please run training first."
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
        self.model.eval()

        self.heroes_df = pd.read_csv(config.paths.heroes_csv_path).set_index("name")
        self.stats_df = pd.read_csv(config.paths.hero_stats_csv_path).set_index("name")
        self._lookup = self._build_alias_lookup()

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

        syn_mat = self.ckpt["graphs"]["synergy_mat"]
        cnt_mat = self.ckpt["graphs"]["counter_mat"]
        top_indices = np.argsort(probs)[::-1][: req.top_k]

        recs: list[HeroRecommendation] = []
        for rank_idx, h_idx in enumerate(top_indices, start=1):
            h_name = self.hero_names[h_idx]
            h_info = self.heroes_df.loc[h_name]
            s_info = self.stats_df.loc[h_name]

            syn_edge = float(ap_vec[0] @ syn_mat[h_idx]) * 100.0
            cnt_edge = float(ep_vec[0] @ cnt_mat[h_idx]) * 100.0

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

            recs.append(
                HeroRecommendation(
                    rank=rank_idx,
                    hero_name=h_name,
                    probability_pct=round(float(probs[h_idx] * 100.0), 2),
                    predicted_win_rate_pct=round(float(win_probs[h_idx] * 100.0), 2),
                    primary_lane=str(s_info["main_pro_lane"]),
                    primary_role=str(h_info["primary_role"]),
                    synergy_edge_pct=round(syn_edge, 2),
                    counter_edge_pct=round(cnt_edge, 2),
                    capabilities=caps,
                )
            )

        return DraftPredictionResponse(
            architecture=self.architecture,
            mode=req.mode,
            side=req.side,
            phase=req.phase,
            missing_ally_lanes=missing_lanes,
            recommendations=recs,
        )
