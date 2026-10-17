"""Self-Play Draft Simulation Engine for RoV Pro Draft.

Simulates an entire 18-step tournament draft between two autonomous AI coaches:
- Blue Team AI vs Red Team AI
- Supports Minimax Lookahead Search (Adversarial Tree Search) vs Greedy Policy Prior
- Demonstrates real-time strategic counter-picking, lane filling, and synergy optimization
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Ensure repo root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.predictor import RoVDraftPredictor
from src.schemas import DraftStateRequest
from src.search.draft_mcts import DRAFT_STEPS


def run_selfplay_simulation(
    blue_strategy: str = "lookahead",
    red_strategy: str = "greedy",
    lookahead_depth: int = 2,
    global_bans: list[str] | None = None,
):
    print("=" * 80)
    print(" " * 20 + "ROV PRO DRAFT SELF-PLAY SIMULATOR")
    print("=" * 80)
    print(
        f"Blue Team AI Strategy: {blue_strategy.upper()} (Depth: {lookahead_depth if blue_strategy == 'lookahead' else 1})"
    )
    print(
        f"Red Team AI Strategy : {red_strategy.upper()} (Depth: {lookahead_depth if red_strategy == 'lookahead' else 1})"
    )
    gb = global_bans or ["Marja"]
    print(f"Global Bans (Bo5/Bo7) : {', '.join(gb)}")
    print("-" * 80)

    predictor = RoVDraftPredictor()

    blue_picks: list[str] = []
    red_picks: list[str] = []
    blue_bans: list[str] = []
    red_bans: list[str] = []

    for step_idx, phase, action_type, side in DRAFT_STEPS:
        side_str = "blue" if side == 0 else "red"
        mode_str = "pick" if action_type == 1 else "ban"
        current_strategy = blue_strategy if side == 0 else red_strategy
        use_lookahead = current_strategy == "lookahead"

        if side == 0:
            ally_p, enemy_p = list(blue_picks), list(red_picks)
            ally_b, enemy_b = list(blue_bans), list(red_bans)
        else:
            ally_p, enemy_p = list(red_picks), list(blue_picks)
            ally_b, enemy_b = list(red_bans), list(blue_bans)

        req = DraftStateRequest(
            mode=mode_str,
            side=side_str,
            phase=phase,
            ally_picks=ally_p,
            enemy_picks=enemy_p,
            ally_bans=ally_b,
            enemy_bans=enemy_b,
            global_bans=gb,
            top_k=3,
            use_lookahead=use_lookahead,
            lookahead_depth=lookahead_depth,
        )

        resp = predictor.predict(req)
        chosen = resp.recommendations[0]
        chosen_hero = chosen.hero_name

        if side == 0:
            if action_type == 1:
                blue_picks.append(chosen_hero)
            else:
                blue_bans.append(chosen_hero)
        else:
            if action_type == 1:
                red_picks.append(chosen_hero)
            else:
                red_bans.append(chosen_hero)

        step_tag = f"Step {step_idx + 1:02d} | Phase {phase} | {side_str.upper():4s} {mode_str.upper():4s}"
        win_stat = f"Win%: {chosen.predicted_win_rate_pct:5.1f}%"
        if chosen.lookahead_win_rate_pct is not None:
            win_stat += f" | Lookahead Win%: {chosen.lookahead_win_rate_pct:5.1f}%"
        lane_role = f"({chosen.primary_lane} / {chosen.primary_role})" if mode_str == "pick" else "(Ban)"

        print(f"[{step_tag}] -> {chosen_hero:<20s} {lane_role:<32s} [{win_stat}]")

    print("\n" + "=" * 80)
    print(" " * 28 + "FINAL DRAFT RESULT")
    print("=" * 80)
    print(f"BLUE TEAM PICKS : {', '.join(blue_picks)}")
    print(f"BLUE TEAM BANS  : {', '.join(blue_bans)}")
    print("-" * 80)
    print(f"RED TEAM PICKS  : {', '.join(red_picks)}")
    print(f"RED TEAM BANS   : {', '.join(red_bans)}")
    print("=" * 80)

    # Final Draft Evaluation from Blue perspective
    eval_req = DraftStateRequest(
        mode="pick",
        side="blue",
        phase=2,
        ally_picks=blue_picks,
        enemy_picks=red_picks,
        ally_bans=blue_bans,
        enemy_bans=red_bans,
        global_bans=gb,
        top_k=1,
    )
    predictor.predict(eval_req)
    # Average team edge
    blue_syn = (
        sum(
            float(predictor.ckpt["graphs"]["synergy_mat"][predictor.hero_to_id[h1], predictor.hero_to_id[h2]])
            for h1 in blue_picks
            for h2 in blue_picks
            if h1 != h2
        )
        * 50.0
    )
    red_syn = (
        sum(
            float(predictor.ckpt["graphs"]["synergy_mat"][predictor.hero_to_id[h1], predictor.hero_to_id[h2]])
            for h1 in red_picks
            for h2 in red_picks
            if h1 != h2
        )
        * 50.0
    )

    print(f"Blue Synergy Edge Score: +{blue_syn:.2f}%")
    print(f"Red Synergy Edge Score : +{red_syn:.2f}%")
    print("Simulation completed successfully.\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Simulate RoV Draft AI Self-Play")
    parser.add_argument("--blue-strategy", choices=["lookahead", "greedy"], default="lookahead")
    parser.add_argument("--red-strategy", choices=["lookahead", "greedy"], default="greedy")
    parser.add_argument("--depth", type=int, default=2)
    args = parser.parse_args()

    run_selfplay_simulation(
        blue_strategy=args.blue_strategy,
        red_strategy=args.red_strategy,
        lookahead_depth=args.depth,
    )
