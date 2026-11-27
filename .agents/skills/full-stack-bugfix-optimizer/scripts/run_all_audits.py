"""One-command full-stack bug-fix, regression, UX, security, and performance verification runner."""

from __future__ import annotations

import argparse
import io
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
FRONTEND_DIR = ROOT / "frontend"
DIST_ASSETS_DIR = FRONTEND_DIR / "dist" / "assets"


def _force_utf8_stdio() -> None:
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if isinstance(sys.stderr, io.TextIOWrapper):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def _resolve_npm() -> str:
    for candidate in ("npm.cmd", "npm"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    return "npm"


def _run_step(name: str, cmd: list[str], cwd: Path = ROOT) -> tuple[bool, float, str]:
    start = time.perf_counter()
    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    elapsed = time.perf_counter() - start
    combined = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
    return proc.returncode == 0, elapsed, combined


def _check_entry_bundle_budget(max_entry_kb: float) -> tuple[bool, float, str]:
    start = time.perf_counter()
    if not DIST_ASSETS_DIR.is_dir():
        return False, time.perf_counter() - start, f"Missing dist assets directory: {DIST_ASSETS_DIR}"

    candidates = sorted(DIST_ASSETS_DIR.glob("index-*.js"))
    if not candidates:
        return False, time.perf_counter() - start, f"No entry bundle index-*.js found in {DIST_ASSETS_DIR}"

    entry = max(candidates, key=lambda p: p.stat().st_size)
    size_kb = entry.stat().st_size / 1024.0
    elapsed = time.perf_counter() - start
    if size_kb > max_entry_kb:
        return (
            False,
            elapsed,
            f"Entry bundle {entry.name} is {size_kb:.2f} KiB > budget {max_entry_kb:.1f} KiB",
        )
    return True, elapsed, f"Entry bundle {entry.name}: {size_kb:.2f} KiB <= {max_entry_kb:.1f} KiB"


def main() -> int:
    _force_utf8_stdio()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fast",
        action="store_true",
        help="Run fast lint/build/bundle/i18n/preflight checks only (skip pytest, regression, and Playwright)",
    )
    parser.add_argument(
        "--max-entry-kb",
        type=float,
        default=260.0,
        help="Maximum allowed size in KiB for frontend/dist/assets/index-*.js (default: 260.0)",
    )
    args = parser.parse_args()

    npm = _resolve_npm()
    py = sys.executable

    checks: list[tuple[str, list[str], Path]] = [
        ("ruff check", ["ruff", "check", "."], ROOT),
        ("ruff format --check", ["ruff", "format", "--check", "."], ROOT),
        ("oxlint (frontend)", [npm, "run", "lint"], FRONTEND_DIR),
        ("vite build (frontend)", [npm, "run", "build"], FRONTEND_DIR),
    ]

    tail_checks: list[tuple[str, list[str], Path]] = [
        ("copy & i18n audit", [py, ".agents/skills/frontend-e2e-inspector/scripts/audit_copy_i18n.py"], ROOT),
        ("wikiskill preflight", [py, ".wikiskill/skills/scripts/preflight_check.py"], ROOT),
    ]
    if not args.fast:
        tail_checks.extend(
            [
                ("pytest suite", [py, "-m", "pytest", "-q", "--tb=short"], ROOT),
                ("security audit", [py, ".agents/skills/security-audit/scripts/audit_security.py"], ROOT),
                ("arch & perf audit", [py, ".agents/skills/arch-perf-auditor/scripts/audit_arch_perf.py"], ROOT),
                ("regression guard", [py, ".agents/skills/regression-guard/scripts/audit_regression_guard.py"], ROOT),
                ("data guardian", [py, ".agents/skills/rov-data-guardian/scripts/audit_rov_data.py"], ROOT),
                (
                    "frontend E2E assets",
                    [py, ".agents/skills/frontend-e2e-inspector/scripts/inspect_frontend_e2e.py"],
                    ROOT,
                ),
                ("UX/UI Playwright audit", [py, ".agents/skills/frontend-e2e-inspector/scripts/audit_ux_ui.py"], ROOT),
            ]
        )

    print("=" * 72)
    print(f"RoV Full-Stack Bug-Fix & Optimizer Audit ({'FAST' if args.fast else 'FULL'} mode)")
    print("=" * 72)

    results: list[tuple[str, bool, float, str]] = []
    for name, cmd, cwd in checks:
        ok, elapsed, out = _run_step(name, cmd, cwd)
        results.append((name, ok, elapsed, out))
        print(f"[{'PASS' if ok else 'FAIL'}] {name} ({elapsed:.1f}s)")
        if name == "vite build (frontend)" and ok:
            b_ok, b_elapsed, b_msg = _check_entry_bundle_budget(args.max_entry_kb)
            results.append(("entry bundle budget", b_ok, b_elapsed, b_msg))
            print(f"[{'PASS' if b_ok else 'FAIL'}] entry bundle budget — {b_msg}")

    for name, cmd, cwd in tail_checks:
        ok, elapsed, out = _run_step(name, cmd, cwd)
        results.append((name, ok, elapsed, out))
        print(f"[{'PASS' if ok else 'FAIL'}] {name} ({elapsed:.1f}s)")

    failed = [item for item in results if not item[1]]
    print("=" * 72)
    if failed:
        print(f"[FAIL] {len(failed)}/{len(results)} checks failed:")
        for name, _ok, _elapsed, out in failed:
            print(f"\n--- {name} ---")
            tail_lines = out.splitlines()[-25:]
            print("\n".join(tail_lines))
        return 1

    total_time = sum(item[2] for item in results)
    print(f"[PASS] All {len(results)} checks passed in {total_time:.1f}s.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
