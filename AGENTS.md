# AGENTS.md — RoV Pro Draft Intelligence & SOTA GNN-Transformer Manual

Shared agent rules are imported below:

@~/.gemini/config/AGENTS.md

---

## Session Quick Start (Read First — Critical for All AI Agents)

Welcome to the **RoV (Arena of Valor) Pro Draft Intelligence** repository (`https://github.com/golfdesu/rov.git`).
This repository follows Big Tech Machine Learning Engineering standards (modeled after `../MLE_zero_to_hero`, `../../Practice/hyperparameter_tuning`, and `../../Practice/model`).

### Current System Status
| Component | Status & Verified Metrics |
| :--- | :--- |
| **Hero & Skill Database** | **130 / 130 Heroes** (`data/heroes_130_full.json`, `data/heroes_130_summary.csv`) up to **Evita** (Oct 2026), **Tamyn** (Jul 2026), and **Flowborn (Marksman & Mage)**, each with `>= 4` skills and 10 combat capability flags. |
| **Pro Match Dataset** | **4,208 Complete Pro Games** (`data/matches_draft_full.json`) from RPL, APL, AIC, AOG, and GCS (2024–2026) with Global Ban Pick tracking and **0 unmapped hero names**. |
| **Draft Web UI** | React 19 + Vite + Tailwind 4 broadcast-style draft board (`frontend/`), served by FastAPI from `frontend/dist`. 130 / 130 square hero icons (`frontend/public/avatars/`), Thai display names (Arthur -> Mortos, Brunhilda -> Celica, Richter -> Riktor). |
| **SOTA Architecture** | `RoVDraftGNNTransformer` (`src/train_sota_model.py`): 2-Layer Multi-Relational Hero GNN (`adj_copick`, `adj_synergy`, `adj_counter`, `adj_countered_by`) + Sequence Transformer + Bounded Neural Temperature Gate + Dual Policy & Win-Value Heads. |
| **H100 Optuna HPO** | Completed 40 Trials on ERAWAN HPC H100 (`best_params/sota_rov_top5_trials.json`, `configs/selected_production_params.json`). |
| **Champion Performance** | **Val Loss = `2.7470–2.7480`** \| **Top-1 = `23.85%`** \| **Top-3 = `49.07%`** \| **Top-5 = `64.22%`** \| **Top-10 = `81.32%`** \| **WinAcc = `54.13%`** (Out of 130 Heroes). |

---

## 1. Hard Constraints & Anti-Bug Guardrails (NON-NEGOTIABLE)

Every AI agent (including fast models such as `3.8flash`) MUST strictly obey these invariants:

1. **Liquipedia Pick Ordering Trap (`t1h1..t1h5`)**:
   - In Liquipedia match data, `t1b1..t1b4` are chronological Bans (Phase 1 = `b1, b2`, Phase 2 = `b3, b4`).
   - However, `t1h1..t1h5` are ordered by the **5 in-game lanes** (`h1 = DS_Lane`, `h2 = Jungle`, `h3 = Mid`, `h4 = Dragon_Lane`, `h5 = Roam`), **NOT** chronological pick order!
   - Always use `order_team_picks_by_draft_logic()` in `src/train_sota_model.py` to reconstruct Phase 1 (`P1..P3`) vs Phase 2 (`P4..P5`) pick sequences.
2. **Data Augmentation Invariant (`augment_factor`)**:
   - **NEVER** set `augment_factor > 2` or shuffle picks across Phase 1 and Phase 2 boundaries. Doing so causes severe overfitting (`Val Loss > 4.30`).
   - In production and H100 HPO, `augment_factor = 1` won all Top 5 ranks.
3. **Model Capacity & Regularization Guardrail**:
   - On 4,208 games (`64,008` training decision steps), `d_model = 128`, `nhead = 4`, `batch_size = 512`, `dropout = 0.27–0.30`, and `neural_scale = 0.27–0.51` is the verified Pareto optimum.
   - Do NOT increase `d_model` to `256+` without running Optuna HPO verification.
4. **ERAWAN HPC (`compute4` H100) Rules**:
   - Partition MUST be `#SBATCH --partition=gpu-h100` with `#SBATCH --gres=gpu:1`.
   - **NEVER** call `torch.compile()` (Rocky Linux on `compute4` lacks `Python.h` headers).
   - Always use `GPUTensorBatcher` and vectorized `evaluate_sota_model()` (zero per-sample `.item()` loops on GPU).
5. **CLI Argument Naming (`predict_draft_cli.py`)**:
   - The CLI flag for action type is `--mode pick` or `--mode ban` (NOT `--action`).
6. **Code Quality & Automatic Linting Protocol (Ruff)**:
   - Whenever any code is written, updated, or refactored, the AI agent **MUST** autonomously run `ruff check --fix .` and `ruff format .` to maintain zero lint errors and consistent formatting before completing any task.
   - For frontend changes, also run `npm run build` and `npm run lint` in `frontend/`.
7. **Hero Display Names vs Canonical Names**:
   - The API, data, and model always use canonical names (`Arthur`, `Brunhilda`, `Richter`). Thai server names are display-only, in `frontend/src/utils/heroNames.ts`. Never rename heroes in `data/` or the checkpoint.
   - Regenerate hero icons only with `python scripts/fetch_hero_icons.py` (keeps filenames in sync with `frontend/public/hero_images.json`).

