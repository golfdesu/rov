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
3. **Data Builders, Scrapers & Baselines (`src/build_training_dataset.py`, `src/build_draft_stats.py`, `src/scrape_matches.py`, `src/scrape_heroes.py`, `src/train_draft_model.py`)**:
   - Construct the 2025–2026 training set, compute pairwise synergy/counter/lane matrices, normalize Liquipedia/AoV hero data, and benchmark against the legacy baseline model.

---

## 4. Backend, Persistence & Frontend

- **FastAPI (`src/api.py`, `src/config.py`, `src/schemas.py`, `src/analytics.py`, `src/sample_analytics.py`)**: Exposes `/health`, `/heroes`, `/auth/*`, `/privacy`, `/draft/steps`, `/draft/session`, `/draft/practice-history`, `/predict`, `/analytics/sample`, `/telemetry/visit`, `/telemetry/event`, `/survey/pricing`, owner-only `/admin/stats`, `/admin/users`, `/admin/analytics` (fail-closed `404` for non-owners), and dev-only `/combat/*`, while serving `frontend/dist` (dev) or `frontend/dist-prod` (prod).
- **Server-Side Sample Scrim Analytics (`src/sample_analytics.py`)**: Computes read-only Scrim Analytics (`get_sample_analytics`) for the anonymized RPL 2026 Summer sample (`configs/sample_scrim_rpl_2026_summer.json`, `SAMPLE LEAGUE 2026`) behind `GET /analytics/sample` (`_sample_analytics_limiter`: 60 requests / 60s per IP, `Cache-Control: public, max-age=300`). Raw match arrays stay strictly server-side; only aggregated `stats`, `allStats`, `advanced`, and `periodDiff` payloads are returned, constrained to coarse `datePreset` scopes (`all`, `last7`, `last30`) and validated `team` / `opponent` names.
- **Stochastic & Statistical Analytics Engine (`src/analytics.py`)**: Pure-Python (`math`) quantitative engine computing Fader-Hardie BG/NBD `P(Alive)` & 7-day repeat forecasts, Pfeifer-Carraway 3x3 Markov retention transitions & 14-day finite-horizon expectations, right-censored Kaplan-Meier survival curves (`S(t)` with Greenwood 95% CIs), Bayesian `Beta(1, 3)` WTP posteriors with Wilson 95% CIs, Katz log-RR CIs, Kohavi statistical power (`MDE = 10pp`) & `p95 <= 500ms` latency guardrails, Sifa behavioral feature-to-WTP Spearman correlations/lifts, and piecewise-linear latency quantiles (`p50`/`p95`).
- **SQLite Store (`src/db.py`)**: Stores `users` (`scrypt`), `auth_sessions`, `user_oauth_accounts` (Google & Discord OAuth 2.0 PKCE), isolated `user_draft_states`, `user_practice_histories`, `user_combat_builds`, `daily_visits` (`client_id`, `visit_date`, `user_id`, `predict_count`, `device_type`), `user_usage_daily`, `site_events_daily`, `pricing_survey_responses`, and `RateLimiter` state (`data/rov_app.db` locally or `/app/db/rov_app.db` in Docker).
- **Stripe Sandbox (`src/billing.py`, `src/api.py`, `src/db.py`)**: The development-only `/billing` routes create one-time PromptPay Checkout Sessions. Signed webhooks record payments in `billing_orders` and activate `billing_passes` in the same SQLite transaction. Duo and Team Pro use `team_invites`, `team_memberships`, and `team_history`, while `hero_pools` stores per-account and shared team 5-lane Hero Pools keyed by normalized team name. Membership and history access depend on the owner's active group pass, and seat and history capacity checks run in write transactions.
- **Sandbox team UI (`BillingSandbox.tsx`, `TeamSandbox.tsx`, `DraftHistoryModal.tsx`)**: Profile displays billing, member management, and invitations. The Draft Board switches between personal and shared history for active group members. Copies preserve the original personal game, and the account and group histories enforce independent capacity limits.
- **Team Global Ban previews**: Each newly recorded game stores an optional snapshot of both teams' used heroes and the universal bans. Team History reads that snapshot directly when displaying or opening a shared game. Legacy games can lack a snapshot, and the viewer's personal series history cannot supply one.
- **Tournament and series identity**: Active drafts and saved game payloads carry an optional tournament reference. New series use stable IDs so rematches with identical names keep separate game counts and Global Bans. Legacy series keep their name-based grouping and appear under No tournament until assigned. Users can create a tournament from multiple saved series in History. Personal assignment updates selected series in the draft state. Team assignment resolves all selected series within the active team and updates their games in one transaction after validating permissions. Later shared games inherit their series tournament. Existing SQLite tables store the optional fields in their JSON payloads.
- **History names**: Tournament renames keep the tournament ID and update all games in its history source. The series editor updates the display title, shared game name, and Team A and Team B names. It keeps the legacy grouping name as a stable key and maps team names to the blue and red sides of each game. Later games inherit the edited names. Shared edits validate permissions across all affected games and apply the requested changes in one transaction.
- **Draft history compatibility**: Session sync and history reads preserve archived pick and ban slots, including legacy games with a hero in both lists. New Team History copies, JSON imports, and prediction requests retain their duplicate-hero checks. On startup the draft board retries a newer browser snapshot when the server has an older revision.
- **Tournament analytics**: Selecting a tournament starts with every team in its history source. The overview counts each game once, shows Blue and Red results, and counts picks and bans across both sides. Series and saved-date filters apply before aggregation. Selecting a team brings back its team-specific analytics.
- **React 19 UI (`frontend/src/`)**: Built with TypeScript, Vite, and Tailwind CSS 4. Includes `DraftBoardView`, `PracticeDraftView`, `ProfileView`, `AdminStatsModal`, `AdminDashboardView` (`/#admin`), `ScrimDashboardView` (`/#analytics`), `telemetry.ts`, `CombatLab` (`components/lab/`), `MetaLab` (`meta_lab/`), and `TierListView` (`tierlist/`).

---

## Related Wiki Articles

- [`draft_invariants_and_pitfalls.md`](draft_invariants_and_pitfalls.md)
- [`production_hyperparameters_and_hpo.md`](production_hyperparameters_and_hpo.md)
- [`combat_engine_and_mechanics.md`](combat_engine_and_mechanics.md)
- [`production_deployment_and_ui.md`](production_deployment_and_ui.md)
