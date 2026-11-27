---
name: arch-perf-auditor
description: Automated architecture, data-structure, algorithmic complexity, SQLite query plan, sync concurrency, and ML data-leakage audit for the RoV Pro Draft Intelligence repository. Use when reviewing code quality, optimizing inference latency, adding SQLite tables/queries, modifying cross-device sync, or auditing training splits before commit/deploy.
---

# Architecture, Data Structures & Best-Practice Auditor

> [!IMPORTANT]
> Run this audit whenever modifying serving inference (`src/predictor.py`, `src/train_sota_model.py`, `src/search/`), database schemas/queries (`src/db.py`), cross-device state sync (`src/api.py`, `frontend/src/`), or dataset splitting/feature generation (`src/train_sota_model.py`).

## 1. Quick Automated Audit

```bash
# Full audit (SQLite EXPLAIN QUERY PLAN, GNN cache + CPU latency benchmark, ML split leak check, fail-closed & sync invariants)
python .agents/skills/arch-perf-auditor/scripts/audit_arch_perf.py

# Fast check without latency micro-benchmark
python .agents/skills/arch-perf-auditor/scripts/audit_arch_perf.py --skip-bench
```

---

## 2. Five Core Engineering Pillars

### Pillar 1: Serving, Inference Caching & Algorithmic Hot Paths
- **Precomputed GNN Embeddings**: `RoVDraftGNNTransformer` precomputes `_cached_h_gnn` via `precompute_gnn_embeddings()` when `RoVDraftPredictor` initializes in `eval()` mode, avoiding redundant message passing on static hero graphs across direct and Minimax lookahead forward passes.
- **Cache Safety**: `.train(True)` and `._apply(fn)` automatically invalidate `_cached_h_gnn = None` so training gradients and device/dtype transfers never use stale tensors.
- **LRU Prediction Cache & Inference Mode (`src/predictor.py`, `src/search/draft_mcts.py`)**: `RoVDraftPredictor.predict()` wraps `_predict_uncached()` with a thread-safe bounded `OrderedDict` LRU cache (`maxsize = 512`) keyed on all 22 fields of `DraftStateRequest`, returning `.model_copy(deep=True)` to isolate callers (`~0.07 ms` hit vs `~5.9 ms` cold). `run_model()` executes inside `torch.inference_mode()` and reuses the uploaded `unavail` tensor (`tensors[4]`) without duplicate host-to-device allocation.
- **OpenMP Thread Cap (`deploy/compose.yaml`, `src/predictor.py`)**: Set `OMP_NUM_THREADS=1`, `MKL_NUM_THREADS=1`, and `ROV_TORCH_NUM_THREADS=1` in container environments to prevent CPU thread oversubscription across AnyIO worker threads.
- **Lazy Dev Engine & HTTP Caching (`src/api.py`)**: `CombatEngine` is lazy-loaded via `_item_folder_aliases()` instead of at module import time. `/heroes` serves `Cache-Control: public, max-age=3600` (excluded from middleware `no-store`), while `_FrontendStaticFiles` sets `public, max-age=31536000, immutable` on `/assets/*`, `public, max-age=86400` on `/avatars/*` and `/hero_images.json`, and `no-cache` on HTML.
- **Zero Pandas in Inference**: Keep hot paths in `src/predictor.py` indexed via dense Python lists/numpy arrays (`_main_lane`, `_lane_key`, etc.) instead of `pandas.DataFrame.iterrows()` or `.loc[]`.

### Pillar 2: SQLite Data Structures, Pragmas & Query Plans
- **WAL Pragmas & One-Time Dir Setup**: `_connect()` applies `PRAGMA synchronous=NORMAL`, `PRAGMA temp_store=MEMORY`, `PRAGMA cache_size=-16000`, `foreign_keys=ON`, and `busy_timeout=5000`; `mkdir` runs in `__init__` / `ensure_schema()`, never per query.
- **Lock-Free WAL Reads**: Do not wrap read-only WAL queries (`get_user_by_token`, `_get_user_json_state`, `get_pricing_survey_choice`, `get_admin_*`) in global `self._lock`; rely on SQLite WAL snapshot isolation.
- **Composite Indexing & Pruning**: Query patterns MUST pass `EXPLAIN QUERY PLAN` without unexpected `SCAN` or `USE TEMP B-TREE` (`idx_auth_sessions_user_created`, `idx_billing_orders_user_status`, `idx_billing_orders_created`, `idx_billing_passes_expires_at`, `idx_daily_visits_user_date`, `idx_users_created_at`, `idx_pricing_survey_updated`, `idx_team_invites_owner_tier_exp`). Avoid strict-prefix redundant indexes (e.g., `idx_hero_pools_owner` dropped in favor of `idx_hero_pools_owner_sort`).
- **SQL CTE Aggregation & Endpoint Consolidation**: Aggregate retention/DAU inside SQLite CTEs (`get_admin_stats()`) and avoid double `json_extract()` parsing in `ORDER BY` (`get_admin_users_report()` uses a `user_rows` CTE). Consolidate multi-query auth/billing checks into single-connection snapshots (`get_auth_user_context()`, `get_billing_snapshot()` -> `<= 2` DB connections per `/auth/me` or `/billing`).

