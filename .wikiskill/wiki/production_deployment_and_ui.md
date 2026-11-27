# Production Deployment (`minidraft.app`) & Frontend UI Invariants

Live production runs at **`https://minidraft.app/`** on Azure VM `rov-draft-vm` (`20.2.210.230`) and is tracked in [`docs/PRODUCTION_RELEASES.md`](../../docs/PRODUCTION_RELEASES.md). Always read `PRODUCTION_RELEASES.md` before inspecting or deploying to the VM.

---

## 1. Production Container Stack & Database Safety

- **Containers (`deploy/compose.yaml`, `deploy/Caddyfile`)**:
  - `deploy-app-1`: FastAPI + `frontend/dist-prod` built with **`VITE_DRAFT_ONLY=true`**, **`ROV_INFERENCE_BACKEND=onnx`** (Pure ONNX Runtime, zero PyTorch/training stack, `666MB` image), Mobile PWA (`sw.js`, `manifest.webmanifest`, `icon-192.png`), and `ROV_ENV=production`.
  - `deploy-caddy-1`: TLS reverse proxy with security headers.
  - `rov-cloudflared`: Cloudflare Tunnel ingress.
- **Production vs Dev Feature Scope**:
  - Production (`VITE_DRAFT_ONLY=true`) serves **Draft Board** + **Draft vs AI (`#practice`)** plus Auth/Profile, Language Switch (`ไทย` / `EN`), and Feedback/Stats.
  - **Dev-Only Exclusions**: `TierListView.tsx`, `MetaLab.tsx`, and `CombatLab.tsx` (`/combat/*`) stay hidden in production builds.
- **SQLite Persistence (`deploy_rov_db_data` -> `/app/db/rov_app.db`)**:
  - **NEVER** delete, truncate, or overwrite `deploy_rov_db_data` or `deploy/.env`.
  - Always create an online SQLite backup inside the volume before any schema migration (e.g., when `user_practice_histories` was added on `2026-11-21`).
  - **Billing & Free Pro Promo**: Live Stripe PromptPay billing (`Pro`, `Duo`, `Business`) is enabled alongside a time-limited Free Pro promo (`free_pro_1796576400`, expiring Dec 7, 2026). See Section 3 for live limits and pass setup.
- **Production-Only VM Checkout (`git sparse-checkout --no-cone`)**: `~/rov` on `rov-draft-vm` checks out only the `21` production paths required by `Dockerfile` and `deploy/` (`/Dockerfile`, `/.dockerignore`, `/requirements.txt`, `/requirements-prod.txt`, `/deploy/`, `/configs/`, `/src/`, `/frontend/`, `/models/sota_draft_gnn_transformer.onnx`, `/models/sota_draft_gnn_transformer.meta.npz`, and the 11 serving `/data/*` files). Dev/training/doc folders (`tests/`, `scripts/`, `docs/`, `.wikiskill/`, `.agents/`, `.claude/`, `best_params/`, `models/archive/`, `models/*heuristic*`, and non-serving `data/*` files) are excluded from the VM disk. Do not run `git pull` on the VM for docs-only commits.

---

## 2. Frontend UI/UX Invariants (`frontend/src/`)

1. **Responsive Hero Replacement (`DraftBoardView.tsx`, `HeroGrid.tsx`, `TeamColumn.tsx`)**:
   - **Desktop/iPad (`>= 768px`)**: Uses inline **Spotlight Replace Mode** inside `HeroGrid` (`AiPanel` dimmed `opacity-30`, opposite team dimmed `opacity-45`, zero `HeroGrid` height shift, full-screen focus-lock backdrop `data-replace-backdrop`, `Tab`/`Shift+Tab` trap, two-step `Esc` cancel).
   - **Phone (`< 768px`)**: Uses `<HeroPickerModal mobileSheet />` bottom-sheet popup without forcing tab switches.
