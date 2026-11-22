# Trace: H100 Optuna HPO & True Pick Order Experiments

This trace records the empirical findings from ERAWAN HPC H100 optimization and the True Pick Order vs Heuristic Order ablation.

---

## 1. 80-Trial Policy-Focused HPO (`best_params/sota_rov_top5_trials.json`)

- **Run Metadata**: `80` Optuna trials, `14` epochs/trial, total wall time `1,228.89s` (`~20.5m`) on NVIDIA H100 80GB.
- **Study Configuration**: `hero_feat_dim = 37`, `recency_half_life = 90.0` days, `use_global_ban_context = true`, `3,535` games (`3,004` train / `531` val).
- **Top Candidates Comparison**:
  - **Rank #1 & Safest (`Trial #31`)**: `val_loss = 2.76992`, `train_pol_loss = 2.61219`, `overfit_gap = +0.15773`, `best_epoch = 6`, `Top-1 = 24.70%`, `Top-3 = 48.16%`, `Top-5 = 61.92%`, `Top-10 = 79.89%`, `WinAcc = 51.18%`, `num_params = 2,606,112`, `batch_size = 512`, `augment_factor = 1`.
  - **Rank #2 (`Trial #3`)**: `val_loss = 2.77099`, `train_pol_loss = 2.58288`, `overfit_gap = +0.18812`, `best_epoch = 6`, `Top-1 = 24.03%`, `Top-5 = 61.54%`, `WinAcc = 51.18%`, `batch_size = 1024`, `augment_factor = 1`.
  - **Rank #3 (`Trial #64`)**: `val_loss = 2.78491`, `train_pol_loss = 2.61202`, `overfit_gap = +0.17289`, `Top-1 = 23.49%`, `Top-5 = 61.56%`.
- **Key Takeaway**: Every single top candidate converged on `d_model = 256`, `nhead = 4`, `num_layers = 1`, and `augment_factor = 1`. Higher dropout (`~0.313`) in Trial #31 suppressed the overfit gap to `+0.15773` while achieving the highest Top-1 (`24.70%`) and Top-5 (`61.92%`).

---

## 2. Heuristic 0% True Pick Order Ablation (`best_params/heuristic_sota_top5_trials.json`)

- **Purpose**: Evaluated how `RoVDraftGNNTransformer` behaves when trained on `data/matches_training_heuristic.json` (0% screenshot-verified pick order; relies purely on `order_team_picks_by_draft_logic()` lane heuristics).
- **Run Metadata**: `50` Optuna trials, `585.43s` on H100 (`num_params = 2,468,896`).
- **Results**:
  - Rank #1 (`Trial #1`): `val_loss = 2.7586`, `overfit_gap = 0.40037`, `Top-1 = 23.76%`, `Top-5 = 61.62%`, `WinAcc = 50.91%`.
  - Safest (`Trial #43`, Rank #5): `val_loss = 2.77981`, `overfit_gap = 0.18729`, `Top-1 = 22.85%`, `Top-5 = 60.16%`, `WinAcc = 49.86%`.
- **Key Takeaway**: Without screenshot-verified true pick orders, models memorized artificial lane-order patterns (`overfit_gap = 0.40` on Rank #1) and lost Top-1/WinAcc fidelity compared to the 51.9% true-order dataset.
