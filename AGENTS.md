# AGENTS.md — RoV Pro Draft Intelligence & SOTA GNN-Transformer Manual

Shared agent rules are imported below:

@~/.gemini/config/AGENTS.md

---

## Session Quick Start (Read First)

Repository: **RoV Pro Draft Intelligence** (`https://github.com/golfdesu/rov.git`).

### Current System Status
| Component | Status & Verified Metrics |
| :--- | :--- |
| **Hero & Skill Database** | **130 / 130 Heroes** (`data/heroes_130_full.json`, `data/heroes_130_summary.csv`, `data/hero_skills_full.json`) up to **Evita** (Oct 2026), **Tamyn** (Jul 2026), and **Flowborn (MM & Mage)**, each `>= 4` skills with numerical cooldown/mana, base damage, and AD/AP/HP scaling. |
| **Pro Match Archive** | **4,352 Complete Pro Games** (`data/matches_draft_full.json`) across RPL, APL, AIC, AOG, GCS (2024–2026) with Global Ban tracking and **0 unmapped hero names**. |
| **Curated Training Dataset** | **3,535 Games (2025–2026)** (`data/matches_training.json`). All 817 games from 2024 are strictly excluded to remove legacy meta noise; includes all 1,833 games from 2026 with 100% verified true pick order. **True Pick Order coverage = 51.9%** (1,833 / 3,535 games). |
| **Draft Web UI** | React 19 + Vite + Tailwind 4 (`frontend/`), served by FastAPI via `frontend/dist` (dev) or `frontend/dist-prod` (`VITE_DRAFT_ONLY=true` prod); 130 square icons (`frontend/public/avatars/`), Thai canonical names, Guest/Account portal (Username/Password, Google/Discord OAuth 2.0 PKCE, `/privacy`, `logo.png`). |
| **SOTA Architecture** | `RoVDraftGNNTransformer` (`src/train_sota_model.py`): Multi-Relational Hero GNN (`adj_copick`, `adj_synergy`, `adj_counter`, `adj_countered_by`) + Transformer + Bounded Neural Temperature Gate + Policy & Win Heads. |
| **H100 Optuna HPO** | 80 Policy-Focused Trials on ERAWAN HPC (`best_params/sota_rov_top5_trials.json`, `configs/selected_production_params.json`, 37-dim hero features, 90d recency decay, Global Ban context). |
| **Champion Performance** | (Selector 2026-11-20) **Served Val Loss = `2.81796`**, WinAcc = `51.69%` \| **HPO Rank #1 & Safest (Trial #31) Val = `2.76992`**, Gap = `+0.15773`, Top-1 = `24.70%`, Top-5 = `61.92%`, WinAcc = `51.18%`, `2,606,112` params. Always re-quote from the selector script (Rule 12). |

---

## 1. Hard Constraints & Anti-Bug Guardrails (NON-NEGOTIABLE)

Every AI agent (including fast models like `3.8flash`) MUST strictly obey these invariants:

1. **Liquipedia Pick Ordering Trap (`t1h1..t1h5`)**: `t1b1..t1b4` are chronological Bans (`Phase 1 = b1,b2`, `Phase 2 = b3,b4`), but `t1h1..t1h5` are in-game lanes (`DS_Lane, Jungle, Mid, Dragon_Lane, Roam`), NOT pick order. Always use `order_team_picks_by_draft_logic()` in `src/train_sota_model.py` for Phase 1 (`P1..P3`) vs Phase 2 (`P4..P5`).
2. **Data Augmentation Invariant (`augment_factor`)**: **NEVER** set `augment_factor > 2` or shuffle across Phase 1/2 (`Val Loss > 4.30`). Production & H100 HPO use `augment_factor = 1`.
3. **Locked SOTA Capacity**: Production architecture is locked to **`d_model = 256`, `num_layers = 1`, `nhead = 4`** (`head_dim = 64`, 2.47M params; sequence `<= 17` tokens, `>= 3` layers overfit). Edge CPU candidate is **`d_model = 128`, `num_layers = 1`, `nhead = 4`** (643K params).
4. **ERAWAN HPC (`compute4` H100)**: Require `#SBATCH --partition=gpu-h100` and `#SBATCH --gres=gpu:1`. **NEVER** call `torch.compile()` (no `Python.h`). Always use `GPUTensorBatcher` + vectorized `evaluate_sota_model()` (zero `.item()` loops).
5. **CLI Flag Naming (`predict_draft_cli.py`)**: Action flag is `--mode pick` or `--mode ban` (NOT `--action`).
6. **Linting & Frontend Rules**: Autonomously run `ruff check --fix .` and `ruff format .` after Python edits; for `frontend/` changes follow scoped `frontend/AGENTS.md` and run `npm run lint && npm run build`.
7. **Hero Canonical Names (Thai Server Default)**: Canonical default across `data/`, `models/`, `src/`, `frontend/` is Thai server naming (`Mortos`, `Celica`, `Riktor`, `Kaine`, `Stuart`, `Helen`). Aliases (`Arthur->Mortos`, `Brunhilda->Celica`, `Richter->Riktor`) normalize in `src/scrape_matches.py` and `src/predictor.py`. Regenerate icons only via `python scripts/fetch_hero_icons.py` (`frontend/public/hero_images.json`).
8. **Combat Calculator (`src/combat_calculator.py`)**: Mitigation is `600 / (600 + max(0, (def - flat_pierce) * (1 - pct_pierce)))`; only `ENCHANTMENT_EFFECTS` entries affect stats (never invent unverified values); base attack speed assumes `BASE_ATTACKS_PER_SEC = 1.0`.
9. **Changelog, Production Log, WikiSkill & English Docs**:
   - Read top entries of `CHANGELOG.md` before starting; prepend an entry at the TOP before finishing.
   - Before touching/deploying to `20.2.210.230` / `minidraft.app`, read `docs/PRODUCTION_RELEASES.md` and update it on release/hotfix; **never** run `git pull` on the VM for docs/wiki/tests/scripts-only commits.
   - Update `.wikiskill/wiki/` (and `.wikiskill/traces/` for major changes) when adding modules/tables/views; sync metrics via `python scripts/sync_metadata.py` and verify via `python .wikiskill/skills/scripts/preflight_check.py`.
   - **STRICT English Requirement**: All markdown docs, `CHANGELOG.md`, `docs/PRODUCTION_RELEASES.md`, and `SKILL.md` MUST be strictly in English.
