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
| **Pro Match Archive** | **4,352 Complete Pro Games** (`data/matches_draft_full.json`) from RPL, APL, AIC, AOG, and GCS (2024–2026) with Global Ban Pick tracking and **0 unmapped hero names**. |
| **Curated Training Dataset** | **3,535 Games (2025–2026)** (`data/matches_training.json`). All 817 games from 2024 are strictly excluded to remove legacy meta noise; includes all 1,833 games from 2026 with 100% verified true pick order. **True Pick Order coverage = 51.9%** (1,833 / 3,535 games). |
| **Draft Web UI** | React 19 + Vite + Tailwind 4 broadcast-style draft board (`frontend/`), served by FastAPI from `frontend/dist` (dev) or `frontend/dist-prod` (`VITE_DRAFT_ONLY=true` in production). 130 / 130 square hero icons (`frontend/public/avatars/`), Thai display names (Arthur -> Mortos, Brunhilda -> Celica, Richter -> Riktor), plus Guest/Account portal (Username/Password + Google & Discord OAuth 2.0 PKCE, `/privacy`, `logo.png`). |
| **SOTA Architecture** | `RoVDraftGNNTransformer` (`src/train_sota_model.py`): Multi-Relational Hero GNN (`adj_copick`, `adj_synergy`, `adj_counter`, `adj_countered_by`) + Sequence Transformer + Bounded Neural Temperature Gate + Dual Policy & Win-Value Heads. |
| **H100 Optuna HPO** | Completed 80 Policy-Focused Trials on ERAWAN HPC (`best_params/sota_rov_top5_trials.json`, `configs/selected_production_params.json`, 37-dim hero features, 90d recency decay, Global Ban context). |
| **Champion Performance** | (Selector output, 2026-11-20) **Served checkpoint Val Loss = `2.81796`**, WinAcc = `51.69%` \| **HPO Rank #1 & Safest (Trial #31) Val = `2.76992`**, Gap = `+0.15773`, Top-1 = `24.70%`, Top-5 = `61.92%`, WinAcc = `51.18%`, Params = `2,606,112` (130 heroes, 3,535 games from 2025 through Nov 17, 2026 AIC Wildcard, 90d recency decay). Always re-quote from the selector script (rule 12). |

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
3. **Model Capacity & Architecture Guardrail (Locked SOTA)**:
   - Verified on 50 HPO Trials (NVIDIA H100, 2026-10-30): Production architecture is strictly locked to **`d_model = 256`**, **`num_layers = 1`**, and **`nhead = 4`** (`head_dim = 64`, 2.47M parameters).
   - Sequence length is short (`<= 17` tokens); 1 Transformer layer provides 100% global receptive field across all draft turns. Deeper networks (`num_layers >= 3`) degrade generalization.
   - For resource-constrained or edge CPU inference, the parsimonious compact candidate is locked to **`d_model = 128`**, **`num_layers = 1`**, and **`nhead = 4`** (643K parameters).
4. **ERAWAN HPC (`compute4` H100) Rules**:
   - Partition MUST be `#SBATCH --partition=gpu-h100` with `#SBATCH --gres=gpu:1`.
   - **NEVER** call `torch.compile()` (Rocky Linux on `compute4` lacks `Python.h` headers).
   - Always use `GPUTensorBatcher` and vectorized `evaluate_sota_model()` (zero per-sample `.item()` loops on GPU).
5. **CLI Argument Naming (`predict_draft_cli.py`)**:
   - The CLI flag for action type is `--mode pick` or `--mode ban` (NOT `--action`).
6. **Code Quality & Automatic Linting Protocol (Ruff)**:
   - Whenever any code is written, updated, or refactored, the AI agent **MUST** autonomously run `ruff check --fix .` and `ruff format .` to maintain zero lint errors and consistent formatting before completing any task.
   - For frontend changes, also run `npm run build` and `npm run lint` in `frontend/`.
7. **Hero Canonical Names (Thai Server Default)**:
   - The API, data, and model use official Thai server hero names (`Mortos`, `Celica`, `Riktor`, `Kaine`, `Stuart`, `Helen`) as the canonical default across all files (`data/`, `models/`, `src/`, `frontend/`). Legacy Global/Liquipedia aliases (`Arthur -> Mortos`, `Brunhilda -> Celica`, `Richter -> Riktor`) are automatically normalized in `src/scrape_matches.py` and `src/predictor.py`.
   - Regenerate hero icons only with `python scripts/fetch_hero_icons.py` (keeps filenames in sync with `frontend/public/hero_images.json`).

