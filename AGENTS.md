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
| **Hero & Skill Database** | **130 / 130 Heroes** (`data/heroes_130_full.json`, `data/heroes_130_summary.csv`, `data/hero_skills_full.json`) up to **Evita** (Oct 2026), **Tamyn** (Jul 2026), and **Flowborn (Marksman & Mage)**, each with `>= 4` skills, 100% numerical cooldowns/mana arrays, base damage, and AD/AP/HP scaling. |
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

8. **Combat Calculator Data Gaps (`src/combat_calculator.py`)**:
   - Mitigation is `600 / (600 + max(0, (def - flat_pierce) * (1 - pct_pierce)))`; pierce is parsed from item passive text.
   - Only enchantments in `ENCHANTMENT_EFFECTS` affect numbers; values are parsed from descriptions and pending in-game verification. Never invent values for the rest.
   - `hero_level_stats.json` lacks attack speed/mana; base attack rate is assumed `BASE_ATTACKS_PER_SEC = 1.0`.

9. **Cross-Session Changelog (`CHANGELOG.md`)**:
   - Before starting work, read the top entries of `CHANGELOG.md` to learn what previous agents already did.
   - Before finishing any task that modified files, add a new entry at the TOP (date, time, agent, what was done, files, verification, open issues) following the format in that file.

10. **Off-Limits Folder (`data/vod_analytics/`)**:
    - This is the owner's paused WIP (VOD minimap rotation tracking).
    - **NEVER** read, modify, delete, move, clean up, or propose work on anything inside `data/vod_analytics/` unless the user explicitly mentions it first in the current session.
    - Do not "tidy" its large files (`*.mp4`, frame dumps); they are intentional and gitignored.

