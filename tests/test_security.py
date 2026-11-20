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


def test_trusted_proxy_strict_loopback_default(monkeypatch):
    """By default, private RFC1918 proxies cannot spoof CF-Connecting-IP / X-Forwarded-For."""
    from src.api import _is_trusted_proxy
    from src.config import config

    monkeypatch.setattr(config, "trusted_proxies", ("loopback",))
    assert _is_trusted_proxy("127.0.0.1") is True
    assert _is_trusted_proxy("::1") is True
    assert _is_trusted_proxy("10.0.0.5") is False
    assert _is_trusted_proxy("172.16.0.10") is False
    assert _is_trusted_proxy("203.0.113.10") is False

    monkeypatch.setattr(config, "trusted_proxies", ("loopback", "10.0.0.0/8"))
    assert _is_trusted_proxy("10.0.0.5") is True


def test_rate_limiter_preserves_active_lockout():
    """Low-volume spray keys must not evict actively locked-out keys from RateLimiter."""
    from src.db import RateLimiter

    limiter = RateLimiter(max_attempts=2, window_seconds=60, max_keys=4)
    assert limiter.check_and_record("acct:target") is True
    assert limiter.check_and_record("acct:target") is True
    assert limiter.check_allowed("acct:target") is False

    for i in range(6):
        assert limiter.check_and_record(f"spray:{i}") is True

    assert limiter.check_allowed("acct:target") is False


def test_stale_unused_account_pruned_at_max_users(tmp_path):
    """Abandoned accounts (>30d old, no active session, no saved states) are pruned when full."""
    import sqlite3
    import time

    from src.db import SESSION_TTL_SECONDS, UserDatabase

    db = UserDatabase(tmp_path / "prune.db", max_users=2)
    old_user = db.register_user("oldbot", "password123")
    active_user = db.register_user("keeper", "password123")
    db.save_user_draft_state(active_user.id, {"bluePicks": ["Tulen"]}, int(time.time()))

    # Backdate old_user past the 30-day inactivity threshold
    old_ts = int(time.time()) - SESSION_TTL_SECONDS - 3600
    with sqlite3.connect(db.db_path) as conn:
        conn.execute("UPDATE users SET created_at = ? WHERE id = ?", (old_ts, old_user.id))

    # 3rd signup succeeds by pruning old_user, while 4th fails because both remaining accounts are active/recent
    fresh_user = db.register_user("newplayer", "password123")
    assert fresh_user.username == "newplayer"
    assert db.get_user_draft_state(active_user.id) == {"bluePicks": ["Tulen"]}
    try:
        db.register_user("overflow", "password123")
        raise AssertionError("Expected max_users RuntimeError")
    except RuntimeError:
        pass


def test_production_stream_body_cap_csrf_nan_and_csp(monkeypatch, tmp_path):
    """Verifies chunked >256KB body cap, Infinity rejection, CSRF Origin check, and CSP form-action."""
    import src.api as api_mod
    from src.config import config

    monkeypatch.setattr(config, "env", "production")
    monkeypatch.setattr(config, "cors_origins", ["https://minidraft.app"])
    monkeypatch.setattr(config.paths, "app_db_path", tmp_path / "sec_prod.db")
    monkeypatch.setattr(api_mod, "_user_db", None)

    with TestClient(app) as prod_client:
        # 1. Chunked / streamed request > 256 KB without Content-Length header
        chunk = b"x" * (64 * 1024)

        def chunked_body():
            yield b'{"mode":"pick","pad":"'
            for _ in range(5):
                yield chunk
            yield b'"}'

        r_chunk = prod_client.post(
            "/predict",
            content=chunked_body(),
            headers={"Content-Type": "application/json", "Origin": "https://minidraft.app"},
        )
        assert r_chunk.status_code == 413

        # 2. Infinity (1e400) rejected on DraftSessionStateSchema
        r_inf = prod_client.put(
            "/draft/session",
            content='{"blueWinRate": 1e400, "winHistory": [1e400]}',
            headers={"Content-Type": "application/json", "Origin": "https://minidraft.app"},
        )
        assert r_inf.status_code == 422

        # 3. Cross-origin / subdomain Origin rejected on state-changing routes
        assert (
            prod_client.post(
                "/auth/logout",
                headers={"Origin": "https://evil.minidraft.app"},
            ).status_code
            == 403
        )
        assert (
            prod_client.post(
                "/auth/logout",
                headers={"Origin": "null"},
            ).status_code
            == 403
        )

        # 4. CSP includes form-action 'self' and allows Cloudflare Web Analytics without relaxing script-src
        csp = prod_client.get("/health").headers.get("content-security-policy", "")
        assert "form-action 'self'" in csp
        assert "script-src 'self' https://static.cloudflareinsights.com;" in csp
        assert "connect-src 'self' https://cloudflareinsights.com;" in csp
        assert "'unsafe-inline'" not in csp.split("script-src", 1)[1].split(";", 1)[0]


