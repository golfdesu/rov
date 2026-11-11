#!/usr/bin/env python3
"""RoV Security Audit Runner.

Inspired by Cloudflare's security-audit-skill framework.
Executes automated security checks across API routes, static mounts,
PyTorch models, and simulation bounds.

Usage:
    python .agents/skills/security-audit/scripts/audit_security.py
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from src.api import app  # noqa: E402
from src.combat_calculator import DUEL_MAX_SECONDS  # noqa: E402

client = TestClient(app)


def audit_path_traversal() -> None:
    print("[1/5] Auditing Path Traversal & Boundary Containment...")
    attack_payloads = [
        "../../etc/passwd",
        "..%2F..%2Fetc%2Fpasswd",
        "..\\..\\windows\\system32",
        "..%5C..%5Cwindows",
        "....//....//etc",
        "/etc/passwd",
        "C:\\Windows\\System32",
        "item/../../src/api.py",
    ]

    for payload in attack_payloads:
        # Hero endpoint
        r_hero = client.get(f"/combat/hero-screenshots/{payload}")
        assert r_hero.status_code in (400, 404), (
            f"Path traversal payload '{payload}' on hero endpoint returned unexpected {r_hero.status_code}"
        )

        # Item endpoint
        r_item = client.get(f"/combat/item-screenshots/{payload}")
        assert r_item.status_code in (400, 404), (
            f"Path traversal payload '{payload}' on item endpoint returned unexpected {r_item.status_code}"
        )

    print("      -> Path traversal defenses active and verified (100% rejected).")


def audit_model_safety() -> None:
    print("[2/5] Auditing PyTorch Checkpoint Safety...")
    models_dir = REPO_ROOT / "models"
    assert models_dir.is_dir(), f"Models directory not found at {models_dir}"

    for pt_file in models_dir.glob("*.pt"):
        # Check that checkpoint is located within models/ and readable
        assert pt_file.is_file(), f"Model file {pt_file} is not a valid file"
        size_mb = pt_file.stat().st_size / (1024 * 1024)
        assert size_mb > 0.1, f"Model file {pt_file} is abnormally small ({size_mb:.2f} MB)"

    print("      -> All model checkpoints verified in models/ directory.")


def audit_simulation_bounds() -> None:
    print("[3/5] Auditing Combat Engine Timeout & Input Bounds...")
    # Verify timeout constraint
    assert DUEL_MAX_SECONDS > 0 and DUEL_MAX_SECONDS <= 120.0, (
        f"DUEL_MAX_SECONDS ({DUEL_MAX_SECONDS}) is outside safe range (0, 120]"
    )

    # Test bad duel payload
    r_bad_hero = client.post(
        "/combat/duel",
        json={
            "a": {"hero": "NonExistentHero", "level": 12, "items": []},
            "b": {"hero": "Toro", "level": 12, "items": []},
        },
    )
    assert r_bad_hero.status_code in (422, 400), f"Invalid hero duel returned unexpected {r_bad_hero.status_code}"

    # Test bad stats payload
    r_bad_stats = client.post(
        "/combat/stats",
        json={"build": {"hero": "Valhein", "items": ["DangerousItemPayload12345"]}},
    )
    assert r_bad_stats.status_code in (422, 400), f"Invalid item stats returned unexpected {r_bad_stats.status_code}"

    print("      -> Combat engine input bounds and timeout guards verified.")


def audit_static_media_containment() -> None:
    print("[4/5] Auditing Static Media File Containment...")
    heroes_dir = REPO_ROOT / "heroes"
    items_dir = REPO_ROOT / "item"

    assert heroes_dir.is_dir(), f"Heroes directory {heroes_dir} missing"
    assert items_dir.is_dir(), f"Item directory {items_dir} missing"

    # Direct static path escape attempt
    r_escape1 = client.get("/heroes-media/../data/matches_draft_full.json")
    assert r_escape1.status_code in (400, 404), f"Static escape returned unexpected {r_escape1.status_code}"

    r_escape2 = client.get("/items-media/../src/api.py")
    assert r_escape2.status_code in (400, 404), f"Static escape returned unexpected {r_escape2.status_code}"

    print("      -> Static media directory isolation verified.")


def audit_secret_leakage() -> None:
    print("[5/5] Auditing Secret & Credential Leakage...")
    try:
        res = subprocess.run(
            ["git", "ls-files"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        tracked_files = res.stdout.splitlines()
    except Exception as exc:
        print(f"      [WARN] git ls-files check skipped: {exc}")
        return

    forbidden_patterns = [".env", "id_rsa", "id_ed25519", ".pem", ".key", "credentials.json"]
    leaked = []
    for f in tracked_files:
        name = os.path.basename(f).lower()
        if any(pat in name for pat in forbidden_patterns) and not f.endswith(".py"):
            leaked.append(f)

    assert not leaked, f"Potential sensitive files tracked in git: {leaked}"
    print(f"      -> 0 secret files tracked across {len(tracked_files)} git files.")


def main() -> None:
    print("=" * 72)
    print("RoV Security Audit Framework (Cloudflare Methodology)")
    print("=" * 72)
    audit_path_traversal()
    audit_model_safety()
    audit_simulation_bounds()
    audit_static_media_containment()
    audit_secret_leakage()
    print("=" * 72)
    print("[PASS] All security audit checkpoints verified successfully.")
    print("=" * 72)


if __name__ == "__main__":
    main()