11. **Reading True Ban/Pick Order from Draft Screenshots (`data/draft_screenshots/`)**:
    - Screenshots are captured at the moment the LAST hero is locked, before players swap heroes into lanes. The on-screen slot order IS the true chronological order. Never treat them as in-game HUD / lane order.
    - **Liquipedia Lane Order vs Pre-Swap Broadcast Trap**: Liquipedia lists picks strictly by in-game lane (`h1 = DS_Lane`, `h2 = Jungle`, `h3 = Mid`, `h4 = Abyssal Dragon`, `h5 = Roam`). This uniquely distinguishes roles (e.g. when picking 2 tanks, `h1` is Offlane like Skud/Taara and `h5` is Support like Toro/Thane). However, screenshots are captured BEFORE hero swap: players pick high-priority heroes for teammates regardless of physical seat. **NEVER** bind the player name under a screen slot to their Liquipedia `h1..h5` lane! Screen slots represent ONLY pick sequence (`B1..B5` / `R1..R5`).
    - Layout: `data/draft_screenshots/<tournament>/week<N>/<year>_w<week>_d<day>_m<match>_g<game>_<season>_<league>_<teamA>_vs_<teamB>.png`, e.g. `2026_rpl_winter/week1/2026_w1_d1_m1_g1_win_rpl_kog_vs_bru.png` = RPL 2026 Winter, week 1, day 1, match 1, game 1. Tournaments use subfolders such as `2026_rpl_winter/` and `2026_rpl_summer/` (`<year>_<league>_<season>`). Team codes are lowercase (`kog`, `bru`, `gjc`, `hd`, `ten`, `fs`, `bac`, `ea`, `slx`).
    - Filenames are only a hint. Identify each game by its 10 picked heroes against `data/matches_draft_full.json` (every game's 10-hero set is unique) plus the on-screen title. Unnamed captures (e.g. `Screenshot <date> <time>.png`) must be identified this way, then renamed and moved into the right `<tournament>/week<N>/` folder.
    - Store results in `data/true_pick_order.json` (`series_id` + `game_number`, `blue_picks`/`red_picks` in true order, `source` = `screenshot`/`manual`, `screenshot` = path relative to `data/draft_screenshots/`). Liquipedia ban order is already chronological; do not "fix" it from the mirrored right side.
    - **Left side (first pick / blue)**: picks and bans read left -> right.
    - **Right side (second pick / red)**: picks and bans read right -> left (mirrored).
    - Teams swap sides between games. Find blue/red per game in `data/matches_draft_full.json` by `series_id` + `game_number`, never assume from the filename.
    - Pick turn order: B1 | R1 R2 | B2 B3 | R3 | (phase-2 bans) | R4 | B4 B5 | R5.
    - Identify heroes by comparing against `frontend/public/avatars/` (via `frontend/public/hero_images.json`). The hero set must match Liquipedia exactly. If it does not match, flag it instead of guessing. Safe elimination is only allowed when 4 slots are visually certain and only 1 hidden slot remains.

12. **Skills Live in `.agents/skills/` (Mirrored to `.claude/skills/`)**:
    - Edit skills only in `.agents/skills/`, then copy them over with `cp -r .agents/skills/. .claude/skills/`. `tests/test_skills_sync.py` fails if the two differ.
    - Quote model metrics from `python .agents/skills/hpo-parsimony-selector/scripts/select_parsimonious_params.py`, not from the status table above. As of 2026-10-21 the table and `configs/selected_production_params.json` describe an older run than the served checkpoint.

---

## 2. Repository Structure & Architecture

```text
ROV/
├── AGENTS.md                        # Master operational manual & guardrails for AI agents
├── CHANGELOG.md                     # Cross-session log of what each AI agent did (read first, append on finish)
├── CLAUDE.md                        # Pointer to @AGENTS.md
├── DESIGN.md                        # Draft UI design system (tokens, typography, layout)
├── Dockerfile                       # Multi-stage: builds frontend/, then FastAPI serving image
├── requirements.txt                 # Locked Python dependencies
├── run_hpo_rov_h100.sbatch          # SLURM job: Fast GPU-Resident Optuna HPO (40 trials) + Training
├── run_sota_rov_h100.sbatch         # SLURM job: Direct SOTA training on ERAWAN H100
├── .agents/
│   └── skills/                      # Progressive-disclosure workspace skills (SOURCE OF TRUTH)
│       ├── rov-data-guardian/       # Data integrity: 130 heroes, 4,208 matches, true_pick_order.json audit
│       ├── hpo-parsimony-selector/  # Top-5 HPO parsimony selector + served-checkpoint vs config check
│       ├── erawan-hpc-ops/          # ERAWAN HPC H100 SLURM, MLflow & Git sync runbook
│       ├── rov-draft-serving/       # CLI, FastAPI + web UI, golden test & pytest runbook
│       └── draft-screenshot-reader/ # Read true pick order from broadcast screenshots
├── .claude/
│   └── skills/                      # Copy of .agents/skills/ for Claude Code (kept in sync by tests/test_skills_sync.py)
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
│   ├── counter_matrix.csv           # Pairwise enemy counter matrix
│   ├── items.json                   # 114 items: rovmeta.com + patch-note overrides (numeric stats, price, passives)
│   ├── items_overrides.json         # Hand-maintained corrections from official Garena TH/TW patch notes
│   ├── hero_names_zh_tw.json        # Traditional Chinese -> canonical English hero name dictionary
│   ├── hero_patch_translations.json # Translation dictionary for patch note phrases & sentences
│   ├── hero_patch_history.json      # 334 historical balance adjustments across 92 heroes from TW patch notes
│   ├── hero_level_stats.json        # Exact level 1-15 stats table for all 130 heroes (JSON catalog)
│   ├── hero_level_stats.csv         # 1,950 row level 1-15 scaling table (130 heroes * 15 levels)
│   ├── hero_skills_full.json        # 525 structured hero skills with numerical cooldowns, mana costs & scalings
│   ├── arcana.json                  # 90 official Arcana runes (30 Red, 30 Purple, 30 Green across Tiers I-III)
│   └── enchantments.json            # 33 official Enchantments (พลังแฝง) across 4 factions (Veda, Lokheim, Afata, Humans)
├── frontend/                        # React 19 + Vite + Tailwind 4 draft UI (see frontend/README.md)
│   ├── src/                         # App, api/client.ts, hooks/useDraft.ts, components/ (Modal, Alert), utils/draft.ts (reducer)
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
│   ├── api.py                       # FastAPI endpoints (/health, /heroes, /draft/steps, /predict, /combat/*) + serves frontend/dist
│   ├── combat_calculator.py         # Stat builder (level+items+T3 arcana+enchantments), skill damage w/ mitigation, 1v1 duel sim
│   ├── train_sota_model.py          # SOTA RoVDraftGNNTransformer model & training pipeline
│   ├── hpo_sota_optuna.py           # Fast GPU-Resident Optuna HPO engine (saves Top 5 trials)
│   ├── predict_draft_cli.py         # CLI draft simulator & tournament scenario runner
│   ├── scrape_heroes.py             # Liquipedia 130-hero & skill scraper
│   ├── scrape_matches.py            # Liquipedia pro tournament match scraper
│   ├── build_draft_stats.py         # Lane distribution & synergy/counter matrix builder
│   └── train_draft_model.py         # Baseline Deep Sets + MLP trainer
├── scripts/
│   ├── fetch_hero_icons.py          # Square hero icons (rovmeta/Garena TH + Liquipedia overrides)
│   ├── fetch_items.py               # Item catalog from rovmeta.com -> data/items.json
│   ├── parse_tw_hero_patches.py     # Crawls Garena TW balance notices -> data/hero_patch_history.json
│   ├── build_hero_level_stats.py    # Builds 1-15 level stats scaling tables -> data/hero_level_stats.*
│   ├── download_rov_apk.py          # Garena RoV TH official APK/XAPK inspector & downloader
│   ├── build_hero_skills_catalog.py # Multi-source scraper/parser for 525 numerical hero skills, cooldowns & scalings
│   ├── fetch_arcana_and_enchantments.py # Scrapes 90 Arcana & 33 Enchantments from Garena TW & MediaWiki
│   └── simulate_draft_selfplay.py   # 18-step AI vs AI self-play draft simulation
└── tests/
    ├── test_data_integrity.py       # Verifies 130 heroes, skills, 4,208 match mappings, and item catalog
    ├── test_model_pipeline.py       # Verifies SOTA checkpoint, masking, and predictor output
    ├── test_api.py                  # Verifies FastAPI endpoints and the served frontend build
    ├── test_combat_calculator.py    # Verifies mitigation formula, stat stacking, CDR cap, arcana/enchantment rules, duel
    ├── test_predictor_golden.py     # Pins predict() output on 72 replayed pro-game states (fixtures/predict_golden.json)
    └── test_skills_sync.py          # Fails if .claude/skills/ drifts from .agents/skills/
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
