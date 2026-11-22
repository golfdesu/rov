# Trace: Production Cutover & UX Stabilization (`minidraft.app`)

Distilled lessons from `CHANGELOG.md` and `docs/PRODUCTION_RELEASES.md` covering the Dev-to-Prod cutover (`2026-11-21`, commits `981b773` -> `6253177` -> `a248e7c`).

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
