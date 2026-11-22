# System Architecture & SSOT Data Overview

**RoV Pro Draft Intelligence** (`MiniDraft`) is a full-stack machine learning and game-analytics platform for Arena of Valor (RoV) professional drafting under **Global Ban Pick** rules (Bo1–Bo7) plus a deterministic 1v1 combat simulator.

---

## 1. Ground Truth Data Provenance (CRITICAL INVARIANT)

All exact numerical game parameters in this repository come directly from the **project owner's manual in-game screenshots**, NOT from automated web scrapers:

- `heroes/*/skill/` (**566 screenshots**): Exact cooldowns, mana costs, base damages, and AD/AP/HP scaling ratios (`data/hero_skills_full.json`, 534 structured skills across 130 heroes).
- `heroes/*/status/` (**268 screenshots**): Exact Lv. 1 and Lv. 15 hero attributes (`data/hero_status_lv1.json`, `data/hero_status_lv15.json`, `data/hero_level_stats.json`, `data/hero_level_stats.csv`).
- `item/*/` (**159 screenshots**): Exact item stats, gold prices, and passive descriptions (`data/items.json`, 114 items with patch-note overrides in `data/items_overrides.json`).
- **Role of Web Scrapers**: External wikis (Liquipedia, AoV Fandom) were used solely as an initial English text skeleton and are frequently outdated relative to the official Thai server client. Always credit the owner's in-game screenshots as ground truth.

---

## 2. Core Datasets (`data/`)

| File | Contents | Key Scope |
| :--- | :--- | :--- |
| `heroes_130_full.json` / `heroes_130_summary.csv` | Full hero catalog | **130 / 130 heroes** up to Evita (Oct 2026), Tamyn (Jul 2026), and Flowborn (Marksman & Mage) |
| `hero_skills_full.json` | Structured skill attributes | **534 skills** (`>= 4` per hero) with numeric cooldown/mana arrays & scalings |
| `matches_draft_full.json` | Historical pro match archive | **4,352 pro games** (RPL, APL, AIC, AOG, GCS from 2024–2026), 0 unmapped heroes |
| `matches_training.json` | Curated SOTA training set | **3,535 games (2025–2026 only)**; all 817 games from 2024 excluded |
| `true_pick_order.json` | Screenshot-verified pick sequences | **1,833 games** (100% of 2026 games; **51.9%** of training set) |
| `hero_draft_stats.csv` | Meta rates & lane distributions | 5-lane distributions, pick/ban/win/presence rates |
| `synergy_matrix.csv` / `counter_matrix.csv` | Pairwise graph edges | **2,538** ally synergy pairs & **6,140** enemy counter pairs |
| `mechanical_matchups_130x130.csv` | 1v1 simulated combat matrix | **16,770** directional matchups (`8,385` pairs) across Lv.4, Lv.10, Lv.15 |
| `counter_item_flips.csv` | Lv.15 item counter adaptations | **235** single-item matchup reversals |
| `arcana.json` / `enchantments.json` | Rune & enchantment catalogs | **30** Tier-III Arcana & **33** Enchantments across 4 factions |
| `hero_tier_overrides.json` | Manual meta overrides | Tiers for new, reworked, or low-sample heroes (`Evita`, `Zanis`, `Ata`) |
| `dataset_metadata.json` | SSOT metrics cache | Synchronized across docs via `python scripts/sync_metadata.py` |

> **Off-Limits Folder**: `data/vod_analytics/` is the owner's paused WIP. Never read, move, modify, or inspect it unless explicitly requested.

---

## 3. ML & Search Architecture (`src/`)

1. **`RoVDraftGNNTransformer` (`src/train_sota_model.py`)**:
   - **Multi-Relational Hero GNN**: Computes hero embeddings across four typed graphs (`adj_copick`, `adj_synergy`, `adj_counter`, `adj_countered_by`) plus 37-dimensional rich hero features.
   - **Sequence Transformer**: 1-layer Transformer (`d_model = 256`, `nhead = 4`, `num_layers = 1`) encoding the sequential 18-step ban/pick trajectory alongside Global Ban pool context.
   - **Bounded Neural Temperature Gate + Dual Heads**: Produces next-pick/next-ban policy logits and terminal win-probability (`PredWin%`) estimates.
2. **Inference & Lookahead (`src/predictor.py`, `src/search/draft_mcts.py`)**:
   - `RoVDraftPredictor` handles canonical Thai server hero name normalization, phase masking, Global Ban filtering, and synergy/counter/mechanical-matchup explanations.
   - `DraftMinimaxSearch` performs multi-step lookahead over `DRAFT_STEPS` to anticipate opponent counter-picks.

---

## 4. Backend, Persistence & Frontend

- **FastAPI (`src/api.py`, `src/schemas.py`, `src/analytics.py`)**: Exposes `/health`, `/heroes`, `/auth/*`, `/privacy`, `/draft/steps`, `/draft/session`, `/draft/practice-history`, `/predict`, `/telemetry/visit`, `/telemetry/event`, `/survey/pricing`, owner-only `/admin/stats`, `/admin/users`, `/admin/analytics` (fail-closed `404` for non-owners), and dev-only `/combat/*`, while serving `frontend/dist` (dev) or `frontend/dist-prod` (prod).
- **Stochastic & Statistical Analytics Engine (`src/analytics.py`)**: Pure-Python (`math`) quantitative engine computing Fader-Hardie BG/NBD `P(Alive)` & 7-day repeat forecasts, Pfeifer-Carraway 3x3 Markov retention transitions & 14-day finite-horizon expectations, right-censored Kaplan-Meier survival curves (`S(t)` with Greenwood 95% CIs), Bayesian `Beta(1, 3)` WTP posteriors with Wilson 95% CIs, Katz log-RR CIs, Kohavi statistical power (`MDE = 10pp`) & `p95 <= 500ms` latency guardrails, Sifa behavioral feature-to-WTP Spearman correlations/lifts, and piecewise-linear latency quantiles (`p50`/`p95`).
- **SQLite Store (`src/db.py`)**: Stores `users` (`scrypt`), `auth_sessions`, `user_oauth_accounts` (Google & Discord OAuth 2.0 PKCE), isolated `user_draft_states`, `user_practice_histories`, `user_combat_builds`, `daily_visits` (`client_id`, `visit_date`, `user_id`, `predict_count`, `device_type`), `user_usage_daily`, `site_events_daily`, `pricing_survey_responses`, and `RateLimiter` state (`data/rov_app.db` locally or `/app/db/rov_app.db` in Docker).
- **React 19 UI (`frontend/src/`)**: Built with TypeScript, Vite, and Tailwind CSS 4. Includes `DraftBoardView`, `PracticeDraftView`, `AdminStatsModal`, `AdminDashboardView` (`/#admin`), `telemetry.ts`, `CombatLab` (`components/lab/`), `MetaLab` (`meta_lab/`), and `TierListView` (`tierlist/`).

---

## Related Wiki Articles

- [`draft_invariants_and_pitfalls.md`](draft_invariants_and_pitfalls.md)
- [`production_hyperparameters_and_hpo.md`](production_hyperparameters_and_hpo.md)
- [`combat_engine_and_mechanics.md`](combat_engine_and_mechanics.md)
- [`production_deployment_and_ui.md`](production_deployment_and_ui.md)
