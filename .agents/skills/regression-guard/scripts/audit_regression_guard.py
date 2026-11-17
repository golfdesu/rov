#!/usr/bin/env python3
"""RoV Regression Guard Auditor.

Audits draft predictor golden snapshots (72 states) and combat calculator
duel benchmarks to prevent algorithmic or numerical regression.

Usage:
    python .agents/skills/regression-guard/scripts/audit_regression_guard.py
    python .agents/skills/regression-guard/scripts/audit_regression_guard.py --predictions
    python .agents/skills/regression-guard/scripts/audit_regression_guard.py --combat
    python .agents/skills/regression-guard/scripts/audit_regression_guard.py --verbose
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

GOLDEN_PATH = REPO_ROOT / "tests" / "fixtures" / "predict_golden.json"
FLOAT_TOL = 0.05


def audit_predictions(verbose: bool = False) -> tuple[int, int, list[str]]:
    """Audits RoVDraftPredictor against tests/fixtures/predict_golden.json."""
    from src.config import config
    from src.predictor import RoVDraftPredictor
    from tests.golden_scenarios import golden_requests

    archive_path = config.paths.models_dir / "archive" / "sota_draft_gnn_transformer.pt"
    if not (config.paths.sota_model_path.exists() or archive_path.exists()):
        print(f"[ERROR] SOTA checkpoint not found at {config.paths.sota_model_path}")
        return 0, 1, ["Checkpoint missing"]

    if not GOLDEN_PATH.exists():
        print(f"[ERROR] Golden fixtures not found at {GOLDEN_PATH}")
        return 0, 1, ["Golden fixtures missing"]

    golden_data = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    scenarios = golden_requests()

    print("=" * 72)
    print("Regression Guard: Draft Predictor Golden Snapshot Audit")
    print(f"Target Fixture: {GOLDEN_PATH.relative_to(REPO_ROOT)} ({len(scenarios)} Replay States)")
    print("=" * 72)

    t0 = time.time()
    predictor = RoVDraftPredictor()
    load_time = time.time() - t0
    print(f"[INFO] RoVDraftPredictor initialized in {load_time:.2f}s")

    passed = 0
    failed = 0
    errors: list[str] = []

    for name, req in scenarios:
        if name not in golden_data:
            failed += 1
            err = f"Scenario '{name}' not found in golden fixture"
            errors.append(err)
            if verbose:
                print(f"  [FAIL] {name}: {err}")
            continue

        golden_item = golden_data[name]
        pred_res = predictor.predict(req)
        actual_dump = pred_res.model_dump()

        expected_recs = golden_item.get("recommendations", [])
        actual_recs = actual_dump.get("recommendations", [])

        if not expected_recs or len(expected_recs) != len(actual_recs):
            failed += 1
            err = f"{name}: Recommendations count mismatch (expected {len(expected_recs)}, got {len(actual_recs)})"
            errors.append(err)
            if verbose:
                print(f"  [FAIL] {err}")
            continue

        scenario_err: str | None = None
        for idx, (exp_rec, act_rec) in enumerate(zip(expected_recs, actual_recs, strict=True), start=1):
            if exp_rec.get("hero_name") != act_rec.get("hero_name"):
                scenario_err = (
                    f"{name} [rec #{idx}]: Hero mismatch "
                    f"(expected '{exp_rec.get('hero_name')}', got '{act_rec.get('hero_name')}')"
                )
                break
            exp_prob = float(exp_rec.get("probability_pct", 0.0))
            act_prob = float(act_rec.get("probability_pct", 0.0))
            if abs(exp_prob - act_prob) > FLOAT_TOL:
                scenario_err = (
                    f"{name} [rec #{idx}]: Prob delta {abs(exp_prob - act_prob):.4f} > tol {FLOAT_TOL} "
                    f"(exp {exp_prob}, act {act_prob})"
                )
                break
            exp_wr = float(exp_rec.get("predicted_win_rate_pct", 0.0))
            act_wr = float(act_rec.get("predicted_win_rate_pct", 0.0))
            if abs(exp_wr - act_wr) > FLOAT_TOL:
                scenario_err = (
                    f"{name} [rec #{idx}]: WinRate delta {abs(exp_wr - act_wr):.4f} > tol {FLOAT_TOL} "
                    f"(exp {exp_wr}, act {act_wr})"
                )
                break
            exp_la = exp_rec.get("lookahead_win_rate_pct")
            act_la = act_rec.get("lookahead_win_rate_pct")
            if (exp_la is None) != (act_la is None) or (
                exp_la is not None and abs(float(exp_la) - float(act_la)) > FLOAT_TOL
            ):
                scenario_err = f"{name} [rec #{idx}]: Lookahead mismatch (exp {exp_la}, act {act_la})"
                break

        if scenario_err is None:
            for fk in ("blue_next_picks", "red_next_picks", "blue_next_bans", "red_next_bans"):
                exp_fl = golden_item.get(fk, [])
                act_fl = actual_dump.get(fk, [])
                if len(exp_fl) != len(act_fl):
                    scenario_err = f"{name} [{fk}]: length mismatch (exp {len(exp_fl)}, act {len(act_fl)})"
                    break
                for j, (ef, af) in enumerate(zip(exp_fl, act_fl, strict=True), start=1):
                    if ef.get("hero_name") != af.get("hero_name"):
                        scenario_err = (
                            f"{name} [{fk} #{j}]: hero mismatch "
                            f"(exp '{ef.get('hero_name')}', act '{af.get('hero_name')}')"
                        )
                        break
                    if abs(float(ef.get("probability_pct", 0.0)) - float(af.get("probability_pct", 0.0))) > FLOAT_TOL:
                        scenario_err = f"{name} [{fk} #{j}]: prob drift"
                        break
                    if (
                        abs(float(ef.get("predicted_win_rate_pct", 0.0)) - float(af.get("predicted_win_rate_pct", 0.0)))
                        > FLOAT_TOL
                    ):
                        scenario_err = f"{name} [{fk} #{j}]: win rate drift"
                        break
                if scenario_err is not None:
                    break

        if scenario_err is None:
            if golden_item.get("missing_ally_lanes", []) != actual_dump.get("missing_ally_lanes", []):
                scenario_err = f"{name}: missing_ally_lanes mismatch"
            elif [x.get("hero_name") for x in golden_item.get("ban_unlocked_heroes", [])] != [
                x.get("hero_name") for x in actual_dump.get("ban_unlocked_heroes", [])
            ]:
                scenario_err = f"{name}: ban_unlocked_heroes mismatch"

        if scenario_err is not None:
            failed += 1
            errors.append(scenario_err)
            if verbose:
                print(f"  [FAIL] {scenario_err}")
            continue

        passed += 1
        if verbose:
            act_top = pred_res.recommendations[0]
            print(f"  [PASS] {name:<18} -> #{act_top.rank} {act_top.hero_name:<14} ({act_top.probability_pct:.2f}%)")

    total_time = time.time() - t0
    print("-" * 72)
    print(
        f"Prediction Audit Summary: {passed}/{len(scenarios)} Passed ({passed / len(scenarios) * 100:.1f}%) in {total_time:.2f}s"
    )
    if failed == 0:
        print(f"[SUCCESS] Zero predictor regressions detected across all {len(scenarios)} tournament states.")
    else:
        print(f"[FAILURE] {failed} scenario(s) showed regression.")
    print("=" * 72)
    return passed, failed, errors


def audit_combat_engine(verbose: bool = False) -> tuple[int, int, list[str]]:
    """Audits CombatEngine 1v1 duel benchmarks to verify damage formulas and TTK stability."""
    from src.combat_calculator import Build, get_engine

    print("=" * 72)
    print("Regression Guard: Combat Engine Duel Benchmark Audit")
    print("=" * 72)

    engine = get_engine()

    benchmarks = [
        {
            "name": "Duel 1 (Physical Brawl): Florentino vs Omen",
            "build_a": Build(hero="Florentino", level=15, items=["Broken Spears", "Omni Arms"]),
            "build_b": Build(hero="Omen", level=15, items=["Shield of the Lost", "Mail of Pain"]),
            "expected_winner": "a",
            "expected_ttk": 9.9,
        },
        {
            "name": "Duel 2 (Burst Trade): Valhein vs Keera",
            "build_a": Build(hero="Valhein", level=15, items=["Claves Sancti", "Muramasa"]),
            "build_b": Build(hero="Keera", level=15, items=["Boomstick", "Staff of Nuul"]),
            "expected_winner": "a",
            "expected_ttk": 8.25,
        },
        {
            "name": "Duel 3 (True Dmg vs Tank): Hayate vs Toro",
            "build_a": Build(hero="Hayate", level=15, items=["The Morning Star", "War Boots"]),
            "build_b": Build(hero="Toro", level=15, items=["Shield of the Lost", "Mail of Pain"]),
            "expected_winner": "a",
            "expected_ttk": 15.0,
        },
    ]

    passed = 0
    failed = 0
    errors: list[str] = []

    for b in benchmarks:
        name = b["name"]
        res = engine.duel(b["build_a"], b["build_b"])
        sim = res.get("simulation", {})

        winner = sim.get("winner")
        ttk = sim.get("time_to_kill", 0.0)

        if math.isnan(ttk) or ttk <= 0:
            failed += 1
            err = f"{name}: Invalid TTK ({ttk})"
            errors.append(err)
            if verbose:
                print(f"  [FAIL] {err}")
            continue

        if winner != b["expected_winner"]:
            failed += 1
            err = f"{name}: Winner mismatch (expected '{b['expected_winner']}', got '{winner}')"
            errors.append(err)
            if verbose:
                print(f"  [FAIL] {err}")
            continue

        if abs(ttk - b["expected_ttk"]) > 0.5:
            failed += 1
            err = f"{name}: TTK drift (expected {b['expected_ttk']}s, got {ttk}s)"
            errors.append(err)
            if verbose:
                print(f"  [FAIL] {err}")
            continue

        passed += 1
        print(f"  [PASS] {name} -> Winner '{winner}' in {ttk:.1f}s")
        if verbose:
            print(f"         Side A remaining HP: {sim.get('a', {}).get('remaining_hp', 0):.1f}")
            print(f"         Side B remaining HP: {sim.get('b', {}).get('remaining_hp', 0):.1f}")

    print("-" * 72)
    print(f"Combat Audit Summary: {passed}/{len(benchmarks)} Passed ({passed / len(benchmarks) * 100:.1f}%)")
    if failed == 0:
        print("[SUCCESS] All combat simulation benchmarks matched baseline within tolerance.")
    else:
        print(f"[FAILURE] {failed} combat benchmark(s) drifted from baseline.")
    print("=" * 72)
    return passed, failed, errors


def main() -> None:
    parser = argparse.ArgumentParser(description="RoV Regression Guard Auditor")
    parser.add_argument("--predictions", action="store_true", help="Audit draft predictor golden states")
    parser.add_argument("--combat", action="store_true", help="Audit combat engine duels")
    parser.add_argument("--verbose", action="store_true", help="Verbose logging per test case")
    args = parser.parse_args()

    run_all = not args.predictions and not args.combat

    total_failed = 0

    if run_all or args.predictions:
        _, p_fail, _ = audit_predictions(verbose=args.verbose)
        total_failed += p_fail
        if run_all:
            print()

    if run_all or args.combat:
        _, c_fail, _ = audit_combat_engine(verbose=args.verbose)
        total_failed += c_fail

    if total_failed > 0:
        print(f"\n[ALERT] Regression Guard failed with {total_failed} regression error(s).")
        sys.exit(1)
    else:
        print("\n[OK] All Regression Guard audits passed successfully.")
        sys.exit(0)


if __name__ == "__main__":
    main()
