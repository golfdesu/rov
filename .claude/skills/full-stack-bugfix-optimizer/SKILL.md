---
name: full-stack-bugfix-optimizer
description: End-to-end automated bug-hunting, fixing, and full-stack performance optimization workflow for the RoV Pro Draft Intelligence repository. Use when the user asks to scan for bugs, fix issues across backend/frontend/PWA/Share Cards, optimize bundle or API latency, or run a comprehensive pre-release sweep (including overnight /goal runs).
---

# Full-Stack Bug-Fix & Optimization Workflow

Run this 4-phase loop whenever asked to scan for bugs, harden reliability, or optimize full-stack performance across the RoV repository.

## Phase 1 — Automated Baseline Sweep

Run the bundled 1-command audit runner to collect baseline failures, bundle sizes, and security/perf/UX checks:

```bash
python .agents/skills/full-stack-bugfix-optimizer/scripts/run_all_audits.py
# Or during rapid local iteration:
python .agents/skills/full-stack-bugfix-optimizer/scripts/run_all_audits.py --fast
```

What this checks automatically:
- **Python Quality & Tests:** `ruff check .`, `ruff format --check .`, `pytest -q --tb=short`
- **Frontend Quality & Entry Budget:** `oxlint`, `vite build`, entry chunk `frontend/dist/assets/index-*.js <= 260 kB` (catches accidental bundling of heavy libs like `posthog-js` or `onnxruntime` into the initial page load)
- **Domain Audits:** `audit_copy_i18n.py`, `audit_security.py`, `audit_arch_perf.py`, `audit_regression_guard.py`, `audit_rov_data.py`, `inspect_frontend_e2e.py`, `audit_ux_ui.py` (including `375x667` mobile overflow & TH/EN `/analytics` clipping), and `.wikiskill/skills/scripts/preflight_check.py`.

---

## Phase 2 — Parallel Deep Bug & Performance Hunt

Spawn 2–3 read-only `research` subagents in parallel to inspect ONLY concrete runtime bugs and measurable optimization wins (ignore cosmetic style nitpicks):

1. **Backend / DB / Auth / Billing / Inference (`src/api.py`, `src/db.py`, `src/schemas.py`, `src/billing.py`, `src/predictor.py`, `src/search/draft_mcts.py`):**
   - Check Pydantic bounds (`MAX_EPOCH_MS`, lengths, `allow_nan=False`), SQLite transaction atomicity (`BEGIN IMMEDIATE`, monotonic tombstones), OAuth/pass precedence edge cases, telemetry race conditions, pre-serialized static JSON endpoints (`GET /heroes`), and HTTP `Cache-Control` / CSP headers.
2. **Frontend Core / PWA / CSP / Analytics (`frontend/src/App.tsx`, `frontend/public/sw.js`, `frontend/src/utils/analytics.ts`, `frontend/src/utils/pwa.ts`, `LanguageProvider.tsx`, `BillingSandbox.tsx`, `ProfileView.tsx`, `DraftBoardView.tsx`, `PracticeDraftView.tsx`, `ScrimDashboardView.tsx`):**
   - Check CSP script violations from third-party SDKs, Service Worker `navigate` vs `/auth/*` & `/privacy` cache poisoning, `bfcache` (`pageshow`) stuck states, `AbortError`/timer leaks, deleted/cleared state resurrection races, `375px` mobile horizontal overflow, and heavy dependencies accidentally imported eagerly into the entry bundle.
3. **Recently Modified / Uncommitted Files (`git status -s`):**
   - Audit every new or uncommitted feature (such as Share Cards, new modals, asset scripts) for Canvas text overflow/clipping, missing `document.fonts?.ready`, premature blob URL revocation on iOS Safari, stale render state on prop change, and missing EN i18n keys.

### Hard Guardrails (NEVER Violate)
- **NEVER** inspect, read, modify, or touch `data/vod_analytics/`.
- **NEVER** hardcode, print, or commit secrets from `.env` or `.secrets/`.
- **NEVER** alter hero/skill/item numbers (`data/heroes_130_full.json`, `hero_skills_full.json`, `items.json`) or combat formulas without verified in-game screenshot provenance.

---

## Phase 3 — Local Fixes, Measurable Optimizations & Regression Tests

1. **Fix Confirmed Bugs (High -> Medium -> Low):** Patch root causes cleanly without duplicating logic or leaving dangling timers/effects.
2. **Apply Safe Performance Optimizations:**
   - Keep third-party heavy libraries (`posthog-js`, etc.) lazy-loaded via dynamic `import()` after initial paint (`requestIdleCallback`), keeping `dist/assets/index-*.js <= 260 kB`.
   - Pre-serialize static startup JSON endpoints (`_public_heroes_json_bytes`) and set `Cache-Control: public, max-age=86400` on static icons/media and `immutable` on hashed assets.
   - Maintain single-query consolidated DB reads (`get_auth_user_context`, `get_billing_snapshot`) and memoized React callbacks/props in large grids and modals.
3. **Add Regression Tests:** Add focused tests to `tests/test_bugfix_regressions.py` for every backend/DB/schema bug fixed.
4. **Local-Only Discipline:** Do **NOT** `git commit`, `git push`, or deploy to the Azure VM (`20.2.210.230`) unless the user explicitly asks. If the user asks to deploy ONLY bug fixes while uncommitted dev features remain in the working tree, isolate production bug-fix hunks cleanly so dev-only features do not leak into `origin/main` or the 21-path VM sparse-checkout.

---

## Phase 4 — Final Verification Gate

Run `ruff` and the full audit script AFTER the last edit:

```bash
ruff check --fix . && ruff format .
python .agents/skills/full-stack-bugfix-optimizer/scripts/run_all_audits.py
```

Require **100% PASS** across every check before reporting completion, and summarize fixed bugs, optimizations (with exact measured before/after metrics), and verified checks with clickable file links.

**Related Skills**: `arch-perf-auditor`, `security-audit`, `frontend-e2e-inspector`, `regression-guard`, `rov-data-guardian`, `rov-draft-serving`