2. **Draft Turn Timer (`useDraftTimer.ts`, `ScoreBar.tsx`)**:
   - Official RoV turn presets (`0:40`, `0:60`; `3s` test preset hidden off localhost), optional sound cues & auto-lock.
   - **Auto-Stop Lifecycle**: Never persists `enabled: true` across reloads (`localStorage` saves only `preset`, `soundEnabled`, `autoLock`), hides controls and turns `enabled = false` when `currentStep === null` (`18/18 COMPLETE`), on draft reset, or on game/series transition (`FinishGameModal`).
3. **Draft vs AI (`PracticeDraftView.tsx`, `practiceHistory.ts`)**:
   - **Mobile Sub-Header (`< 640px`)**: Fits in a single `39px` row (`BoX <select>`, `G1/7`, `BLUE/RED`, icon-first `>= 28px` buttons) with zero horizontal overflow.
   - **Visual Icon Distinction**: `"เริ่มรอบใหม่"` (new series) uses solid gold `PlusCircle`; current-game `RESET` uses red `RotateCcw`.
   - **Cross-Device History Sync**: Syncs via `GET/PUT/DELETE /draft/practice-history` (`user_practice_histories`) with `meta.recordedSignatures` delete non-resurrection guard.
4. **Assistant Toggle & Unified Drawer (`App.tsx`, `MobileNavDrawer.tsx`)**:
   - Turning **`ตัวช่วย` (`Assistant`)** OFF skips `/predict` requests and shows Draft Progress in the center bar.
   - `≡` slide-out menu drawer renders across all viewports (`LanguageSwitch`, `Stats`, `Feedback`, `Donate`, `Logout`).
5. **Owner Analytics Dashboard (`/#admin`, `AdminStatsModal.tsx`, `AdminDashboardView.tsx`, `src/analytics.py`)**:
   - **Access & Navigation**: `AdminStatsModal` keeps its compact modal layout intact and provides a `Dashboard` link opening `/#admin` in a new tab. All `/admin/*` endpoints (`/admin/stats`, `/admin/feedback`, `/admin/users`, `/admin/analytics`) return fail-closed HTTP `404` for guests and non-owner accounts. Both `AdminStatsModal` and `AdminDashboardView` surface the user feedback inbox (`GET /admin/feedback`) fed by `POST /feedback` from the Update Announcement & Feedback modal (`PricingSurveyModal.tsx`).
   - **Plain-Thai Translation Invariant**: While `src/analytics.py` computes rigorous models (BG/NBD `P(Alive)`, 3x3 Markov chain, right-censored Kaplan-Meier survival, Wilson/Katz 95% CIs, Kohavi statistical power, Sifa behavioral feature correlations), the main dashboard UI MUST translate every card title, column header, and status badge into everyday, self-explanatory Thai with a 1-sentence owner takeaway (`สรุปให้:`). Reserve academic citations and raw notation for the collapsed reference `<details>` drawer at the bottom.
   - **Thai Typography Floor (`>= 12px` / `text-xs`)**: Never use `text-[9px]` or `text-[10px]` on Thai dashboard copy or tables (Thai vowels and tone marks become illegible below `12px`); use `text-xs sm:text-sm` (`12px–14px`) for body/table cells, `text-sm sm:text-base` for card titles, and `fontSize="11"` on SVG chart axes.
6. **Retired Controls, Telemetry Caveats & Owner Identity**:
   - **No Lookahead UI Toggle (`useLookahead`)**: The frontend UI button/toggle to enable `useLookahead` was retired and removed; there is no `setUseLookahead` control anywhere in the React UI. Remaining `predict_lookahead_count` telemetry events come solely from legacy saved `user_draft_states` sessions that still hold `"useLookahead": true` — **never** suggest adding, moving, or fixing UI discoverability for a Lookahead button.
   - **Owner / Admin Accounts (`@chayanin5392`, `@golfdesu`)**: `@chayanin5392` is the primary admin account and `@golfdesu` is the owner's secondary/test account. Their test orders, promo claims, and feedback rows in SQLite must be excluded from external customer counts.

---

## 3. Stripe PromptPay Billing Setup (Sandbox & Live Production)