10. **Off-Limits Folder (`data/vod_analytics/`)**: **NEVER** read, modify, delete, move, tidy, or propose work in `data/vod_analytics/` unless explicitly requested by the user in the current session.
11. **Reading Draft Screenshots (`data/draft_screenshots/`)**:
    - Captured at last hero lock BEFORE lane swaps: on-screen order is chronological (`B1..B5` / `R1..R5`), NOT HUD/lane order (`h1..h5`). **NEVER** bind player name under a screen slot to their Liquipedia `h1..h5` lane.
    - Path layout: `<tournament>/week<N>/<year>_w<week>_d<day>_m<match>_g<game>_<season>_<league>_<teamA>_vs_<teamB>.png` (e.g. `2026_rpl_winter/week1/2026_w1_d1_m1_g1_win_rpl_kog_vs_bru.png`), lowercase team codes (`kog`, `bru`, `gjc`, `hd`, `ten`, `fs`, `bac`, `ea`, `slx`). **Keep `<teamA>_vs_<teamB>` identical across G1–G5** (anchored on Game 1, never swap on side switch). Saigon Phantom = `sgp` (never `sp`), Supernova = `spn`.
    - Identify games by 10-hero set in `data/matches_draft_full.json` (+ screen title) and resolve blue/red per `series_id` + `game_number` there (never assume from filename). Rename unnamed captures into the matching folder.
    - Store in `data/true_pick_order.json` (`series_id`, `game_number`, `blue_picks`, `red_picks`, `source`, relative `screenshot`). Do not rewrite Liquipedia chronological bans.
    - **Left (Blue)** reads L->R; **Right (Red)** reads R->L (mirrored). Pick order: `B1 | R1 R2 | B2 B3 | R3 | (bans) | R4 | B4 B5 | R5`.
    - Verify portraits against `frontend/public/avatars/` (`frontend/public/hero_images.json`); hero set must match Liquipedia (flag mismatches; safe elimination only if 4 slots certain & 1 hidden).
12. **Skills Mirror & Metric Quoting**: Edit skills only in `.agents/skills/`, then mirror via `cp -r .agents/skills/. .claude/skills/` (`tests/test_skills_sync.py` enforces parity). End every skill with `**Related Skills**` (updating neighbors & Section 2 on additions). Always quote model metrics from `python .agents/skills/hpo-parsimony-selector/scripts/select_parsimonious_params.py`.
13. **Curated Training Dataset (`data/matches_training.json`)**: `data/matches_draft_full.json` (4,352 games) is archival (2024–2026). **STRICTLY FORBIDDEN to train production on 2024 data**: All 817 games from 2024 are excluded due to legacy meta noise. `data/matches_training.json` is active, containing **3,535 games strictly from 2025–2026** (1,702 from 2025 + 1,833 from 2026, through Nov 7, 2026 AOG Winter Finals) with **51.9% True Pick Order coverage** (1,833 / 3,535 games = 100% of 2026 games, verified from broadcast screenshots) — auto-loaded by `src/train_sota_model.py`. Regenerate only via `python src/build_training_dataset.py --min-year 2025`.
14. **Hero/Skill/Item Data Provenance (In-Game Screenshots Ground Truth)**: Exact hero level scalings (`data/hero_level_stats.*`, `hero_status_lv1.json`, `hero_status_lv15.json`), skills (`data/hero_skills_full.json`, 534 skills), and items (`data/items.json`, 114 items) come directly from **owner-captured in-game screenshots** (`heroes/*/skill/` 566, `heroes/*/status/` 268, `item/*/` 159). External wikis (Liquipedia/Fandom) were only a rough EN skeleton and are outdated; **always tell the truth** that these numbers come from owner in-game screenshots, never web scrapers.
15. **Open Free Launch, OAuth, Secrets & VM Sparse-Checkout Lock**:
    - `minidraft.app` is **100% free** (no paywalls/quotas unless owner initiates `docs/SUBSCRIPTION_ROADMAP.md`). Auth/state live in SQLite (`src/db.py` -> `data/rov_app.db` or `/app/db/rov_app.db`): `scrypt` Username/Password + Google & Discord OAuth 2.0 PKCE (`user_oauth_accounts`). Secrets (`ROV_GOOGLE_*`, `ROV_DISCORD_*`, JSON) stay in gitignored `.env` / `.secrets/` (`test_no_secrets_in_tracked_files`).
    - **Production VM Lock (`~/rov` on `20.2.210.230`)**: Uses `git sparse-checkout --no-cone` limited to `/Dockerfile`, `/.dockerignore`, `/requirements.txt`, `/deploy/**`, `/configs/**`, `/src/**`, `/frontend/**`, `/models/sota_draft_gnn_transformer.pt`, and the 11 serving `/data/*` files. **STRICTLY FORBIDDEN** to disable sparse-checkout, copy non-prod files (`tests/`, `scripts/`, `docs/`, `.wikiskill/`, `.agents/`, `.claude/`, `best_params/`, `models/archive/`, `models/*heuristic*`, `data/draft_screenshots/`), or `git pull` on VM for non-prod commits.

