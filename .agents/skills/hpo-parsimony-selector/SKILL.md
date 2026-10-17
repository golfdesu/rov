---
name: hpo-parsimony-selector
description: >-
  Audits Optuna HPO trial outputs in best_params/sota_rov_top5_trials.json and selects
  safe, parsimonious production hyperparameters using the 1% epsilon-tolerance rule
  (Hastie et al., 2009) and Overfit Gap analysis. Use this skill after running HPO or
  when selecting/updating hyperparameters in configs/selected_production_params.json.
---

# HPO Parsimony & Safety Selector Skill (`SKILL.parsimony`)

Use this skill to inspect `best_params/sota_rov_top5_trials.json` and update `configs/selected_production_params.json` without falling into validation overfitting traps.

---

## 1. Run the Automated Parsimony Selector

```bash
python .agents/skills/hpo-parsimony-selector/scripts/select_parsimonious_params.py
```

---

## 2. Selection Rules for RoVDraftGNNTransformer

Never blindly pick a high-capacity model (`d_model >= 256` or `augment_factor > 1`) if a smaller or better-regularized configuration achieves within `1.0%` of the minimum `val_loss`:

1. **Epsilon-Tolerance Threshold (`1.0%`)**:
   - Keep all candidate trials with `val_loss <= 1.01 * min_val_loss`.
2. **Overfit Gap Check (`overfit_gap = val_loss - train_pol_loss`)**:
   - Prefer trials with `overfit_gap <= 0.28` and `dropout >= 0.25`.
3. **Capacity Parsimony**:
   - On 4,208 pro games (64,008 training steps), `d_model = 128, nhead = 4, batch_size = 512, augment_factor = 1` dominates all 5 top ranks.
   - **Rank #1 (Trial #21)**: `num_layers = 2` (`776K` params, `Val Loss = 2.7470`, `WinAcc = 54.13%`) — Best compact parsimonious model.
   - **Rank #2 (Trial #10)**: `num_layers = 4` (`1.04M` params, `Val Loss = 2.7480`, `Overfit Gap = +0.2553`, `Top-1 = 23.85%`) — Best heavily-regularized (`weight_decay = 0.040`, `neural_scale = 0.275`) model.

---

## 3. Training with a Specific Rank from Top 5

To train `src/train_sota_model.py` using any of the Top 5 candidates in `best_params/sota_rov_top5_trials.json`:
```bash
# Train with the lowest-overfit-gap [SAFEST] candidate (Rank #2, Trial #10)
python src/train_sota_model.py --preset h100 --use-safest

# Or train with a specific rank (1 to 5), e.g., Rank #1 compact 2-layer model (Trial #21)
python src/train_sota_model.py --preset h100 --top-rank 1
```
