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

## 2. Four Core Engineering Pillars

### Pillar 1: Serving & Algorithmic Hot Paths
- **Precomputed GNN Embeddings**: `RoVDraftGNNTransformer` precomputes `_cached_h_gnn` via `precompute_gnn_embeddings()` when `RoVDraftPredictor` initializes in `eval()` mode, avoiding redundant message passing on static hero graphs across direct and Minimax lookahead forward passes.
- **Cache Safety**: `.train(True)` and `._apply(fn)` automatically invalidate `_cached_h_gnn = None` so training gradients and device/dtype transfers never use stale tensors.
- **Zero Pandas in Inference**: Keep hot paths in `src/predictor.py` indexed via dense Python lists/numpy arrays (`_main_lane`, `_lane_key`, etc.) instead of `pandas.DataFrame.iterrows()` or `.loc[]`.

### Pillar 2: SQLite Data Structures & Query Plans
- **Composite Indexing**: Query patterns with `WHERE user_id = ? ORDER BY created_at DESC` (e.g., `auth_sessions` pruning) MUST be backed by `idx_auth_sessions_user_created ON auth_sessions(user_id, created_at)` and pass `EXPLAIN QUERY PLAN` without `USE TEMP B-TREE` or full-table scans.
- **SQL CTE Aggregation**: Aggregate analytics (`get_admin_stats()` retention/DAU/breakdown over `daily_visits`) inside SQLite CTEs rather than fetching entire tables into Python memory under `self._lock`.

### Pillar 3: Sync Concurrency, Fail-Closed Defaults & Atomic I/O
- **Monotonic Server Revision on Merge**: `UserDatabase.save_user_practice_history()` merges concurrent device entries by `id`/`signature` (honoring `deletedIds` and `clearedAt` tombstones) and strictly bumps `merged_updated_at > existing_updated_at` whenever the stored set changes, even if an incoming client timestamp is older.
- **Client Ordering & Reconciliation**: `PracticeDraftView.tsx` enforces a sequence guard (`pushSeqRef`) on `PUT` responses and persists pending `deletedIds` in `localStorage` until acknowledged; `useDraft.ts` reconciles with authoritative newer server state returned by `PUT /draft/session`.
- **Fail-Closed Admin Config**: `ROV_ADMIN_USERNAMES` in `src/config.py` and `deploy/compose.yaml` defaults to `""` (`()`), disabling `/admin/stats` until explicitly configured via environment variables.
- **Atomic / Complete Manifests**: Scripts generating production manifests (such as `scripts/fetch_hero_icons.py` writing `frontend/public/hero_images.json`) MUST fail cleanly (`SystemExit(1)`) without overwriting existing intact manifests when required assets are missing.

### Pillar 4: ML Pipeline & Data-Leakage Hygiene
- **Zero 2024 Fallback**: `load_sota_data_and_graphs()` raises `FileNotFoundError` if `data/matches_training.json` is missing rather than silently falling back to `data/matches_draft_full.json`.
- **Series-Boundary Chronological Split**: Split train/validation chronologically grouped by `series_id` so `train_sids & val_sids == set()`.
- **Train-Only Node Statistics**: Compute `lane_probs`, `meta_stats`, and `priority_scores` exclusively from `train_games` after splitting.

---

## 3. Related Skills

- [`rov-draft-serving`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/rov-draft-serving/SKILL.md): Serves FastAPI endpoints, SOTA inference, and UI conventions.
- [`regression-guard`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/regression-guard/SKILL.md): Audits 72 golden draft states and 3 combat duel benchmarks.
- [`security-audit`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/security-audit/SKILL.md): Audits path traversal, pickle boundaries, input bounds, and secret hygiene.
- [`rov-data-guardian`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/rov-data-guardian/SKILL.md): Validates datasets, hero skills, and true pick order integrity.
- [`hpo-parsimony-selector`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/hpo-parsimony-selector/SKILL.md): Audits Optuna HPO trials and served checkpoint parsimony.