---

## 2. Repository Structure & Architecture

> Full directory map: [`docs/ARCHITECTURE_MAP.md`](file:///C:/Users/chaya/Documents/Program/Project/ROV/docs/ARCHITECTURE_MAP.md).

| Path | Purpose |
| :--- | :--- |
| `AGENTS.md` / `frontend/AGENTS.md` / `CHANGELOG.md` / `DESIGN.md` | Root & scoped agent rules, work log, UI design spec |
| `docs/PRODUCTION_RELEASES.md` / `docs/ARCHITECTURE_MAP.md` | Prod state & VM hotfix ledger; full file map |
| `.agents/skills/` (mirrored to `.claude/skills/`) | 10 skills: `rov-data-guardian`, `hpo-parsimony-selector`, `erawan-hpc-ops`, `rov-draft-serving`, `draft-screenshot-reader`, `security-audit`, `frontend-e2e-inspector`, `moba-meta-intel`, `regression-guard`, `arch-perf-auditor` |
| `.wikiskill/` | LLM Wiki (`wiki/INDEX.md`, `traces/`, `skills/scripts/`) |
| `src/` | FastAPI (`api.py`, `db.py`, `schemas.py`, `config.py`), Predictor/MCTS (`predictor.py`, `search/draft_mcts.py`), Combat Engine (`combat_calculator.py`, `skill_mechanics.py`), Trainer/HPO (`train_sota_model.py`, `hpo_sota_optuna.py`), scrapers/builders |
| `frontend/` | React 19 + TS + Vite + Tailwind 4 UI (`DraftBoardView`, `components/lab/`, `meta_lab/`, `tierlist/`, OAuth/Accounts; `dist/`, `dist-prod/`) |
| `data/` & `models/` & `configs/` & `best_params/` | 130 heroes, 534 skills, 114 items, 30 arcana, 33 enchantments, 4,352 pro games, 3,535 training games, `true_pick_order.json`, 130x130 matchups; served checkpoint, `selected_production_params.json`, HPO trials |
| `scripts/` (`+ scripts/archive/`), `deploy/`, `Dockerfile`, `tests/` | Pipelines (`discover_mechanical_matchups.py`, `sync_metadata.py`, `simulate_draft_selfplay.py`), Docker/Caddy prod configs, Pytest suite |

---

## 3. Common Development & Verification Commands

```bash
# 1. Automated tests & data/HPO/meta/regression/security/perf audits
pytest -v
python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py
python .agents/skills/hpo-parsimony-selector/scripts/select_parsimonious_params.py
python .agents/skills/regression-guard/scripts/audit_regression_guard.py
python .agents/skills/security-audit/scripts/audit_security.py
python .agents/skills/arch-perf-auditor/scripts/audit_arch_perf.py
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --tier-list --top 25
python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --emerging --top 15
python .wikiskill/skills/scripts/preflight_check.py
python .wikiskill/skills/scripts/validate_gating.py

# 2. CLI demo & SOTA training
python src/predict_draft_cli.py --demo
python src/train_sota_model.py --preset h100 --use-safest
python src/train_sota_model.py --preset h100 --top-rank 1

# 3. Backend / Frontend servers & QA
cd frontend && npm install && npm run lint && npm run build && cd ..
uvicorn src.api:app --reload --port 8000     # http://localhost:8000
cd frontend && npm run dev                   # http://localhost:3000 (hot reload)
python .agents/skills/frontend-e2e-inspector/scripts/audit_copy_i18n.py
python .agents/skills/frontend-e2e-inspector/scripts/inspect_frontend_e2e.py
python .agents/skills/frontend-e2e-inspector/scripts/audit_ux_ui.py

# 4. Python lint & format (Autonomous verification)
ruff check --fix . && ruff format .
```
