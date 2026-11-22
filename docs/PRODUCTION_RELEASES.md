# Production Releases & Hotfix Log (`minidraft.app`)

Dedicated operational record for the live production deployment of **MiniDraft (`https://minidraft.app/`)**, kept separate from `CHANGELOG.md` so agents and maintainers can see the exact live state, active hotfixes on the VM, and dev-only features at a glance.

> [!IMPORTANT]
> **For AI Agents:** Always read this file **before** inspecting, patching, syncing, or deploying to the production VM (`20.2.210.230`). **Append new production deploys/hotfixes at the TOP of Release History** and update the **Current Live Snapshot** below. Strictly English only.

---

## Current Live Snapshot

| Field | Value |
| :--- | :--- |
| **Live Domain** | `https://minidraft.app/` (`www.minidraft.app`) |
| **Host VM** | Azure VM `rov-draft-vm` (`20.2.210.230`, `azureuser`, `~/rov`) |
| **Container Stack** | `deploy-app-1` (`VITE_DRAFT_ONLY=true` serving **Draft Board + Draft vs AI**, `ROV_ENV=production`), `deploy-caddy-1`, `rov-cloudflared` |
| **Git Base Commit on VM** | `13758c4` (`main`: mobile UX density, GNN serving cache, multi-device sync merge/`clearedAt`, SQLite index/CTE, fail-closed admin, leak-free split, `compose.yaml`) |
| **Active Frontend Bundle** | `dist-prod/assets/index-OYcteBXS.js` (`665.66 kB`) + `dist-prod/assets/index-DyAYAAUJ.css` (`128.26 kB`), `dist-prod/index.html` (`2.96 kB`) |
| **Persistent Database** | Docker volume `deploy_rov_db_data` -> `/app/db/rov_app.db` (SQLite; **NEVER** delete or overwrite) |
| **Active Model Checkpoint** | `models/sota_draft_gnn_transformer.pt` (`val_loss = 2.81796`, `win_acc = 51.69%`, 90d half-life Trial #31, 3,535 training games / 4,352 total matches) |
| **Last Updated** | `2026-11-22 11:39 (UTC+7)` |

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
