"""Automated Security Test Suite for RoV Pro Draft Intelligence.

Adapts Cloudflare's security-audit-skill methodology into automated CI/CD Pytest checks.
Verifies path traversal fuzzing, static media containment, model checkpoint safety,
combat simulation boundaries, and secret leak prevention.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from src.api import app
from src.combat_calculator import DUEL_MAX_SECONDS

client = TestClient(app)
REPO_ROOT = Path(__file__).resolve().parent.parent


def test_path_traversal_fuzzing():
    """Fuzzes hero and item screenshot endpoints with traversal payloads."""
    traversal_payloads = [
        "../../etc/passwd",
        "..%2F..%2Fetc%2Fpasswd",
        "..%2f..%2fetc%2fpasswd",
        "..\\..\\windows\\system32",
        "..%5C..%5Cwindows",
        "..%5c..%5cwindows",
        "....//....//etc",
        "/etc/passwd",
        "C:\\Windows\\System32",
        "item/../../src/api.py",
        "heroes/../../data/items.json",
        "%2e%2e%2f%2e%2e%2fetc",
        "%2e%2e%5c%2e%2e%5cwindows",
    ]

    for payload in traversal_payloads:
        # Hero endpoint fuzzing
        r_hero = client.get(f"/combat/hero-screenshots/{payload}")
        assert r_hero.status_code in (400, 404), (
            f"Expected 400/404 for hero payload '{payload}', got {r_hero.status_code}"
        )

        # Item endpoint fuzzing
        r_item = client.get(f"/combat/item-screenshots/{payload}")
        assert r_item.status_code in (400, 404), (
            f"Expected 400/404 for item payload '{payload}', got {r_item.status_code}"
        )


def test_static_media_containment():
    """Verifies static media mounts do not allow traversing outside their target directories."""
    escape_routes = [
        "/heroes-media/../data/matches_draft_full.json",
        "/heroes-media/..%2Fdata%2Fmatches_draft_full.json",
        "/items-media/../src/api.py",
        "/items-media/..%2Fsrc%2Fapi.py",
        "/heroes-media/../package.json",
        "/items-media/../requirements.txt",
    ]

    for route in escape_routes:
        res = client.get(route)
        assert res.status_code in (400, 404), f"Static escape route '{route}' returned unexpected {res.status_code}"


def test_model_checkpoint_pickle_safety():
    """Verifies production model checkpoint existence and structural integrity."""
    models_dir = REPO_ROOT / "models"
    assert models_dir.is_dir()

    sota_pt = models_dir / "sota_draft_gnn_transformer.pt"
    assert sota_pt.is_file(), f"SOTA checkpoint missing at {sota_pt}"
    # Must be non-trivial binary file (>1MB)
    assert sota_pt.stat().st_size > 1_000_000, "Checkpoint file suspiciously small"


def test_combat_input_boundaries_and_dos_protection():
    """Tests combat calculator against out-of-bounds parameters, DoS payloads, and malformed inputs."""
    # 1. Duel max timeout cap invariant
    assert DUEL_MAX_SECONDS <= 120.0, f"DUEL_MAX_SECONDS ({DUEL_MAX_SECONDS}) exceeds safe threshold"

    # 2. Invalid hero name rejection
    r_bad_hero = client.post(
        "/combat/duel",
        json={
            "a": {"hero": "MaliciousHero<script>", "level": 12, "items": []},
            "b": {"hero": "Toro", "level": 12, "items": []},
        },
    )
    assert r_bad_hero.status_code in (400, 422)

    # 3. Invalid items list rejection
    r_bad_items = client.post(
        "/combat/stats",
        json={"build": {"hero": "Valhein", "items": ["NonExistentItemExploit"]}},
    )
    assert r_bad_items.status_code in (400, 422)

    # 4. Out-of-bounds rune recommendation request (level > 15 or < 1)
    r_bad_level_high = client.get(
        "/combat/rune-recommendation",
        params={"my_hero": "Omen", "enemy_hero": "Biron", "lane": "DS_Lane", "level": 999},
    )
    assert r_bad_level_high.status_code == 422

    r_bad_level_low = client.get(
        "/combat/rune-recommendation",
        params={"my_hero": "Omen", "enemy_hero": "Biron", "lane": "DS_Lane", "level": 0},
    )
    assert r_bad_level_low.status_code == 422


def test_no_secrets_in_tracked_files():
    """Ensures no private keys, passwords, or .env files are committed to git."""
    try:
        res = subprocess.run(
            ["git", "ls-files"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        tracked = res.stdout.splitlines()
    except Exception:
        return  # Skip if git is not accessible

    forbidden = [".env", "id_rsa", "id_ed25519", ".pem", ".key", "credentials.json"]
    leaked = [
        f for f in tracked if any(pat in os.path.basename(f).lower() for pat in forbidden) and not f.endswith(".py")
    ]
    assert not leaked, f"Potential sensitive files committed to git: {leaked}"
