"""Draft Lookahead Search & Minimax Game-Theoretic Evaluation.

This module implements sequential multi-step draft planning for RoV Pro Draft:
- Models the 18-step sequential zero-sum draft game (Phase 1 & Phase 2 Bans and Picks).
- Employs Policy-Guided Branch Pruning (expands Top-K plausible actions via Policy Head).
- Computes Adversarial Minimax / Expectiminimax lookahead win rates using the Value Head (q_win_logits).
- Prevents illegal hero selections and duplicate bans across Global BP rules.
"""

from __future__ import annotations

import dataclasses
from typing import TYPE_CHECKING
import numpy as np
import torch

if TYPE_CHECKING:
    from src.predictor import RoVDraftPredictor

# 18 canonical draft steps in tournament mode:
# (step_idx, phase, action_type, side) where action_type: 0=BAN, 1=PICK; side: 0=BLUE, 1=RED
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


@dataclasses.dataclass(frozen=True)
class DraftSearchState:
    """Immutable state representation of an in-progress draft."""

    blue_picks: tuple[int, ...] = ()
    red_picks: tuple[int, ...] = ()
    blue_bans: tuple[int, ...] = ()
    red_bans: tuple[int, ...] = ()
    global_bans: tuple[int, ...] = ()
    step_idx: int = 0

    @property
    def is_terminal(self) -> bool:
        return self.step_idx >= len(DRAFT_STEPS)

    @property
    def current_step_info(self) -> tuple[int, int, int, int]:
        if self.is_terminal:
            return (18, 2, 1, 1)
        return DRAFT_STEPS[self.step_idx]

    @property
    def phase(self) -> int:
        return self.current_step_info[1]

    @property
    def action_type(self) -> int:
        return self.current_step_info[2]

    @property
    def acting_side(self) -> int:
        return self.current_step_info[3]

    def get_unavailable_set(self) -> set[int]:
        return (
            set(self.blue_picks)
            | set(self.red_picks)
            | set(self.blue_bans)
            | set(self.red_bans)
            | set(self.global_bans)
        )

    def transition(self, hero_idx: int) -> DraftSearchState:
        """Return the successor state after taking action hero_idx."""
        if self.is_terminal:
            raise ValueError(f"Cannot transition from terminal draft step {self.step_idx}")

        _, _, action_type, side = DRAFT_STEPS[self.step_idx]
        b_p, r_p = list(self.blue_picks), list(self.red_picks)
        b_b, r_b = list(self.blue_bans), list(self.red_bans)

        if side == 0:  # Blue
            if action_type == 1:
                b_p.append(hero_idx)
            else:
                b_b.append(hero_idx)
        else:  # Red
            if action_type == 1:
                r_p.append(hero_idx)
            else:
                r_b.append(hero_idx)

        return DraftSearchState(
            blue_picks=tuple(b_p),
            red_picks=tuple(r_p),
            blue_bans=tuple(b_b),
            red_bans=tuple(r_b),
            global_bans=self.global_bans,
            step_idx=self.step_idx + 1,
        )


