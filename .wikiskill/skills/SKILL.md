---
name: wikiskill
description: Google Research WikiSkill framework for RoV Pro Draft Intelligence. Provides persistent institutional memory (.wikiskill/wiki/), empirical experiment/UX traces (.wikiskill/traces/), and automated preflight & gating scripts (.wikiskill/skills/scripts/).
---

# WikiSkill Engine (Google Research Architecture)

Use this 3-layer knowledge and verification framework whenever inspecting, modifying, training, or deploying the RoV Pro Draft Intelligence system.

## Three-Layer Operation

1. **Trace Layer (`.wikiskill/traces/`)**: Read empirical H100 HPO logs and production UX/cutover lessons before repeating experiments or UI patterns.
2. **Wiki Layer (`.wikiskill/wiki/INDEX.md`)**: Consult the compiled wiki articles for system architecture, non-negotiable draft/data invariants, locked hyperparameters, ERAWAN HPC rules, combat physics, and production deployment guardrails.
3. **Skill Layer (`.wikiskill/skills/scripts/`)**: Run automated preflight scans and regression gating before committing or launching HPC/production runs.

## Quick Commands

- **Run Preflight Scan** (checks prohibited HPC/training patterns and production hyperparameter locks):
  ```bash
  python .wikiskill/skills/scripts/preflight_check.py
  ```
- **Run Full Gating Validator** (runs preflight scan + data guardian + 72-state golden regression guard + skills sync test):
  ```bash
  python .wikiskill/skills/scripts/validate_gating.py
  ```
