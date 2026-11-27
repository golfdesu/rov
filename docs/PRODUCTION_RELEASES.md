# Production Releases & Hotfix Log (`minidraft.app`)

Dedicated operational record for the live production deployment of **MiniDraft (`https://minidraft.app/`)**, kept separate from `CHANGELOG.md` so agents and maintainers can see the exact live state, active hotfixes on the VM, and dev-only features at a glance.

> [!IMPORTANT]
> **For AI Agents:** Always read this file **before** inspecting, patching, syncing, or deploying to the production VM (`20.2.210.230`). **Append new production deploys/hotfixes at the TOP of Release History** and update the **Current Live Snapshot** below. Strictly English only.

---

## Current Live Snapshot

| Field | Value |
| :--- | :--- |
| **Live Domain** | `https://minidraft.app/` (`www.minidraft.app`) |
| **Host VM** | Azure VM `rov-draft-vm` (`20.2.210.230`, `azureuser`, `~/rov` via `git sparse-checkout --no-cone` production-only working tree) |
| **Container Stack** | `deploy-app-1` (`VITE_DRAFT_ONLY=true` serving **Draft Board + Draft vs AI + Scrim Analytics + Live PromptPay Billing & Promo**, `ROV_ENV=production`), `deploy-caddy-1`, `rov-cloudflared` |
| **Git Base Commit on VM** | `6e9434e` (`main`: Pure ONNX Runtime serving without PyTorch in Docker image) |
| **Active Frontend Bundle** | `dist-prod/assets/index-CVBi7Tl4.js` (`580K`) + `dist-prod/assets/react-vendor-DpjQJ7Lb.js` (`218.79 kB`) + `dist-prod/assets/index-WR-kJNtJ.css` (`114K`), `sw.js` (`3.0K`), `icon-192.png` (`42K`) |
| **Persistent Database** | Docker volume `deploy_rov_db_data` -> `/app/db/rov_app.db` (SQLite; **NEVER** delete or overwrite) |
| **Active Model Checkpoint** | `models/sota_draft_gnn_transformer.onnx` (`7.93 MB`) + `models/sota_draft_gnn_transformer.meta.npz` (`74.0 KB`), exported from `sota_draft_gnn_transformer.pt` (`val_loss = 2.81796`, `win_acc = 51.69%`, Trial #31) |
| **Last Updated** | `2026-11-27 15:37 (UTC+7)` |

---

## Production VM Sparse-Checkout Invariant (NEVER Pull Non-Production Files)

`~/rov` on `rov-draft-vm` (`20.2.210.230`) is locked with `git sparse-checkout --no-cone` to check out **ONLY** the 21 production paths required by `Dockerfile` and `deploy/`:
- `/Dockerfile`, `/.dockerignore`, `/requirements.txt`, `/requirements-prod.txt`
- `/deploy/**`, `/configs/**`, `/src/**`, `/frontend/**`
- `/models/sota_draft_gnn_transformer.onnx`, `/models/sota_draft_gnn_transformer.meta.npz`
- `/data/heroes_130_summary.csv`, `/data/hero_draft_stats.csv`, `/data/hero_tier_overrides.json`, `/data/dataset_metadata.json`, `/data/matches_training.json`, `/data/heroes_130_full.json`, `/data/hero_level_stats.json`, `/data/hero_skills_full.json`, `/data/items.json`, `/data/arcana.json`, `/data/enchantments.json`

**Hard Guardrails for All Agents:**
1. **NEVER** run `git sparse-checkout disable` or widen the sparse-checkout list on the VM to include `tests/`, `scripts/`, `docs/`, `.wikiskill/`, `.agents/`, `.claude/`, `best_params/`, `models/archive/`, `models/*heuristic*`, `data/draft_screenshots/`, or non-serving `data/*` files.
2. **NEVER** `scp` or `rsync` non-production files onto the VM.
3. **NEVER** SSH to run `git pull` on the VM for commits that only touch `docs/`, `.wikiskill/`, `CHANGELOG.md`, `AGENTS.md`, `tests/`, or `scripts/`. Only pull on the VM when deploying changes to the 21 production paths above.

---

## Active Uncommitted Hotfixes on Production VM (`~/rov`)

None — all previous hotfixes over `4dbc614` were reconciled into `main` during the Dev -> Prod cutover on `2026-11-21`.

---

## Dev-Only Features (Not Yet Deployed to Production)

These features exist in the local workspace (`main`) and remain **excluded** from `minidraft.app` while `VITE_DRAFT_ONLY=true`:

- **Meta Tier List, MetaLab & Combat Lab (`TierListView.tsx`, `MetaLab.tsx`, `CombatLab.tsx`):** Hidden in production while `VITE_DRAFT_ONLY=true`.
- **Ranked 10-Ban Mode (`docs/archive/ranked_10_ban_mode/`):** Archived patch; not active in main Draft Board.

---

## Production Deploy & Hotfix History

### 📅 2026-11-27 15:37 (UTC+7) — Pure ONNX Runtime Production Container (PyTorch Removed) (`6e9434e`)
- **Base Commit:** Fast-forwarded `~/rov` from `48e4c99` through `c5673aa`, `c4eccf5`, and `6e9434e` (`main`, updated VM `git sparse-checkout` cleanly to `21` production paths replacing `.pt` with `.onnx` + `.meta.npz` + `requirements-prod.txt`).
- **Zero-Torch Serving (`src/league_utils.py`, `src/predictor.py`, `src/search/draft_mcts.py`, `src/api.py`, `scripts/export_onnx.py`):** Separated league encoding from training modules, exported pickle-safe `models/sota_draft_gnn_transformer.meta.npz` (`74.0 KB`), converted `run_model()` / `DraftMinimaxSearch` to pure NumPy, lazy-loaded PyTorch only for dev/HPC fallback, and updated `/health` in `src/api.py` to check `predictor.inference_model`.
- **Slim Docker Stack (`requirements-prod.txt`, `.dockerignore`, `Dockerfile`, `deploy/compose.yaml`):** Removed `torch` and training/HPO libraries from production Docker builds (`deploy-app:latest` image size `666MB`, pip install `18.0s`), defaulting `ROV_INFERENCE_BACKEND=onnx`.
- **Live Verification (`20.2.210.230`):** Verified `TORCH_ABSENT: OK` (`import torch` raises `ModuleNotFoundError`), `API_BACKEND: onnx`, `TORCH_IN_SYS: False`, `https://minidraft.app/health` (`200`, `{"status":"healthy","model_loaded":true}`), and `POST https://minidraft.app/predict` (`200`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-27 15:20 (UTC+7) — Mobile PWA, PostHog Analytics, ONNX Inference Support & CI/CD (`48e4c99`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `a6eccb8` to `48e4c99` (`main`, 19-path sparse-checkout intact).
- **Mobile PWA (`frontend/` & `src/api.py`):** Shipped `manifest.webmanifest`, `icon-192.png`, `sw.js` (caching hero avatars/assets while keeping API paths network-only), `usePwaInstall()` prompt in `MobileNavDrawer.tsx`, and `Cache-Control: no-cache` for `/sw.js` on FastAPI origin.
- **PostHog Analytics (`frontend/`, `deploy/.env`, `src/api.py`):** Configured `VITE_POSTHOG_KEY` + `VITE_POSTHOG_HOST` (`https://us.i.posthog.com`) in `deploy/.env` on VM, baked `phc_...` token into `dist-prod/assets/index-CVBi7Tl4.js`, and permitted PostHog `connect-src` origins in CSP.
- **ONNX Runtime (`src/predictor.py`, `src/search/draft_mcts.py`, `requirements.txt`):** Added `onnxruntime>=1.20.0` + `ROV_INFERENCE_BACKEND=auto|onnx|torch` support in backend (`models/sota_draft_gnn_transformer.pt` remains the active VM sparse-checkout model path for now).
- **Live Verification (`20.2.210.230`):** Rebuilt & started `deploy-app-1`; verified `https://minidraft.app/health` (`200`, `model_loaded: true`, PostHog CSP header), `https://minidraft.app/sw.js` (`200`, origin `Cache-Control: no-cache`), `https://minidraft.app/manifest.webmanifest` (`200`, contains `icon-192.png`), `https://minidraft.app/icon-192.png` (`200`, `42120` bytes), and confirmed PostHog project key presence inside `dist-prod/assets/index-CVBi7Tl4.js`.
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-27 11:59 (UTC+7) — Ignore Stale-Tab `/telemetry/visit` Ghost Pings & Clean `@eakkasit.k` DB Noise (`a6eccb8`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `286a1f0` to `a6eccb8` (`main`, 19-path sparse-checkout intact).
- **Backend Fix (`src/api.py`):** `record_daily_visit()` now returns `{"recorded": false, "visit_date": <today_th>}` without inserting into `daily_visits` whenever `device_type` is omitted (`None`, i.e., stale cached JS tabs waking from browser sleep).
- **Live Verification & DB Hygiene (`20.2.210.230`):** Rebuilt `deploy-app-1` via `deploy/compose.yaml`, verified `https://minidraft.app/health` (`200`), and confirmed live `POST /telemetry/visit` without `device_type` returns `{"recorded":false,"visit_date":"2026-11-27"}`. Removed `@eakkasit.k` (`user_id = 6`) ghost-ping rows from `/app/db/rov_app.db` (`3` rows from `daily_visits` on Nov 23/25/26, `2` rows from `user_usage_daily` on Nov 23/25; real activity on Nov 20, 21, 22, and 24 preserved).

### 📅 2026-11-27 11:14 (UTC+7) — Plain Coach-Friendly Scrim Analytics Copy (`286a1f0`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `b6641de` to `286a1f0` (`main`, 19-path sparse-checkout intact).
- **Analytics Terminology (`frontend/src/components/ScrimDashboardView.tsx`, `frontend/src/i18n/englishMessages.ts`):** Rewrote `MethodsReferenceCard`, `CiRangeBar`, statistical tooltips, and table/card labels (`WR ถ่วงน้ำหนัก`, `สถิติเจอแต่ละทีม`, removing `Wilson 95% CI`, `p=`, `Z=`, `Empirical Bayes`, `Bradley-Terry`, `Shannon Entropy`, `EWMA`, `Head-to-Head` jargon and unused `fmtPValue`), plus added 25 synced EN translations.
- **Live Verification (`20.2.210.230`):** Rebuilt & started `deploy-app-1` (`dist-prod/assets/index-8m0RJQkO.js` `226.38 kB`, `react-vendor-DpjQJ7Lb.js` `218.79 kB`, `createLucideIcon-FqRLNzYq.js` `5.34 kB`, `ScrimDashboardView-BvDf0Xt_.js` `157.10 kB`, `englishMessages-Co47WdZF.js` `207.45 kB`, `index-WR-kJNtJ.css` `116.25 kB`, `dist-prod/index.html` `3.13 kB`); verified `https://minidraft.app/health` (`200`), `https://minidraft.app/analytics` (`200`), and `/app/db/rov_app.db` (`users: 1078`, `promo_claims: 50`, `billing_orders: 6`, `billing_passes: 51`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-27 10:53 (UTC+7) — Clean Path Routing (`/analytics`, `/practice`, `/plans`, `/profile`, `/admin`) (`b6641de`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `774467a` to `b6641de` (`main`, 19-path sparse-checkout intact).
- **Frontend History API Routing (`frontend/src/utils/navigation.ts`, `App.tsx`, `vite.config.ts`, 7 UI components):** Replaced all hash-based routes (`#practice`, `#analytics`, `#plans`, `#profile`, `#admin`, `href="#"`) with `history.pushState` / `popstate` path navigation (`/`, `/practice`, `/analytics`, `/plans`, `/profile`, `/admin`) via `navigateTo` + `handleSpaLinkClick`, keeping same-page `#team-setup` anchor scrolling intact and refining Vite dev proxy regex so `/admin` and `/analytics` SPA pages stay on Vite while `/admin/*` and `/analytics/*` API calls proxy to FastAPI.
- **Backend SPA Routes & Billing Redirect (`src/api.py`, `src/billing.py`):** Registered `GET`/`HEAD` SPA routes for `/practice`, `/analytics`, `/plans`, `/profile`, `/admin` returning `FRONTEND_DIST/index.html` with `Cache-Control: no-cache` without colliding with `/analytics/*` or `/admin/*` endpoints, and updated Stripe `success_url` / `cancel_url` to `/profile`.
- **Live Verification (`20.2.210.230`):** Rebuilt & started `deploy-app-1` (`dist-prod/assets/index-JFMszWUU.js` `226.38 kB`, `react-vendor-DpjQJ7Lb.js` `218.79 kB`, `createLucideIcon-Bjkpe-ll.js` `5.34 kB`, `index-WR-kJNtJ.css` `116.25 kB`, `dist-prod/index.html` `3.13 kB`); verified `https://minidraft.app/health` (`200`), all 5 SPA URLs (`/analytics`, `/practice`, `/plans`, `/profile`, `/admin` -> `200 OK`, `Cache-Control: no-cache`), and `/app/db/rov_app.db` (`users: 1078`, `promo_claims: 50`, `billing_orders: 6`, `billing_passes: 51`).
- **VM Sync Note:** Tests & docs commit recording this release (`tests/test_billing.py`, `tests/test_perf_optimizations.py`, `docs/PRODUCTION_RELEASES.md`, `CHANGELOG.md`) is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-27 10:40 (UTC+7) — Unified Collapsible Analytics Cards & Sample Refetch Scroll-Jump Fix (`774467a`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `24918b6` to `774467a` (`main`, 19-path sparse-checkout intact).
- **Scrim Analytics UI (`frontend/src/components/scrim/ScrimAdvancedCards.tsx`, `frontend/src/components/ScrimDashboardView.tsx`):** Exported an enhanced `CollapsibleCard` (supporting `id`, `as`, `className`, `icon`, `badge`, `headerRight`) and wrapped all 14 main tournament/team analysis cards in `ScrimDashboardView.tsx` so every analytics card shares the same collapse toggle (`พับเก็บ / กางดู`), shrinking `ScrimDashboardView` chunk from `158.30 kB` to `155.43 kB`. Fixed sample-mode scroll jumps when toggling `PeriodDiffCard` period buttons (`ครึ่งแรก vs ครึ่งหลัง` / `7 วันล่าสุด vs ก่อนหน้า`) or filters by keeping the dashboard mounted during `sampleLoading` (unmounting only when `!sampleData`) with an `aria-busy` / `opacity-75` transition wrapper.
- **Live Verification (`20.2.210.230`):** Rebuilt & started `deploy-app-1` (`dist-prod/assets/index-CJhDewGW.js` `226.04 kB`, `react-vendor-DpjQJ7Lb.js` `218.79 kB`, `createLucideIcon-Bjkpe-ll.js` `5.34 kB`, `ScrimDashboardView-5lTuARk3.js` `155.43 kB`, `index-WR-kJNtJ.css` `116.25 kB`, `dist-prod/index.html` `3.13 kB`); verified `https://minidraft.app/health` (`200`), live HTML bundle references, and `/app/db/rov_app.db` (`users: 1077`, `promo_claims: 50`, `billing_orders: 6`, `billing_passes: 51`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-27 10:05 (UTC+7) — Delayed Draft Completion Save Prompts & Mobile Action Labels (`24918b6`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `668cc63` to `24918b6` (`main`, 19-path sparse-checkout intact).
- **Completion Prompts & Mobile Sub-Header (`frontend/src/components/DraftBoardView.tsx`, `frontend/src/i18n/englishMessages.ts`):** Added a `1,800 ms` delayed confirmation prompt when a draft transitions to 18 steps complete (if unsaved, conflict-free, unlocked, and not loaded from team history) offering direct save (`FinishGameModal` or upgrade modal) or board review, a `900 ms` delay before `promptNewMatchAfterGame7()` after recording Game 7 (with timer guards/cleanup on undo, modal opens, series changes, and unmount), and compact mobile labels (`ใหม่`, `บันทึก`/`บันทึกแล้ว`, `ล็อก`) in the Draft Board sub-header with 3 new EN i18n keys.
- **Live Verification (`20.2.210.230`):** Rebuilt & started `deploy-app-1` (`dist-prod/assets/index-44toL8zw.js` `226.04 kB`, `react-vendor-DpjQJ7Lb.js` `218.79 kB`, `createLucideIcon-Bjkpe-ll.js` `5.34 kB`, `index-DgKXZFWX.css` `116.22 kB`, `dist-prod/index.html` `3.13 kB`); verified `https://minidraft.app/health` (`200`), live HTML bundle references, and `/app/db/rov_app.db` (`users: 1076`, `promo_claims: 50`, `billing_orders: 6`, `billing_passes: 51`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-27 09:35 (UTC+7) — Hide `MiniDraft Home` Navbar Logo on Mobile Screens (`668cc63`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `fa137ac` to `668cc63` (`main`, 19-path sparse-checkout intact).
- **Mobile Navbar UI (`frontend/src/App.tsx`):** Updated the `MiniDraft Home` logo button (`aria-label="MiniDraft Home"`) from `inline-flex` to `hidden sm:inline-flex`, hiding it on viewports below `640px` (`sm`) while keeping it rendered on tablet/desktop screens (`MobileNavDrawer` retains the mobile drawer logo).
- **Live Verification (`20.2.210.230`):** Rebuilt & started `deploy-app-1` (`dist-prod/assets/index-vyhFz7zv.js` `224.55 kB`, `react-vendor-DpjQJ7Lb.js` `218.79 kB`, `createLucideIcon-CpX25kZH.js` `5.34 kB`, `index-3Q07jOHG.css` `116.22 kB`, `dist-prod/index.html` `3.13 kB`); verified `https://minidraft.app/health` (`200`), live HTML bundle references, and `/app/db/rov_app.db` (`users: 1076`, `promo_claims: 50`, `billing_orders: 6`, `billing_passes: 51`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-26 22:26 (UTC+7) — Full-Stack Performance Optimization (`fa137ac`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `ff7f2ec` to `fa137ac` (`main`, 19-path sparse-checkout intact).
- **Frontend Bundle & Initial Load (`frontend/`):** Dynamic-imported `englishMessages.ts` into a separate `201.92 kB` EN-only chunk (`createLucideIcon` dropped from `210.0 kB` to `5.34 kB`), split `react-vendor` (`218.79 kB`), lazy-loaded rare modals + `ScoutingReportModal` (`42.81 kB`) + `PracticeHistoryModal` (`9.80 kB`), prefetched `/heroes` in parallel with `/auth/me`, gated the `document.body` `MutationObserver`, stabilized `PracticeDraftView` callbacks/arrays for `HeroGrid`, and added `useDeferredValue` + `decoding="async"`.
- **Backend Inference, Lazy Init & HTTP Caching (`src/predictor.py`, `src/search/draft_mcts.py`, `src/api.py`, `deploy/compose.yaml`):** Added thread-safe LRU cache (`maxsize=512`, `0.069 ms` avg hit vs `5.87 ms` cold), switched `run_model()` to `torch.inference_mode()` without redundant `unavail` tensor creation, pinned `OMP_NUM_THREADS=1` / `MKL_NUM_THREADS=1` / `ROV_TORCH_NUM_THREADS=1`, lazy-loaded `CombatEngine`, and added `Cache-Control` headers (`immutable` for `/assets/*`, `max-age=86400` for `/avatars/*`, `max-age=3600` for `/heroes`).
- **SQLite Tuning, Indexes & Query Consolidation (`src/db.py`, `src/api.py`):** Enabled `PRAGMA synchronous=NORMAL` + `temp_store=MEMORY` + `cache_size=-16000`, added 7 missing indexes, dropped redundant `idx_hero_pools_owner`, removed `self._lock` from WAL-safe reads, and consolidated `GET /auth/me` and `GET /billing` via `get_auth_user_context()` and `get_billing_snapshot()`.
- **Live Verification (`20.2.210.230`):** Built & started `deploy-app-1` (`index-DZ579WS6.js` `224.54 kB`, `react-vendor-DpjQJ7Lb.js` `218.79 kB`, `index-3Q07jOHG.css` `116.22 kB`); verified `https://minidraft.app/health` (`200`), `/assets/index-DZ579WS6.js` (`immutable`), `/heroes` (`public, max-age=3600`), `/avatars/Valhein.jpg` (`public, max-age=86400`), and `/app/db/rov_app.db` (`PRAGMA synchronous = 1`, new indexes active, `users: 1067`, `promo_claims: 47`, `billing_orders: 5`, `billing_passes: 48`).
- **VM Sync Note:** Docs/tests commit recording this release (`CHANGELOG.md`, `docs/PRODUCTION_RELEASES.md`, `tests/test_perf_optimizations.py`) is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-26 21:49 (UTC+7) — Translucent Purple Owner Accents (`ff7f2ec`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `a29e4fe` to `ff7f2ec` (`main`, 19-path sparse-checkout intact).
- **Theme Alignment (`frontend/src/App.tsx`, `frontend/src/components/BillingSandbox.tsx`):** Replaced the maroon (`rose-*`) Owner `#profile` navbar button, `#plans` Owner preview notice, and `#profile` plans link with translucent purple styling (`purple-400/500/300/200`) matching the existing tier palette.
- **Live Verification (`20.2.210.230`):** Built & started `deploy-app-1` (`dist-prod/assets/index-CbKosdoR.js` `487.73 kB`, `index-Bh3zIg3X.css` `115.96 kB`), verified `https://minidraft.app/health` (`200`), and verified SQLite DB counts intact (`users: 1066`, `promo_claims: 47`, `billing_orders: 5`, `billing_passes: 48`).

### 📅 2026-11-26 21:44 (UTC+7) — Owner Read-Only `#plans` Preview (`a29e4fe`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `63b0930` to `a29e4fe` (`main`, 19-path sparse-checkout intact).
- **Owner Plans View (`frontend/src/components/BillingSandbox.tsx`, `frontend/src/i18n/englishMessages.ts`):** Added `catalogDisplayPackages` so owner accounts see the exact `#plans` layout regular users see (Pro, Duo, and Business cards, 30/90-day duration toggle, savings badges, comparison table, and standard tier CTA labels) with an Owner preview banner, checkout buttons disabled, and a `#plans` link on `#profile`.
- **Live Verification (`20.2.210.230`):** Built & started `deploy-app-1` (`dist-prod/assets/index-BYT79WHc.js` `487.73 kB`, `index-CFfhrfw3.css` `116.53 kB`), verified `https://minidraft.app/health` (`200`), and verified SQLite DB counts intact (`users: 1066`, `promo_claims: 47`, `billing_orders: 5`, `billing_passes: 48`).

### 📅 2026-11-26 21:39 (UTC+7) — Tier-Colored `#profile` Navbar Button & Maroon Owner Badge (`63b0930`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `0d6c73c` to `63b0930` (`main`, 19-path sparse-checkout intact).
- **Navbar Tier Styling (`frontend/src/App.tsx`):** Styled the `#profile` navbar button by active pass tier (`Owner` = maroon `border-rose-800 bg-rose-950/90 text-rose-200` + `Crown` icon, `Business` = `blue`, `Duo` = `good`, `Pro` = `gold`, `Free` = neutral).
- **Live Verification (`20.2.210.230`):** Deployed `dist-prod/assets/index-mHEU1SNF.js` (`487.73 kB`) + `index-ByPqdtLZ.css` (`115.76 kB`) and verified `https://minidraft.app/health` (`200`) and SQLite row counts (`users: 1066`, `promo_claims: 47`, `billing_orders: 5`, `billing_passes: 48`).

### 📅 2026-11-26 21:24 (UTC+7) — Funnel/Feature Telemetry & `#admin` Billing Orders History (`0d6c73c`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `5aec988` to `0d6c73c` (`main`, 19-path sparse-checkout intact).
- **Telemetry Keys & Analytics (`src/schemas.py`, `src/analytics.py`, `frontend/src/utils/telemetry.ts`, `App.tsx`, `DraftBoardView.tsx`, `PracticeDraftView.tsx`, `ScrimDashboardView.tsx`):** Added 12 lightweight aggregate telemetry counters (`tab_practice`, `tab_analytics`, `tab_plans`, `tab_profile`, `feat_scouting_pdf`, `feat_hero_pools`, `feat_global_ban`, `feat_practice_history`, `feat_practice_review`, `draft_started`, `practice_started`, `auth_skip_guest`) to `site_events_daily` and exposed them under `feature_usage` in `/admin/analytics` and `#admin`.
- **Billing Orders Table in `#admin` (`src/db.py`, `frontend/src/types/auth.ts`, `AdminDashboardView.tsx`):** Added `recent_orders` (latest `50` `billing_orders` rows across `paid`, `pending`, `closed` with `is_admin` badge) under a collapsible section in the `#admin` billing panel.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-0Er8RcO9.js` (`487.07 kB`), `dist-prod/assets/index-TJjZCR0r.css` (`114.20 kB`).
- **Verification:** `ruff check/format` clean, `pytest -q --tb=short tests/test_billing.py tests/test_api.py` (`72 passed`), `oxlint` (`0` warnings/errors), `vite build` & `build:prod`, `audit_copy_i18n.py` (`[PASS]`, 100% EN coverage), `preflight_check.py` (`[OK]`); live `https://minidraft.app/health` -> `200`, live HTML serving `assets/index-0Er8RcO9.js` and `assets/index-TJjZCR0r.css`; `/app/db/rov_app.db` intact (`users: 1064`, `promo_claims: 44`, `billing_orders: 5`, `billing_passes: 45`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-26 21:16 (UTC+7) — Team Onboarding, Free Pro Conversion & Expiry Nudges, Owner Pass, and Admin Revenue Separation (`5aec988`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `a821939` to `5aec988` (`main`, 19-path sparse-checkout intact).
- **Live DB Owner Pass Update (`/app/db/rov_app.db`):** Created online SQLite backup `/app/db/rov_app.db.bak-20261126-ownerpass` (`5,259,264` bytes) and updated `@chayanin5392` (`user_id = 3`) in `billing_passes` to `tier = 'team_pro'`, `expires_at = 4070908800` (`2099-01-01`).
- **Team Onboarding (`TeamSandbox.tsx`, `BillingSandbox.tsx`, `ScrimDashboardView.tsx`):** Added `#team-setup` anchor and a 3-step quick-start guide when a Duo/Business owner still has `members.length === 1`, plus actionable empty-state links in `#analytics` team history.
- **Free Pro Expiry & Willing Nudges (`src/db.py`, `src/schemas.py`, `src/billing.py`, `src/api.py`, `App.tsx`, `BillingSandbox.tsx`, `ScrimDashboardView.tsx`):** Exposed `pass_tier`, `pass_source`, `pass_expires_at` (`BillingPass.source`, `is_owner_account`), added `<= 4`-day navbar/mobile/profile expiry alerts for `promo_free` holders, added a dismissible navbar-strip Free Pro nudge for returning `willing` survey respondents, and surfaced the Free Pro CTA inside `#analytics` demo mode. Displayed `Owner` pass label on `#profile` for admin `team_pro` accounts.
- **Admin Revenue Separation (`src/db.py`, `src/api.py`, `AdminDashboardView.tsx`, `tests/test_billing.py`):** Passed `config.admin_usernames` into `get_admin_stats()`, separated admin test orders/passes (`is_admin`, `active_admin_passes`, `admin_test_orders`, `admin_test_revenue_thb`) from commercial metrics, and added the `แอดมิน / Owner` filter pill in `#admin`.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-31ipnxx8.js` (`486.66 kB`), `dist-prod/assets/index-C4BQQffz.css` (`114.16 kB`).
- **Verification:** `ruff check/format` clean, `pytest -q --tb=short tests/test_billing.py tests/test_api.py` (`72 passed`), `oxlint` (`0` warnings/errors), `vite build` & `build:prod`, `audit_copy_i18n.py` (`[PASS]`, 100% EN coverage), `preflight_check.py` (`[OK]`); live `https://minidraft.app/health` -> `200`, live HTML serving `assets/index-31ipnxx8.js` and `assets/index-C4BQQffz.css`; `/app/db/rov_app.db` intact (`users: 1063`, `promo_claims: 44`, `billing_orders: 5`, `billing_passes: 45`).
- **VM Sync Note:** Docs-only commit recording this release (plus `.wikiskill/wiki/production_deployment_and_ui.md` and `AGENTS.md` updates) is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-26 14:04 (UTC+7) — Real RPL 2026 Winter & Summer Sample Analytics Datasets (`a821939`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `3805788` to `a821939` (`main`, 19-path sparse-checkout intact).
- **Datasets (`configs/sample_scrim_rpl_2026_summer.json`, `configs/sample_scrim_rpl_2026_winter.json`):** Replaced the anonymized team aliases in the 291-game RPL 2026 Summer sample with authentic team codes (`BRU`, `FS`, `KOG`, `SLX`, `EA`, `TEN`, `BAC`, `GJC`, `HD`), and generated the 307-game (`76` series) RPL 2026 Winter server-side sample dataset with verified true pick order and 10-slot lane assignments.
- **Backend (`src/sample_analytics.py`, `src/api.py`, `tests/test_api.py`):** Added multi-dataset selection via `dataset` on `GET /analytics/sample` (`rpl-2026-winter` default `307` games, `rpl-2026-summer` `291` games, and legacy `sample-league-2026` alias) returning `availableTournaments` while keeping all raw match records strictly server-side.
- **Frontend (`frontend/src/api/sampleAnalytics.ts`, `frontend/src/components/ScrimDashboardView.tsx`):** Exposed both `RPL 2026 Winter (307)` and `RPL 2026 Summer (291)` in the Scrim Analytics tournament selector across sample/demo and paid modes, defaulting to `RPL 2026 Winter` + `BRU` with graceful fallback from cached legacy filters.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-8QUWNewd.js` (`483.64 kB`), `dist-prod/assets/index-C4BQQffz.css` (`114.16 kB`).
- **Verification:** `ruff check/format` clean, `pytest -q --tb=short tests/test_api.py` (`52 passed`), `oxlint` (`0` warnings/errors), `vite build` & `build:prod`, `audit_copy_i18n.py` (`[PASS]`, 100% EN coverage); live `https://minidraft.app/health` -> `200 {"status":"healthy","model_loaded":true}`, live HTML serving `assets/index-8QUWNewd.js` and `assets/index-C4BQQffz.css`, live `/analytics/sample` returning `RPL 2026 Winter` (`307` games) and `RPL 2026 Summer` (`291` games); `/app/db/rov_app.db` intact (`users: 1045`, `promo_claims: 36`, `billing_orders: 5`, `billing_passes: 37`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-26 08:38 (UTC+7) — Tiered Draft vs AI Practice History Limits (100 Free / 1,000 Pro) (`3805788`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `a4eaa1c` to `3805788` (`main`, 19-path sparse-checkout intact).
- **Backend (`src/db.py`, `src/schemas.py`, `src/api.py`, `tests/test_billing.py`):** Added `FREE_PRACTICE_HISTORY_LIMIT = 100` and `PAID_PRACTICE_HISTORY_LIMIT = 1000`, enforced per-user limit in `save_user_practice_history()`, raised `PracticeHistorySyncSchema.entries` `max_length` to `1000`, raised production `_MaxBodySizeMiddleware` cap on `PUT /draft/practice-history` to `2 MiB`, and exposed `practice_history_limit` on `/auth/me`.
- **Frontend (`types/auth.ts`, `utils/practiceHistory.ts`, `PracticeDraftView.tsx`, `PracticeHistoryModal.tsx`, `App.tsx`, `BillingSandbox.tsx`, `englishMessages.ts`):** Propagated `authUser.practice_history_limit` into practice history sanitization/merge/storage and `PracticeHistoryModal` cap indicator (`entries.length / maxHistory`), and added the `"ประวัติดราฟต์ vs AI"` (`100` Free / `1,000` Pro, Duo, Business) comparison row on `#plans`.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-BsjAkmLf.js` (`483.64 kB`), `dist-prod/assets/index-C4BQQffz.css` (`114.16 kB`).
- **Verification:** `ruff check/format` clean, `pytest -q --tb=short tests/test_billing.py tests/test_api.py` (`71 passed`), `oxlint` (`0` warnings/errors), `vite build` & `build:prod`, `audit_copy_i18n.py` (`[PASS]`, 100% EN coverage); live `https://minidraft.app/health` -> `200 {"status":"healthy","model_loaded":true}`, live HTML serving `assets/index-BsjAkmLf.js` and `assets/index-C4BQQffz.css`; `/app/db/rov_app.db` intact (`users: 1035`, `promo_claims: 31`, `billing_orders: 5`, `billing_passes: 32`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-26 07:03 (UTC+7) — Ghost-Tab Telemetry DB Cleanup & `#admin` `"ใช้งานจริง"` Filter Pill (`a4eaa1c`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `cb6ba65` to `a4eaa1c` (`main`, 19-path sparse-checkout intact).
- **Targeted Live DB Cleanup (`/app/db/rov_app.db`):**
  - Created online SQLite backup `/app/db/rov_app.db.bak-20261126-ghostcleanup` (`4,792,320` bytes) via `sqlite3.Connection.backup()`.
  - Verified zero draft, practice, promo, or billing rows for suspended-tab-only accounts `@kaisertz` (`id=273`) and `@nicee2925` (`id=349`), then removed `9` `daily_visits` rows and `7` `user_usage_daily` rows (`0` remaining for both accounts; `users: 1034` intact).
- **Frontend (`AdminDashboardView.tsx`):** Added the `"ใช้งานจริง"` (`engaged`: `saved_series_games >= 1 || practice_games >= 1 || draft_step_index >= 1 || predict_calls >= 2`) filter pill in the `#admin` user activity table.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-DHp6DXP3.js` (`483.54 kB`), `dist-prod/assets/index-C4BQQffz.css` (`114.16 kB`).
- **Verification:** `oxlint` (`0` warnings/errors), `vite build` & `build:prod`; live `https://minidraft.app/health` -> `200 {"status":"healthy","model_loaded":true}`, live HTML serving `assets/index-DHp6DXP3.js` and `assets/index-C4BQQffz.css`; `/app/db/rov_app.db` intact (`users: 1034`, `promo_claims: 31`, `billing_orders: 5`, `billing_passes: 32`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-26 06:53 (UTC+7) — Interaction-Gated Daily Visit & Active-Board Predict Telemetry (`cb6ba65`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `b8cd831` to `cb6ba65` (`main`, 19-path sparse-checkout intact).
- **Summary (`frontend/src/App.tsx`, `src/api.py`, `tests/test_api.py`):** Gated the once-per-day `POST /telemetry/visit` ping on `document.visibilityState === "visible"` plus a real `pointerdown`/`keydown` user interaction, and skipped `record_predict_telemetry` on empty `0/18` preload `/predict` calls (`ally_bans`, `enemy_bans`, `ally_picks`, `enemy_picks`, and global bans all empty) so background/suspended mobile tab reloads no longer inflate DAU or `predict_count`.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-BrZ7xUyP.js` (`483.54 kB`), `dist-prod/assets/index-C4BQQffz.css` (`114.16 kB`).
- **Verification:** `ruff` clean, `pytest -q --tb=short tests/test_api.py` (`52 passed`), `oxlint` (`0` warnings/errors), `vite build` & `build:prod`; live `https://minidraft.app/health` -> `200 {"status":"healthy","model_loaded":true}`, live HTML serving `assets/index-BrZ7xUyP.js` and `assets/index-C4BQQffz.css`; `/app/db/rov_app.db` intact (`users: 1034`, `promo_claims: 31`, `billing_orders: 5`, `billing_passes: 32`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-26 06:41 (UTC+7) — Show Purchase & Claim Timestamps in `#admin` Active Passes Table (`b8cd831`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `76d6aa4` to `b8cd831` (`main`, 19-path sparse-checkout intact).
- **Summary (`src/db.py`, `auth.ts`, `AdminDashboardView.tsx`, `tests/test_billing.py`):** Added `acquired_at` / `acquired_at_th` (`MAX(paid_at)` for paid orders and `MAX(claimed_at)` for Free Pro claims) to `GET /admin/stats` (`billing.active_passes`), sorted newest acquisitions first per source tier, and rendered the `"ซื้อ / รับสิทธิ์ (เวลาไทย)"` column in `#admin`.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-CC7FvFCS.js` (`483.17 kB`), `dist-prod/assets/index-C4BQQffz.css` (`114.16 kB`).
- **Verification:** `ruff` clean, `pytest -q --tb=short tests/test_billing.py` (`18 passed`), `oxlint` (`0` warnings/errors), `vite build` & `build:prod`; live `https://minidraft.app/health` -> `200 {"status":"healthy","model_loaded":true}`, live HTML serving `assets/index-CC7FvFCS.js` and `assets/index-C4BQQffz.css`; `/app/db/rov_app.db` intact (`users: 1034`, `promo_claims: 31`, `billing_orders: 5`, `billing_passes: 32`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-25 22:37 (UTC+7) — Display Disabled Current Pro Card on `#plans` (`76d6aa4`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `a05845b` to `76d6aa4` (`main`, 19-path sparse-checkout intact).
- **Summary (`BillingSandbox.tsx`, `englishMessages.ts`):** When `activePass.tier === "pro"`, prepends a read-only Pro tier card (`59` / `139` THB with `38` THB 90-day savings indicator) alongside Duo and Business so all 3 plans remain visible for comparison, with a disabled `"แพ็กเกจปัจจุบัน"` (`Current Plan`) button while keeping backend `409 pass_active` protection intact.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-CTznpWeT.js` (`483.17 kB`), `dist-prod/assets/index-DrPQ72Op.css` (`114.16 kB`).
- **Verification:** `oxlint` (`0` warnings/errors), `vite build` & `build:prod`, `audit_copy_i18n.py` (`[PASS]`, 100% EN coverage); live `https://minidraft.app/health` -> `200 {"status":"healthy","model_loaded":true}`, live HTML serving `assets/index-CTznpWeT.js` and `assets/index-DrPQ72Op.css`; `/app/db/rov_app.db` intact (`users: 1027`, `promo_claims: 25`, `billing_orders: 5`, `billing_passes: 26`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-25 22:32 (UTC+7) — Block Repeat Pro Purchases While Active, Keep Duo & Business Upgrades (`a05845b`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `a045e93` to `a05845b` (`main`, 19-path sparse-checkout intact).
- **Summary (`src/db.py`, `BillingSandbox.tsx`, `englishMessages.ts`, `tests/test_billing.py`):** Restored the same-tier `pass_active` guard so active `pro` users cannot repurchase `pro` until expiry (`409 pass_active`), while still displaying and enabling `pro -> duo` (`remaining_days // 2` bonus) and `pro -> team_pro` (`remaining_days // 3` bonus) upgrades on `#plans`.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-CLeU6ehA.js` (`483.17 kB`), `dist-prod/assets/index-DrPQ72Op.css` (`114.16 kB`).
- **Verification:** `ruff` clean, `pytest -q --tb=short tests/test_billing.py` (`18 passed`), `oxlint` (`0` warnings/errors), `vite build` & `build:prod`, `audit_copy_i18n.py` (`[PASS]`, 100% EN coverage); live `https://minidraft.app/health` -> `200 {"status":"healthy","model_loaded":true}`, live HTML serving `assets/index-CLeU6ehA.js` and `assets/index-DrPQ72Op.css`; `/app/db/rov_app.db` intact (`users: 1026`, `promo_claims: 24`, `billing_orders: 5`, `billing_passes: 25`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-25 22:19 (UTC+7) — Allow Pro Users to Extend Pro & Upgrade to Duo on `#plans` (`a045e93`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `a321a9d` to `a045e93` (`main`, 19-path sparse-checkout intact).
- **Summary (`src/db.py`, `BillingSandbox.tsx`, `englishMessages.ts`, `tests/test_billing.py`):** Enabled active `pro` users (including Free Pro promo users) to see all 3 tiers (`pro`, `duo`, `team_pro`) on `#plans`, extend `pro` by stacking days onto their existing expiry, or upgrade `pro -> duo` with `remaining_days // 2` bonus days (`pro -> team_pro` retains `remaining_days // 3` bonus days; `duo`/`team_pro` and `team_memberships` blocks remain unchanged).
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-DAsMzu-l.js` (`483.17 kB`), `dist-prod/assets/index-DrPQ72Op.css` (`114.16 kB`).
- **Verification:** `ruff` clean, `pytest -q --tb=short tests/test_billing.py` (`18 passed`), `oxlint` (`0` warnings/errors), `vite build` & `build:prod`, `audit_copy_i18n.py` (`[PASS]`, 100% EN coverage); live `https://minidraft.app/health` -> `200 {"status":"healthy","model_loaded":true}`, live HTML serving `assets/index-DAsMzu-l.js` and `assets/index-DrPQ72Op.css`; `/app/db/rov_app.db` intact (`users: 1026`, `promo_claims: 24`, `billing_orders: 4`, `billing_passes: 25`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-25 22:05 (UTC+7) — Direct `PickLaneModal` on Pick Click with Inline Replace Hero (`a321a9d`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `93b5ce0` to `a321a9d` (`main`, 19-path sparse-checkout intact).
- **Summary (`PickLaneModal.tsx`, `DraftBoardView.tsx`):** Clicking an existing Pick slot now opens `PickLaneModal` directly instead of showing the two-button `DraftPickActions` chooser; added a `"เปลี่ยนฮีโร่"` (`Replace Hero`) footer button inside `PickLaneModal` to launch Spotlight/Mobile hero replacement directly (Ban clicks continue opening hero replacement directly).
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-u27y8avV.js` (`483.17 kB`), `dist-prod/assets/index-DrPQ72Op.css` (`114.16 kB`).
- **Verification:** `oxlint` (`0` warnings/errors), `vite build` & `build:prod`, `audit_copy_i18n.py` (`[PASS]`, 100% EN coverage); live `https://minidraft.app/health` -> `200 {"status":"healthy","model_loaded":true}`, live HTML serving `assets/index-u27y8avV.js` and `assets/index-DrPQ72Op.css`; `/app/db/rov_app.db` intact (`users: 1025`, `promo_claims: 23`, `billing_orders: 4`, `billing_passes: 24`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-25 21:33 (UTC+7) — Free Pro Promo Badge in Navbar & `#plans` View (`93b5ce0`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `5d66a76` to `93b5ce0` (`main`, 19-path sparse-checkout intact).
- **Summary (`App.tsx`, `BillingSandbox.tsx`, `englishMessages.ts`):** Added a visible Free Pro promo pill (`Free Pro until <date>`) in the Desktop navbar and a slim clickable strip below the Mobile `< sm` navbar linking directly to `#profile` (or Sign-In for guests), plus a 1-click Free Pro claim banner at the top of `#plans` (automatically hidden once `authUser.is_paid` or expired).
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-CW-NmP1u.js` (`483.50 kB`), `dist-prod/assets/index-DrPQ72Op.css` (`114.16 kB`).
- **Verification:** `oxlint` (`0` warnings/errors), `vite build` & `build:prod`, `audit_copy_i18n.py` (`[PASS]`, 100% EN coverage); live `https://minidraft.app/health` -> `200 {"status":"healthy","model_loaded":true}`, live HTML serving `assets/index-CW-NmP1u.js` and `assets/index-DrPQ72Op.css`; `/app/db/rov_app.db` intact (`users: 1024`, `promo_claims: 22`, `billing_orders: 4`, `billing_passes: 23`).
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-25 19:37 (UTC+7) — Non-Blocking Cloudflare Cache & Progressive Admin Dashboard (`5d66a76`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `867bdaa` to `5d66a76` (`main`, 19-path sparse-checkout intact).
- **Summary (`src/api.py`, `AdminDashboardView.tsx`):** Eliminated the 4.2s `/admin/stats` stall with a 5-minute (`300s`) stale-while-revalidate Cloudflare cache + single-flight background thread and switched the admin dashboard from blocking `Promise.all` to progressive per-endpoint rendering (`Promise.allSettled`).
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-C5yl2h2h.js` (`482.19 kB`), `dist-prod/assets/index-DrPQ72Op.css` (`114.16 kB`).

### 📅 2026-11-25 19:19 (UTC+7) — Display Active Duo/Business Team Members in Admin Dashboard (`867bdaa`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `7c27b2d` to `867bdaa` (`main`, 19-path sparse-checkout intact).
- **Summary (`db.py`, `schemas.py`, `auth.ts`, `AdminDashboardView.tsx`):** Included active Duo and Business `team_memberships` in `/admin/stats`, `/admin/users`, and the `#admin` dashboard (`Team Member (@owner)` badges, expiry dates, and filters) without double-counting paying buyers or revenue.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-Cw53souk.js` (`482.19 kB`), `dist-prod/assets/index-DrPQ72Op.css` (`114.16 kB`).

### 📅 2026-11-25 15:58 (UTC+7) — Remove Keyboard Shortcuts from User Guide (`7c27b2d`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `eb65d1f` to `7c27b2d` (`main`, 19-path sparse-checkout intact).
- **Summary (`UserGuideModal.tsx`, `englishMessages.ts`):** Removed the keyboard shortcuts card from the User Guide modal and focused Tab 4 on `Accounts & Tiers` (`Guest`, `Free`, `Pro / Duo / Business`).
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-BsWEyMW4.js` (`482.19 kB`), `dist-prod/assets/index-DrPQ72Op.css` (`114.16 kB`).

### 📅 2026-11-25 15:53 (UTC+7) — Clarify 10-Hero Draft Wording in User Guide (`eb65d1f`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `19b890d` to `eb65d1f` (`main`, 19-path sparse-checkout intact).
- **Summary (`UserGuideModal.tsx`, `englishMessages.ts`):** Updated the Save Match Guide copy from `18 steps` to `10 heroes` so players clearly see they can save once all 10 heroes are drafted.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-USZYtqjX.js` (`484.58 kB`), `dist-prod/assets/index-DTk0A1yx.css` (`114.24 kB`).

### 📅 2026-11-25 15:38 (UTC+7) — User Guide Modal & Admin Paid/Promo Pass Tracker (`19b890d`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `27167b8` to `19b890d` (`main`, 19-path sparse-checkout intact).
- **Summary:**
  - Added the 4-tab `UserGuideModal` (`Draft Board & Series`, `AI & Draft Practice`, `Stats, Pools & Teams`, `Shortcuts & Accounts`) with a top-nav `?` help button and Drawer entry point, highlighting `New Series` for starting a new series.
  - Added live active pass tracking (`Paid` by tier + THB revenue vs `Free Pro` promo claims + expiry dates/days left) to `GET /admin/stats`, `GET /admin/users`, and `AdminDashboardView`.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-DYeWCBhA.js` (`484.58 kB`), `dist-prod/assets/index-DTk0A1yx.css` (`114.24 kB`).

### 📅 2026-11-25 14:21 (UTC+7) — Keep Swap Sides Button Width Constant (`27167b8`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `252f881` to `27167b8` (`main`).
- **Summary (`DraftBoardView.tsx`):** Always render the Swap Sides `<ChevronDown>` icon (`invisible` when `!canSwapBoardAndTeams`) so the button width never jumps when the first pick or ban is placed.
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-gbAOGplt.js` (`470.44 kB`), `dist-prod/assets/index-lnmJj0ei.css` (`113.97 kB`).
- **Verification:** Local `oxlint` (`0` warnings/errors), `vite build` + `build:prod`; live `https://minidraft.app/health` -> `200 {"status":"healthy","model_loaded":true}`, live HTML serving `assets/index-gbAOGplt.js` and `assets/index-lnmJj0ei.css`.
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-25 13:30 (UTC+7) — Update Announcement PromptPay Copy Polish (`252f881`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `947cfd9` to `252f881` (`main`).
- **Summary (`PricingSurveyModal.tsx`, `englishMessages.ts`):** Replaced `"แพ็กเติมวันผ่าน PromptPay"` (`"PromptPay day passes"`) with `"แพ็ก Pro / Duo / Business จ่ายผ่าน PromptPay"` (`"Pro / Duo / Business PromptPay passes"`).
- **Bundle Built:** `dist-prod/index.html` (`3.12 kB`), `dist-prod/assets/index-D63M18OL.js` (`470.41 kB`), `dist-prod/assets/index-lnmJj0ei.css` (`113.97 kB`).
- **Verification:** Local `oxlint` (`0` warnings/errors), `vite build` + `build:prod`, `audit_copy_i18n.py` (`[PASS]`, 100% EN coverage); live `https://minidraft.app/health` -> `200 {"status":"healthy","model_loaded":true}`, live HTML serving `assets/index-D63M18OL.js` and `assets/index-lnmJj0ei.css`.
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-25 13:24 (UTC+7) — Live PromptPay Billing, Free Pro Promo (until `2026-12-07`), Scrim Analytics, Hero Pools & Feedback Inbox (`947cfd9`)
- **Base Commit:** Fast-forwarded `~/rov` (sparse-checkout intact across all 19 paths) cleanly from `4252991` to `947cfd9` (`main`).
- **Live Config (`~/rov/deploy/.env` & `deploy/compose.yaml`):** Configured live `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ROV_STRIPE_LIVE_ENABLED=true`, and `ROV_FREE_PROMO_UNTIL=2026-12-07T00:00:00+07:00`.
- **Deployed Delta:**
  - **Claimable Free Pro Promo until Dec 7, 2026 (`src/config.py`, `src/db.py`, `src/billing.py`, `src/api.py`, `PricingSurveyModal.tsx`, `BillingSandbox.tsx`):** Added `promo_claims` table, `POST /billing/promo/claim`, profile claim card with dynamic expiry formatting, and promo banner inside the Update Announcement modal (auto-hidden once claimed or paid).
  - **Live PromptPay Billing, Teams, Hero Pools & Free 14-Game Cap (`BillingSandbox.tsx`, `TeamSandbox.tsx`, `HeroPoolsModal.tsx`, `src/db.py`):** Enabled live prepaid passes (`Pro` 59/139, `Duo` 109/259, `Business` 239/569 THB), Guest (3) / Free (14) / Paid (500) personal history caps, 5-lane Hero Pools (Free 2 / Paid 50 + Team 50), team invite `"User not found"` feedback, mobile Hero Pools sheet layout, and streamlined `#plans` copy.
  - **Scrim Analytics Top Tab, Sample League & PDF (`ScrimDashboardView.tsx`, `src/sample_analytics.py`, `App.tsx`, `MobileNavDrawer.tsx`):** Promoted `สถิติซ้อมทีม` (`#analytics`) into the top nav bar next to `ฝึกดราฟต์ vs AI`, right-aligned category tabs on `sm+`, unified Guest/Free sample dataset (`SAMPLE LEAGUE 2026` / `VGD`), and added explicit `Profile` button above `Plans` in `MobileNavDrawer`.
  - **Update Announcement + Text Feedback + Admin Inbox (`PricingSurveyModal.tsx`, `AdminDashboardView.tsx`, `AdminStatsModal.tsx`, `src/api.py`, `src/db.py`):** Added rate-limited `POST /feedback` -> `user_feedback` table and fail-closed owner-only `GET /admin/feedback`; archived deferred Screenshot Import (`docs/archive/screenshot_draft_import/`) and unused Meta/Combat Lab UI (`docs/archive/meta_and_combat_labs/`).
  - **Catch-Up DB Timestamp Backfill:** Created online SQLite backup `/app/db/rov_app.db.bak-20261125-1323` (`4,243,456` bytes) via `sqlite3.Connection.backup()`; updated `26` remaining undated games across `14` `user_draft_states` rows (`517` total games across `939` rows; `0` undated left, `bad_len=0`, `mismatched=0`).
- **Bundle Built:** `dist-prod/index.html`, `dist-prod/assets/index-5Swasnsa.js`, `dist-prod/assets/index-lnmJj0ei.css`.
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data`, `deploy-caddy-1`, `rov-cloudflared` untouched).
- **Verification:**
  - Pre-deploy: 3 parallel Playwright QA agents (`0` P0/P1 bugs), `pytest -q --tb=short` (`163 passed`), `ruff` clean, `oxlint` (`0` warnings / `0` errors across `64` files), `vite build` & `build:prod` clean, `audit_copy_i18n.py` (`[PASS]`, 100% EN coverage), `audit_ux_ui.py` (`[PASS]`), `preflight_check.py` (`[OK]`).
  - Live (`https://minidraft.app/`): `/health` -> `200 {"status":"healthy","model_loaded":true}`, `/auth/me` -> `stripe_sandbox_enabled: true`, `stripe_livemode: true`, `free_promo_until: 1796576400` (`2026-12-07 00:00:00+07:00`), `/admin/feedback` unauthenticated -> `404`; Playwright live smoke check passed with `0` console/page errors and `0` horizontal overflow on Desktop (`1280x800`) & Mobile (`375x667`).
  - Persistent DB (`/app/db/rov_app.db`) intact: `users: 987`, `user_oauth_accounts: 937`, `user_draft_states: 939`, `user_practice_histories: 43`, `team_history: 0`, `promo_claims: 0`, `user_feedback: 0`, `daily_visits: 1488`.
- **VM Sync Note:** Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-24 10:38 (UTC+7) — Production DB-Only One-off Timestamp Backfill (`"2026-11-24 10:00"`, Base Commit Unchanged `4252991`)
- **Action**: Executed DB-only in-place timestamp backfill on live `/app/db/rov_app.db` via `docker exec -i deploy-app-1 python -` stdin (no `git push`, no `git pull` on VM, no container rebuild; sparse-checkout intact).
- **Backup**: `/app/db/rov_app.db.bak-20261124-1036` (`3,911,680` bytes) created via `sqlite3.Connection.backup()`.
- **Summary**:
  - Updated all `504` existing games across `220` modified `user_draft_states` rows (`903` total state rows, `949` users; `team_history` not yet present on live `4252991`) to `timestamp = "2026-11-24 10:00"`.
  - Bumped `user_draft_states.updated_at` and `payload.updatedAt` (preserving ms/sec units) on modified rows so logged-in clients automatically pull the updated timestamps on refresh.
- **Verification**:
  - Post-update read-only SQLite check (`ALL_PROD_VERIFY_PASSED`): `users=949`, `user_draft_states=903`, `total_games=504`, `matched=504`, `mismatched=0`, `bad_len=0`.
  - Live `https://minidraft.app/health`: HTTP `200` (`{"status":"healthy","model_loaded":true}`).

### 📅 2026-11-22 21:33 (UTC+7) — Remove Full `TeamColumn` Turn Badge & Auto-Reset `HeroGrid` Lane Filter to `ALL` (`4252991`)
- **Commit**: `4252991` (`feat(ui): remove full TeamColumn turn badge and auto-reset lane filter to ALL`)
- **Summary**:
  - Removed the redundant `NOW` / `ON THE CLOCK` turn badge from `TeamColumn` (`variant="full"`), keeping `ScoreBar` and pulsing gold slot borders uncluttered.
  - Updated `HeroGrid` (`laneResetKey` + `lockHeroAndResetLane`) and callers (`DraftBoardView`, `PracticeDraftView`, `MetaLab`) so selecting/replacing a hero via `HeroGrid`, `AiPanel`, or ghost slots resets the active lane filter back to `ALL`.
- **Built Assets (`dist-prod/`)**: `index.html` (`2.96 kB`), `assets/index-7UEaMoXV.css` (`129.60 kB`), `assets/index-B-WaLS7p.js` (`714.67 kB`).
- **Verification**:
  - Local: `npm run lint` (`0` warnings, `0` errors across `67` files), `npm run build` (`tsc -b && vite build`), `ruff check --fix .` & `ruff format .`, and Playwright `1440x900` against `http://127.0.0.1:8000` (`UI_VERIFY_OK`, `errors: 0`).
  - Live (`https://minidraft.app/`): `/health` returned `200 {"status":"healthy","model_loaded":true}`; Playwright `1440x900` verified `UI_VERIFY_OK` on both Draft Board and Practice vs AI (`mid_activated: true`, `all_reset: true`, `no_turn_badge: true`, `errors: 0`).
  - Persistent DB (`/app/db/rov_app.db`): preserved intact (`users: 906`, `user_oauth_accounts: 860`, `user_draft_states: 865`, `user_practice_histories: 13`, `auth_sessions: 948`, `pricing_survey_responses: 379`, `daily_visits: 849`).
- **VM Sync Note**: Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-22 21:05 (UTC+7) — Place Ban Slots Above Pick Slots in Full `TeamColumn` (`af45b80`)
- **Commit**: `af45b80` (`feat(ui): place Ban slots above Pick slots in full TeamColumn`)
- **Summary**: Reordered `frontend/src/components/TeamColumn.tsx` (`variant="full"`) so the 4-slot Ban row (`B1..B4`) renders at the top above the 5-slot Pick stack (`1..5`) across both Draft Board and Practice vs AI desktop views.
- **Built Assets (`dist-prod/`)**: `index.html` (`2.96 kB`), `assets/index-7UEaMoXV.css` (`129.60 kB`), `assets/index-BzpQ5bH6.js` (`714.72 kB`).
- **Verification**:
  - Local: `npm run lint` (`0` warnings/errors), `npm run build` (`tsc -b && vite build`), `ruff check --fix .` & `ruff format .`, and local Playwright `1440x900` layout check (`BAN_ABOVE_PICK_OK`, `0` errors).
  - Live (`https://minidraft.app/`): `/health` returned `200 {"status":"healthy","model_loaded":true}`; Playwright `1440x900` verified `BAN_ABOVE_PICK_OK` on both Draft Board and Practice vs AI (`blue: ban1_y=179 < pick1_y=267`, `red: ban1_y=179 < pick1_y=267`, `0` console/page errors).
  - Persistent DB (`/app/db/rov_app.db`): preserved intact (`users: 906`, `user_oauth_accounts: 860`, `user_draft_states: 865`, `user_practice_histories: 13`, `auth_sessions: 948`, `pricing_survey_responses: 377`, `daily_visits: 836`).
- **VM Sync Note**: Docs-only commit recording this release is pushed to `origin/main` without running `git pull` on the VM (sparse-checkout guardrail).

### 📅 2026-11-22 15:55 (UTC+7) — Stratify 7-Day Active Returning Users into Regulars vs One-Time Returnees (`fc06c96`)
- **Base Commit:** Fast-forwarded `~/rov` (sparse-checkout) cleanly from `86dc150` to `fc06c96` (`main`).
- **Delta:**
  - `src/db.py` (`get_admin_stats()["retention"]`): Added 7-day rolling active returning cohort stratification (`active_returning_7d`, `active_returning_7d_pct`, `active_repeat_3plus_7d` for `>= 3` visit days, `active_returned_once_7d` for `2` visit days, and `dormant_returning` for inactive `> 7` days) while keeping `returning_clients` cumulative count for historical comparison.
  - `frontend/src/types/auth.ts`, `frontend/src/components/AdminDashboardView.tsx`, `frontend/src/components/AdminStatsModal.tsx`, `frontend/src/i18n/englishMessages.ts`: Updated Returning Users KPI cards to surface 7-day active returning clients and separate regulars (`3+` days) from 1-time returnees (`2` days) and churned (`> 7` days).
  - `tests/test_api.py`: Expanded `test_daily_visit_telemetry_and_retention_stats` for `3+`-day active, `2`-day active, and `>7d` dormant returning cohorts.
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-CAYnP3Ja.js` (`714.72 kB`), `dist-prod/assets/index-7UEaMoXV.css` (`129.60 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data`, `deploy-caddy-1`, `rov-cloudflared`, and `deploy/.env` untouched).
- **Verification:**
  - Pre-deploy: `oxlint` `0` warnings / `0` errors across 66 files; `vite build` `1.75s`; `ruff` clean; `pytest -q --tb=short` `139 passed` (`46.46s`).
  - `https://minidraft.app/health` -> `200` (`{"status":"healthy","model_loaded":true}`), `https://minidraft.app/admin/stats` (unauthenticated) -> `404`.
  - Live `deploy-app-1` `get_admin_stats()["retention"]`: `active_returning_7d = 70` (`active_repeat_3plus_7d = 12`, `active_returned_once_7d = 58`, `dormant_returning = 0`, `today_dau = 156`).
  - `/app/db/rov_app.db` intact (`users: 896`, `user_oauth_accounts: 851`, `user_draft_states: 855`, `user_practice_histories: 8`, `auth_sessions: 938`, `pricing_survey_responses: 362`, `daily_visits: 768`).

### 📅 2026-11-22 15:24 (UTC+7) — Align Feedback Survey Button Label & Single-Line Status in `MobileNavDrawer` (`86dc150`)
- **Base Commit:** Fast-forwarded `~/rov` (sparse-checkout) cleanly from `6f41a4f` to `86dc150` (`main`).
- **Delta:**
  - `frontend/src/components/MobileNavDrawer.tsx`: Shortened survey action label from `"แบบสอบถาม / Feedback"` to `"แบบสอบถาม"` (`"Feedback Survey"`), shortened visible right status pill to `"ตอบแล้ว"` / `"ยังไม่ได้ตอบ"`, and moved the full choice breakdown (`"ตอบแล้ว: พร้อมจ่าย"` / `"ตอบแล้ว: ไม่พร้อม"`) into the button `title` tooltip.
  - `frontend/src/components/StableButtonLabel.tsx` & `frontend/src/i18n/englishMessages.ts`: Added `self-center` vertical centering inside the dual-language grid and `"แบบสอบถาม": "Feedback Survey"` translation key.
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-CmB764jK.js` (`713.70 kB`), `dist-prod/assets/index-BNeNphRr.css` (`129.45 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data`, `deploy-caddy-1`, `rov-cloudflared`, and `deploy/.env` untouched).
- **Verification:**
  - `oxlint`: `0` warnings / `0` errors across 66 files; `vite build`: `1.94s`; `ruff`: clean (`136` files unchanged).
  - `https://minidraft.app/health` -> `200` (`{"status":"healthy","model_loaded":true}`).
  - Live Playwright E2E (`verify_feedback_btn_alignment.py` on `https://minidraft.app/`, `360x800` & `1440x900`): confirmed single-line `16px` height, `0.0px` icon-to-label and `0.01px` icon-to-status vertical midpoint delta in both Thai & English, and `0` console/page errors.
  - `/app/db/rov_app.db` intact (`users: 895`, `user_oauth_accounts: 850`, `user_draft_states: 854`, `user_practice_histories: 8`, `auth_sessions: 937`, `pricing_survey_responses: 360`, `daily_visits: 761`).

### 📅 2026-11-22 13:36 (UTC+7) — Production-Only VM Working Tree (`git sparse-checkout --no-cone`) & `.dockerignore` Hardening
- **VM Working Tree (`~/rov` on `rov-draft-vm`)**: Enabled `git sparse-checkout --no-cone` restricted strictly to production build/runtime files (`/Dockerfile`, `/.dockerignore`, `/requirements.txt`, `/deploy/**`, `/configs/**`, `/src/**`, `/frontend/**`, `/models/sota_draft_gnn_transformer.pt`, and the 11 serving `/data/*` files), removing dev/training/archive/doc clutter (`~38 MB` working-tree files) from VM disk while preserving `deploy/.env` and `deploy_rov_db_data`.
- **Docker Context (`.dockerignore`)**: Explicitly excluded `.wikiskill/`, `.agents/`, `.claude/`, and `.github/` from Docker build contexts.

### 📅 2026-11-22 13:23 (UTC+7) — Increase Owner Dashboard Typography Scale (`6fec71a`)
- **Frontend UI Typography (`frontend/src/components/AdminDashboardView.tsx`)**: Eliminated micro `9px`/`10px` fonts across all analytics cards, badges, tables, and SVG survival plot axes (`fontSize="11"`, `text-xs sm:text-sm` body/tables, `text-sm sm:text-base` card headings).
- **Verification & Live Rollout**: Passed `oxlint` (`0 warnings, 0 errors`), `tsc -b && vite build`, Playwright E2E (`min table/strong fontSize=12px, 0 errors`), and `preflight_check.py`. Deployed via `sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched), live HTML serving `index-CIqebms0.js` / `index-BxP94eC5.css`.

### 📅 2026-11-22 13:17 (UTC+7) — Plain-Thai Owner-Friendly Copy Localization (`25d680d`)
- **Frontend UI Copy (`frontend/src/components/AdminDashboardView.tsx`)**: Replaced academic jargon across all analytics cards, interval bars, behavioral signal tables, and user retention badges with plain-Thai labels and 1-sentence owner takeaways (`สรุปให้`), keeping citations collapsed at the bottom drawer.
- **Verification & Live Rollout**: Passed `oxlint` (`0 warnings, 0 errors`), `tsc -b && vite build`, Playwright E2E (`/#admin` desktop + mobile + SVG + zero console errors), and `preflight_check.py`. Deployed via `sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched), live HTML serving `index-Bmz-m1vZ.js` / `index-BswwniSY.css`.

### 📅 2026-11-22 13:10 (UTC+7) — Research-Grade Dashboard Visualizations & Literature Models (`3fec0dc`)
- **Backend Research Models (`src/analytics.py`, `src/schemas.py`)**: Implemented Fader-Hardie BG/NBD `P(Alive)` segmentation & per-user `user_btyd_scores`, Pfeifer-Carraway 3x3 Markov Transition Matrix + 14-day finite-horizon expectation + steady-state equilibrium, nonparametric right-censored Kaplan-Meier survival curves (`member` vs `guest` + Greenwood 95% CI), Kohavi Statistical Power / MDE=10pp guardrails & `p95 <= 500ms` SLA, and Sifa et al. (2015) behavioral feature-to-WTP signal matrix.
- **Dashboard UI (`frontend/src/components/AdminDashboardView.tsx`, `frontend/src/types/auth.ts`)**: Added responsive SVG Kaplan-Meier survival curve, 3x3 Markov migration heatmap, BTYD `P(Alive)` stacked cohort health bar, Wilson/Bayes 95% CI interval bars with Kohavi Power guardrail badges, Sifa behavioral signal table, sortable `BTYD P(Alive)` user column, and collapsible academic citations drawer.
- **Verification & Live Rollout**: Passed `pytest` (`139 passed`), `ruff check/format`, `oxlint` (`0 warnings, 0 errors`), `tsc -b && vite build`, Playwright research dashboard E2E (`/#admin` desktop + mobile + SVG + zero console errors), `audit_arch_perf.py --skip-bench`, `preflight_check.py`, and `validate_gating.py`. Deployed via `sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched); `/health` healthy (`model_loaded: true`), `/admin/analytics` unauthenticated `404`, live HTML serving `index-_zWybZtk.js` / `index-BswwniSY.css`.

### 📅 2026-11-22 12:55 (UTC+7) — Expanded Telemetry & Stochastic / Statistical Inference Engine (`15ce12a`)
- **Pure-Python Stochastic & Statistical Engine (`src/analytics.py`)**: Added `build_statistical_analytics(conn, today_str)` computing Markov retention transitions, absorbing streak `E[L]`, survival curve, Bayesian `Beta(1, 3)` WTP segmentation + 95% Wilson CIs + Two-Proportion Z-tests + Spearman `rho`, Member-vs-Guest retention Relative Risk (`RR`), usage overdispersion (`Var/Mean`) + Gini + Pareto concentration, Gamma-Poisson next-day DAU/AI load forecast, Binomial AI Top-5 Trust Z-test, and piecewise-linear latency quantiles (`p50`/`p95`).
- **Telemetry Schema & Endpoints (`src/db.py`, `src/schemas.py`, `src/api.py`)**: Added `site_events_daily`, migrated `daily_visits` (`predict_count`, `device_type`), added `POST /telemetry/event`, `X-Client-Id` CORS header + guest predict attribution on `POST /predict`, latency buckets, and owner-only `GET /admin/analytics` (`404` for guests/non-admins).
- **Frontend Telemetry & Dashboard (`frontend/src/`)**: Wired `device_type`, `X-Client-Id` on `/predict`, fire-and-forget `/telemetry/event` tracking (`draft_complete`, `practice_complete`, `ai_pick`, feature usage), and full stochastic inference visualizations in `AdminDashboardView.tsx`.
- **Verification & Live Rollout**: Passed `pytest` (`139 passed`), `ruff check/format`, `oxlint` (`0 warnings, 0 errors`), `tsc -b && vite build`, Playwright E2E, `audit_arch_perf.py`, and `validate_gating.py`. Deployed via `sudo docker compose up -d --build app` (`deploy_rov_db_data` preserved); `/health` healthy (`model_loaded: true`), `/admin/analytics` unauthenticated `404`, live HTML serving `index-CG-lnUfb.js` / `index-DKEIpV1d.css`.

### 📅 2026-11-22 12:01 (UTC+7) — Owner Full-Screen Analytics Dashboard (`/#admin`), `GET /admin/users` & Per-User Usage Tracking (`8767742`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `3292617` to `8767742` (`main`).
- **Delta:**
  - **Backend (`src/db.py`, `src/schemas.py`, `src/api.py`):** Added `user_usage_daily` table (`predict_count`, `draft_save_count`), `record_user_usage()`, SQL-aggregated `get_admin_users_report()`, and owner-only `GET /admin/users` (`404` for guests and non-admins).
  - **Frontend (`AdminStatsModal.tsx`, `AdminDashboardView.tsx`, `App.tsx`, `types/auth.ts`):** Kept existing `AdminStatsModal` layout unchanged with a new `Dashboard` (`ExternalLink`) header link opening `/#admin` in a new tab; built full-screen `AdminDashboardView` with KPI summary, searchable/filterable/sortable Power Users leaderboard, unlinked Guest device leaderboard, and Cloudflare referer breakdown.
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-D1d9Azcg.js` (`683.62 kB`), `dist-prod/assets/index-Ds-wpNa7.css` (`128.58 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched).
- **Verification:**
  - Local gates prior to push: `pytest -q --tb=short` (`139 passed`), `oxlint` (`0` warnings / `0` errors), `validate_gating.py` (`72/72` Golden Draft States, `3/3` Duel Benchmarks), and Playwright E2E verifying `Stats` modal -> new-tab `/#admin` popup with `0` runtime errors and no horizontal overflow.
  - Live `https://minidraft.app/health` -> `200` (`{"status":"healthy","model_loaded":true}`), `/admin/stats` & `/admin/users` (unauthenticated) -> `404`, live HTML references `index-D1d9Azcg.js` & `index-Ds-wpNa7.css`, `get_admin_users_report()` returns `total_users: 893` and `top_guests: 50`.

### 📅 2026-11-22 11:39 (UTC+7) — Mobile UX Density, GNN Serving Cache, Multi-Device Sync Hardening & SQLite Indexing (`13758c4`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `113bde2` to `13758c4` (`main`), migrating `deploy/docker-compose.yml` -> `deploy/compose.yaml`.
- **Delta:**
  - **Mobile UX & Hero Grid (`frontend/src/App.tsx`, `DraftBoardView.tsx`, `HeroGrid.tsx`, `index.css`):** Removed duplicate mobile AI PICK/BAN strip during active drafts (retaining `#1–#10` grid badges, mobile AI tab, and 18/18 summary), removed shared role dropdown from `HeroGrid`, moved free-access banner to mobile menu, compacted bottom nav to one line, and fit search + lane filters on one row on short phones (`>= 3` hero rows visible).
  - **Multi-Device Sync Hardening (`src/schemas.py`, `src/db.py`, `src/api.py`, `frontend/src/components/PracticeDraftView.tsx`, `frontend/src/utils/practiceHistory.ts`, `frontend/src/hooks/useDraft.ts`):** Added server-side entry merge (`id`/`signature`), `deletedIds` & `clearedAt` tombstones, monotonic server-issued `updatedAt` revision bump on merge, client `pushSeqRef` sequence guard, and authoritative DB echo reconciliation on `PUT /draft/session`.
  - **Serving & SQLite Performance (`src/train_sota_model.py`, `src/predictor.py`, `src/db.py`):** Precomputed static `H_gnn` embeddings during `eval()` (`precompute_gnn_embeddings()`), added composite index `idx_auth_sessions_user_created ON auth_sessions(user_id, created_at)`, and moved `daily_visits` retention analytics to SQLite CTEs.
  - **Security & Trainer Hygiene (`src/config.py`, `deploy/compose.yaml`, `src/train_sota_model.py`, `scripts/fetch_hero_icons.py`):** Fail-closed `ROV_ADMIN_USERNAMES` (`deploy/.env` explicitly defines `chayanin5392`), strict `FileNotFoundError` when curated training dataset is missing, series-boundary 85/15 split (`series_overlap=0`), and manifest completeness guard on icon fetches.
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-OYcteBXS.js` (`665.66 kB`), `dist-prod/assets/index-DyAYAAUJ.css` (`128.26 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data`, `deploy-caddy-1`, `rov-cloudflared`, and `deploy/.env` untouched).
- **Verification:**
  - Local gates prior to push: `pytest -q --tb=short` (`139 passed`), `audit_arch_perf.py` (`direct median=8.0 ms, depth-2 median=13.6 ms`, `series_overlap=0`), `validate_gating.py` (`72/72` Golden Draft States in `1.35s`, `3/3` Duel Benchmarks), `oxlint` (`0` warnings / `0` errors), `ruff` clean, plus dual-agent Playwright QA across Draft Board & Draft vs AI on Desktop (`1280x800`) and Mobile (`375x667`, `360x640`).
  - Live `https://minidraft.app/health` -> `200` (`{"status":"healthy","model_loaded":true}`), `/admin/stats` (unauthenticated) -> `404`, live HTML references `index-OYcteBXS.js` & `index-DyAYAAUJ.css`.
  - `/app/db/rov_app.db` intact (`users: 892`, `user_draft_states: 850`, `user_practice_histories: 8`, `daily_visits: 715`, `idx_auth_sessions_user_created` migrated cleanly).

### 📅 2026-11-21 22:47 (UTC+7) — Auto-Stop Draft Turn Timer on Draft Completion, Reset, & Game Transition (`a248e7c`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `f34fc15` to `a248e7c` (`main`).
- **Delta:**
  - `frontend/src/hooks/useDraftTimer.ts`: Disabled `enabled` persistence across page reloads (`localStorage` retains only `preset`, `soundEnabled`, and `autoLock`), and auto-disabled `enabled` whenever `currentStep === null` (`18/18 COMPLETE`) or `resetSignal` (`gameNumber` / `seriesName`) changes.
  - `frontend/src/components/ScoreBar.tsx` & `frontend/src/components/DraftBoardView.tsx`: Hid timer entry/countdown controls when `currentStep === null` (`COMPLETE`) and called `timer.setEnabled(false)` on draft `Reset` and `FinishGameModal` `onConfirmWinner`.
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-CXX5ped2.js` (`664.60 kB`), `dist-prod/assets/index-sNaMQu7-.css` (`128.19 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data`, `deploy-caddy-1`, `rov-cloudflared`, and `deploy/.env` untouched).
- **Verification:**
  - `oxlint`: `0` warnings / `0` errors across 64 files; `vite build`: `1.35s`; `ruff`: clean (`119` files unchanged).
  - `https://minidraft.app/health` -> `200` (`{"status":"healthy","model_loaded":true}`).
  - Live Playwright E2E (`verify_timer_autostop.py` on `https://minidraft.app/`): verified timer enables on Step 1, auto-stops and hides controls/clock at `18/18 COMPLETE`, stays OFF when advancing to `Game 2`, turns OFF on `Reset draft`, and emitted `0` console/page errors.
  - `/app/db/rov_app.db` intact (`users: 869`, `user_oauth_accounts: 826`, `user_draft_states: 828`, `user_practice_histories: 1`, `auth_sessions: 911`, `pricing_survey_responses: 313`, `daily_visits: 599`).

### 📅 2026-11-21 22:18 (UTC+7) — Deploy Responsive Spotlight Hero Replace (Focus Lock) & Single-Row Practice Mobile Bar (`6253177`)
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `10600a8` to `6253177` (`main`).
- **Delta:**
  - **Responsive Hero Replacement (`DraftBoardView.tsx`, `HeroGrid.tsx`, `TeamColumn.tsx`, `englishMessages.ts`):**
    - On Desktop/iPad (`>= 768px`), replaced `HeroPickerModal` popup with **Spotlight Replace Mode (Option A)** inline inside `HeroGrid` (`AiPanel` dimmed `opacity-30 pointer-events-none` with zero height shift, opposite team column dimmed `opacity-45`, golden grid frame with `[Old Hero] -> [?]` header, `"ตัวเดิม"`/`"เปลี่ยน"` badges, Desktop search auto-focus, two-step `Esc` handling, and single pulsing **`กำลังแก้`** slot) guarded by a full-screen focus-lock scrim (`data-replace-backdrop`, `z-30`), trapped `Tab`/`Shift+Tab`, and locked Undo/Redo & `TeamColumn` actions until resolved or canceled.
    - On Phone (`< 768px`), kept `<HeroPickerModal mobileSheet />` bottom-sheet popup cleanly without switching away from the active tab (`banOpensDialog` + `aria-haspopup` synced to viewport).
  - **Compact Practice Sub-Header (`PracticeDraftView.tsx`):** Compressed the `< 640px` mobile bar into a single `39px` row (`BoX` `<select>`, `G1/7`, `BLUE`/`RED` + shuffle, icon-first action buttons) and changed **"เริ่มรอบใหม่"** to solid gold `PlusCircle` so it is clearly distinct from red **`RESET`** (`RotateCcw`).
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-C2grrDgg.js` (`664.41 kB`), `dist-prod/assets/index-sNaMQu7-.css` (`128.19 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data`, `deploy-caddy-1`, `rov-cloudflared`, and `deploy/.env` untouched).
- **Verification:**
  - Pre-deploy `pytest -q --tb=short`: `135 passed` (`22.90s` / `36.10s`), `oxlint`: `0` warnings/`0` errors, `vite build`: `1.32s`, `ruff`: clean (`119` files unchanged).
  - `https://minidraft.app/health` -> `200` (`{"status":"healthy","model_loaded":true}`).
  - Live Playwright E2E on `https://minidraft.app/`: verified Desktop (`1440x900`) Focus Lock backdrop + `HeroGrid` height (`472.8 -> 472.8`) + Ban replace, Phone (`390x844`) popup sheet Ban replace, `#practice` (`360x800`) single `39px` sub-header + `PlusCircle` vs `RotateCcw` + zero horizontal overflow, and `0` console/page errors.
  - `/app/db/rov_app.db` intact (`users: 867`, `user_oauth_accounts: 824`, `user_draft_states: 826`, `user_practice_histories: 1`, `auth_sessions: 909`, `pricing_survey_responses: 309`, `daily_visits: 588`).

### 📅 2026-11-21 21:11 (UTC+7) — Deploy Cross-Device Sync for Draft vs AI History (`/draft/practice-history`, `user_practice_histories`)
- **Database Backup:** Created online SQLite backup `/app/db/rov_app.db.bak_20261121_sync` inside `deploy_rov_db_data` prior to schema update adding `user_practice_histories`.
- **Delta:** Added isolated `user_practice_histories` SQLite table + `GET/PUT/DELETE /draft/practice-history` endpoints (`src/db.py`, `src/schemas.py`, `src/api.py`), frontend cross-device sync (`PracticeDraftView.tsx`, `practiceHistory.ts`, `client.ts`, `App.tsx`) with `meta.recordedSignatures` delete non-resurrection guard, and `tests/test_api.py` isolation tests.
- **Bundle Built:** `dist-prod/index.html` (`3.01 kB`), `dist-prod/assets/index-CKQbz309.js` (`655.20 kB`), `dist-prod/assets/index-BKHs1Fu2.css` (`125.16 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched).

### 📅 2026-11-21 20:56 (UTC+7) — Unified Slide-Out Menu Drawer Across All Viewports (`minidraft.app`)
- **Delta:** Updated `frontend/src/App.tsx` and `frontend/src/components/MobileNavDrawer.tsx` so the `≡` menu trigger renders across all screen sizes, moving secondary desktop actions (`LanguageSwitch`, `Stats`, `Feedback`, `Donate`, `Logout`) into the slide-out drawer and removing `min-width: 1024px` auto-close (keeping Mode Navigation `lg:hidden` in the drawer).
- **Bundle Built:** `dist-prod/index.html` (`3.01 kB`), `dist-prod/assets/index-BHFXkT_p.js` (`652.03 kB`), `dist-prod/assets/index-BKHs1Fu2.css` (`125.16 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched).

### 📅 2026-11-21 20:47 (UTC+7) — Enable Bilingual Language Switch (`ไทย` / `EN`) on Production (`minidraft.app`)
- **Delta:** Updated `frontend/src/i18n/language.ts` (`languageSwitchEnabled = true`) so the smooth sliding `ไทย` / `EN` language switch renders in production (`VITE_DRAFT_ONLY=true`) across `AuthLanding`, Desktop Navbar, and `MobileNavDrawer` with full 966-key English localization (`englishMessages.ts`).
- **Bundle Built:** `dist-prod/index.html` (`3.01 kB`), `dist-prod/assets/index-DfrnWxNW.js` (`654.75 kB`), `dist-prod/assets/index-CdOMJcVs.css` (`125.17 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched).

### 📅 2026-11-21 20:28 (UTC+7) — Dev-to-Prod Cutover: Deploy Draft Board + Draft vs AI, Assistant Toggle, Practice History & Draft Turn Timer (`981b773`)
- **Database Backup:** Created online SQLite backup `/app/db/rov_app.db.bak_20261121` inside `deploy_rov_db_data` prior to container rebuild (`users: 856`, `user_oauth_accounts: 813`, `user_draft_states: 816`, `auth_sessions: 896`, `pricing_survey_responses: 290`, `daily_visits: 519`).
- **Base Commit:** Fast-forwarded `~/rov` cleanly from `4dbc614` to `981b773` (`main`) after reconciling VM hotfixes (`deploy/.env` untouched).
- **Key Features Shipped:**
  - Enabled **Draft vs AI** (`#practice`, `PracticeDraftView.tsx`) alongside **Draft Board** under `VITE_DRAFT_ONLY=true`, keeping `Meta Tier List`, `MetaLab`, and `Combat Lab` hidden.
  - Added isolated local **Practice History** (`PracticeHistoryModal.tsx`, `practiceHistory.ts`) with Review/Pick replay loading and summary stats.
  - Replaced the standalone Lookahead button on `DraftBoardView`/`ScoreBar` with the **`ตัวช่วย` (`Assistant`)** toggle (defaults ON on both Draft Board and Draft vs AI; turning OFF skips `/predict` calls and switches the center bar to Draft Progress).
  - Shipped **Draft Turn Timer** (`useDraftTimer.ts` with `0:40`/`0:60` official RoV clock, pause/reset, audio cues, auto-lock; `3s` test preset hidden off localhost), bilingual i18n copy, individual slot editing (`DraftPickActions`), and `ProfileView` (`/auth/profile`).
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-CP_XwVbT.js` (`565.26 kB`), `dist-prod/assets/index-DO23SNI6.css` (`125.16 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy-caddy-1`, `rov-cloudflared`, and `deploy_rov_db_data` untouched).
- **Verification:**
  - `https://minidraft.app/health` -> `200` (`{"status":"healthy","model_loaded":true}`).
  - Live Playwright E2E on `https://minidraft.app/`: verified `Draft Board` + `ฝึกดราฟต์ vs AI` tabs visible (`Meta Tier List` / `MetaLab` / `Combat Lab` hidden), Draft Turn Timer (`0:40`), Assistant toggle OFF -> `0` `/predict` calls, `#practice` Assistant ON + History button visible, `0` overflow on Desktop (`1440x900`) & Mobile (`390x844`), and `0` console/CSP/page errors.
  - `/app/db/rov_app.db` intact (`users: 856`, `user_oauth_accounts: 813`, `user_draft_states: 816`, `auth_sessions: 896`, `pricing_survey_responses: 292`, `daily_visits: 523`).

### 📅 2026-11-20 23:43 (UTC+7) — Deploy 90-Day Half-Life SOTA Checkpoint (Trial #31) & Updated 4,352-Game Dataset
- **Base + Delta:** `4dbc614` + existing hotfixes + synced `models/sota_draft_gnn_transformer.pt` (`90d` half-life Trial #31, `val_loss = 2.81796`, `win_acc = 51.69%`), `configs/selected_production_params.json`, `best_params/sota_rov_best_params.json`, `best_params/sota_rov_top5_trials.json`, `data/` (`4,352` total matches, `3,535` training games, `1,833` true pick order, rebuilt synergy/counter/draft stats CSVs), and `frontend/public/dataset_metadata.json` (`frontend/dist-prod/dataset_metadata.json`). Dev-only features (Draft Turn Timer, Ranked 10-Ban) remain excluded.
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-Cq1516Ka.js` (`473.72 kB`), `dist-prod/assets/index-koghUP00.css` (`113.81 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched).
- **Verification:**
  - `https://minidraft.app/health` -> `200` (`{"status":"healthy","model_loaded":true}`).
  - `https://minidraft.app/predict` -> `200` returning live recommendations.
  - Inside `deploy-app-1`: verified `ckpt['val_loss'] = 2.81796`, `win_acc = 51.69%`, `total_matches = 4352`, `training_matches = 3535`, and `/app/db/rov_app.db` intact (`803` users).

### 📅 2026-11-20 20:02 (UTC+7) — Add First-Party Returning Users & D1+ Retention Tracking (`daily_visits` & `POST /telemetry/visit`)
- **Base + Delta:** `4dbc614` + existing hotfixes + updated `src/db.py` (`daily_visits` table, `record_daily_visit`, `retention` metrics in `get_admin_stats`), `src/schemas.py` (`DailyVisitRequest`, `DailyVisitResponse`, `retention`), `src/api.py` (`POST /telemetry/visit`), `frontend/src/types/auth.ts`, `frontend/src/App.tsx` (once-per-day UTC+7 telemetry ping), and `frontend/src/components/AdminStatsModal.tsx` (Retention & Returning Users section).
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-Cq1516Ka.js` (`473.72 kB`), `dist-prod/assets/index-koghUP00.css` (`113.81 kB`).
- **Verification:**
  - Local dev E2E (`127.0.0.1:8011`) via Playwright verified once-per-day ping, reload deduplication, login `user_id` linking, `AdminStatsModal` rendering, `0` console/page errors.
  - Live production: `https://minidraft.app/health` -> `200`, `https://minidraft.app/admin/stats` (unauth) -> `404`, and `deploy-app-1` `get_user_db().get_admin_stats()["retention"]` initialized cleanly.

### 📅 2026-11-20 19:50 (UTC+7) — Add Cloudflare RUM Top Traffic Sources / Referrers Breakdown to `AdminStatsModal` (`@chayanin5392`)
- **Base + Delta:** `4dbc614` + existing hotfixes + updated `src/api.py` (`_normalize_referer_host`, `_aggregate_referers`, `referers_today`, `referers_7d` in `_fetch_cloudflare_stats()`), `frontend/src/types/auth.ts`, and `frontend/src/components/AdminStatsModal.tsx` (Top Sources card with `วันนี้` / `7 วัน` toggle and share bars).
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-D5fHzaxf.js` (`470.07 kB`), `dist-prod/assets/index-koghUP00.css` (`113.81 kB`).
- **Verification:**
  - `https://minidraft.app/health` -> `200`, `https://minidraft.app/admin/stats` (unauthenticated) -> `404`.
  - Live `deploy-app-1` `_fetch_cloudflare_stats()` returned `today_uniques=1006` along with `referers_today` and `referers_7d` (grouped into `Direct / แอปแชต`, `Google Search`, `Facebook`, `Instagram`, `Google OAuth`, `Bing`, `Discord`, etc.).

### 📅 2026-11-20 16:10 (UTC+7) — Isolate Unsaved Draft Scratchpad (`unsavedDraftsRef`) When Switching Games (`G2 -> G1 -> G2`)
- **Base + Delta:** `4dbc614` + existing hotfixes + patched `frontend/src/hooks/useDraft.ts` (`unsavedDraftsRef` preserves in-progress unsaved drafts when peeking at another game without auto-saving into `seriesGames`).
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-BndtgRZC.js` (`468.12 kB`), `dist-prod/assets/index-exoc_w53.css` (`113.55 kB`).
- **Verification:**
  - Live Playwright E2E on `https://minidraft.app/`: `[LIVE PROD PASS] Unsaved G2 -> G1 -> G2 preserves 18-step draft without auto-saving into seriesGames, errors=0`.

### 📅 2026-11-20 15:58 (UTC+7) — Prevent Redundant Re-Save on Already-Saved Games (`"บันทึกแล้ว"` / `"อัปเดตผล"` State in `DraftBoardView` & `useDraft`)
- **Base + Delta:** `4dbc614` + existing hotfixes + patched `frontend/src/components/DraftBoardView.tsx` and `frontend/src/hooks/useDraft.ts` (`isCurrentGameSavedUnchanged` & `isSameRecordedDraft`).
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-DlzcyPBB.js` (`467.66 kB`), `dist-prod/assets/index-exoc_w53.css` (`113.55 kB`).
- **Verification:**
  - Live Playwright E2E on `https://minidraft.app/`: `[LIVE PROD PASS] G1 save -> return to G1 disabled ('บันทึกแล้ว') -> edit enables ('อัปเดตผล'), errors=0`.

### 📅 2026-11-20 15:25 (UTC+7) — Deploy Stale-While-Revalidate Cache in `AdminStatsModal` (`@chayanin5392`)
- **Base + Delta:** `4dbc614` + existing hotfixes + updated `frontend/src/components/AdminStatsModal.tsx` (`cachedAdminStats` in-memory SWR cache so re-opening `Stats` renders immediately without flashing `"กำลังโหลดข้อมูลสถิติล่าสุด..."` while silently refreshing in the background).
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-VdGN9PE9.js` (`466.46 kB`), `dist-prod/assets/index-DLGFuMhI.css` (`113.51 kB`).

### 📅 2026-11-20 15:13 (UTC+7) — Deploy Owner-Only Analytics Dashboard (`GET /admin/stats` & Filterable `AdminStatsModal` for `@chayanin5392`)
- **Base + Delta:** `4dbc614` + existing hotfixes + `src/config.py`, `src/db.py`, `src/api.py`, isolated `AdminStatsResponse` / `is_admin` patch in `src/schemas.py`, `deploy/docker-compose.yml` (`ROV_ADMIN_USERNAMES`, `ROV_CF_*`), `frontend/src/types/auth.ts`, `frontend/src/components/AdminStatsModal.tsx` (with clickable `พร้อมจ่าย` / `ไม่พร้อม` / `เฉพาะสมาชิก (@)` voter filters up to 500 records), `frontend/src/components/AuthModal.tsx`, `frontend/src/components/MobileNavDrawer.tsx`, and `frontend/src/App.tsx`.
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-CjXawFci.js` (`466.28 kB`), `dist-prod/assets/index-DLGFuMhI.css` (`113.51 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched).
- **Verification:**
  - `https://minidraft.app/health` -> `200` (`{"status":"healthy","model_loaded":true}`).
  - `https://minidraft.app/admin/stats` (unauthenticated / non-admin) -> `404 Not Found`.
  - Live Playwright E2E on `https://minidraft.app/`: verified Guest sees `0` `Stats` buttons (`errors=0`), while `deploy-app-1` `get_admin_stats()` + `_fetch_cloudflare_stats()` returns live SQLite + Cloudflare metrics for `@chayanin5392`.

### 📅 2026-11-20 12:44 (UTC+7) — Deploy Smooth Pop-In & Scale/Fade-Out Transitions Across All Modals (`Modal`, `DraftHistoryModal`, `PricingSurveyModal`, etc.)
- **Base + Delta:** `4dbc614` + existing hotfixes + updated `frontend/src/components/Modal.tsx`, `PricingSurveyModal.tsx`, `DraftHistoryModal.tsx` (with `draftMode === "ranked"` stripped for `4dbc614` type compatibility), `GlobalBanModal.tsx`, `NewSeriesModal.tsx`, `FinishGameModal.tsx`, `DonateModal.tsx`, `AuthModal.tsx`, `ConfirmDialog.tsx`, `PickLaneModal.tsx`, and `frontend/src/App.tsx`.
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-DiP7N08-.js` (`451.35 kB`), `dist-prod/assets/index-Co9GPYUm.css` (`112.53 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched).
- **Verification:**
  - `https://minidraft.app/health` -> `200` (`{"status":"healthy","model_loaded":true}`).
  - Live Playwright E2E on `https://minidraft.app/`: `[LIVE PROD PASS] PricingSurveyModal & DraftHistoryModal smooth enter/exit verified, errors=0`.

### 📅 2026-11-20 12:11 (UTC+7) — Deploy Daily Willingness-to-Pay Survey (`PricingSurveyModal`), `POST /survey/pricing`, & Smooth 3-Bar `MobileNavDrawer`
- **Database Backup:** Created online SQLite backup `/app/db/rov_app.db.bak_20261120` inside `deploy_rov_db_data` prior to schema update (`users: 727`, `user_oauth_accounts: 688`, `user_draft_states: 696`, `auth_sessions: 752`).
- **Base + Delta:** `4dbc614` + existing hotfixes + `src/db.py`, `src/api.py`, isolated survey schema patch in `src/schemas.py`, `frontend/src/types/auth.ts`, `frontend/src/components/AuthModal.tsx`, `frontend/src/components/PricingSurveyModal.tsx`, `frontend/src/components/MobileNavDrawer.tsx`, and `frontend/src/App.tsx` (Draft Turn Timer and Ranked 10-Ban strictly excluded).
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-K5es1ZtC.js` (`448.93 kB`), `dist-prod/assets/index-BmC5DGWd.css` (`111.64 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched).
- **Verification:**
  - `https://minidraft.app/health` -> `200` (`{"status":"healthy","model_loaded":true}`).
  - Live Playwright E2E on `https://minidraft.app/`:
    - `mobile_375`: `[LIVE PROD PASS] mobile_375: survey+drawer/feedback verified, overflow=False, errors=0`
    - `desktop_1280`: `[LIVE PROD PASS] desktop_1280: survey+drawer/feedback verified, overflow=False, errors=0`
  - `/app/db/rov_app.db` intact (`users: 727`, `user_oauth_accounts: 688`, `user_draft_states: 696`, `auth_sessions: 752`, `pricing_survey_responses: 0`).

### 📅 2026-11-19 20:48 (UTC+7) — Deploy `"ให้บริการฟรีถึง 30/11/2026"` Notice on Mobile & Desktop Navbar + Landing Header
- **Base + Delta:** `4dbc614` + existing hotfixes + updated `frontend/src/App.tsx` and `frontend/src/components/AuthModal.tsx` (`ให้บริการฟรีถึง 30/11/2026` badge on `>= sm` Navbar & `AuthLanding` header, plus `22px` slim strip on `< sm` mobile Navbar).
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-DsO8l_xd.js` (`432.96 kB`), `dist-prod/assets/index-DyyKE2jt.css` (`110.39 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched).
- **Verification:**
  - Live Playwright E2E on `https://minidraft.app/`:
    - `mobile_375`: `visible={'w': 375, 'h': 22, 'tag': 'DIV'}`, `errors=0`
    - `desktop_1280`: `visible={'w': 168, 'h': 28, 'tag': 'SPAN'}`, `errors=0`
  - `/app/db/rov_app.db` intact (`db_users: 628`).

### 📅 2026-11-19 20:36 (UTC+7) — Deploy PromptPay `Donate` Modal, Desktop Typography Scaling & WCAG 2.2 AA Touch Targets
- **Base + Delta:** `4dbc614` + existing hotfixes + `frontend/public/donate-qr.jpg` (`590x685`, `82,437` bytes), `frontend/src/components/DonateModal.tsx`, `frontend/src/App.tsx`, `frontend/src/components/AuthModal.tsx`, `frontend/src/components/NewSeriesModal.tsx`, and `frontend/src/components/DraftHistoryModal.tsx` (with `draftMode === "ranked"` stripped for `4dbc614` type compatibility; Draft Turn Timer and Ranked 10-Ban strictly excluded).
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-CdxUCi8P.js` (`432.45 kB`), `dist-prod/assets/index-DyyKE2jt.css` (`110.39 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched).
- **Verification:**
  - `https://minidraft.app/health` -> `200` (`40` bytes).
  - `https://minidraft.app/donate-qr.jpg` -> `200 image/jpeg` (`82,437` bytes).
  - Live Playwright E2E on `https://minidraft.app/`: `[LIVE PROD PASS] DonateModal open, QR 590x685 loaded, copy verified, errors=0`.
  - `/app/db/rov_app.db` intact (`db_users: 625`).

### 📅 2026-11-19 17:29 (UTC+7) — Deploy Open Graph & SEO Assets (Frontend-Only, No API Changes)
- **Base + Delta:** `4dbc614` + existing hotfixes + `frontend/index.html`, `frontend/public/robots.txt`, and `frontend/public/sitemap.xml` (copied to VM without touching `src/api.py`, Draft Turn Timer, or Ranked 10-Ban).
- **Bundle Built:** `dist-prod/index.html` (`2.96 kB`), `dist-prod/assets/index-CqOf-r1j.js` (`427.42 kB`), `dist-prod/assets/index-B0gxNj4c.css` (`108.87 kB`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (Python/`src/` layers cached; `deploy_rov_db_data` untouched).
- **Verification:**
  - `https://minidraft.app/health` -> `200` (`{"status":"healthy","model_loaded":true}`).
  - `https://minidraft.app/` (`facebookexternalhit/1.1`): `200`, verified `<title>`, `og:title`, `og:description`, `og:image`, `twitter:card`, `canonical`, and strict CSP with `static.cloudflareinsights.com`.
  - `https://minidraft.app/robots.txt` (`200 text/plain`), `https://minidraft.app/sitemap.xml` (`200 text/xml`), and `https://minidraft.app/logo.png` (`200 image/png`, `162,414` bytes for `facebookexternalhit/1.1`, `Twitterbot/1.0`, `Mozilla/5.0`).
  - `/app/db/rov_app.db` intact (`users: 521`).

### 📅 2026-11-19 08:42 (UTC+7) — Enable Cloudflare Web Analytics in Strict CSP
- **Base + Delta:** `4dbc614` + existing hotfixes + 2-line CSP update in `src/api.py` (`script-src 'self' https://static.cloudflareinsights.com;`, `connect-src 'self' https://cloudflareinsights.com;`).
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched).
- **Verification:**
  - `https://minidraft.app/` response header verified with updated `Content-Security-Policy`.
  - Live Guest Playwright smoke check (`verify_live_prod_guest.py`): `[LIVE PROD PASS] Swap1_extra=0, GB_after_close=1, Swap2_extra=0, errors=0` (0 CSP console errors).
  - `/app/db/rov_app.db` intact (`users: 195` at 08:42; `users: 206` at 09:06).

### 📅 2026-11-19 08:27 (UTC+7) — Redundant-Fetch Elimination & Session Sync Coalescing Hotfix
- **Base + Delta:** `4dbc614` + isolated 5-file patch (`src/api.py`, `frontend/src/utils/draft.ts`, `frontend/src/hooks/useDraft.ts`, `frontend/src/components/DraftBoardView.tsx`, `frontend/src/App.tsx`).
- **Bundle Built:** `dist-prod/assets/index-CqOf-r1j.js`.
- **Deploy Method:** `cd ~/rov/deploy && sudo docker compose up -d --build app` (`deploy_rov_db_data` untouched).
- **Verification:**
  - `https://minidraft.app/health` -> `{"status":"healthy","model_loaded":true}`.
  - Live Guest Playwright smoke check: Game 1 10x Swap Sides -> `0` extra `POST /predict`; `GlobalBanModal` -> `0` while open, `1` on close; Game 2 asymmetric 10x Swap Sides -> `0` extra `POST /predict` on repeat swaps.
  - `/app/db/rov_app.db` intact (`users: 180`, `user_oauth_accounts: 168`, `user_draft_states: 179`, `auth_sessions: 181`).

### 📅 2026-11-18 18:39 (UTC+7) — Initial Azure Container Stack Deploy (`4dbc614`)
- **Base:** Commit `4dbc614` (`index-Cjm4hN5j.js`) running inside Docker Compose (`deploy-app-1`, `deploy-caddy-1`) fronted by `rov-cloudflared` tunnel (`minidraft.app`).
- **Database:** Migrated/persisted user accounts in Docker volume `deploy_rov_db_data` (`/app/db/rov_app.db`).

---

## VM Specs, Cost & Read-Only Diagnostic Commands

Reference runbook for checking `rov-draft-vm` sizing, live resource utilization, and Azure for Students credit burn (`100 USD` tier).

| Item | Observed Value (`2026-11-19 21:02 UTC+7`) |
| :--- | :--- |
| **Subscription / RG** | Azure for Students (`~100 USD` credit), Resource Group `rov-draft-rg`, Region `East Asia` |
| **VM Size & CPU** | `Standard_B2als_v2` (`2` vCPU `AMD EPYC 7763`, `3,856 MiB` / `4 GiB` RAM, ~`0.0526 USD/hr`) |
| **OS Disk & IP** | `30 GB` (`29G` `/dev/root`, `Premium_LRS`), Static Public IP `20.2.210.230` (`rov-draft-vm-ip`) |
| **Live Host Usage** | Load `0.23, 0.18, 0.18` \| RAM `1,117 MiB` used / `2,739 MiB` available (`Swap: 0`) \| Disk `9.0G / 29G` (`33%`) |
| **Container Footprint** | `deploy-app-1` (`1.83%` CPU, `379.3 MiB`), `deploy-caddy-1` (`0.00%` CPU, `60.36 MiB`), `rov-cloudflared` (`1.02%` CPU, `26.16 MiB`) |

### PowerShell Read-Only VM Diagnostics (Run from Windows)

```powershell
# 1. Inspect CPU, RAM, Disk, load average, and live Docker container usage
ssh -i "$env:USERPROFILE\.ssh\rov-draft-vm_key.pem" -o BatchMode=yes -o ConnectTimeout=5 azureuser@20.2.210.230 "nproc; lscpu | grep -E 'Model name|Architecture|CPU\(s\)'; free -m; df -h /; uptime; sudo docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}'"

# 2. Check container logs and SQLite DB row counts (read-only)
ssh -i "$env:USERPROFILE\.ssh\rov-draft-vm_key.pem" -o BatchMode=yes -o ConnectTimeout=5 azureuser@20.2.210.230 "sudo docker ps --format 'table {{.Names}}\t{{.Status}}'; sudo docker exec deploy-app-1 python -c 'import sqlite3; c=sqlite3.connect(\"/app/db/rov_app.db\"); print({t:c.execute(f\"SELECT COUNT(*) FROM {t}\").fetchone()[0] for t in (\"users\",\"user_oauth_accounts\",\"user_draft_states\",\"auth_sessions\")})'"
```

### Azure Portal Cost & Sizing Checklist

- **Check remaining 100 USD credit & expiry:** `Azure Portal` -> search `Education` (or `Cost Management + Billing` -> `Overview` / `Credits`).
- **Check daily burn & item breakdown:** `Cost Management + Billing` -> `Cost Management` -> `Cost analysis` -> set `Group by: Meter` or `Service name` (splits `Virtual Machines`, `Storage` disk, and `Public IP / Bandwidth`).
- **Set budget alerts:** `Cost Management` -> `Budgets` -> `Add` (email alerts at 50%, 80%, 90% of credit).
- **Check live CPU/RAM metrics:** `Virtual machines` -> `rov-draft-vm` -> `Monitoring` -> `Metrics` (`Percentage CPU`, `Available Memory Bytes`, `CPU Credits Remaining`).
- **Sizing guidance for this stack:** Keep at least `2 GiB` RAM (avoid `1 GiB` SKUs because `docker compose build` + PyTorch CPU can OOM); `Standard_B2als_v2` (`4 GiB`) leaves `~2.7 GiB` headroom. If cutting disk cost, `Premium_LRS` can be switched to `StandardSSD_LRS` while VM is deallocated.
- **Full cleanup when retiring:** Delete the entire `rov-draft-rg` Resource Group (`az group delete --name rov-draft-rg --yes --no-wait`) so no orphaned Public IP or Disk keeps consuming credits.

---

## Production Safety & Cutover Rules

1. **Database Preservation:** Never run `docker compose down -v`, remove `deploy_rov_db_data`, or overwrite `/app/db/rov_app.db`. Always back up `/app/db/rov_app.db` before any schema change.
2. **Container Rebuild:** Use `cd ~/rov/deploy && sudo docker compose up -d --build app` so Caddy, Cloudflare Tunnel, and `deploy_rov_db_data` remain intact.
3. **Dev -> Prod Cutover Checklist:** When ready to ship Dev to Production, commit/push verified Dev changes cleanly, reconcile any VM hotfixes on `~/rov` (all current hotfixes are already in Dev), pull, rebuild `app`, and verify `/health`, CSP headers, `0` console errors, and DB row counts.
