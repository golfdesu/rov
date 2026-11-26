# Trace: Production Cutover & UX Stabilization (`minidraft.app`)

Distilled lessons from `CHANGELOG.md` and `docs/PRODUCTION_RELEASES.md` covering the Dev-to-Prod cutover (`2026-11-21` to `2026-11-22`, commits `981b773` -> `a248e7c` -> `6fec71a`).

---

## 1. Database & Multi-User Isolation Lessons

- **SQLite Migration Safety**: Before deploying schema additions (`user_practice_histories` for cross-device `#practice` history sync), create an online backup inside `deploy_rov_db_data` (`/app/db/rov_app.db.bak_YYYYMMDD*`) and run `docker compose up -d --build app` without touching the named volume.
- **Account-Switch & Delete Guards**:
  - Frontend API requests carry `X-Expected-User` (`frontend/src/api/client.ts`) so concurrent session switches cannot overwrite another user's draft state.
  - `practiceHistory.ts` maintains `meta.recordedSignatures` so deleted practice records do not resurrect during cross-device cloud merge.

---

## 2. Responsive Draft UX & State Lifecycle Lessons

- **Spotlight Replace Mode vs Bottom Sheet**:
  - Desktop/iPad (`>= 768px`) users expect inline hero replacement inside `HeroGrid` without popup modals shifting layout height (`472.8px -> 472.8px`), protected by a `z-30` focus-lock scrim (`data-replace-backdrop`) and `Tab` trap.
  - Phone (`< 768px`) users need `<HeroPickerModal mobileSheet />` so replacing a slot stays in context without losing scroll position.
- **Practice Mobile Header Density**:
  - Wrapping controls across 3–4 rows on `360x800` / `390x844` pushed the hero grid off-screen. Collapsing the sub-header to a single `39px` row (`BoX <select>`, `G1/N`, `BLUE/RED`, icon-first `>= 28px` actions) and separating gold `PlusCircle` ("เริ่มรอบใหม่") from red `RotateCcw` (`RESET`) resolved accidental resets and zeroed horizontal overflow.
- **Draft Turn Timer Lifecycle**:
  - Persisting `enabled: true` across reloads or leaving the timer active at `18/18 COMPLETE` left a dead `--:--` bar on screen. Auto-disabling `enabled` on `currentStep === null`, `Reset`, and `FinishGameModal` game transitions fixed both issues.

---

## 3. Automated Regression & E2E Discipline

- Every predictor or draft-state change must pass the 72-state golden snapshot guard (`tests/test_predictor_golden.py` / `audit_regression_guard.py`).
- Every UI/layout change is verified via `oxlint` (`0` warnings/errors), `vite build`, and multi-viewport Playwright E2E checks (`360x800`, `390x844`, `1440x900`) with `0` console/page errors.

---

## 4. Owner Analytics, Stochastic Telemetry & Plain-Thai UX Trace (`2026-11-22`, `8767742` -> `6fec71a`)

- **Zero-Overhead Telemetry Architecture (`src/db.py`, `src/api.py`, `frontend/src/utils/telemetry.ts`)**:
  - `POST /predict` attributes guest calls via `X-Client-Id` (`daily_visits.predict_count`) and member calls via `user_usage_daily.predict_count`, while recording latency histogram buckets (`<25ms`, `25-100ms`, `100-500ms`, `>500ms`) into `site_events_daily` (`p50 = 12.5 ms`, `p95 = 23.7 ms` in live production).
  - Frontend batches non-blocking feature & AI adoption events (`draft_completed_18`, `practice_completed_18`, `ai_adopt_top1`, `ai_adopt_top2_5`, `ai_adopt_top6_10`, `ai_adopt_offmeta`, leagues, BoX modes, tools) to `POST /telemetry/event`.
- **Empirical Findings from Live Production DB (`/app/db/rov_app.db`, `893` registered users, `663` tracked device clients)**:
  - **Member vs Guest Return Rate (`>= 2d`)**: Member return rate (`15.8%`, `34/215`) is **`RR = 2.08x`** higher than Guest (`7.6%`, `34/448`, Katz 95% CI `[1.33, 3.26]`, `p = 0.0011`, Kohavi statistical power = `84.0%`, adequately powered).
  - **Self-Reported WTP vs Actual Engagement**: Engaged members report `30.4%` WTP (`17/56`) vs Casual `23.9%` (`21/88`, `p = 0.3887`, Spearman `rho = 0.035`), but Kohavi power analysis shows only `13.3%` achieved power (`required_n_per_arm = 310` for `MDE = 10pp`), preventing premature conclusions.
  - **Heavy-Tailed Usage & AI Trust**: Saved-game distribution is strongly overdispersed (`Var/Mean = 4.69`, `Gini = 0.863`, Top 10% users generate `73.3%` of saved games). Live AI Top-5 adoption reached `52.2%` vs `3.85%` random baseline (`Binomial Z = 12.05`, `p < 0.0001`).
- **Dashboard Readability Lesson**:
  - Exposing raw academic terms (`BG/NBD`, `Markov Migration`, `Wilson/Katz CI`, `Spearman rho`) or micro-typography (`9px–10px`) obscures decision-making for product owners. Keep the math engine in `src/analytics.py`, render plain-Thai headlines and `"สรุปให้:"` callouts at `>= 12px` (`text-xs sm:text-sm`), and tuck formal citations into a collapsible footer drawer.

---

## 5. Full-Stack Performance Optimization Trace (`2026-11-26`, `fa137ac`)

- **Problem Diagnosed (Zero-Accuracy-Loss Profiling):**
  - Static EN translation map (`englishMessages.ts`, `201.9 kB` UTF-8) bundled into `createLucideIcon-*.js` (`210.0 kB`), forcing Thai users to download/parse 2,012 EN keys on first paint; `GET /heroes` waited behind `GET /auth/me` spinner; global `MutationObserver` ran on every DOM change.
  - `RoVDraftPredictor.predict()` had zero response caching, `run_model()` allocated `unavail` tensors twice under `torch.no_grad()`, OpenMP threads were uncapped under AnyIO's 40-thread pool, `src/api.py` eagerly initialized `CombatEngine()` at import time, and `/assets/*` + `/avatars/*` + `/heroes` lacked cache headers.
  - SQLite `_connect()` called `mkdir()` per query without `synchronous=NORMAL` / `temp_store=MEMORY` / `cache_size`, global `self._lock` blocked WAL reads behind admin scans, and `/auth/me` opened up to 7 connections sequentially.
- **Measured Outcomes (`dist-prod` + Python Microbenchmarks + Live VM):**
  - Frontend bundles: `createLucideIcon` `210.0 kB -> 5.34 kB` (`englishMessages` split to `201.92 kB` lazy EN chunk), core `index` `483.5 kB -> 224.54 kB` + cached `react-vendor` `218.79 kB`, `ScrimDashboardView` `197.4 kB -> 158.30 kB`, `PracticeDraftView` `46.9 kB -> 38.13 kB`.
  - Backend inference & DB: `predict()` repeated-state latency `5.87 ms -> 0.069 ms` (`~85x` via thread-safe LRU `maxsize=512` with `model_copy(deep=True)` isolation), `72/72` golden snapshot parity untouched (`100%`), `/auth/me` & `/billing` consolidated to `<= 2` DB connections, live `minidraft.app` serving `Cache-Control` `immutable` on `/assets/*`, `86400s` on `/avatars/*`, `3600s` on `/heroes`.