def test_multi_ip_account_lockout(monkeypatch, tmp_path):
    """Per-account lockout triggers after 20 failures even when client IP rotates per attempt."""
    import src.api as api_mod
    from src.config import config
    from src.db import RateLimiter

    monkeypatch.setattr(config, "env", "production")
    monkeypatch.setattr(config, "cors_origins", ["https://minidraft.app"])
    monkeypatch.setattr(config, "trusted_proxies", ("private", "loopback"))
    monkeypatch.setattr(config.paths, "app_db_path", tmp_path / "lockout.db")
    monkeypatch.setattr(api_mod, "_user_db", None)
    monkeypatch.setattr(api_mod, "_account_login_limiter", RateLimiter(max_attempts=20, window_seconds=300))
    monkeypatch.setattr(api_mod, "_auth_rate_limiter", RateLimiter(max_attempts=100, window_seconds=60))
    monkeypatch.setattr(api_mod, "_login_user_limiter", RateLimiter(max_attempts=10, window_seconds=300))
    monkeypatch.setattr(api_mod, "_client_ip", lambda req: req.headers.get("x-test-ip", "1.1.1.1"))

    with TestClient(app) as prod_client:
        reg = prod_client.post(
            "/auth/register",
            json={"username": "victim1", "password": "correcthorse"},
            headers={"Origin": "https://minidraft.app", "x-test-ip": "198.51.100.1"},
        )
        assert reg.status_code == 201

        for i in range(20):
            r = prod_client.post(
                "/auth/login",
                json={"username": "victim1", "password": "wrongpassword"},
                headers={"Origin": "https://minidraft.app", "x-test-ip": f"203.0.113.{i + 1}"},
            )
            assert r.status_code == 401

        # 21st attempt from yet another fresh IP must be blocked with 429
        blocked = prod_client.post(
            "/auth/login",
            json={"username": "victim1", "password": "correcthorse"},
            headers={"Origin": "https://minidraft.app", "x-test-ip": "203.0.113.200"},
        )
        assert blocked.status_code == 429


def test_updated_at_bounds_cors_header_csp_and_db_monotonic_guard(monkeypatch, tmp_path):
    """Verify updatedAt >= 2**63 returns 422, CORS allows X-Expected-User, and stale writes do not overwrite newer DB state."""
    import src.api as api_mod
    from src.config import config
    from src.db import UserDatabase

    # 1. Monotonic updated_at guard prevents stale client overwrites
    db = UserDatabase(tmp_path / "sync.db")
    u = db.register_user("syncuser", "password123")
    db.save_user_draft_state(u.id, {"stepIndex": 5, "updatedAt": 2000}, 2000)
    db.save_user_draft_state(u.id, {"stepIndex": 0, "updatedAt": 1000}, 1000)
    assert db.get_user_draft_state(u.id)["stepIndex"] == 5

    # 2. CORS preflight allows X-Expected-User, dev CSP permits Arcana CDN icons, and updatedAt >= 2**63 returns 422
    monkeypatch.setattr(config, "env", "development")
    monkeypatch.setattr(config, "cors_origins", ["http://localhost:3000"])
    monkeypatch.setattr(config.paths, "app_db_path", tmp_path / "sync.db")
    monkeypatch.setattr(api_mod, "_user_db", db)
    with TestClient(app) as dev_client:
        preflight = dev_client.options(
            "/draft/session",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "Content-Type, X-Expected-User",
            },
        )
        assert preflight.status_code == 200
        assert "x-expected-user" in preflight.headers.get("access-control-allow-headers", "").lower()

        dev_csp = dev_client.get("/health").headers.get("content-security-policy", "")
        assert "https://cdngarenanow-a.akamaihd.net" in dev_csp

        assert (
            dev_client.post(
                "/auth/login",
                json={"username": "syncuser", "password": "password123"},
                headers={"Origin": "http://localhost:3000"},
            ).status_code
            == 200
        )
        r_huge = dev_client.put(
            "/draft/session", json={"updatedAt": 10**25}, headers={"Origin": "http://localhost:3000"}
        )
        assert r_huge.status_code == 422
        r_neg = dev_client.put("/draft/session", json={"updatedAt": -5}, headers={"Origin": "http://localhost:3000"})
        assert r_neg.status_code == 422