1. **Stripe Thailand Dashboard Setup (`Individual` KYC)**:
   - **Account Type & KYC**: `Business type = Individual` (Thailand); Legal Name entered in **Thai script** matching the National ID card; ID photo upload must have **no signatures, notes, or watermarks**; Thailand THB bank payout account.
   - **Product & Descriptor Settings**:
     - Category: `Software as a service` (SaaS; avoid `Video Games` / `Virtual goods` MCCs).
     - Statement Descriptor / Shortened: `MINIDRAFT.APP` / `MINIDRAFT`; Support Contact Email + Website enabled; Fraud Protection set to **`Radar Lite (Included)`** (free — avoid per-transaction Radar Standard fees since only PromptPay is accepted).
     - **Payment Methods**: Confirm **PromptPay** is `Enabled` (`thb`). Keep **Adaptive Pricing** turned `Off` (additionally enforced per Checkout Session via `adaptive_pricing: {"enabled": False}` and `currency == "thb"` checks).
     - **Branding**: Background `#070B14`, Accent `#F5C451`, Logo [`frontend/public/logo.png`](../../frontend/public/logo.png). Enable Store `Refund and return policy` only after a public `/terms` or `/refund` page is deployed.
2. **Restricted API Key & Workbench Webhook**:
   - **API Key**: `Developers -> API keys -> Create key -> Building your own integration -> Custom permissions -> Checkout Sessions: Write` only (`rk_live_<...>` or `sk_live_<...>`).
   - **Webhook (Stripe Workbench -> Webhooks -> Add destination)**:
     - Scope: `Your account` | Payload style: **`Snapshot`** (never `Thin`, because `src/api.py` reads `event.data.object` directly).
     - Endpoint URL: `https://minidraft.app/billing/webhook`
     - Subscribe to **4 events** (`BILLING_EVENT_TYPES` in `src/billing.py`): `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
   - **Secret Hygiene**: Keep live `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (`whsec_<...>`) strictly inside gitignored VM `.env` (never in tracked repo files or chat logs; rotate immediately if exposed).
3. **Dual-Mode Architecture & Pricing (`src/config.py`, `src/billing.py`, `src/api.py`, `deploy/compose.yaml`)**:
   - **Strict Mode Isolation**:
     - Development Sandbox (`ROV_ENV=development` + `sk_test_`/`rk_test_` + `whsec_`): accepts `cs_test_`, `livemode=False`, loopback origins, and shows `"โหมดทดสอบ"` (`Test Mode`) badges.
     - Production Live (`ROV_ENV=production` + `ROV_STRIPE_LIVE_ENABLED!=false` + `sk_live_`/`rk_live_` + `whsec_`): accepts `cs_live_`, `livemode=True`, HTTPS `config.cors_origins` (`https://minidraft.app`), unblocks `/billing` & `/billing/*` in `security_and_lockdown_middleware`, and hides test badges. Cross-mode keys or test-vs-live webhook events are rejected fail-closed.
   - **Active Limits & Pass Catalog (`PRICE_SATANG`)**:
     - Guest: `3` browser-local Draft Board games, `100` browser-local Draft vs AI games | Free Registered: `14` synced Draft Board games, `100` synced Draft vs AI games, `2` personal Hero Pools.
     - Paid (`500` Draft Board games, `1,000` Draft vs AI games, `50` Hero Pools, Scrim Analytics with real server-side `RPL 2026 Winter` `307`-game and `RPL 2026 Summer` `291`-game sample leagues): **Pro** (`59 THB / 30d`, `139 THB / 90d`), **Duo** (`109 THB / 30d`, `259 THB / 90d`, 2 seats), **Business (`team_pro`)** (`239 THB / 30d`, `569 THB / 90d`, 5 seats + shared Team History & Pools).

---

## 4. Performance, Caching & SQLite Invariants (`fa137ac`)

