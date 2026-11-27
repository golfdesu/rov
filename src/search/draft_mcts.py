"""Draft Lookahead Search & Minimax Game-Theoretic Evaluation.

This module implements sequential multi-step draft planning for RoV Pro Draft:
- Models the 18-step sequential zero-sum draft game (Phase 1 & Phase 2 Bans and Picks).
- Employs Policy-Guided Branch Pruning (expands Top-K plausible actions via Policy Head).
- Computes Adversarial Minimax / Expectiminimax lookahead win rates using the Value Head (q_win_logits).
- Prevents illegal hero selections and duplicate bans across Global BP rules.
"""

from __future__ import annotations

import dataclasses
import os
from collections.abc import Sequence
from typing import TYPE_CHECKING, NamedTuple

import numpy as np
import torch

from src.train_sota_model import get_league_vector

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


def _build_step_lookup() -> tuple[
    dict[tuple[int, int, int, int, int, int, int], int],
    list[tuple[int, int, int, int, int, int, int, int]],
]:
    """Maps exact and pick/ban-count descriptors -> DRAFT_STEPS index."""
    lookup: dict[tuple[int, int, int, int, int, int, int], int] = {}
    step_counts: list[tuple[int, int, int, int, int, int, int, int]] = []
    done = {(side, act): 0 for side in (0, 1) for act in (0, 1)}
    for step_idx, phase, act, side in DRAFT_STEPS:
        bp, rp, bb, rb = done[(0, 1)], done[(1, 1)], done[(0, 0)], done[(1, 0)]
        key = (phase, act, side, bp, rp, bb, rb)
        lookup.setdefault(key, step_idx)
        step_counts.append((step_idx, phase, act, side, bp, rp, bb, rb))
        done[(side, act)] += 1
    return lookup, step_counts


_STEP_LOOKUP, _STEP_COUNTS = _build_step_lookup()


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


def sequence_events(inp: ModelInput) -> list[tuple[int, int, int]]:
    """Reconstruct (hero_id, token_type, step_idx) in exact DRAFT_STEPS turn order matching training."""
    acting_side = 1 if (len(inp.meta) > 3 and inp.meta[3] >= 0.5) else 0
    if acting_side == 0:
        b_picks, r_picks = inp.ally_picks, inp.enemy_picks
        b_bans, r_bans = inp.ally_bans, inp.enemy_bans
    else:
        b_picks, r_picks = inp.enemy_picks, inp.ally_picks
        b_bans, r_bans = inp.enemy_bans, inp.ally_bans

    bp_i = rp_i = bb_i = rb_i = 0
    events: list[tuple[int, int, int]] = []
    for step_idx, _phase, act_ev, side_ev in DRAFT_STEPS:
        h: int | None = None
        if act_ev == 0:
            if side_ev == 0 and bb_i < len(b_bans):
                h = b_bans[bb_i]
                bb_i += 1
            elif side_ev == 1 and rb_i < len(r_bans):
                h = r_bans[rb_i]
                rb_i += 1
        else:
            if side_ev == 0 and bp_i < len(b_picks):
                h = b_picks[bp_i]
                bp_i += 1
            elif side_ev == 1 and rp_i < len(r_picks):
                h = r_picks[rp_i]
                rp_i += 1
        if h is not None and h != -1:
            same_side = side_ev == acting_side
            ttype = (1 if same_side else 2) if act_ev == 1 else (3 if same_side else 4)
            events.append((h, ttype, step_idx))

    # Append any overflow tokens from custom/non-standard board states
    for h in b_bans[bb_i:]:
        if h is not None and h != -1:
            events.append((h, 3 if acting_side == 0 else 4, 17))
    for h in r_bans[rb_i:]:
        if h is not None and h != -1:
            events.append((h, 4 if acting_side == 0 else 3, 17))
    for h in b_picks[bp_i:]:
        if h is not None and h != -1:
            events.append((h, 1 if acting_side == 0 else 2, 17))
    for h in r_picks[rp_i:]:
        if h is not None and h != -1:
            events.append((h, 2 if acting_side == 0 else 1, 17))
    return events


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
    meta_dim = len(inputs[0].meta) if inputs else 11
    meta = np.zeros((n, meta_dim), dtype=np.float32)
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
            tok_heroes[row, :k], tok_types[row, :k], tok_steps[row, :k] = zip(*events)
            tok_pad[row, :k] = False

        meta[row] = inp.meta
        act_types[row] = inp.act_type
        phases[row] = inp.phase

    return ap, ep, ab, eb, unavail, tok_heroes, tok_types, tok_steps, tok_pad, meta, act_types, phases


