---
name: regression-guard
description: Audits draft predictor golden snapshots (72 states) and combat calculator duel benchmarks to prevent algorithmic or numerical regression.
---

# regression-guard

Automated regression testing and stability guard for the RoV draft predictor golden outputs and combat calculator damage/duel simulations.

## Quick Start

```bash
# Run both prediction stability and combat benchmark audits
python .agents/skills/regression-guard/scripts/audit_regression_guard.py

# Run only predictor golden state verification (72 pro draft states)
python .agents/skills/regression-guard/scripts/audit_regression_guard.py --predictions

# Run only combat engine simulation verification (3 deterministic duels)
python .agents/skills/regression-guard/scripts/audit_regression_guard.py --combat

# Verbose output with detailed breakdown
python .agents/skills/regression-guard/scripts/audit_regression_guard.py --verbose
```

---

## What This Skill Protects

### 1. Predictor Golden Snapshot Stability (72 States)
- Replays **72 real pro match draft states** (across 4 real tournament matches, 9 turn steps, with and without lookahead) defined in `tests/golden_scenarios.py`.
- Pins output against `tests/fixtures/predict_golden.json`.
- Asserts:
  - **Rank #1 Hero Match**: 100% exact match of recommended top hero.
  - **Probability & Win-Rate Delta**: Within tolerance (`FLOAT_TOL = 0.05` to accommodate cross-platform CPU BLAS rounding).
  - **Zero Regressions**: Any algorithmic drift or accidental logic modification fails immediately.

### 2. Combat Engine & Duel Simulation Benchmark
- Audits numerical calculations in `src/combat_calculator.py` using standard baseline duels:
  - **Florentino vs Omen**: Physical duelist burst & sustained brawl.
  - **Valhein vs Keera**: Marksman vs assassin burst trade.
  - **Hayate vs Toro**: True damage marksman vs pure high-armor tank.
- Verifies:
  - TTK (Time-To-Kill) is finite, positive, and matches baseline expectations.
  - Mitigation formulas, armor pierce, passive stacking, and CDR caps produce consistent numerical output.
  - Zero NaN or floating-point division by zero exceptions.

---

## When to Use

1. **Before Committing Code**: Run after modifying `src/predictor.py`, `src/train_sota_model.py`, or `src/combat_calculator.py`.
2. **Post-HPO / Model Serving**: Verify that newly converted model checkpoints maintain expected inference ranking without degrading edge cases.
3. **CI/CD & Pre-Push Hook**: Rapid regression sanity check that completes in seconds without running lengthy full test suites.

---

## Regenerating Golden Fixtures

Golden snapshots in `tests/fixtures/predict_golden.json` must **NEVER** be regenerated just to make a broken refactor pass.
Regenerate only when deliberately updating the model checkpoint, training dataset, or scoring formulas:

```bash
python -c "from tests.test_predictor_golden import regenerate; regenerate()"
```
