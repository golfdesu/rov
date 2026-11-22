# WikiSkill Knowledge Base Index — RoV Pro Draft Intelligence

Welcome to the **WikiSkill Knowledge Base** for **RoV Pro Draft Intelligence** (`golfdesu/rov`).
Constructed under the 3-layer **WikiSkill** institutional memory architecture (*Google Research, arXiv:2608.27454*), this directory compiles verified system architecture, non-negotiable domain invariants, H100 HPO benchmarks, combat engine physics, and production deployment lessons into cross-linked markdown pages and automated gating scripts so AI agents never repeat solved mistakes.

---

## Wiki Catalog (`.wikiskill/wiki/`)

| Article | Topic | Purpose |
| :--- | :--- | :--- |
| [`system_architecture_and_data.md`](system_architecture_and_data.md) | **System Architecture & SSOT Data** | End-to-end map of the 130-hero dataset, screenshot provenance, `RoVDraftGNNTransformer`, FastAPI + SQLite/OAuth backend, and React 19 UI |
| [`draft_invariants_and_pitfalls.md`](draft_invariants_and_pitfalls.md) | **Draft Invariants & Pitfalls** | Liquipedia lane-order vs pre-swap broadcast trap, `augment_factor = 1` lock, 2024 exclusion, Thai canonical names, and screenshot naming rules |
| [`production_hyperparameters_and_hpo.md`](production_hyperparameters_and_hpo.md) | **Production Hyperparameters & HPO** | 80-trial H100 Optuna HPO, `delta <= 1.0%` parsimony rule, Trial #31 (`Val = 2.76992`), served checkpoint (`Val = 2.81796`), and model capacity locks |
| [`erawan_hpc_playbook.md`](erawan_hpc_playbook.md) | **ERAWAN HPC & H100 Playbook** | `compute4` (`gpu-h100`) SLURM rules, `torch.compile()` ban, `GPUTensorBatcher`, and vectorized evaluation requirements |
| [`combat_engine_and_mechanics.md`](combat_engine_and_mechanics.md) | **Combat Engine & 130x130 Matchups** | Mitigation math, stat stacking, `skill_mechanics.py` passives/overrides, 16,770 matchup duels, 235 counter-item flips, and known data gaps |
| [`production_deployment_and_ui.md`](production_deployment_and_ui.md) | **Production Deployment & UI/UX** | Live `minidraft.app` Docker/Caddy stack, `VITE_DRAFT_ONLY=true` scope, SQLite DB safety, Spotlight Replace, Draft Timer, and Practice sync |

---

## Operational Traces (`.wikiskill/traces/`)

| Trace | Scope |
| :--- | :--- |
| [`h100_hpo_and_training_trace.md`](../traces/h100_hpo_and_training_trace.md) | Empirical trace of 80-trial 37-dim H100 Optuna HPO (90d recency decay) and True Pick Order vs 0% Heuristic baseline experiments |
| [`production_cutover_and_ux_trace.md`](../traces/production_cutover_and_ux_trace.md) | Distilled engineering lessons from `CHANGELOG.md` and `docs/PRODUCTION_RELEASES.md` (`981b773` -> `6fec71a`, including stochastic telemetry & `/#admin` UX) |

---

## Executable Skills & Gating (`.wikiskill/skills/`)

- **Usage Guide**: [`skills/SKILL.md`](../skills/SKILL.md)
- **Preflight Scanner**: [`skills/scripts/preflight_check.py`](../skills/scripts/preflight_check.py) — Scans `src/`, `scripts/`, and `*.sbatch` for prohibited patterns (`torch.compile`, `set_per_process_memory_fraction`, `augment_factor > 2`, invalid SLURM partitions) and validates `configs/selected_production_params.json`.
- **Gating Validator**: [`skills/scripts/validate_gating.py`](../skills/scripts/validate_gating.py) — Orchestrates `preflight_check.py`, `rov-data-guardian`, `regression-guard` (72 golden states + 3 duel benchmarks), and `tests/test_skills_sync.py`.

---

## Live Verification Commands

```bash
# 1. Run WikiSkill preflight scan
python .wikiskill/skills/scripts/preflight_check.py

# 2. Run full WikiSkill gating suite
python .wikiskill/skills/scripts/validate_gating.py

# 3. Always re-quote live model metrics from the HPO selector
python .agents/skills/hpo-parsimony-selector/scripts/select_parsimonious_params.py
```