8. **Combat Calculator Data Gaps (`src/combat_calculator.py`)**:
   - Mitigation is `600 / (600 + max(0, (def - flat_pierce) * (1 - pct_pierce)))`; pierce is parsed from item passive text.
   - Only enchantments in `ENCHANTMENT_EFFECTS` affect numbers; values are parsed from descriptions and pending in-game verification. Never invent values for the rest.
   - `hero_level_stats.json` lacks attack speed/mana; base attack rate is assumed `BASE_ATTACKS_PER_SEC = 1.0`.

9. **Cross-Session Changelog (`CHANGELOG.md`), Production Log (`docs/PRODUCTION_RELEASES.md`) & English Documentation Invariant**:
   - Before starting work, read the top entries of `CHANGELOG.md` to learn what previous agents already did.
   - Before touching or deploying to production (`20.2.210.230` / `minidraft.app`), read `docs/PRODUCTION_RELEASES.md` to check the live base commit, active VM hotfixes, and dev-only exclusions; update it whenever a production release or hotfix is deployed.
   - Before finishing any task that modified files, add a new entry at the TOP (date, time, agent, what was done, files, verification, open issues) following the format in that file.
   - **STRICT English Requirement**: All entries in `CHANGELOG.md`, `docs/PRODUCTION_RELEASES.md`, skill documentation (`SKILL.md`), agent notes, and repository markdown files MUST be authored strictly in English to maximize token efficiency and prevent semantic loss across LLM context windows.

10. **Off-Limits Folder (`data/vod_analytics/`)**:
    - This is the owner's paused WIP (VOD minimap rotation tracking).
    - **NEVER** read, modify, delete, move, clean up, or propose work on anything inside `data/vod_analytics/` unless the user explicitly mentions it first in the current session.
    - Do not "tidy" its large files (`*.mp4`, frame dumps); they are intentional and gitignored.