### Pillar 3: Sync Concurrency, Fail-Closed Defaults & Atomic I/O
- **Monotonic Server Revision on Merge**: `UserDatabase.save_user_practice_history()` merges concurrent device entries by `id`/`signature` (honoring `deletedIds` and `clearedAt` tombstones) and strictly bumps `merged_updated_at > existing_updated_at` whenever the stored set changes, even if an incoming client timestamp is older.
- **Client Ordering & Reconciliation**: `PracticeDraftView.tsx` enforces a sequence guard (`pushSeqRef`) on `PUT` responses and persists pending `deletedIds` in `localStorage` until acknowledged; `useDraft.ts` reconciles with authoritative newer server state returned by `PUT /draft/session`.
- **Fail-Closed Admin Config**: `ROV_ADMIN_USERNAMES` in `src/config.py` and `deploy/compose.yaml` defaults to `""` (`()`), disabling `/admin/stats` until explicitly configured via environment variables.
- **Atomic / Complete Manifests**: Scripts generating production manifests (such as `scripts/fetch_hero_icons.py` writing `frontend/public/hero_images.json`) MUST fail cleanly (`SystemExit(1)`) without overwriting existing intact manifests when required assets are missing.

### Pillar 4: ML Pipeline & Data-Leakage Hygiene
- **Zero 2024 Fallback**: `load_sota_data_and_graphs()` raises `FileNotFoundError` if `data/matches_training.json` is missing rather than silently falling back to `data/matches_draft_full.json`.
- **Series-Boundary Chronological Split**: Split train/validation chronologically grouped by `series_id` so `train_sids & val_sids == set()`.
- **Train-Only Node Statistics**: Compute `lane_probs`, `meta_stats`, and `priority_scores` exclusively from `train_games` after splitting.

### Pillar 5: Frontend Bundle Splitting, Waterfall & Rendering Hygiene
- **EN-Only Dynamic Dictionary (`language.ts`, `LanguageProvider.tsx`)**: Dynamically `import("./englishMessages")` only when `language === "en"` so Thai users never download/parse the `~202 KB` EN translation chunk (keeping `createLucideIcon-*.js` `< 10 KB`).
- **Vendor & Modal Splitting (`vite.config.ts`, `App.tsx`, `ScrimDashboardView.tsx`, `PracticeDraftView.tsx`)**: Isolate `react`/`react-dom`/`scheduler` into `react-vendor` via `rolldownOptions.output.manualChunks`, and `React.lazy()`-load rare/heavy modals (`AuthLanding`, `AuthModal`, `DonateModal`, `MobileNavDrawer`, `PricingSurveyModal`, `UserGuideModal`, `ScoutingReportModal`, `PracticeHistoryModal`).
- **Zero Cold-Load Waterfall**: Trigger `fetchHeroCatalogOnce()` in parallel with `GET /auth/me` on app mount instead of waiting for auth resolution before requesting `/heroes`.
- **Main-Thread & Memo Guardrails**: Gate `document.body` `MutationObserver` only when auto-survey eligibility applies (`App.tsx`), keep `useCallback` + module-level constants in `PracticeDraftView.tsx` so `React.memo(HeroGrid)` holds, wrap hero search `query` in `useDeferredValue`, use `decoding="async"` on `HeroPortrait`, and share `Intl.Collator` in `HeroPickerModal`.

---

## 3. Related Skills

**Related Skills**: [`full-stack-bugfix-optimizer`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/full-stack-bugfix-optimizer/SKILL.md), [`rov-draft-serving`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/rov-draft-serving/SKILL.md), [`regression-guard`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/regression-guard/SKILL.md), [`security-audit`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/security-audit/SKILL.md), [`rov-data-guardian`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/rov-data-guardian/SKILL.md), [`hpo-parsimony-selector`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/hpo-parsimony-selector/SKILL.md)
