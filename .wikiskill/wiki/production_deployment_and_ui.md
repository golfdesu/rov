# Production Deployment (`minidraft.app`) & Frontend UI Invariants

Live production runs at **`https://minidraft.app/`** on Azure VM `rov-draft-vm` (`20.2.210.230`) and is tracked in [`docs/PRODUCTION_RELEASES.md`](../../docs/PRODUCTION_RELEASES.md). Always read `PRODUCTION_RELEASES.md` before inspecting or deploying to the VM.

---

## 1. Production Container Stack & Database Safety

- **Containers (`deploy/compose.yaml`, `deploy/Caddyfile`)**:
  - `deploy-app-1`: FastAPI + `frontend/dist-prod` built with **`VITE_DRAFT_ONLY=true`** and `ROV_ENV=production`.
  - `deploy-caddy-1`: TLS reverse proxy with security headers.
  - `rov-cloudflared`: Cloudflare Tunnel ingress.
- **Production vs Dev Feature Scope**:
  - Production (`VITE_DRAFT_ONLY=true`) serves **Draft Board** + **Draft vs AI (`#practice`)** plus Auth/Profile, Language Switch (`ไทย` / `EN`), and Feedback/Stats.
  - **Dev-Only Exclusions**: `TierListView.tsx`, `MetaLab.tsx`, and `CombatLab.tsx` (`/combat/*`) stay hidden in production builds.
- **SQLite Persistence (`deploy_rov_db_data` -> `/app/db/rov_app.db`)**:
  - **NEVER** delete, truncate, or overwrite `deploy_rov_db_data` or `deploy/.env`.
  - Always create an online SQLite backup inside the volume before any schema migration (e.g., when `user_practice_histories` was added on `2026-11-21`).
  - **Open Free Access**: `minidraft.app` is 100% free during launch; do not add paywalls unless explicitly instructed (`docs/SUBSCRIPTION_ROADMAP.md` is future spec only).

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
   - **Access & Navigation**: `AdminStatsModal` keeps its compact modal layout intact and provides a `Dashboard` link opening `/#admin` in a new tab. All `/admin/*` endpoints (`/admin/stats`, `/admin/users`, `/admin/analytics`) return fail-closed HTTP `404` for guests and non-owner accounts.
   - **Plain-Thai Translation Invariant**: While `src/analytics.py` computes rigorous models (BG/NBD `P(Alive)`, 3x3 Markov chain, right-censored Kaplan-Meier survival, Wilson/Katz 95% CIs, Kohavi statistical power, Sifa behavioral feature correlations), the main dashboard UI MUST translate every card title, column header, and status badge into everyday, self-explanatory Thai with a 1-sentence owner takeaway (`สรุปให้:`). Reserve academic citations and raw notation for the collapsed reference `<details>` drawer at the bottom.
   - **Thai Typography Floor (`>= 12px` / `text-xs`)**: Never use `text-[9px]` or `text-[10px]` on Thai dashboard copy or tables (Thai vowels and tone marks become illegible below `12px`); use `text-xs sm:text-sm` (`12px–14px`) for body/table cells, `text-sm sm:text-base` for card titles, and `fontSize="11"` on SVG chart axes.

---

## Related Wiki Articles

- [`system_architecture_and_data.md`](system_architecture_and_data.md)
- [`../traces/production_cutover_and_ux_trace.md`](../traces/production_cutover_and_ux_trace.md)
- [`../../docs/PRODUCTION_RELEASES.md`](../../docs/PRODUCTION_RELEASES.md)