11. **Reading True Ban/Pick Order from Draft Screenshots (`data/draft_screenshots/`)**:
    - Screenshots are captured at the moment the LAST hero is locked, before players swap heroes into lanes. The on-screen slot order IS the true chronological order. Never treat them as in-game HUD / lane order.
    - **Liquipedia Lane Order vs Pre-Swap Broadcast Trap**: Liquipedia lists picks strictly by in-game lane (`h1 = DS_Lane`, `h2 = Jungle`, `h3 = Mid`, `h4 = Abyssal Dragon`, `h5 = Roam`). This uniquely distinguishes roles (e.g. when picking 2 tanks, `h1` is Offlane like Skud/Taara and `h5` is Support like Toro/Thane). However, screenshots are captured BEFORE hero swap: players pick high-priority heroes for teammates regardless of physical seat. **NEVER** bind the player name under a screen slot to their Liquipedia `h1..h5` lane! Screen slots represent ONLY pick sequence (`B1..B5` / `R1..R5`).
    - Layout: `data/draft_screenshots/<tournament>/week<N>/<year>_w<week>_d<day>_m<match>_g<game>_<season>_<league>_<teamA>_vs_<teamB>.png`, e.g. `2026_rpl_winter/week1/2026_w1_d1_m1_g1_win_rpl_kog_vs_bru.png` = RPL 2026 Winter, week 1, day 1, match 1, game 1. Tournaments use subfolders such as `2026_rpl_winter/` and `2026_rpl_summer/` (`<year>_<league>_<season>`). Team codes are lowercase (`kog`, `bru`, `gjc`, `hd`, `ten`, `fs`, `bac`, `ea`, `slx`).
    - **Canonical Match Team Naming Invariant**: In all screenshot filenames for a given series/match, `<teamA>_vs_<teamB>` MUST remain constant across all games of that match (anchored on Game 1's team order, e.g. `bru_vs_fs` for all G1–G5). NEVER swap team order across games when sides swap (do not use `fs_vs_bru`).
    - **Canonical Team Codes**: Saigon Phantom is strictly `sgp` (never `sp`), Supernova is `spn`.
    - Filenames are only a hint. Identify each game by its 10 picked heroes against `data/matches_draft_full.json` (every game's 10-hero set is unique) plus the on-screen title. Unnamed captures (e.g. `Screenshot <date> <time>.png`) must be identified this way, then renamed and moved into the right `<tournament>/week<N>/` folder.
    - Store results in `data/true_pick_order.json` (`series_id` + `game_number`, `blue_picks`/`red_picks` in true order, `source` = `screenshot`/`manual`, `screenshot` = path relative to `data/draft_screenshots/`). Liquipedia ban order is already chronological; do not "fix" it from the mirrored right side.
    - **Left side (first pick / blue)**: picks and bans read left -> right.
    - **Right side (second pick / red)**: picks and bans read right -> left (mirrored).
    - Teams swap sides between games. Find blue/red per game in `data/matches_draft_full.json` by `series_id` + `game_number`, never assume from the filename.
    - Pick turn order: B1 | R1 R2 | B2 B3 | R3 | (phase-2 bans) | R4 | B4 B5 | R5.
    - Identify heroes by comparing against `frontend/public/avatars/` (via `frontend/public/hero_images.json`). The hero set must match Liquipedia exactly. If it does not match, flag it instead of guessing. Safe elimination is only allowed when 4 slots are visually certain and only 1 hidden slot remains.

12. **Skills Live in `.agents/skills/` (Mirrored to `.claude/skills/`)**:
    - Edit skills only in `.agents/skills/`, then copy them over with `cp -r .agents/skills/. .claude/skills/`. `tests/test_skills_sync.py` fails if the two differ.
    - Quote model metrics from `python .agents/skills/hpo-parsimony-selector/scripts/select_parsimonious_params.py`, not from the status table above. As of 2026-11-18 the table was re-synced to the selector output (served checkpoint val_loss 2.76695; `configs/selected_production_params.json` = Trial #00 rank #1 & safest, updated 2026-11-18).
    - Every skill ends with a **Related Skills** section. When adding or renaming a skill, update the Related Skills sections of its neighbors and the skill list in Section 2 below.

13. **Curated Training Dataset & 2024 Exclusion Invariant (`data/matches_training.json`)**:
    - `data/matches_draft_full.json` (4,352 games) is the historical archival repository (2024–2026).
    - **STRICTLY FORBIDDEN to train the production model on 2024 data**. All 817 games from 2024 are excluded because legacy meta noise and obsolete hero priorities (e.g., pre-rework Wonder Woman, obsolete 2024 Erin dynamics) degrade model performance on the current meta.
    - The active training dataset is `data/matches_training.json` containing **3,535 games strictly from 2025–2026** (1,702 from 2025 + 1,833 from 2026, through the AOG 2026 Winter Finals on Nov 7, 2026) with **51.9% True Pick Order coverage** (1,833 / 3,535 games = 100% of 2026 games, verified from broadcast screenshots).
    - `src/train_sota_model.py` automatically defaults to `data/matches_training.json` whenever it exists.
    - Regenerate the training set only with (reproduces the current file exactly; add `--max-date YYYY-MM-DD` only for a deliberate hold-out):
      `python src/build_training_dataset.py --min-year 2025`

14. **Hero Status, Skills & Item Data Provenance Invariant (User In-Game Screenshots as Ground Truth)**:
    - **Single Source of Ground Truth**: The exact numerical stats for hero level scalings (Lv. 1 to Lv. 15 in `data/hero_level_stats.*`, `data/hero_status_lv1.json`, `data/hero_status_lv15.json`), structured skill attributes, cooldowns, scalings (`data/hero_skills_full.json`, 534 skills), and item attributes (`data/items.json`, 114 items) originate directly from **the project owner's manual in-game screenshots** stored in `heroes/*/skill/` (566 screenshots), `heroes/*/status/` (268 screenshots), and `item/*/` (159 screenshots).
    - **Web Scraping Limitation**: External web sources (such as Liquipedia or AoV Fandom) were only used as an initial rough English text skeleton. Online wikis are notoriously outdated, riddled with incorrect numbers, and out of sync with the official Thai server client.
    - **Strict Agent Truthfulness Rule**: In all sessions, whenever an AI agent is asked where hero stats, level scaling, skills, or items came from, the agent **MUST ALWAYS tell the truth**: they were manually captured in-game by the project owner through screenshots, which served as the definitive ground truth to correct and override external wikis. Never attribute these numbers to automated web scrapers.

15. **Open Free Launch, Multi-Provider OAuth & Secret Hygiene**:
    - `minidraft.app` is currently **100% free for all users** (do NOT add paywalls or prediction quotas unless the owner explicitly initiates the future monetization phase documented in `docs/SUBSCRIPTION_ROADMAP.md`).
    - Multi-user accounts and per-user draft/combat state live in SQLite (`src/db.py` -> `data/rov_app.db` locally or `ROV_DB_PATH=/app/db/rov_app.db` in Docker), supporting Username/Password (`scrypt`) plus optional Google and Discord OAuth 2.0 + PKCE (`user_oauth_accounts`).
    - OAuth credentials (`ROV_GOOGLE_*`, `ROV_DISCORD_*`) and raw client JSON files MUST stay strictly inside gitignored `.env` and `.secrets/` — never commit secrets or tracked `*env*` filenames (`tests/test_security.py::test_no_secrets_in_tracked_files`).

---

## 2. Repository Structure & Architecture

> **Full File-by-File Map**: Read **[`docs/ARCHITECTURE_MAP.md`](file:///C:/Users/chaya/Documents/Program/Project/ROV/docs/ARCHITECTURE_MAP.md)** for the complete directory tree across `src/`, `frontend/src/`, `data/`, `scripts/`, `scripts/archive/`, `tests/`, `deploy/`, and `.agents/skills/` (kept compact here so `AGENTS.md` never truncates in agent context windows).

| Path | Purpose |
| :--- | :--- |
| `AGENTS.md` / `CHANGELOG.md` / `DESIGN.md` | Master agent rules, cross-session work log (read top entries first, prepend on finish), and UI design system |
| `docs/PRODUCTION_RELEASES.md` | Live production (`minidraft.app`) state, VM hotfix ledger, dev-only exclusions, and deploy history |
| `docs/ARCHITECTURE_MAP.md` | Complete file-by-file repository & architecture map (read when locating files) |
| `.agents/skills/` (mirrored to `.claude/skills/`) | 9 workspace skills: `rov-data-guardian`, `hpo-parsimony-selector`, `erawan-hpc-ops`, `rov-draft-serving`, `draft-screenshot-reader`, `security-audit`, `frontend-e2e-inspector`, `moba-meta-intel`, `regression-guard` |
| `src/` | FastAPI (`api.py`), SQLite auth/state (`db.py`), Pydantic schemas (`schemas.py`), config (`config.py`), SOTA predictor (`predictor.py`, `search/draft_mcts.py`), Combat Engine (`combat_calculator.py`, `skill_mechanics.py`), SOTA trainer & HPO (`train_sota_model.py`, `hpo_sota_optuna.py`), data builders & scrapers |
| `frontend/` | React 19 + TypeScript + Vite + Tailwind 4 draft board (`DraftBoardView`), Combat Lab (`components/lab/`), Matrix Sandbox (`meta_lab/`), Tier List (`tierlist/`), and OAuth/Account portal (`dist/` dev, `dist-prod/` prod) |
| `data/` | 130 heroes, 534 skills, 114 items, 30 T3 arcana, 33 enchantments, 4,340 pro games (`matches_draft_full.json`), 3,523 curated 2025–2026 training games (`matches_training.json`), 1,821 screenshot pick orders (`true_pick_order.json`), 130x130 combat matchups (`mechanical_matchups_130x130.csv`, `counter_item_flips.csv`) |
| `models/` & `configs/` & `best_params/` | Served `sota_draft_gnn_transformer.pt` checkpoint, `selected_production_params.json`, and H100 Optuna HPO trials |
| `scripts/` (`+ scripts/archive/`) | Active pipelines (`discover_mechanical_matchups.py`, `sync_metadata.py`, `simulate_draft_selfplay.py`, `fetch_*`, `build_*`) + archived one-off patch scripts |
| `deploy/` & `Dockerfile` | Production multi-stage Docker build, `docker-compose.yml`, and `Caddyfile` reverse proxy |
| `tests/` | Full Pytest suite (`test_data_integrity.py`, `test_model_pipeline.py`, `test_api.py`, `test_combat_calculator.py`, `test_predictor_golden.py`, `test_rl_search.py`, `test_security.py`, `test_skills_sync.py`) |

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

# 8. Regression guard: 72 golden draft states + 3 combat duel benchmarks
python .agents/skills/regression-guard/scripts/audit_regression_guard.py

# 9. Frontend bundle, avatar, and media endpoint audit (after npm run build)
python .agents/skills/frontend-e2e-inspector/scripts/inspect_frontend_e2e.py

# 10. Security audit (path traversal, pickle safety, input bounds, secrets)
python .agents/skills/security-audit/scripts/audit_security.py

# 11. Patch-aware meta intelligence (tier list with hero_tier_overrides.json, emerging heroes)
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --tier-list --top 25
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --emerging --top 15
```