class DraftMinimaxSearch:
    """Adversarial Minimax Lookahead Search Engine using Policy and Value heads."""

    def __init__(self, predictor: RoVDraftPredictor):
        self.predictor = predictor
        self.model = predictor.model
        self.device = predictor.device
        self.num_heroes = len(predictor.hero_names)

    def _build_batch_tensors(self, states: list[DraftSearchState]):
        """Construct batched GNN-Transformer input tensors for a list of states."""
        batch_size = len(states)
        ap_vec = np.zeros((batch_size, self.num_heroes), dtype=np.float32)
        ep_vec = np.zeros((batch_size, self.num_heroes), dtype=np.float32)
        ab_vec = np.zeros((batch_size, self.num_heroes), dtype=np.float32)
        eb_vec = np.zeros((batch_size, self.num_heroes), dtype=np.float32)
        unavail = np.zeros((batch_size, self.num_heroes), dtype=np.bool_)

        tok_heroes = np.zeros((batch_size, MAX_HISTORY_LEN), dtype=np.int64)
        tok_types = np.zeros((batch_size, MAX_HISTORY_LEN), dtype=np.int64)
        tok_steps = np.zeros((batch_size, MAX_HISTORY_LEN), dtype=np.int64)
        tok_pad_mask = np.ones((batch_size, MAX_HISTORY_LEN), dtype=np.bool_)

        meta_ctx = np.zeros((batch_size, 7), dtype=np.float32)
        act_types = np.zeros(batch_size, dtype=np.int64)
        phases = np.zeros(batch_size, dtype=np.int64)

        for b_idx, s in enumerate(states):
            side = s.acting_side
            act_type = s.action_type
            phase = s.phase

            if side == 0:  # Blue acting
                ally_picks, enemy_picks = list(s.blue_picks), list(s.red_picks)
                ally_bans, enemy_bans = list(s.blue_bans), list(s.red_bans)
            else:  # Red acting
                ally_picks, enemy_picks = list(s.red_picks), list(s.blue_picks)
                ally_bans, enemy_bans = list(s.red_bans), list(s.blue_bans)

            for h in ally_picks:
                ap_vec[b_idx, h] = 1.0
                unavail[b_idx, h] = True
            for h in enemy_picks:
                ep_vec[b_idx, h] = 1.0
                unavail[b_idx, h] = True
            for h in ally_bans:
                ab_vec[b_idx, h] = 1.0
                unavail[b_idx, h] = True
            for h in enemy_bans:
                eb_vec[b_idx, h] = 1.0
                unavail[b_idx, h] = True
            for h in s.global_bans:
                unavail[b_idx, h] = True

            step_idx = min(s.step_idx, 17)
            meta_ctx[b_idx] = [
                step_idx / 17.0,
                float(phase == 2),
                float(act_type == 1),
                float(side == 1),
                1.0,
                len(ally_picks) / 5.0,
                len(enemy_picks) / 5.0,
            ]
            act_types[b_idx] = act_type
            phases[b_idx] = phase

            events = []
            for h in ally_bans[:2]:
                events.append((h, 3))
            for h in enemy_bans[:2]:
                events.append((h, 4))
            for h in ally_picks[:3]:
                events.append((h, 1))
            for h in enemy_picks[:3]:
                events.append((h, 2))
            for h in ally_bans[2:]:
                events.append((h, 3))
            for h in enemy_bans[2:]:
                events.append((h, 4))
            for h in ally_picks[3:]:
                events.append((h, 1))
            for h in enemy_picks[3:]:
                events.append((h, 2))

            for idx, (hid, ttype) in enumerate(events[:MAX_HISTORY_LEN]):
                tok_heroes[b_idx, idx] = hid
                tok_types[b_idx, idx] = ttype
                tok_steps[b_idx, idx] = idx
                tok_pad_mask[b_idx, idx] = False

        return (
            torch.from_numpy(ap_vec).to(self.device),
            torch.from_numpy(ep_vec).to(self.device),
            torch.from_numpy(ab_vec).to(self.device),
            torch.from_numpy(eb_vec).to(self.device),
            torch.from_numpy(unavail).to(self.device),
            torch.from_numpy(tok_heroes).to(self.device),
            torch.from_numpy(tok_types).to(self.device),
            torch.from_numpy(tok_steps).to(self.device),
            torch.from_numpy(tok_pad_mask).to(self.device),
            torch.from_numpy(meta_ctx).to(self.device),
            torch.from_numpy(act_types).to(self.device),
            torch.from_numpy(phases).to(self.device),
        )

    def evaluate_batch(
        self, states: list[DraftSearchState]
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """Evaluate a batch of draft states through the neural network.

        Returns:
            policy_probs: (batch_size, num_heroes) probabilities from Policy Head
            win_probs: (batch_size, num_heroes) acting team win rates from Value Head
        """
        if not states:
            return torch.empty(0), torch.empty(0)

        tensors = self._build_batch_tensors(states)
        with torch.no_grad():
            logits, q_win_logits = self.model(*tensors)
            probs = torch.softmax(logits, dim=-1)
            win_probs = torch.sigmoid(q_win_logits)

        return probs, win_probs

    def find_matching_step(
        self,
        side_val: int,
        act_type: int,
        phase: int,
        b_picks_len: int,
        r_picks_len: int,
        b_bans_len: int,
        r_bans_len: int,
    ) -> int:
        """Find the exact step index (0..17) matching current draft configuration."""
        for step_idx, s_phase, s_act, s_side in DRAFT_STEPS:
            if s_phase == phase and s_act == act_type and s_side == side_val:
                expected_b_bans = sum(1 for i in range(step_idx) if DRAFT_STEPS[i][2] == 0 and DRAFT_STEPS[i][3] == 0)
                expected_r_bans = sum(1 for i in range(step_idx) if DRAFT_STEPS[i][2] == 0 and DRAFT_STEPS[i][3] == 1)
                expected_b_picks = sum(1 for i in range(step_idx) if DRAFT_STEPS[i][2] == 1 and DRAFT_STEPS[i][3] == 0)
                expected_r_picks = sum(1 for i in range(step_idx) if DRAFT_STEPS[i][2] == 1 and DRAFT_STEPS[i][3] == 1)

                if (
                    expected_b_bans == b_bans_len
                    and expected_r_bans == r_bans_len
                    and expected_b_picks == b_picks_len
                    and expected_r_picks == r_picks_len
                ):
                    return step_idx

        # Fallback to total completed actions
        total_done = b_picks_len + r_picks_len + b_bans_len + r_bans_len
        return min(total_done, 17)

    def search_lookahead_win_rates(
        self,
        root_state: DraftSearchState,
        candidate_hero_indices: list[int],
        depth: int = 2,
        branch_factor: int = 5,
    ) -> dict[int, float]:
        """Perform adversarial Minimax / Expectiminimax lookahead for candidate actions.

        Args:
            root_state: The current draft state
            candidate_hero_indices: List of candidate actions to evaluate from root
            depth: Number of lookahead steps (depth 1 = immediate value, depth 2 = 1 counter turn)
            branch_factor: Number of opponent counter-actions to explore per branch

        Returns:
            dict mapping hero_idx -> lookahead expected win rate percentage (0.0 to 100.0)
        """
        root_side = root_state.acting_side
        results: dict[int, float] = {}

        if not candidate_hero_indices:
            return results

        # 1. Base evaluation of root state
        root_probs, root_win = self.evaluate_batch([root_state])
        root_w_np = root_win[0].cpu().numpy()

        if depth <= 1 or root_state.step_idx >= len(DRAFT_STEPS) - 1:
            for hid in candidate_hero_indices:
                results[hid] = round(float(root_w_np[hid] * 100.0), 2)
            return results

        # 2. Depth 2 Lookahead: Evaluate children states (Opponent counter-turn)
        child_states: list[DraftSearchState] = []
        valid_candidates: list[int] = []

        for hid in candidate_hero_indices:
            if hid in root_state.get_unavailable_set():
                continue
            child_states.append(root_state.transition(hid))
            valid_candidates.append(hid)

        if not child_states:
            return results

        c_probs_batch, c_win_batch = self.evaluate_batch(child_states)
        c_probs_np = c_probs_batch.cpu().numpy()
        c_win_np = c_win_batch.cpu().numpy()

        for idx, (hid, next_state) in enumerate(zip(valid_candidates, child_states)):
            next_acting_side = next_state.acting_side
            p_next = c_probs_np[idx]
            w_next = c_win_np[idx]

            # Top counter-actions for the next acting team
            counter_candidates = np.argsort(p_next)[::-1][:branch_factor]
            counter_candidates = [c for c in counter_candidates if p_next[c] > 0]

            if not counter_candidates:
                # If no counters available, fallback to immediate win probability
                results[hid] = round(float(root_w_np[hid] * 100.0), 2)
                continue

            counter_root_values = []
            counter_priors = []

            for c_hid in counter_candidates:
                q_val = float(w_next[c_hid])
                # Value head predicts acting team win rate.
                # If next acting side is Root, root_win = q_val
                # If next acting side is Opponent, root_win = 1.0 - q_val
                if next_acting_side == root_side:
                    v_root = q_val
                else:
                    v_root = 1.0 - q_val

                counter_root_values.append(v_root)
                counter_priors.append(float(p_next[c_hid]))

            counter_priors_arr = np.array(counter_priors, dtype=np.float32)
            prior_sum = counter_priors_arr.sum()
            if prior_sum > 1e-6:
                counter_priors_arr /= prior_sum
            else:
                counter_priors_arr = np.ones_like(counter_priors_arr) / len(counter_priors_arr)

            # Adversarial Minimax: Opponent picks their optimal counter (worst case for Root)
            # Expectiminimax: Opponent picks according to their pro-meta policy prior
            if next_acting_side == root_side:
                # Teammate turn: max value
                minimax_val = max(counter_root_values)
                expected_val = float(np.dot(counter_priors_arr, counter_root_values))
            else:
                # Opponent turn: min value (adversarial defense)
                minimax_val = min(counter_root_values)
                expected_val = float(np.dot(counter_priors_arr, counter_root_values))

            # Balanced lookahead score: 50% pessimistic counter-defense + 50% expected counter-rate
            blended_lookahead = 0.5 * minimax_val + 0.5 * expected_val
            results[hid] = round(blended_lookahead * 100.0, 2)

        return results
