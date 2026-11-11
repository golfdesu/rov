---
name: hpo-parsimony-selector
description: >-
  Audits Optuna HPO trial outputs in best_params/sota_rov_top5_trials.json, compares them
  with the served checkpoint, and selects safe, parsimonious production hyperparameters
  using the 1% epsilon-tolerance rule (Hastie et al., 2009) and Overfit Gap analysis. Use
  this skill after running HPO, when quoting model metrics, or when selecting/updating
  hyperparameters in configs/selected_production_params.json.
---

# HPO Parsimony & Safety Selector Skill

Use this skill to inspect `best_params/sota_rov_top5_trials.json` and update `configs/selected_production_params.json` without falling into validation overfitting traps.

---

## 1. Run the Automated Parsimony Selector (Source of Truth for Numbers)

```bash
python .agents/skills/hpo-parsimony-selector/scripts/select_parsimonious_params.py
```

It prints:
1. The current Top-5 trials with the `SAFEST-GAP` and `COMPACT-PARSIMONY` tags.
2. The **served checkpoint** (`models/sota_draft_gnn_transformer.pt`): `val_loss`, `val_win_acc`, `model_config`.
3. What `configs/selected_production_params.json` claims, with its `last_updated` date.

**Never quote model metrics from memory, this file, or `AGENTS.md`.** Run the script and quote what it prints. If the config disagrees with the checkpoint, the config is stale: say so to the user instead of "fixing" either side silently.

> Status (as of 2026-11-11): Served checkpoint has `val_loss = 2.86752`, `win_acc = 52.13%` (`d_model=256, nhead=4, num_layers=1, dropout=0.2513, neural_scale=1.3326`). `configs/selected_production_params.json` records Trial #01 as safest (`val_loss=2.83993`, gap `+0.29107`) and Trial #13 as rank #1 compact (`val_loss=2.83144`), updated 2026-11-10.

---

## 2. Selection Rules for RoVDraftGNNTransformer

Never blindly pick a high-capacity model (`d_model >= 256` or `augment_factor > 1`) if a smaller or better-regularized configuration lands within `1.0%` of the minimum `val_loss`:

1. **Epsilon-Tolerance Threshold (`1.0%`)**: keep trials with `val_loss <= 1.01 * min_val_loss`.
2. **Overfit Gap (`overfit_gap = val_loss - train_pol_loss`)**: prefer the smallest gap. The script's `SAFEST-GAP` tag minimises `val_loss + 0.25 * max(0, overfit_gap)`.
3. **Capacity Parsimony**: among eligible trials, `COMPACT-PARSIMONY` is the fewest parameters. Prefer it unless its metrics are meaningfully worse.
4. **Augmentation**: `augment_factor = 1` has won every HPO run; values `> 2` overfit badly (`AGENTS.md` rule 2).

---

## 3. Training with a Specific Rank from the Top 5

```bash
# Lowest-overfit-gap candidate (safest_recommended_trial in the HPO json)
python src/train_sota_model.py --preset h100 --use-safest

# A specific rank (1 to 5)
python src/train_sota_model.py --preset h100 --top-rank 1
```

After a new checkpoint is promoted:
- rerun the selector script and update `configs/selected_production_params.json` and the `AGENTS.md` status table to match it
- regenerate the predictor golden fixture (`rov-draft-serving` skill), since recommendations will change
- add a `CHANGELOG.md` entry

---

## 4. Related Skills

- [`erawan-hpc-ops`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/erawan-hpc-ops/SKILL.md): SLURM job execution and Optuna HPO training on ERAWAN HPC H100 GPU nodes.
- [`regression-guard`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/regression-guard/SKILL.md): Verify that newly promoted checkpoints preserve 72 golden draft states without regression.
- [`rov-draft-serving`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/rov-draft-serving/SKILL.md): Run predictions and serve the production checkpoint via CLI, FastAPI, and web UI.