ONNX_INPUT_NAMES = (
    "ally_picks_vec",
    "enemy_picks_vec",
    "ally_bans_vec",
    "enemy_bans_vec",
    "unavailable_mask",
    "tok_heroes",
    "tok_types",
    "tok_steps",
    "tok_pad_mask",
    "meta_ctx",
    "action_type",
    "phase",
)
ONNX_OUTPUT_NAMES = ["policy_logits", "q_win_logits"]


class OnnxDraftModel:
    """ONNX Runtime inference wrapper matching the run_model() batch contract."""

    def __init__(self, onnx_path: str | os.PathLike[str], num_threads: int | None = None):
        import onnxruntime as ort

        sess_opts = ort.SessionOptions()
        if num_threads is not None and num_threads > 0:
            sess_opts.intra_op_num_threads = int(num_threads)
            sess_opts.inter_op_num_threads = 1
        self.onnx_path = str(onnx_path)
        self.session = ort.InferenceSession(
            self.onnx_path,
            sess_options=sess_opts,
            providers=["CPUExecutionProvider"],
        )

    def run_arrays(self, arrays: tuple[np.ndarray, ...]) -> tuple[np.ndarray, np.ndarray]:
        """Run one batched ONNX Runtime forward pass using numpy arrays from encode_batch()."""
        inputs = {name: arr for name, arr in zip(ONNX_INPUT_NAMES, arrays, strict=True)}
        logits, win_logits = self.session.run(ONNX_OUTPUT_NAMES, inputs)
        return logits, win_logits


