"""WikiSkill Gating Validator for RoV Pro Draft Intelligence.

Chains preflight pattern scanning, data guardian integrity checks, 72-state
golden + combat duel regression guards, and skills mirror verification.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

CHECKS: list[tuple[str, list[str]]] = [
    (
        "WikiSkill Preflight Scan",
        [sys.executable, ".wikiskill/skills/scripts/preflight_check.py"],
    ),
    (
        "RoV Data Guardian Audit",
        [sys.executable, ".agents/skills/rov-data-guardian/scripts/audit_rov_data.py"],
    ),
    (
        "Regression Guard (72 Golden Draft States + 3 Duel Benchmarks)",
        [sys.executable, ".agents/skills/regression-guard/scripts/audit_regression_guard.py"],
    ),
    (
        "Skills Mirror Sync Check",
        [sys.executable, "-m", "pytest", "tests/test_skills_sync.py", "-q", "--tb=short"],
    ),
]


def main() -> int:
    """Execute all gating checks sequentially and fail fast on any regression."""
    print("=" * 70)
    print("[WikiSkill Gating] Running Preflight, Data, Regression & Sync Suite...")
    print("=" * 70)

    for label, cmd in CHECKS:
        print(f"\n>>> Running: {label}")
        script_path = REPO_ROOT / cmd[1] if cmd[1] != "-m" else None
        if script_path is not None and not script_path.exists():
            print(f"[FAIL] Missing script: {script_path}")
            return 1

        proc = subprocess.run(cmd, cwd=REPO_ROOT)
        if proc.returncode != 0:
            print(f"\n[FAIL] GATING REJECTED at '{label}' (exit code {proc.returncode}).")
            print("=" * 70)
            return proc.returncode

    print("\n" + "=" * 70)
    print("[OK] GATING APPROVED: All Preflight, Data, Regression & Sync Checks Passed.")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
