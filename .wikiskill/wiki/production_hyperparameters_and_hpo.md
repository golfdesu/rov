# Production Hyperparameters & HPO Parsimony Selection

Hyperparameter optimization for `RoVDraftGNNTransformer` is executed on ERAWAN HPC (NVIDIA H100) via `src/hpo_sota_optuna.py` and curated via the **1% epsilon-tolerance parsimony rule** (Hastie et al., 2009; Breiman et al., 1984) inside `.agents/skills/hpo-parsimony-selector/`.

> **Quote-Sync Rule**: Always verify live metrics by running `python .agents/skills/hpo-parsimony-selector/scripts/select_parsimonious_params.py` rather than relying on stale static notes.

---

## 1. Current Study & Dataset Configuration (`configs/selected_production_params.json`)

- **Dataset**: `3,535` curated 2025–2026 pro games (`3,004` train / `531` val, `130` heroes).
- **Feature & Context Settings**:
  - `hero_feat_dim = 37`
  - `recency_half_life = 90.0` days (continuous temporal decay weighting recent 2026 patches higher)
  - `use_global_ban_context = true`
  - Search budget: `80` policy-focused Optuna trials (`14` epochs/trial, total `1,228.89s`).

---

## 2. Served Checkpoint vs HPO Rank #1 / Safest (`Trial #31`)

| Metric | Served Checkpoint (`models/sota_draft_gnn_transformer.pt`) | HPO Rank #1 & Safest (`Trial #31`) |
| :--- | :--- | :--- |
| **Validation Loss** | `2.81796` | **`2.76992`** |
| **Train Policy Loss** | — | `2.61219` |
| **Overfit Gap** | — | **`+0.15773`** |
| **Top-1 / Top-3 / Top-5 / Top-10** | — | `24.70%` / `48.16%` / `61.92%` / `79.89%` |
| **Win Accuracy (`WinAcc`)** | `51.69%` (TermWin `53.48%`) | `51.18%` |
| **Parameters** | `2,606,112` | `2,606,112` |

Because `Trial #31` achieved both the lowest validation loss (`2.76992`) and the smallest overfit gap (`+0.15773`) in the 80-trial study, `selected_for_production_safest` and `selected_for_production_rank1` both point to `Trial #31`.

---

## 3. Selected Production Hyperparameters (`Trial #31`)

| Hyperparameter | Value | Guardrail Status |
| :--- | :--- | :--- |
| `d_model` | `256` | Locked SOTA capacity |
| `nhead` | `4` | Locked (`head_dim = 64`) |
| `num_layers` | `1` | Locked (100% global receptive field for `<= 17` tokens) |
| `augment_factor` | `1` | Locked (`<= 2`; `1` swept all Top 5 ranks) |
| `batch_size` | `512` | GPU-resident batcher |
| `dropout` | `0.31345473633753024` | Strong regularization against draft memorization |
| `neural_scale` | `1.3467303190079796` | Bounded neural temperature gate scale |
| `lr` | `0.0012116455172192443` | AdamW learning rate |
| `weight_decay` | `0.0007868784193377809` | L2 regularization |
| `label_smoothing` | `0.05283479855440725` | Policy target smoothing |
| `win_loss_weight` | `0.14066028810867318` | Auxiliary terminal win-value loss weight |

For constrained edge/CPU deployments, the compact fallback architecture is locked to `d_model = 128`, `num_layers = 1`, `nhead = 4` (`643K` parameters).

---

## Related Wiki Articles

- [`erawan_hpc_playbook.md`](erawan_hpc_playbook.md)
- [`draft_invariants_and_pitfalls.md`](draft_invariants_and_pitfalls.md)
- [`../traces/h100_hpo_and_training_trace.md`](../traces/h100_hpo_and_training_trace.md)