def run_model(
    model: torch.nn.Module | OnnxDraftModel,
    arrays: tuple[np.ndarray, ...],
    device: torch.device,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Runs one batched forward pass; returns (policy probs, acting-team win probs), each (batch, heroes)."""
    if isinstance(model, OnnxDraftModel):
        logits_np, q_win_np = model.run_arrays(arrays)
        logits = torch.from_numpy(logits_np)
        q_win_logits = torch.from_numpy(q_win_np)
        unavail = torch.from_numpy(arrays[4])
    else:
        with torch.inference_mode():
            tensors = tuple(torch.from_numpy(a).to(device) for a in arrays)
            logits, q_win_logits = model(*tensors)
            unavail = tensors[4]
    probs = torch.softmax(logits, dim=-1)
    probs = probs.masked_fill(unavail, 0.0)
    sums = probs.sum(dim=-1, keepdim=True)
    probs = torch.where(sums > 0, probs / sums, probs)
    return probs, torch.sigmoid(q_win_logits)


@dataclasses.dataclass(frozen=True)
class DraftSearchState:
    """Immutable state representation of an in-progress draft."""

    blue_picks: tuple[int, ...] = ()
    red_picks: tuple[int, ...] = ()
    blue_bans: tuple[int, ...] = ()
    red_bans: tuple[int, ...] = ()
    global_bans: tuple[int, ...] = ()
    blue_global_bans: tuple[int, ...] = ()
    red_global_bans: tuple[int, ...] = ()
    series_winning_heroes: tuple[int, ...] = ()
    blue_pick_lanes: tuple[tuple[str, str], ...] = ()
    red_pick_lanes: tuple[tuple[str, str], ...] = ()
    step_idx: int = 0
    league: str = "GLOBAL"

    @property
    def is_terminal(self) -> bool:
        return self.step_idx >= len(DRAFT_STEPS)

    @property
    def is_last_step(self) -> bool:
        return self.step_idx >= len(DRAFT_STEPS) - 1

    @property
    def current_step_info(self) -> tuple[int, int, int, int]:
        if self.is_terminal:
            return (len(DRAFT_STEPS), 2, 1, 1)
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
        base = (
            set(self.blue_picks)
            | set(self.red_picks)
            | set(self.blue_bans)
            | set(self.red_bans)
            | set(self.global_bans)
        )
        if self.action_type == 0:  # BAN
            # When banning, unavailable heroes are those the opponent cannot pick anyway
            opp_gb = set(self.red_global_bans) if self.acting_side == 0 else set(self.blue_global_bans)
            return base | opp_gb
        else:  # PICK
            # When picking, unavailable heroes are those the acting team cannot pick
            own_gb = set(self.blue_global_bans) if self.acting_side == 0 else set(self.red_global_bans)
            return base | own_gb

    def transition(self, hero_idx: int) -> DraftSearchState:
        """Return the successor state after taking action hero_idx."""
        if self.is_terminal:
            raise ValueError(f"Cannot transition from terminal draft step {self.step_idx}")

        b_p, r_p = list(self.blue_picks), list(self.red_picks)
        b_b, r_b = list(self.blue_bans), list(self.red_bans)

        _, _, action_type, side = DRAFT_STEPS[self.step_idx]

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
            blue_global_bans=self.blue_global_bans,
            red_global_bans=self.red_global_bans,
            series_winning_heroes=self.series_winning_heroes,
            blue_pick_lanes=self.blue_pick_lanes,
            red_pick_lanes=self.red_pick_lanes,
            step_idx=self.step_idx + 1,
            league=self.league,
        )


class DraftMinimaxSearch:
    """Adversarial Minimax Lookahead Search Engine using Policy and Value heads."""

    def __init__(self, predictor: RoVDraftPredictor):
        self.predictor = predictor
        self.model = getattr(predictor, "inference_model", predictor.model)
        self.device = predictor.device
        self.num_heroes = len(predictor.hero_names)

    def _to_model_input(self, s: DraftSearchState) -> ModelInput:
        if s.acting_side == 0:  # Blue acting
            ally_picks, enemy_picks, ally_bans, enemy_bans = s.blue_picks, s.red_picks, s.blue_bans, s.red_bans
            side_gb = s.red_global_bans if s.action_type == 0 else s.blue_global_bans
        else:  # Red acting
            ally_picks, enemy_picks, ally_bans, enemy_bans = s.red_picks, s.blue_picks, s.red_bans, s.blue_bans
            side_gb = s.blue_global_bans if s.action_type == 0 else s.red_global_bans
        effective_gb = tuple(dict.fromkeys([*s.global_bans, *side_gb]))
        model_step = min(s.step_idx, 17)
        meta = (
            model_step / 17.0,
            float(s.phase == 2),
            float(s.action_type == 1),
            float(s.acting_side == 1),
            1.0,
            len(ally_picks) / 5.0,
            len(enemy_picks) / 5.0,
            *get_league_vector(s.league),
        )
        return ModelInput(
            ally_picks,
            enemy_picks,
            ally_bans,
            enemy_bans,
            effective_gb,
            meta,
            s.action_type,
            s.phase,
        )

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

    @staticmethod
    def find_matching_step(
        side_val: int,
        act_type: int,
        phase: int,
        b_picks_len: int,
        r_picks_len: int,
        b_bans_len: int,
        r_bans_len: int,
    ) -> int:
        """Find the exact step index matching current draft configuration.

        When bans are omitted or entered out-of-order (partial-ban query), match by
        phase, action_type, side_val, and pick counts first so pick queries never
        collapse onto Ban steps 0/1.
        """
        key = (phase, act_type, side_val, b_picks_len, r_picks_len, b_bans_len, r_bans_len)
        if key in _STEP_LOOKUP:
            return _STEP_LOOKUP[key]

        candidates = [row for row in _STEP_COUNTS if row[1] == phase and row[2] == act_type and row[3] == side_val]
        if not candidates:
            candidates = [row for row in _STEP_COUNTS if row[2] == act_type and row[3] == side_val]
        if not candidates:
            return min(b_picks_len + r_picks_len + b_bans_len + r_bans_len, 17)

        def _distance(row: tuple[int, int, int, int, int, int, int, int]) -> tuple[int, int, int]:
            step_idx, _p, _a, _s, bp, rp, bb, rb = row
            pick_diff = abs(bp - b_picks_len) + abs(rp - r_picks_len)
            ban_diff = abs(bb - b_bans_len) + abs(rb - r_bans_len)
            primary = pick_diff if act_type == 1 else ban_diff
            secondary = ban_diff if act_type == 1 else pick_diff
            return (primary, secondary, step_idx)

        return min(candidates, key=_distance)[0]

    def _filtered_action_dist(
        self,
        state: DraftSearchState,
        raw_probs: np.ndarray,
        branch_factor: int,
        *,
        root_side: int | None = None,
        pool_hero_lanes: dict[str, set[str]] | None = None,
        pool_lanes_by_id: dict[int, set[str]] | None = None,
        needed_cache: dict[tuple[int, tuple[int, ...], tuple[tuple[str, str], ...]], set[str]] | None = None,
    ) -> tuple[np.ndarray, list[int]]:
        """Apply series winning boost + needed lane filter and extract top branch_factor actions."""
        p_next = raw_probs.copy()
        if state.series_winning_heroes:
            unavail = state.get_unavailable_set()
            for w_hid in state.series_winning_heroes:
                if w_hid not in unavail:
                    p_next[w_hid] *= 1.12
            p_sum = float(p_next.sum())
            if p_sum > 0:
                p_next /= p_sum

        if state.action_type == 1:
            target_pick_ids = state.blue_picks if state.acting_side == 0 else state.red_picks
            raw_pick_lanes = state.blue_pick_lanes if state.acting_side == 0 else state.red_pick_lanes
            use_root_pool = root_side is not None and state.acting_side == root_side and bool(pool_lanes_by_id)
            cache_key = (state.acting_side, target_pick_ids, raw_pick_lanes)
            if needed_cache is not None and cache_key in needed_cache:
                needed_next = needed_cache[cache_key]
            else:
                target_pick_names = [self.predictor.hero_names[i] for i in target_pick_ids]
                target_row = np.zeros(self.num_heroes, dtype=np.float32)
                if target_pick_ids:
                    target_row[list(target_pick_ids)] = 1.0
                needed_next = self.predictor._needed_lanes_for_picks(
                    target_pick_names,
                    target_row,
                    explicit_lanes=dict(raw_pick_lanes),
                    pool_hero_lanes=pool_hero_lanes if use_root_pool else None,
                )
                if needed_cache is not None:
                    needed_cache[cache_key] = needed_next
            p_next = self.predictor._apply_lane_filter(
                p_next,
                needed_next,
                pool_lanes_by_id=pool_lanes_by_id if use_root_pool else None,
            )

        top_ids = np.argsort(p_next)[::-1][:branch_factor]
        filtered = [int(c) for c in top_ids if p_next[c] > 0]
        return p_next, filtered

    def _evaluate_frontier(
        self,
        nodes: list[DraftSearchState],
        root_side: int,
        remaining_depth: int,
        branch_factor: int,
        *,
        pool_hero_lanes: dict[str, set[str]] | None = None,
        pool_lanes_by_id: dict[int, set[str]] | None = None,
        needed_cache: dict[tuple[int, tuple[int, ...], tuple[tuple[str, str], ...]], set[str]] | None = None,
    ) -> list[float]:
        """Batched recursive adversarial minimax/expectiminimax evaluation for depth >= 2."""
        probs_batch, win_batch = self.evaluate_batch(nodes)
        probs_np = probs_batch.cpu().numpy()
        win_np = win_batch.cpu().numpy()

        node_actions: list[tuple[np.ndarray, list[int]]] = [
            self._filtered_action_dist(
                st,
                probs_np[idx],
                branch_factor,
                root_side=root_side,
                pool_hero_lanes=pool_hero_lanes,
                pool_lanes_by_id=pool_lanes_by_id,
                needed_cache=needed_cache,
            )
            for idx, st in enumerate(nodes)
        ]

        if remaining_depth <= 1:
            out: list[float] = []
            for idx, (st, (p_next, actions)) in enumerate(zip(nodes, node_actions)):
                if not actions:
                    # Fallback mean top win estimate
                    v = float(win_np[idx].max())
                    out.append(v if st.acting_side == root_side else 1.0 - v)
                    continue
                vals = [
                    float(win_np[idx, a]) if st.acting_side == root_side else 1.0 - float(win_np[idx, a])
                    for a in actions
                ]
                priors = np.array([float(p_next[a]) for a in actions], dtype=np.float32)
                p_sum = priors.sum()
                priors = priors / p_sum if p_sum > 1e-6 else np.ones_like(priors) / len(priors)
                mm = max(vals) if st.acting_side == root_side else min(vals)
                ev = float(np.dot(priors, vals))
                out.append(0.5 * mm + 0.5 * ev)
            return out

        # Expand non-terminal children across the entire depth frontier in one neural batch
        child_nodes: list[DraftSearchState] = []
        child_slices: list[tuple[int, int, int]] = []  # (node_idx, start, count) or (-1, action, node_idx)
        leaf_fallback: dict[tuple[int, int], float] = {}

        sub_branch = max(2, branch_factor - 1)
        for idx, (st, (p_next, actions)) in enumerate(zip(nodes, node_actions)):
            if not actions or st.is_terminal:
                v = float(win_np[idx].max())
                leaf_fallback[(idx, -1)] = v if st.acting_side == root_side else 1.0 - v
                child_slices.append((idx, -1, 0))
                continue
            start = len(child_nodes)
            unavail = st.get_unavailable_set()
            expanded_actions: list[int] = []
            for a in actions:
                if st.is_last_step or a in unavail:
                    q_val = float(win_np[idx, a])
                    leaf_fallback[(idx, a)] = q_val if st.acting_side == root_side else 1.0 - q_val
                else:
                    child_nodes.append(st.transition(a))
                    expanded_actions.append(a)
            child_slices.append((idx, start, len(expanded_actions)))

        child_vals = (
            self._evaluate_frontier(
                child_nodes,
                root_side,
                remaining_depth - 1,
                sub_branch,
                pool_hero_lanes=pool_hero_lanes,
                pool_lanes_by_id=pool_lanes_by_id,
                needed_cache=needed_cache,
            )
            if child_nodes
            else []
        )

        out_vals: list[float] = []
        for idx, start, count in child_slices:
            st = nodes[idx]
            p_next, actions = node_actions[idx]
            if start < 0:
                out_vals.append(leaf_fallback[(idx, -1)])
                continue
            vals: list[float] = []
            priors_list: list[float] = []
            c_offset = 0
            for a in actions:
                if (idx, a) in leaf_fallback:
                    vals.append(leaf_fallback[(idx, a)])
                else:
                    vals.append(child_vals[start + c_offset])
                    c_offset += 1
                priors_list.append(float(p_next[a]))
            priors = np.array(priors_list, dtype=np.float32)
            p_sum = priors.sum()
            priors = priors / p_sum if p_sum > 1e-6 else np.ones_like(priors) / len(priors)
            mm = max(vals) if st.acting_side == root_side else min(vals)
            ev = float(np.dot(priors, vals))
            out_vals.append(0.5 * mm + 0.5 * ev)
        return out_vals

    def search_lookahead_win_rates(
        self,
        root_state: DraftSearchState,
        candidate_hero_indices: list[int],
        depth: int = 2,
        branch_factor: int = 5,
        root_win_probs: np.ndarray | None = None,
        pool_hero_lanes: dict[str, set[str]] | None = None,
        pool_lanes_by_id: dict[int, set[str]] | None = None,
    ) -> dict[int, float]:
        """Perform adversarial Minimax / Expectiminimax lookahead for candidate actions.

        Args:
            root_state: The current draft state
            candidate_hero_indices: List of candidate actions to evaluate from root
            depth: Number of lookahead steps (1 = immediate value, 2..4 = multi-ply lookahead)
            branch_factor: Number of counter-actions to explore per branch
            root_win_probs: Optional precomputed root value vector to skip redundant root inference
            pool_hero_lanes: Optional Hero Pool lane assignments for root side consecutive picks
            pool_lanes_by_id: Optional hero-id keyed Hero Pool lane assignments

        Returns:
            dict mapping hero_idx -> lookahead expected win rate percentage (0.0 to 100.0)
        """
        root_side = root_state.acting_side
        results: dict[int, float] = {}

        if not candidate_hero_indices:
            return results

        # 1. Base evaluation of root state (reuse root_win_probs when caller already ran forward pass)
        if root_win_probs is not None:
            root_w_np = root_win_probs
        else:
            _root_probs, root_win = self.evaluate_batch([root_state])
            root_w_np = root_win[0].cpu().numpy()

        if depth <= 1 or root_state.is_last_step:
            for hid in candidate_hero_indices:
                results[hid] = round(float(root_w_np[hid] * 100.0), 2)
            return results

        # 2. Multi-ply Lookahead (depth 2..4): batched child / frontier expansion
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

        needed_cache: dict[tuple[int, tuple[int, ...], tuple[tuple[str, str], ...]], set[str]] = {}

        if depth >= 3:
            frontier_vals = self._evaluate_frontier(
                child_states,
                root_side=root_side,
                remaining_depth=min(depth - 1, 3),
                branch_factor=max(2, min(branch_factor, 4)),
                pool_hero_lanes=pool_hero_lanes,
                pool_lanes_by_id=pool_lanes_by_id,
                needed_cache=needed_cache,
            )
            for hid, val in zip(valid_candidates, frontier_vals):
                results[hid] = round(float(val * 100.0), 2)
            return results

        c_probs_batch, c_win_batch = self.evaluate_batch(child_states)
        c_probs_np = c_probs_batch.cpu().numpy()
        c_win_np = c_win_batch.cpu().numpy()

        for idx, (hid, next_state) in enumerate(zip(valid_candidates, child_states)):
            next_acting_side = next_state.acting_side
            p_next, counter_candidates = self._filtered_action_dist(
                next_state,
                c_probs_np[idx],
                branch_factor,
                root_side=root_side,
                pool_hero_lanes=pool_hero_lanes,
                pool_lanes_by_id=pool_lanes_by_id,
                needed_cache=needed_cache,
            )
            w_next = c_win_np[idx]

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
                minimax_val = max(counter_root_values)
                expected_val = float(np.dot(counter_priors_arr, counter_root_values))
            else:
                minimax_val = min(counter_root_values)
                expected_val = float(np.dot(counter_priors_arr, counter_root_values))

            # Balanced lookahead score: 50% pessimistic counter-defense + 50% expected counter-rate
            blended_lookahead = 0.5 * minimax_val + 0.5 * expected_val
            results[hid] = round(blended_lookahead * 100.0, 2)

        return results