1. **Frontend Bundle & Load Architecture (`frontend/`):**
   - **Dynamic EN i18n (`language.ts`, `LanguageProvider.tsx`):** `englishMessages.ts` (`~202 KB`) is dynamic-imported only when `language === "en"`, shrinking `createLucideIcon-*.js` from `210.0 KB` to `5.34 KB` for default Thai users.
   - **Vendor & Modal Splitting (`vite.config.ts`, `App.tsx`, `ScrimDashboardView.tsx`, `PracticeDraftView.tsx`):** `rolldownOptions.output.manualChunks` isolates `react-vendor` (`~219 KB`), and rarely-opened modals (`AuthModal`, `ScoutingReportModal` PDF export, `PracticeHistoryModal`, `MobileNavDrawer`, `DonateModal`, `UserGuideModal`, `PricingSurveyModal`) are `React.lazy()`-loaded, keeping core `index-*.js` at `~224.5 KB`.
   - **Zero Initial Waterfall & Low-Overhead UI:** `fetchHeroCatalogOnce()` runs in parallel with `GET /auth/me`; `document.body` `MutationObserver` mounts only when auto-survey is eligible; `HeroGrid` uses `useDeferredValue(query)`, targeted CSS transitions, stable props from `PracticeDraftView`, and `decoding="async"` on `HeroPortrait`.
   - **Draft Sync Serialization Guard (`useDraft.ts`, `da515c4`):** Cloud/local sync splits `serializedSyncIdentity` (`useMemo`, excluding `winHistory`/`blueWinRate`) from `serializedSyncState` and uses `lastProcessedSyncStateRef` so UI flags (`isLoading`, `predictError`) do not re-run `JSON.stringify` over up to 500 `seriesGames`. **Invariant:** Any new draft state field that must sync to the backend MUST be added to both `serializedSyncIdentity` and its `useMemo` dependency array, or changes to that field alone will not trigger a sync.
2. **Backend Inference & HTTP Caching (`src/predictor.py`, `src/search/draft_mcts.py`, `src/league_utils.py`, `src/api.py`, `deploy/compose.yaml`):**
   - **Thread-Safe LRU Cache (`maxsize=512`) & Pure ONNX Serving:** `RoVDraftPredictor.predict()` caches canonicalized 22-field `DraftStateRequest` responses (`~0.07 ms` hit vs `~5.9 ms` cold) with `.model_copy(deep=True)` isolation. Production runs `ROV_INFERENCE_BACKEND=onnx` (`onnxruntime` + pickle-safe `.meta.npz` + NumPy softmax/sigmoid in `src/search/draft_mcts.py` + zero-dependency `src/league_utils.py`), eliminating PyTorch from production Docker builds (`666MB`). `deploy/compose.yaml` pins `OMP_NUM_THREADS=1` / `MKL_NUM_THREADS=1` / `ROV_TORCH_NUM_THREADS=1`.
   - **Lazy `CombatEngine` & Static `Cache-Control`:** `CombatEngine` is lazy-loaded via `_item_folder_aliases()` (never instantiated at import time). `/heroes` returns `Cache-Control: public, max-age=3600`, `/assets/*` returns `public, max-age=31536000, immutable`, `/avatars/*` + `/hero_images.json` return `public, max-age=86400`, and HTML serves `no-cache`.
3. **SQLite Pragmas, Read Concurrency & Query Consolidation (`src/db.py`, `src/api.py`):**
   - `_connect()` configures `PRAGMA synchronous=NORMAL`, `temp_store=MEMORY`, and `cache_size=-16000`; WAL-safe read paths run without `self._lock`.
   - Seven missing indexes cover `billing_orders`, `billing_passes`, `daily_visits(user_id, visit_date)`, `users(created_at)`, `pricing_survey_responses`, and `team_invites`; redundant prefix `idx_hero_pools_owner` was dropped; `get_admin_users_report()` sorts over a CTE without duplicate `json_extract()`; `/auth/me` and `/billing` consolidate DB reads via `get_auth_user_context()` and `get_billing_snapshot()` (`<= 2` connections per request).

---

## 5. External Services, APIs & Environment Variables Inventory

> [!NOTE]
> Never store raw secrets, API tokens, or `.pem` keys in tracked files. Keep credentials exclusively in gitignored local `.env`, VM `deploy/.env`, `~/.ssh/`, or GitHub Actions Settings.

