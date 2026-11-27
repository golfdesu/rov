# RoV Pro Draft Intelligence — Complete Repository & Architecture Map

> [!IMPORTANT]
> **AI Agent Navigation Index (Progressive Disclosure)**
> Referenced by [AGENTS.md](file:///C:/Users/chaya/Documents/Program/Project/ROV/AGENTS.md). Read this file when locating modules, datasets, frontend components, scripts, or test suites.

---

## 1. Full Directory & File Tree

```text
ROV/
├── AGENTS.md                        # Master operational manual & guardrails for AI agents
├── CHANGELOG.md                     # Cross-session log of what each AI agent did (read first, append on finish)
├── CLAUDE.md                        # Pointer to @AGENTS.md
├── DESIGN.md                        # Draft UI design system (tokens, typography, layout)
├── Dockerfile                       # Multi-stage: builds frontend/, then FastAPI serving image
├── pyproject.toml                   # Ruff & Pytest configuration
├── requirements.txt                 # Locked Python dependencies
├── run_hpo_rov_h100.sbatch          # SLURM job: Fast GPU-Resident Optuna HPO (40 trials) + Training
├── run_sota_rov_h100.sbatch         # SLURM job: Direct SOTA training on ERAWAN H100
├── run_hpo_heuristic_h100.sbatch    # SLURM job: 0% true pick order heuristic baseline HPO
├── .agents/
│   └── skills/                      # Progressive-disclosure workspace skills (SOURCE OF TRUTH)
│       ├── rov-data-guardian/       # Data integrity: 130 heroes, 4,352 matches, true_pick_order.json & tier overrides audit
│       ├── hpo-parsimony-selector/  # Top-5 HPO parsimony selector + served-checkpoint vs config check
│       ├── erawan-hpc-ops/          # ERAWAN HPC H100 SLURM, MLflow & Git sync runbook
│       ├── rov-draft-serving/       # CLI, FastAPI + web UI, golden test & pytest runbook
│       ├── draft-screenshot-reader/ # Read true pick order from broadcast screenshots
│       ├── security-audit/          # Cloudflare-based 5-phase security auditing & threat verification
│       ├── frontend-e2e-inspector/  # UI & asset verification: React 19 draft board, combat modals & hero media
│       ├── moba-meta-intel/         # Esports tournament intelligence CLI (tier lists, flex picks, duo synergies)
│       └── regression-guard/        # Regression testing: 72 golden draft states & combat duel simulation stability
├── .claude/
│   └── skills/                      # Copy of .agents/skills/ for Claude Code (kept in sync by tests/test_skills_sync.py)
├── .wikiskill/                      # 3-Layer LLM Wiki (Google Research WikiSkill)
│   ├── wiki/                        # Compiled knowledge articles (INDEX.md, architecture, invariants, HPO, HPC, combat, prod UI)
│   ├── traces/                      # Empirical H100 HPO and production cutover/UX traces
│   └── skills/                      # SKILL.md + scripts/ (preflight_check.py, validate_gating.py)
├── configs/
│   └── selected_production_params.json  # Curated production hyperparameters (Safest & Compact)
├── best_params/
│   ├── sota_rov_best_params.json    # Raw Optuna HPO best output from ERAWAN H100
│   ├── sota_rov_top5_trials.json    # Top 5 HPO candidates with Overfit Gap & safety metrics
│   └── heuristic_sota_*.json        # H100 HPO results for the 0% true pick order heuristic experiment model
├── deploy/
│   ├── Caddyfile                    # Reverse proxy TLS + security headers -> app:8000
│   └── compose.yaml                 # Production Compose stack (app + Caddy + persistent /app/db volume)
├── docs/
│   ├── ARCHITECTURE_MAP.md          # Complete file-by-file repository & architecture index (this file)
│   ├── PRODUCTION_RELEASES.md       # Live production (minidraft.app) commit snapshot, bundle ledger & deploy history
│   ├── MECHANICAL_MATCHUP_DISCOVERY.md # 130x130 combat simulation matchup & counter-item flip report
│   ├── COMPETITORS.md               # Competitive landscape vs other draft tools
│   └── ROADMAP.md                   # Product, subscription tiers, completed checklist & future backlog
├── data/
│   ├── dataset_metadata.json        # Auto-generated SSOT metrics (matches, heroes, skills, true order %)
│   ├── heroes_130_full.json         # Full 130 RoV heroes + skills + capability flags
│   ├── heroes_130_summary.csv       # Tabular summary of all 130 heroes
│   ├── matches_training.json        # Curated training set: 3,535 games (2025–2026 only, 2024 excluded, 51.9% true order)
│   ├── matches_training_heuristic.json # 0% true pick order experiment set (3,483 games, lane-heuristic order only)
│   ├── matches_draft_full.json      # Full historical archive: 4,352 pro tournament draft games (2024–2026)
│   ├── matches_draft_flat.csv       # Flattened match draft table
│   ├── true_pick_order.json         # 1,833 screenshot-verified chronological pick orders (draft-screenshot-reader)
│   ├── screenshots_manifest.json    # Hero skill/status & item card screenshot manifest (scripts/build_screenshots_manifest.py)
│   ├── hero_tier_overrides.json     # Hand-maintained tiers for low-sample/new/reworked heroes (src/api.py, moba-meta-intel)
│   ├── hero_draft_stats.csv         # 5-lane distributions, pick/ban/win/presence rates
│   ├── synergy_matrix.csv           # Pairwise ally synergy matrix (2,538 pairs)
│   ├── counter_matrix.csv           # Pairwise enemy counter matrix (6,140 pairs)
│   ├── mechanical_matchups_130x130.csv # 16,770 directional 1v1 combat matchups across Lv.4, Lv.10, Lv.15
│   ├── counter_item_flips.csv       # 235 Lv.15 single-item adaptation matchup reversals
│   ├── mechanical_matchup_summary.json # Structured summary of same-lane, cross-lane, hidden gems & item flips
│   ├── items.json                   # 114 items: rovmeta.com + patch-note overrides (numeric stats, price, passives)
│   ├── items_overrides.json         # Hand-maintained corrections from official Garena TH/TW patch notes
│   ├── hero_names_zh_tw.json        # Traditional Chinese -> canonical English hero name dictionary
│   ├── hero_patch_translations.json # Translation dictionary for patch note phrases & sentences
│   ├── hero_patch_history.json      # 363 historical balance adjustments across 101 heroes from TW patch notes
│   ├── hero_level_stats.json        # Exact level 1-15 stats table for all 130 heroes (JSON catalog)
│   ├── hero_level_stats.csv         # 1,950 row level 1-15 scaling table (130 heroes * 15 levels)
│   ├── hero_status_lv1.json         # In-game status panel values at level 1
│   ├── hero_status_lv15.json        # In-game status panel values at level 15
│   ├── hero_skills_full.json        # 534 structured hero skills with numerical cooldowns, mana costs & scalings
│   ├── arcana.json                  # 30 Tier-III Arcana runes (10 Red, 10 Purple, 10 Green, Thai server names)
│   └── enchantments.json            # 33 official Enchantments across 4 factions (Veda, Lokheim, Afata, Humans)
├── frontend/                        # React 19 + Vite + Tailwind 4 draft UI (see frontend/README.md)
│   ├── vite.config.ts               # Dev proxy & VITE_DRAFT_ONLY production asset pruning
│   ├── src/
│   │   ├── App.tsx                  # Auth portal, workspace routing, session refresh & error boundary
│   │   ├── api/client.ts            # Typed fetch wrapper (getJson/postJson/putJson/deleteJson, X-Expected-User)
│   │   ├── hooks/
│   │   │   ├── useDraft.ts          # Draft board state, /draft/session sync, /predict orchestration & series management
│   │   │   └── useCombatLab.ts      # Combat Lab build state, /combat/builds sync & /combat/duel simulation
│   │   ├── utils/
│   │   │   ├── draft.ts             # Pure draftReducer, flex-lane bipartite matcher, Global Ban helpers & payload builder
│   │   │   ├── telemetry.ts         # Client ID persistence, device detection & batched /telemetry/event emitter
│   │   │   ├── heroNames.ts         # Canonical <-> Thai server display name mapping & search matching
│   │   │   ├── heroForms.ts         # Multi-form stance badges (Liliana, Yena, Edras, Dirak)
│   │   │   └── skillEffects.ts      # Skill description effect tag parser
│   │   └── components/
│   │       ├── DraftBoardView.tsx   # Main broadcast-style draft board, lane filters & series controls
│   │       ├── PracticeDraftView.tsx # Draft vs AI practice board, Bo1-Bo7 series & synced history
│   │       ├── AdminStatsModal.tsx  # Owner quick stats modal with new-tab launcher to /#admin
│   │       ├── AdminDashboardView.tsx # Full-screen owner analytics dashboard (/#admin, plain-Thai stochastic & user insights)
│   │       ├── AiPanel.tsx          # Top-K AI recommendations, synergy/counter badges & opponent forecasts
│   │       ├── HeroGrid.tsx         # 130-hero filterable grid with Global Ban & rank overlays
│   │       ├── TeamColumn.tsx       # Blue/Red pick & ban slots with manual lane assignment modal triggers
│   │       ├── GlobalBanModal.tsx   # Bo1-Bo7 Team A/B used heroes & Universal Ban manager
│   │       ├── PickLaneModal.tsx    # Manual in-game lane assignment override modal
│   │       ├── AuthModal.tsx        # Login/Register + Google/Discord OAuth 2.0 PKCE modal & landing
│   │       ├── BillingSandbox.tsx   # Profile checkout, payment status, and recent sandbox orders
│   │       ├── lab/                 # Combat Lab (CombatLab, BuildEditor, SkillDamageTable, HeroSkillsModal, ItemCardModal, ArcanaBoard, EnchantmentBoard)
│   │       ├── meta_lab/            # SOTA + Synergy/Counter Matrix sandbox (MetaLab.tsx)
│   │       └── tierlist/            # Tournament Meta Tier List & hero inspector (TierListView.tsx)
│   └── public/
│       ├── avatars/                 # 130 square 160x160 hero icons
│       ├── items/                   # 114 item icons (scripts/fetch_item_icons.py)
│       ├── skills/                  # Hero skill icons
│       ├── enchantments/            # 33 enchantment icons
│       ├── logo.png                 # 512x512 PNG MiniDraft logo (rendered from favicon.svg)
│       ├── privacy.html             # Public Privacy Policy page (also served at GET /privacy)
│       └── hero_images.json         # Hero name -> /avatars/<file> (also read by src/api.py)
├── heroes/                          # Local, gitignored: in-game skill/status screenshots per hero (served at /heroes-media)
├── item/                            # Local, gitignored: in-game item card screenshots (served at /items-media)
├── models/
│   ├── sota_draft_gnn_transformer.pt # Production SOTA RoVDraftGNNTransformer checkpoint
│   ├── sota_draft_gnn_transformer_heuristic.pt # 0% true pick order experiment checkpoint
│   ├── archive/                     # Previous production checkpoints
│   └── draft_predictor.pt           # Baseline Deep Sets + MLP checkpoint (not committed; created by src/train_draft_model.py)
├── src/
│   ├── __init__.py
│   ├── config.py                    # Centralized OOP configuration (PathConfig, DraftModelConfig, HPOConfig, auto-.env load, OAuth env)
│   ├── db.py                        # SQLite UserDatabase (users, auth_sessions, user_oauth_accounts, per-user draft/combat state, telemetry, RateLimiter)
│   ├── analytics.py                 # Pure-Python probabilistic, stochastic & statistical inference engine (BG/NBD, Markov 3x3, Kaplan-Meier, Wilson/Katz, Kohavi, Sifa)
│   ├── schemas.py                   # Pydantic V2 request/response validation schemas
│   ├── billing.py                   # Prepaid pass prices, Stripe Sandbox Checkout, and order confirmation
│   ├── predictor.py                 # Production OOP inference engine (RoVDraftPredictor)
│   ├── search/
│   │   └── draft_mcts.py            # DRAFT_STEPS, ModelInput/encode_batch/run_model, DraftMinimaxSearch lookahead
│   ├── api.py                       # FastAPI endpoints (/health, /heroes, /auth/*, /privacy, /draft/*, /predict, /combat/*) + serves dist/dist-prod
│   ├── combat_calculator.py         # Stat builder (level+items+T3 arcana+enchantments), skill damage w/ mitigation, 1v1 duel sim
│   ├── skill_mechanics.py           # 100% 130-hero/534-skill mechanics extractor, curated skill effects, stack/stateful passives & poke spacing
│   ├── train_sota_model.py          # SOTA RoVDraftGNNTransformer model & training pipeline
│   ├── hpo_sota_optuna.py           # Fast GPU-Resident Optuna HPO engine (saves Top 5 trials)
│   ├── predict_draft_cli.py         # CLI draft simulator & tournament scenario runner
│   ├── build_training_dataset.py    # Builds data/matches_training.json (2025+ filter, true pick order merge)
│   ├── scrape_heroes.py             # Liquipedia 130-hero & skill scraper
│   ├── scrape_matches.py            # Liquipedia pro tournament match scraper
│   ├── build_draft_stats.py         # Lane distribution & synergy/counter matrix builder
│   └── train_draft_model.py         # Baseline Deep Sets + MLP trainer
├── scripts/
│   ├── discover_mechanical_matchups.py # 130x130 3-stage duel sweep + counter-item flip generator -> data/mechanical_matchups_130x130.csv
│   ├── fetch_hero_icons.py          # Square hero icons (rovmeta/Garena TH + Liquipedia overrides)
│   ├── fetch_items.py               # Item catalog from rovmeta.com -> data/items.json
│   ├── fetch_item_icons.py          # 114 item icons -> frontend/public/items/
│   ├── parse_tw_hero_patches.py     # Crawls Garena TW balance notices -> data/hero_patch_history.json
│   ├── build_hero_level_stats.py    # Builds 1-15 level stats scaling tables -> data/hero_level_stats.*
│   ├── download_rov_apk.py          # Garena RoV TH official APK/XAPK inspector & downloader
│   ├── build_hero_skills_catalog.py # Multi-source scraper/parser for 534 numerical hero skills, cooldowns & scalings
│   ├── fetch_arcana_and_enchantments.py # Scrapes Arcana & 33 Enchantments from Garena TW & MediaWiki
│   ├── process_draft_screenshots.py # Hungarian-matching screenshot reader -> data/true_pick_order.json
│   ├── build_screenshots_manifest.py # Hero skill/status + item card screenshots -> data/screenshots_manifest.json
│   ├── normalize_team_names.py      # Team abbreviation normalization across datasets
│   ├── export_commercial_package.py # 2026 analytics bundle export (reads hero_tier_overrides.json)
│   ├── sync_metadata.py             # SSOT dataset metadata generator & automatic documentation synchronizer
│   ├── start_public_15d.ps1         # Launches production uvicorn + Cloudflare Tunnel (minidraft.app) with auto-restart
│   ├── simulate_draft_selfplay.py   # 18-step AI vs AI self-play draft simulation
│   └── archive/                     # Archived one-off patch & migration scripts (21 scripts)
└── tests/
    ├── test_data_integrity.py       # Verifies 130 heroes, skills, 4,352 match mappings, and item catalog
    ├── test_model_pipeline.py       # Verifies SOTA checkpoint, masking, and predictor output
    ├── test_api.py                  # Verifies FastAPI endpoints and the served frontend build
    ├── test_combat_calculator.py    # Verifies mitigation formula, stat stacking, CDR cap, arcana/enchantment rules, duel
    ├── test_predictor_golden.py     # Pins predict() output on 72 replayed pro-game states (fixtures/predict_golden.json)
    ├── golden_scenarios.py          # The 4 pro games x 9 steps replayed by the golden test and regression-guard
    ├── test_rl_search.py            # DraftSearchState transitions & DraftMinimaxSearch lookahead (src/search/draft_mcts.py)
    ├── test_security.py             # Path traversal, media containment, pickle safety, input bounds, secret leaks (security-audit)
    └── test_skills_sync.py          # Fails if .claude/skills/ drifts from .agents/skills/
```