---

## 2. Repository Structure & Architecture

```text
ROV/
├── AGENTS.md                        # Master operational manual & guardrails for AI agents
├── CLAUDE.md                        # Pointer to @AGENTS.md
├── DESIGN.md                        # Draft UI design system (tokens, typography, layout)
├── Dockerfile                       # Multi-stage: builds frontend/, then FastAPI serving image
├── requirements.txt                 # Locked Python dependencies
├── run_hpo_rov_h100.sbatch          # SLURM job: Fast GPU-Resident Optuna HPO (40 trials) + Training
├── run_sota_rov_h100.sbatch         # SLURM job: Direct SOTA training on ERAWAN H100
├── .agents/
│   └── skills/                      # Progressive-disclosure workspace skills
│       ├── rov-data-guardian/       # Data integrity & 130-hero / 4,208-match audit skill
│       ├── hpo-parsimony-selector/  # Top-5 HPO parsimony & overfit-gap selector skill
│       ├── erawan-hpc-ops/          # ERAWAN HPC H100 SLURM & Git sync runbook
│       └── rov-draft-serving/       # CLI simulation, FastAPI serving & pytest runbook
├── configs/
│   └── selected_production_params.json  # Curated production hyperparameters (Safest & Compact)
├── best_params/
│   ├── sota_rov_best_params.json    # Raw Optuna HPO best output from ERAWAN H100
│   └── sota_rov_top5_trials.json    # Top 5 HPO candidates with Overfit Gap & safety metrics
├── data/
│   ├── heroes_130_full.json         # Full 130 RoV heroes + skills + capability flags
│   ├── heroes_130_summary.csv       # Tabular summary of all 130 heroes
│   ├── matches_draft_full.json      # 4,208 pro tournament draft games (2024–2026)
│   ├── matches_draft_flat.csv       # Flattened match draft table
│   ├── hero_draft_stats.csv         # 5-lane distributions, pick/ban/win/presence rates
│   ├── synergy_matrix.csv           # Pairwise ally synergy matrix
│   └── counter_matrix.csv           # Pairwise enemy counter matrix
├── frontend/                        # React 19 + Vite + Tailwind 4 draft UI (see frontend/README.md)
│   ├── src/                         # App, hooks/useDraft.ts, components/, utils/heroNames.ts
│   └── public/
│       ├── avatars/                 # 130 square 160x160 hero icons
│       └── hero_images.json         # Hero name -> /avatars/<file> (also read by src/api.py)
├── models/
│   ├── sota_draft_gnn_transformer.pt # Production SOTA RoVDraftGNNTransformer checkpoint
│   └── draft_predictor.pt           # Baseline Deep Sets + MLP checkpoint
├── src/
│   ├── __init__.py
│   ├── config.py                    # Centralized OOP configuration (PathConfig, DraftModelConfig)
│   ├── schemas.py                   # Pydantic V2 request/response validation schemas
│   ├── predictor.py                 # Production OOP inference engine (RoVDraftPredictor)
│   ├── api.py                       # FastAPI endpoints (/health, /heroes, /draft/steps, /predict) + serves frontend/dist
│   ├── train_sota_model.py          # SOTA RoVDraftGNNTransformer model & training pipeline
│   ├── hpo_sota_optuna.py           # Fast GPU-Resident Optuna HPO engine (saves Top 5 trials)
│   ├── predict_draft_cli.py         # CLI draft simulator & tournament scenario runner
│   ├── scrape_heroes.py             # Liquipedia 130-hero & skill scraper
│   ├── scrape_matches.py            # Liquipedia pro tournament match scraper
│   ├── build_draft_stats.py         # Lane distribution & synergy/counter matrix builder
│   └── train_draft_model.py         # Baseline Deep Sets + MLP trainer
├── scripts/
│   ├── fetch_hero_icons.py          # Square hero icons (rovmeta/Garena TH + Liquipedia overrides)
│   └── simulate_draft_selfplay.py   # 18-step AI vs AI self-play draft simulation
└── tests/
    ├── test_data_integrity.py       # Verifies 130 heroes, skills, and 4,208 match mappings
    ├── test_model_pipeline.py       # Verifies SOTA checkpoint, masking, and predictor output
    └── test_api.py                  # Verifies FastAPI endpoints and the served frontend build
```

---

## 3. Common Development & Verification Commands

```bash
# 1. Run all automated tests (Data + Model + FastAPI)
pytest -v

# 2. Run Data Guardian integrity check
python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py

# 3. Inspect Top-5 HPO Parsimony & Safety Leaderboard
python .agents/skills/hpo-parsimony-selector/scripts/select_parsimonious_params.py

# 4. Run CLI draft demo scenarios
python src/predict_draft_cli.py --demo

# 5. Train SOTA model with Safest HPO candidate (Rank #2) or Compact candidate (Rank #1)
python src/train_sota_model.py --preset h100 --use-safest
python src/train_sota_model.py --preset h100 --top-rank 1

# 6. Build the web UI, then start FastAPI (UI at http://localhost:8000)
cd frontend && npm install && npm run build && cd ..
uvicorn src.api:app --reload --port 8000

# 6b. Frontend dev server with hot reload (http://localhost:3000, proxies API to :8000)
cd frontend && npm run dev

# 7. Lint and format check (Autonomous verification)
ruff check --fix .
ruff format .
```
