---
name: security-audit
description: >-
  Automated multi-phase security auditing framework based on Cloudflare's methodology.
  Audits path traversal, PyTorch model pickle safety, FastAPI input bounds/DoS,
  static media containment, CORS/headers, and secret leak prevention across the RoV project.
---

# RoV Security Audit Skill

This skill adapts the **Cloudflare Multi-Phase Security Audit Framework** (`cloudflare/security-audit-skill`) to the RoV Pro Draft Intelligence codebase (FastAPI + PyTorch SOTA GNN-Transformer + React Vite + Local Media Storage).

---

## 1. Quick Programmatic Audit (Run First and Last)

```bash
python .agents/skills/security-audit/scripts/audit_security.py
pytest -v tests/test_security.py
```

These automated checks test:
1. **Path Traversal & Boundary Containment**: Fuzzes `/combat/hero-screenshots/{hero}` and `/combat/item-screenshots/{item_name}` with encoded and raw directory traversal vectors.
2. **PyTorch Pickle Safety**: Inspects model checkpoints in `models/` to ensure no arbitrary code execution or unvalidated callable opcodes exist.
3. **Input Boundaries & DoS Resistance**: Validates Pydantic schema boundaries on `/combat/duel`, `/combat/stats`, and `/predict` against negative numbers, excessive arrays, and `inf`/`nan` floats.
4. **Static Media Shadowing & Containment**: Verifies that `/heroes-media` and `/items-media` are properly contained and cannot expose parent directory assets.
5. **Secret Leakage Prevention**: Confirms that no API keys, private tokens, or `.env` files are tracked in git.

---

## 2. Multi-Phase Audit Methodology (Cloudflare Standard)

When conducting deep code reviews or adding new external endpoints, follow this 5-phase protocol:

### Phase 1: Reconnaissance (Attack Surface Mapping)
- Map all external entry points:
  - Public FastAPI routes in `src/api.py` (`/predict`, `/combat/*`, `/heroes/*`, `/draft/*`).
  - Static file mounts (`/`, `/heroes-media`, `/items-media`).
  - CLI entry points with user input arguments (`src/predict_draft_cli.py`).
- Trace data flows from user input directly to filesystem calls, model forwards, and math loops.

### Phase 2: Coverage-Led Hunting (Vulnerability Classes)
Deploy targeted inspection across the project's critical vulnerability categories:

1. **Path Traversal & In-Game Media Security**:
   - Every file-system lookup accepting user strings MUST use `is_relative_to()` boundary checks and strict token validation (`..`, `/`, `\`).
   - Suffix filtering must be explicitly whitelisted (`.jpg`, `.jpeg`, `.png`).
2. **PyTorch Safe Model Deserialization**:
   - Check all `torch.load()` calls across `src/` and `scripts/`.
   - Ensure checkpoint provenance is validated, and avoid unpickling arbitrary user-supplied `.pt` files.
3. **Pydantic Validation & Resource Exhaustion (DoS)**:
   - Numerical parameters (`level`, `skill_level`, `skill_hits`) must have explicit Pydantic bounds (`ge=1, le=15`, etc.).
   - Simulation loops (e.g. `DUEL_MAX_SECONDS = 60.0` in `src/combat_calculator.py`) must have strict hard timeout caps to avoid CPU hanging.
4. **Cross-Origin & Header Policy**:
   - Review CORS policy in `src/api.py`.
   - In production builds, verify static file headers prevent MIME-sniffing (`X-Content-Type-Options: nosniff`).

### Phase 3: Candidate Validation (False Positive Filtering)
- For every potential lead identified during hunting:
  - Formulate the threat hypothesis: *What attacker capability is enabled?*
  - Identify existing mitigations: *Does Pydantic, FastAPI, or Pathlib already block this?*
  - Discard purely theoretical issues that violate no real trust boundary.

### Phase 4: Independent Record Verification (Proof-of-Concept)
- For every validated finding:
  - Write an automated regression test in `tests/test_security.py`.
  - Execute the test to verify the failure before fixing, and verify 100% green after remediation.

### Phase 5: Structured Reporting & Remediation
- Document findings with clear CVSS severity, exact code locations (`file:///...`), root cause, and verified remediation diffs.
- Append a permanent record in `CHANGELOG.md`.

---

## 3. Critical Security Invariants (NON-NEGOTIABLE)

1. **Path Traversal Shield**: Never construct a `Path` from user input without asserting `.resolve().is_relative_to(BASE_DIR)`.
2. **Pickle Boundary**: Never call `torch.load()` on unverified remote files. All production checkpoints in `models/` must be audited for safe globals.
3. **Infinite Loop Floor**: Every simulation loop in `src/combat_calculator.py` or search algorithms in `src/search/` MUST possess an explicit step/time bound (`DUEL_MAX_SECONDS`, `max_steps`, `depth`).

---

## 4. Related Skills

- [`rov-draft-serving`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/rov-draft-serving/SKILL.md): Implements FastAPI endpoints, static asset routing, and inference pipeline.
- [`frontend-e2e-inspector`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/frontend-e2e-inspector/SKILL.md): Audits production frontend bundles, media assets, and endpoint health.
- [`regression-guard`](file:///C:/Users/chaya/Documents/Program/Project/ROV/.agents/skills/regression-guard/SKILL.md): Protects against algorithmic regression and bounds simulation runtime.
