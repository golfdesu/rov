"""Draft Lookahead Search & Minimax Game-Theoretic Evaluation.

This module implements sequential multi-step draft planning for RoV Pro Draft:
- Models the 18-step sequential zero-sum draft game (Phase 1 & Phase 2 Bans and Picks).
- Employs Policy-Guided Branch Pruning (expands Top-K plausible actions via Policy Head).
- Computes Adversarial Minimax / Expectiminimax lookahead win rates using the Value Head (q_win_logits).
- Prevents illegal hero selections and duplicate bans across Global BP rules.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Sequence
from typing import TYPE_CHECKING, NamedTuple

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


def _build_step_lookup() -> dict[tuple[int, int, int, int, int, int, int], int]:
    """Maps (phase, action, side, blue_picks, red_picks, blue_bans, red_bans) -> step index."""
    lookup: dict[tuple[int, int, int, int, int, int, int], int] = {}
    done = {(side, act): 0 for side in (0, 1) for act in (0, 1)}
    for step_idx, phase, act, side in DRAFT_STEPS:
        key = (phase, act, side, done[(0, 1)], done[(1, 1)], done[(0, 0)], done[(1, 0)])
        lookup.setdefault(key, step_idx)
        done[(side, act)] += 1
    return lookup


_STEP_LOOKUP = _build_step_lookup()


class ModelInput(NamedTuple):
    """One draft position from the acting team's point of view (hero ids, not names)."""

    ally_picks: Sequence[int]
    enemy_picks: Sequence[int]
    ally_bans: Sequence[int]
    enemy_bans: Sequence[int]
    global_bans: Sequence[int]
    meta: Sequence[float]
    act_type: int
    phase: int


def sequence_events(inp: ModelInput) -> list[tuple[int, int]]:
    """(hero_id, token_type) in the order the model was trained on: phase-1 bans/picks, then phase 2."""
    return (
        [(h, 3) for h in inp.ally_bans[:2]]
        + [(h, 4) for h in inp.enemy_bans[:2]]
        + [(h, 1) for h in inp.ally_picks[:3]]
        + [(h, 2) for h in inp.enemy_picks[:3]]
        + [(h, 3) for h in inp.ally_bans[2:]]
        + [(h, 4) for h in inp.enemy_bans[2:]]
        + [(h, 1) for h in inp.ally_picks[3:]]
        + [(h, 2) for h in inp.enemy_picks[3:]]
    )


def encode_batch(inputs: Sequence[ModelInput], num_heroes: int) -> tuple[np.ndarray, ...]:
    """Builds the 12 model input arrays (one row per position) in RoVDraftGNNTransformer.forward order."""
    n = len(inputs)
    ap = np.zeros((n, num_heroes), dtype=np.float32)
    ep = np.zeros((n, num_heroes), dtype=np.float32)
    ab = np.zeros((n, num_heroes), dtype=np.float32)
    eb = np.zeros((n, num_heroes), dtype=np.float32)
    unavail = np.zeros((n, num_heroes), dtype=np.bool_)
    tok_heroes = np.zeros((n, MAX_HISTORY_LEN), dtype=np.int64)
    tok_types = np.zeros((n, MAX_HISTORY_LEN), dtype=np.int64)
    tok_steps = np.zeros((n, MAX_HISTORY_LEN), dtype=np.int64)
    tok_pad = np.ones((n, MAX_HISTORY_LEN), dtype=np.bool_)
    meta = np.zeros((n, 7), dtype=np.float32)
    act_types = np.zeros(n, dtype=np.int64)
    phases = np.zeros(n, dtype=np.int64)

    for row, inp in enumerate(inputs):
        # list() matters: a tuple index would be read as a multi-dimensional index
        ap[row, list(inp.ally_picks)] = 1.0
        ep[row, list(inp.enemy_picks)] = 1.0
        ab[row, list(inp.ally_bans)] = 1.0
        eb[row, list(inp.enemy_bans)] = 1.0
        unavail[row, [*inp.ally_picks, *inp.enemy_picks, *inp.ally_bans, *inp.enemy_bans, *inp.global_bans]] = True

        events = sequence_events(inp)[:MAX_HISTORY_LEN]
        if events:
            k = len(events)
            tok_heroes[row, :k], tok_types[row, :k] = zip(*events)
            tok_steps[row, :k] = np.arange(k)
            tok_pad[row, :k] = False

        meta[row] = inp.meta
        act_types[row] = inp.act_type
        phases[row] = inp.phase

    return ap, ep, ab, eb, unavail, tok_heroes, tok_types, tok_steps, tok_pad, meta, act_types, phases


def run_model(
    model: torch.nn.Module, arrays: tuple[np.ndarray, ...], device: torch.device
) -> tuple[torch.Tensor, torch.Tensor]:
    """Runs one batched forward pass; returns (policy probs, acting-team win probs), each (batch, heroes)."""
    with torch.no_grad():
        logits, q_win_logits = model(*(torch.from_numpy(a).to(device) for a in arrays))
    return torch.softmax(logits, dim=-1), torch.sigmoid(q_win_logits)


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

    def _to_model_input(self, s: DraftSearchState) -> ModelInput:
        if s.acting_side == 0:  # Blue acting
            ally_picks, enemy_picks, ally_bans, enemy_bans = s.blue_picks, s.red_picks, s.blue_bans, s.red_bans
        else:  # Red acting
            ally_picks, enemy_picks, ally_bans, enemy_bans = s.red_picks, s.blue_picks, s.red_bans, s.blue_bans
        meta = (
            min(s.step_idx, 17) / 17.0,
            float(s.phase == 2),
            float(s.action_type == 1),
            float(s.acting_side == 1),
            1.0,
            len(ally_picks) / 5.0,
            len(enemy_picks) / 5.0,
        )
        return ModelInput(ally_picks, enemy_picks, ally_bans, enemy_bans, s.global_bans, meta, s.action_type, s.phase)

    def evaluate_batch(self, states: list[DraftSearchState]) -> tuple[torch.Tensor, torch.Tensor]:
        """Evaluate a batch of draft states through the neural network.

        Returns:
            policy_probs: (batch_size, num_heroes) probabilities from Policy Head
            win_probs: (batch_size, num_heroes) acting team win rates from Value Head
        """
        if not states:
            return torch.empty(0), torch.empty(0)

        arrays = encode_batch([self._to_model_input(s) for s in states], self.num_heroes)
        return run_model(self.model, arrays, self.device)

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
        key = (phase, act_type, side_val, b_picks_len, r_picks_len, b_bans_len, r_bans_len)
        if key in _STEP_LOOKUP:
            return _STEP_LOOKUP[key]
        # Fallback to total completed actions
        return min(b_picks_len + r_picks_len + b_bans_len + r_bans_len, 17)

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

        unavailable = root_state.get_unavailable_set()
        for hid in candidate_hero_indices:
            if hid in unavailable:
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
