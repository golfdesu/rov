import subprocess
import sys

from fastapi.testclient import TestClient

from src.api import _FrontendStaticFiles, app, predictor
from src.schemas import DraftStateRequest


def test_predict_lru_cache_hit_and_isolation():
    req = DraftStateRequest(
        mode="ban",
        side="blue",
        phase=1,
        top_k=5,
        global_bans=["Florentino"],
    )
    first = predictor.predict(req)
    assert len(first.recommendations) == 5

    # Mutate caller copy and verify cached entry remains pristine & hits cache
    original_top_hero = first.recommendations[0].hero_name
    first.recommendations[0].hero_name = "CORRUPTED"

    second = predictor.predict(req)
    assert second.recommendations[0].hero_name == original_top_hero
    assert second is not first


def test_heroes_cache_control_and_static_cache_headers():
    client = TestClient(app)
    res = client.get("/heroes")
    assert res.status_code == 200
    assert res.headers.get("Cache-Control") == "public, max-age=3600"

    assert (
        _FrontendStaticFiles._cache_control_for("/assets/index-1234.js", "application/javascript")
        == "public, max-age=31536000, immutable"
    )
    assert _FrontendStaticFiles._cache_control_for("/avatars/Valhein.jpg", "image/jpeg") == "public, max-age=86400"
    assert _FrontendStaticFiles._cache_control_for("/hero_images.json", "application/json") == "public, max-age=86400"
    assert _FrontendStaticFiles._cache_control_for("/", "text/html; charset=utf-8") == "no-cache"


def test_combat_engine_lazy_loaded_on_api_import():
    code = (
        "import src.combat_calculator as cc; "
        "import src.api as api; "
        "assert cc._engine is None, 'CombatEngine eagerly constructed during import'"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout


def test_auth_me_and_billing_consolidated_connections(tmp_path, monkeypatch):
    import src.api as api_mod
    from src.config import config
    from src.db import UserDatabase

    db_file = tmp_path / "perf_consolidated.db"
    monkeypatch.setattr(config.paths, "app_db_path", db_file)
    monkeypatch.setattr(config, "stripe_secret_key", "sk_test_dummy_123")
    monkeypatch.setattr(api_mod._billing_rate_limiter, "max_attempts", 50)

    client = TestClient(app)
    reg = client.post("/auth/register", json={"username": "perf_user_1", "password": "secret-pass-perf"})
    assert reg.status_code == 201

    connect_calls = 0
    orig_connect = UserDatabase._connect

    def counted_connect(self):
        nonlocal connect_calls
        connect_calls += 1
        return orig_connect(self)

    monkeypatch.setattr(UserDatabase, "_connect", counted_connect)

    me_res = client.get("/auth/me")
    assert me_res.status_code == 200
    assert me_res.json()["authenticated"] is True
    assert connect_calls <= 2

    connect_calls = 0
    bill_res = client.get("/billing")
    assert bill_res.status_code == 200
    assert connect_calls <= 2


def test_sqlite_pragmas_indexes_and_query_plans(tmp_path):
    from src.db import UserDatabase

    db_file = tmp_path / "perf_indexes.db"
    db = UserDatabase(db_file)
    db.ensure_schema()

    with db._connect() as conn:
        sync_val = conn.execute("PRAGMA synchronous").fetchone()[0]
        temp_store_val = conn.execute("PRAGMA temp_store").fetchone()[0]
        assert int(sync_val) == 1  # NORMAL
        assert int(temp_store_val) == 2  # MEMORY

        indexes = {
            row["name"] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'").fetchall()
        }
        assert "idx_hero_pools_owner" not in indexes
        for expected in (
            "idx_billing_orders_user_status",
            "idx_billing_orders_created",
            "idx_billing_passes_expires_at",
            "idx_daily_visits_user_date",
            "idx_users_created_at",
            "idx_pricing_survey_updated",
            "idx_team_invites_owner_tier_exp",
        ):
            assert expected in indexes

        eqp_orders = " | ".join(
            str(r["detail"])
            for r in conn.execute(
                "EXPLAIN QUERY PLAN SELECT 1 FROM billing_orders WHERE user_id = 1 AND status = 'paid' LIMIT 1"
            ).fetchall()
        )
        assert "USING INDEX" in eqp_orders or "USING COVERING INDEX" in eqp_orders

        eqp_recent_orders = " | ".join(
            str(r["detail"])
            for r in conn.execute(
                "EXPLAIN QUERY PLAN SELECT id FROM billing_orders ORDER BY created_at DESC, id DESC LIMIT 50"
            ).fetchall()
        )
        assert "TEMP B-TREE" not in eqp_recent_orders


def test_spa_routes_serve_index_html_without_conflicting_with_api():
    from src.api import FRONTEND_DIST

    if not (FRONTEND_DIST.is_dir() and (FRONTEND_DIST / "index.html").is_file()):
        return

    client = TestClient(app)
    for path in ("/practice", "/analytics", "/plans", "/profile", "/admin"):
        res = client.get(path)
        assert res.status_code == 200, path
        assert "text/html" in res.headers.get("content-type", ""), path
        assert res.headers.get("Cache-Control") == "no-cache", path

    api_res = client.get("/analytics/sample")
    assert api_res.status_code == 200
    assert "application/json" in api_res.headers.get("content-type", "")