| Service / Platform | Role in MiniDraft | Key Env Vars / Credentials | Where Stored |
| :--- | :--- | :--- | :--- |
| **Azure VM (`rov-draft-vm`, `20.2.210.230`)** | Production server (`deploy-app-1`, `deploy-caddy-1`, persistent SQLite `deploy_rov_db_data`) | SSH key (`rov-draft-vm_key.pem`) | `~/.ssh/` on owner workstation |
| **Cloudflare (DNS, Tunnel, Web Analytics & API)** | `minidraft.app` DNS, `rov-cloudflared` tunnel, edge Web Analytics, and admin traffic GraphQL API | `ROV_CF_API_TOKEN`, `ROV_CF_ACCOUNT_ID`, `ROV_CF_ZONE_ID` | VM `deploy/.env` |
| **Google OAuth 2.0 (PKCE)** | User sign-in & account linking (`/auth/google/*`) | `ROV_GOOGLE_CLIENT_ID`, `ROV_GOOGLE_CLIENT_SECRET`, `ROV_GOOGLE_REDIRECT_URI` | Local `.env`, VM `deploy/.env` |
| **Discord OAuth 2.0 (PKCE)** | User sign-in & account linking (`/auth/discord/*`) | `ROV_DISCORD_CLIENT_ID`, `ROV_DISCORD_CLIENT_SECRET`, `ROV_DISCORD_REDIRECT_URI` | Local `.env`, VM `deploy/.env` |
| **Stripe Thailand (PromptPay + Webhooks)** | Live PromptPay Checkout (`Pro`, `Duo`, `Business`) & webhook fulfillment (`/billing/webhook`) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ROV_STRIPE_LIVE_ENABLED` | Local `.env` (test), VM `deploy/.env` (live) |
| **PostHog (US Cloud, Project ID `771611`)** | Client Product Analytics, Web Analytics, Web Vitals, Feature Flags, Error Tracking (`frontend/src/utils/analytics.ts`) | Write token: `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` (`https://us.i.posthog.com`) | Local `.env`, VM `deploy/.env`, optional GH Actions Vars |
| **PostHog Query API (Read-Only Analytics)** | Ad-hoc HogQL funnel, retention, and error diagnostics queried from workstation via `https://us.posthog.com/api/projects/771611/query/` | `POSTHOG_PERSONAL_API_KEY` (read-only scopes), `POSTHOG_PROJECT_ID=771611` | Local `.env` only (never VM or Git) |
| **GitHub & GHCR (`golfdesu/rov`)** | Source control, Actions CI (`ruff`, `pytest`, Vite builds, i18n audit), and GHCR image publishing (`.github/workflows/ci.yaml`) | `GITHUB_TOKEN` (automatic in Actions) | GitHub Actions (`ghcr.io/golfdesu/rov`) |
| **ERAWAN HPC (`compute4`, NVIDIA H100)** | Offline PyTorch SOTA training & Optuna HPO (produces `.pt`; converted locally to `.onnx` + `.meta.npz` via `scripts/export_onnx.py`) | Cluster SSH / SLURM (`gpu-h100`) | Owner workstation / HPC account |
| **Google Fonts** | Frontend web typography (`Chakra Petch`, `IBM Plex Sans Thai`, `JetBrains Mono` in `frontend/index.html`) | Public CSS CDN (permitted in CSP `style-src` / `font-src`) | Frontend static HTML |
| **Liquipedia (Offline Scraper Only)** | Pro tournament draft ingestion into `data/matches_draft_full.json` (`src/scrape_matches.py`; never called by prod runtime) | Public HTTP (offline workstation scripts only) | Local dev/data pipeline |

---

## Related Wiki Articles

- [`system_architecture_and_data.md`](system_architecture_and_data.md)
- [`../traces/production_cutover_and_ux_trace.md`](../traces/production_cutover_and_ux_trace.md)
- [`../../docs/PRODUCTION_RELEASES.md`](../../docs/PRODUCTION_RELEASES.md)
