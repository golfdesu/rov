"""Sandbox checkout, authenticated order ownership, and atomic fulfillment."""

import hashlib
import hmac
import json
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
import stripe
from fastapi.testclient import TestClient

from src import api
from src import db as database_module
from src.db import SESSION_COOKIE_NAME, RateLimiter, UserDatabase

ORIGIN = {"Origin": "http://localhost:3000"}
WEBHOOK_SECRET = "whsec_local_test_fixture"
USERNAME = "billing_tester"


def make_session(order_id, session_id, amount, **changes):
    return {
        "id": session_id,
        "object": "checkout.session",
        "mode": "payment",
        "livemode": False,
        "client_reference_id": order_id,
        "metadata": {"minidraft_order_id": order_id},
        "payment_method_types": ["promptpay"],
        "payment_intent": None,
        "currency": "thb",
        "amount_total": amount,
        "status": "open",
        "payment_status": "unpaid",
        "url": "https://checkout.stripe.com/c/pay/example",
        **changes,
    }


class FakeCheckout:
    def __init__(self):
        self.by_id = {}
        self.by_key = {}
        self.last_params = None

    def create(self, params, options):
        self.last_params = params
        key = options["idempotency_key"]
        if key not in self.by_key:
            session_id = f"cs_test_example{len(self.by_key)}"
            data = make_session(
                params["client_reference_id"], session_id, params["line_items"][0]["price_data"]["unit_amount"]
            )
            self.by_key[key] = session_id
            self.by_id[session_id] = data
        return self.retrieve(self.by_key[key])

    def retrieve(self, session_id):
        return stripe.checkout.Session.construct_from(self.by_id[session_id], None)

    def expire(self, session_id):
        self.by_id[session_id]["status"] = "expired"
        return self.retrieve(session_id)


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    monkeypatch.setattr(api.config, "env", "development")
    monkeypatch.setattr(api.config, "stripe_secret_key", "sk_test_fixture")
    monkeypatch.setattr(api.config, "stripe_webhook_secret", WEBHOOK_SECRET)
    monkeypatch.setattr(api.config.paths, "app_db_path", tmp_path / "billing.db")
    monkeypatch.setattr(api, "_billing_rate_limiter", RateLimiter(max_attempts=12))
    monkeypatch.setattr(api, "_team_rate_limiter", RateLimiter(max_attempts=40, window_seconds=60))
    fake = FakeCheckout()
    monkeypatch.setattr(
        api,
        "make_stripe_client",
        lambda _key: SimpleNamespace(v1=SimpleNamespace(checkout=SimpleNamespace(sessions=fake))),
    )
    db = api.get_user_db()
    user = db.register_user(USERNAME, "test-password", display_name="Billing Tester")
    with TestClient(api.app, base_url="http://localhost:8000") as client:
        client.cookies.set(SESSION_COOKIE_NAME, db.create_session(user.id))
        yield client, fake, db, user


def create_checkout(client, tier="pro", days=30, **extra):
    return client.post(
        "/billing/checkout",
        headers=ORIGIN,
        json={"tier": tier, "days": days, "expected_username": USERNAME, **extra},
    )


def event(client, session, event_type="checkout.session.completed", secret=WEBHOOK_SECRET):
    payload = json.dumps({"id": "evt_example", "object": "event", "type": event_type, "data": {"object": session}})
    timestamp = int(time.time())
    signature = hmac.new(secret.encode(), f"{timestamp}.{payload}".encode(), hashlib.sha256).hexdigest()
    return client.post(
        "/billing/webhook", content=payload, headers={"Stripe-Signature": f"t={timestamp},v1={signature}"}
    )


def test_checkout_uses_server_price_and_keeps_one_open_order(sandbox):
    client, fake, _, _ = sandbox
    assert create_checkout(client, amount=1).status_code == 200
    assert fake.last_params["mode"] == "payment"
    assert fake.last_params["allowed_payment_method_types"] == ["promptpay"]
    assert fake.last_params["line_items"][0]["price_data"]["unit_amount"] == 5900
    assert fake.last_params["success_url"] == "http://localhost:3000/#profile"
    assert create_checkout(client).status_code == 200
    assert len(fake.by_id) == 1
    assert create_checkout(client, days=90).json()["detail"] == "pending_order"
    order = client.get("/billing").json()["orders"][0]
    assert order["status"] == "pending"
    closed = client.post(f"/billing/orders/{order['id']}/cancel", headers=ORIGIN, json={"expected_username": USERNAME})
    assert closed.status_code == 204
    assert create_checkout(client, days=90).status_code == 200
    assert fake.last_params["line_items"][0]["price_data"]["unit_amount"] == 13900


def test_paid_webhook_validates_payment_and_grants_access_once(sandbox):
    client, fake, db, user = sandbox
    assert create_checkout(client).status_code == 200
    session = fake.by_id["cs_test_example0"]
    complete = {**session, "status": "complete", "payment_status": "paid", "payment_intent": "pi_example0"}
    assert event(client, complete, secret="wrong_key").status_code == 400
    for change in ({"amount_total": 1}, {"currency": "usd"}, {"livemode": True}, {"payment_method_types": ["card"]}):
        assert event(client, {**complete, **change}).status_code == 400
    assert event(client, {**complete, "payment_status": "unpaid"}).status_code == 204
    assert client.get("/billing").json()["active_pass"] is None
    assert event(client, complete).status_code == 204
    state = client.get("/billing").json()
    assert state["active_pass"]["tier"] == "pro"
    assert [(package["tier"], package["days"]) for package in state["packages"]] == [("team_pro", 30), ("team_pro", 90)]
    assert state["orders"][0]["status"] == "paid"
    expires_at = state["active_pass"]["expires_at"]
    assert expires_at == state["orders"][0]["paid_at"] + 30 * 86400
    assert event(client, complete, event_type="checkout.session.async_payment_succeeded").status_code == 204
    assert client.get("/billing").json()["active_pass"]["expires_at"] == expires_at
    for days in (30, 90):
        response = create_checkout(client, days=days)
        assert response.status_code == 409
        assert response.json()["detail"] == "pass_active"
    assert len(fake.by_id) == 1
    assert len(client.get("/billing").json()["orders"]) == 1

    with db._connect() as conn:
        conn.execute("UPDATE billing_passes SET expires_at = ? WHERE user_id = ?", (int(time.time()) - 1, user.id))
    state = client.get("/billing").json()
    assert state["active_pass"] is None
    assert len(state["packages"]) == 6
    assert create_checkout(client, days=90).status_code == 200
    renewal = {
        **fake.by_id["cs_test_example1"],
        "status": "complete",
        "payment_status": "paid",
        "payment_intent": "pi_example1",
    }
    assert event(client, renewal).status_code == 204
    state = client.get("/billing").json()
    renewal_order = next(order for order in state["orders"] if order["days"] == 90)
    assert state["active_pass"]["expires_at"] == renewal_order["paid_at"] + 90 * 86400


def test_order_ownership_origin_and_production_gate(sandbox, monkeypatch):
    client, fake, db, _ = sandbox
    assert create_checkout(client, expected_username="another_user").status_code == 409
    response = client.post(
        "/billing/checkout",
        headers={"Origin": "https://elsewhere.example"},
        json={"tier": "pro", "days": 30, "expected_username": USERNAME},
    )
    assert response.status_code == 403
    assert create_checkout(client).status_code == 200
    order = client.get("/billing").json()["orders"][0]
    other = db.register_user("another_user", "test-password", display_name="Another User")
    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(other.id))
    assert client.get("/billing").json()["orders"] == []
    assert (
        client.post(
            f"/billing/orders/{order['id']}/cancel",
            headers=ORIGIN,
            json={"expected_username": "another_user"},
        ).status_code
        == 404
    )
    client.cookies.clear()
    assert client.get("/billing").status_code == 401
    monkeypatch.setattr(api.config, "env", "production")
    assert client.get("/billing").status_code == 404
    assert create_checkout(client).status_code == 404
    assert len(fake.by_id) == 1


def test_concurrent_webhooks_and_team_upgrade(sandbox):
    client, fake, db, user = sandbox
    pro = db.reserve_billing_order(user.id, "pro", 90, 13900, ORIGIN["Origin"])

    def fulfill(_):
        # Separate instances can process concurrent deliveries in separate worker processes.
        UserDatabase(db.db_path).settle_billing_order(pro["id"], "cs_test_pro", 13900, "pi_pro")

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fulfill, range(8)))
    active, orders = db.billing_summary(user.id)
    assert active["expires_at"] == orders[0]["paid_at"] + 90 * 86400
    team = db.reserve_billing_order(user.id, "team_pro", 30, 23900, ORIGIN["Origin"])
    db.settle_billing_order(team["id"], "cs_test_team", 23900, "pi_team")
    team_active, orders = db.billing_summary(user.id)
    paid_at = next(order["paid_at"] for order in orders if order["id"] == team["id"])
    credit_days = (active["expires_at"] - paid_at) // 86400 // 3
    assert team_active["tier"] == "team_pro"
    assert team_active["expires_at"] == paid_at + (30 + credit_days) * 86400
    assert client.get("/billing").json()["packages"] == []
    for tier, reason in (("team_pro", "pass_active"), ("pro", "team_active")):
        for days in (30, 90):
            response = create_checkout(client, tier=tier, days=days)
            assert response.status_code == 409
            assert response.json()["detail"] == reason
    assert not fake.by_id
    assert len(client.get("/billing").json()["orders"]) == 2


def draft_game(source_id: str) -> dict:
    return {
        "id": source_id,
        "seriesName": f"Series {source_id}",
        "timestamp": "12:00:00",
        "blueTeamName": "Blue",
        "redTeamName": "Red",
    }


def test_duo_checkout_invitation_and_shared_history(sandbox):
    client, fake, db, owner = sandbox
    member = db.register_user("duo_friend", "test-password", display_name="Friend")
    outsider = db.register_user("duo_other", "test-password", display_name="Other")
    assert create_checkout(client, "duo", 30).status_code == 200
    assert fake.last_params["line_items"][0]["price_data"]["unit_amount"] == 10900
    assert (
        event(
            client,
            {
                **fake.by_id["cs_test_example0"],
                "status": "complete",
                "payment_status": "paid",
                "payment_intent": "pi_duo",
            },
        ).status_code
        == 204
    )
    own = client.get("/billing/team").json()["team"]
    assert own["capacity"] == 2 and own["is_owner"]
    assert create_checkout(client, "team_pro", 30).json()["detail"] == "duo_transition"
    assert client.post("/billing/team/invite", headers=ORIGIN, json={"username": "duo_friend"}).status_code == 204
    assert (
        client.post("/billing/team/invite", headers=ORIGIN, json={"username": "duo_other"}).json()["detail"]
        == "team_full"
    )

    def sign_in(account):
        client.cookies.set(SESSION_COOKIE_NAME, db.create_session(account.id))

    sign_in(outsider)
    assert client.get("/billing/team").json() == {"team": None, "received": []}
    assert client.post(f"/billing/team/accept/{owner.id}", headers=ORIGIN).status_code == 404
    assert client.get("/billing/team/history").status_code == 403
    sign_in(member)
    assert client.get("/billing/team").json()["received"][0]["owner_username"] == USERNAME
    assert client.post(f"/billing/team/accept/{owner.id}", headers=ORIGIN).status_code == 204
    assert client.post(f"/billing/team/accept/{owner.id}", headers=ORIGIN).status_code == 204
    assert client.get("/billing").json()["active_pass"]["is_owner"] is False
    assert client.get("/billing").json()["packages"] == []
    assert client.get("/auth/me").json()["user"]["draft_history_limit"] == 500
    assert client.post("/billing/team/invite", headers=ORIGIN, json={"username": "duo_other"}).status_code == 403

    copied_bans = {
        "teamAUsed": ["Omen", "Liliana"],
        "teamBUsed": ["Zip", "Aoi"],
        "universalBans": ["Toro"],
    }
    game = {**draft_game("personal-game"), "gameNumber": 3, "blueSideTeam": "B", "globalBans": copied_bans}
    legacy_game = draft_game("legacy-game")
    assert (
        client.put(
            "/draft/session",
            json={"globalBans": {"universalBans": ["Alice"]}, "seriesGames": [game, legacy_game]},
        ).status_code
        == 200
    )
    body = {"owner_id": owner.id, "tier": "duo", "source_id": game["id"]}
    assert client.post("/billing/team/history", headers=ORIGIN, json=body).status_code == 403
    assert client.get("/billing/team/history").status_code == 403
    assert (
        client.post(
            "/billing/team/history/batch",
            headers=ORIGIN,
            json={"owner_id": owner.id, "tier": "duo", "source_ids": [game["id"]]},
        ).status_code
        == 403
    )
    assert client.delete("/billing/team/history/1", headers=ORIGIN).status_code == 403
    assert len(client.get("/draft/session").json()["seriesGames"]) == 2
    sign_in(owner)
    assert client.get("/billing/team/history").status_code == 403
    assert client.post("/billing/team/history", headers=ORIGIN, json=body).status_code == 403
    assert (
        client.post(
            "/billing/team/history",
            headers=ORIGIN,
            json={
                **body,
                "source_id": "shared-game",
                "tier": "team_pro",
                "game": {**draft_game("shared-game"), "globalBans": copied_bans},
            },
        ).status_code
        == 403
    )
    assert client.post(f"/billing/team/remove/{member.id}", headers=ORIGIN).status_code == 204
    sign_in(member)
    assert client.get("/billing/team/history").status_code == 403
    assert client.post("/billing/team/history", headers=ORIGIN, json=body).status_code == 403
    assert client.get("/draft/session").json()["seriesGames"][0]["id"] == game["id"]
    assert client.get("/auth/me").json()["user"]["draft_history_limit"] == 14


def test_team_pro_seats_capacity_and_expiry(sandbox, monkeypatch):
    client, _, db, owner = sandbox
    order = db.reserve_billing_order(owner.id, "team_pro", 90, 56900, ORIGIN["Origin"])
    db.settle_billing_order(order["id"], "cs_test_team", 56900, "pi_team")
    members = [db.register_user(f"team_member_{number}", "test-password", display_name="Member") for number in range(5)]
    for member in members[:4]:
        db.invite_team_member(owner.id, member.username)
    with pytest.raises(ValueError, match="team_full"):
        db.invite_team_member(owner.id, members[4].username)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda member: db.respond_to_team_invite(member.id, owner.id, True), members[:4]))
    assert len(client.get("/billing/team").json()["team"]["members"]) == 5
    assert api.config.stripe_sandbox_enabled

    monkeypatch.setattr(database_module, "TEAM_HISTORY_LIMIT", 1)
    first = draft_game("team-game-1")
    second = draft_game("team-game-2")
    game_id = db.save_team_game(owner.id, owner.id, "team_pro", first["id"], first)
    assert db.save_team_game(owner.id, owner.id, "team_pro", first["id"], first) == game_id
    with pytest.raises(ValueError, match="history_full"):
        db.save_team_game(owner.id, owner.id, "team_pro", second["id"], second)
    db.delete_team_game(owner.id, game_id)
    db.save_team_game(owner.id, owner.id, "team_pro", second["id"], second)
    with db._connect() as conn:
        conn.execute("UPDATE billing_passes SET expires_at = ? WHERE user_id = ?", (int(time.time()), owner.id))
    assert db.team_overview(members[0].id)["team"] is None
    assert client.get("/billing/team/history").status_code == 403
    monkeypatch.setattr(api.config, "env", "production")
    assert client.get("/billing/team").status_code == 404


def test_duo_schema_migrates_existing_billing_rows(tmp_path, monkeypatch):
    path = tmp_path / "legacy-billing.db"
    with monkeypatch.context() as context:
        context.setattr(
            database_module,
            "BILLING_TABLES",
            {
                table: definition.replace("'pro', 'duo', 'team_pro'", "'pro', 'team_pro'")
                for table, definition in database_module.BILLING_TABLES.items()
            },
        )
        legacy = UserDatabase(path)
        user = legacy.register_user("team_owner", "test-password", display_name="Owner")
        order = legacy.reserve_billing_order(user.id, "team_pro", 30, 23900, ORIGIN["Origin"])
        legacy.settle_billing_order(order["id"], "cs_test_legacy", 23900, "pi_legacy")
    db = UserDatabase(path)
    assert db.team_overview(user.id)["team"]["capacity"] == 5
    assert db.get_billing_order(user.id, order["id"])["stripe_payment_id"] == "pi_legacy"
    another = db.register_user("duo_owner", "test-password", display_name="Duo Owner")
    assert db.reserve_billing_order(another.id, "duo", 90, 25900, ORIGIN["Origin"])["tier"] == "duo"


def test_sandbox_personal_history_preserves_existing_games_at_capacity(sandbox):
    client, _, db, user = sandbox
    games = [draft_game(str(number)) for number in range(15)]
    assert client.put("/draft/session", json={"seriesGames": games[:14], "updatedAt": 1}).status_code == 200
    full = client.put("/draft/session", json={"seriesGames": games, "updatedAt": 2})
    assert full.status_code == 422 and full.json()["detail"] == "history_full"
    assert len(client.get("/draft/session").json()["seriesGames"]) == 14
    order = db.reserve_billing_order(user.id, "pro", 30, 5900, ORIGIN["Origin"])
    db.settle_billing_order(order["id"], "cs_test_pro", 5900, "pi_pro")
    assert client.put("/draft/session", json={"seriesGames": games, "updatedAt": 3}).status_code == 200
    with db._connect() as conn:
        conn.execute("UPDATE billing_passes SET expires_at = ? WHERE user_id = ?", (int(time.time()), user.id))
    updated = client.put("/draft/session", json={"seriesGames": games, "updatedAt": 4, "stepIndex": 1})
    assert updated.status_code == 200 and len(updated.json()["seriesGames"]) == 15
    again = client.put("/draft/session", json={"seriesGames": [*games, draft_game("new")], "updatedAt": 5})
    assert again.status_code == 422
    assert client.put("/draft/session", json={"seriesGames": games[1:], "updatedAt": 6}).status_code == 200


def test_hero_pools_limits_and_team_sharing(sandbox, monkeypatch):
    client, _, db, owner = sandbox
    member = db.register_user("pool_member", "test-password", display_name="Pool Member")
    free_res = client.put(
        "/billing/hero-pools",
        headers=ORIGIN,
        json={"scope": "personal", "team_name": "BRU", "lanes": {"Jungle": ["Nakroth", "Nakroth", "Aoi"]}},
    )
    assert free_res.status_code == 200
    assert free_res.json()["lanes"]["Jungle"] == ["Nakroth", "Aoi"]
    # Case-insensitive update of existing team pool stays within the 1-pool Free limit
    upd_res = client.put(
        "/billing/hero-pools",
        headers=ORIGIN,
        json={"scope": "personal", "team_name": "bru", "lanes": {"Mid": ["Liliana"]}},
    )
    assert upd_res.status_code == 200 and upd_res.json()["id"] == free_res.json()["id"]
    # Second distinct team pool succeeds within the 2-pool Free limit; third is blocked
    second_free = client.put(
        "/billing/hero-pools",
        headers=ORIGIN,
        json={"scope": "personal", "team_name": "FS", "lanes": {"Mid": ["Krixi"]}},
    )
    assert second_free.status_code == 200
    third_free = client.put(
        "/billing/hero-pools",
        headers=ORIGIN,
        json={"scope": "personal", "team_name": "HD", "lanes": {"Mid": ["Tulen"]}},
    )
    assert third_free.status_code == 409 and third_free.json()["detail"] == "pool_limit_reached"
    assert (
        client.put(
            "/billing/hero-pools",
            headers=ORIGIN,
            json={"scope": "team", "team_name": "BRU", "lanes": {"Mid": ["Krixi"]}},
        ).status_code
        == 403
    )

    # Upgrade owner to Duo and invite member (personal 50 pools each, no shared team pools)
    order = db.reserve_billing_order(owner.id, "duo", 30, 10900, ORIGIN["Origin"])
    db.settle_billing_order(order["id"], "cs_test_duo_pool", 10900, "pi_duo_pool")
    db.invite_team_member(owner.id, member.username)
    db.respond_to_team_invite(member.id, owner.id, True)
    assert client.get("/auth/me").json()["user"]["is_paid"] is True
    paid_overview = client.get("/billing/hero-pools").json()
    assert paid_overview["personal_limit"] == 50
    assert paid_overview["team_limit"] == 0
    assert paid_overview["team_tier"] is None
    assert (
        client.put(
            "/billing/hero-pools",
            headers=ORIGIN,
            json={"scope": "personal", "team_name": "FS", "lanes": {"Roam": ["Toro"]}},
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/billing/hero-pools",
            headers=ORIGIN,
            json={"scope": "team", "team_name": "Team A", "lanes": {"DS_Lane": ["Florentino"]}},
        ).status_code
        == 403
    )
    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(member.id))
    assert client.get("/billing/hero-pools").json()["personal_limit"] == 50
    assert client.get("/billing/hero-pools").json()["team_limit"] == 0
    assert (
        client.put(
            "/billing/hero-pools",
            headers=ORIGIN,
            json={"scope": "team", "team_name": "Team A", "lanes": {"DS_Lane": ["Omen"]}},
        ).status_code
        == 403
    )

    # Team Pro grants 50 shared team Hero Pools across the team owner and accepted members
    team_owner = db.register_user("team_pool_owner", "test-password", display_name="Team Owner")
    team_member = db.register_user("team_pool_member", "test-password", display_name="Team Member")
    t_order = db.reserve_billing_order(team_owner.id, "team_pro", 30, 23900, ORIGIN["Origin"])
    db.settle_billing_order(t_order["id"], "cs_test_team_pool", 23900, "pi_team_pool")
    db.invite_team_member(team_owner.id, team_member.username)
    db.respond_to_team_invite(team_member.id, team_owner.id, True)

    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(team_owner.id))
    assert (
        client.put(
            "/billing/hero-pools",
            headers=ORIGIN,
            json={"scope": "personal", "team_name": "FS", "lanes": {"Roam": ["Toro"]}},
        ).status_code
        == 200
    )
    team_overview = client.get("/billing/hero-pools").json()
    assert team_overview["personal_limit"] == 50
    assert team_overview["team_limit"] == 50
    assert team_overview["team_tier"] == "team_pro"
    shared = client.put(
        "/billing/hero-pools",
        headers=ORIGIN,
        json={"scope": "team", "team_name": "Team A", "lanes": {"DS_Lane": ["Florentino"]}},
    )
    assert shared.status_code == 200
    pool_id = shared.json()["id"]

    # Creating a new pool with a duplicate case-insensitive name must fail without overwriting
    dup = client.put(
        "/billing/hero-pools",
        headers=ORIGIN,
        json={"scope": "team", "team_name": "team a", "lanes": {"DS_Lane": ["Omen"]}, "create_only": True},
    )
    assert dup.status_code == 409 and dup.json()["detail"] == "duplicate_team_name"
    assert client.get("/billing/hero-pools").json()["team"][0]["lanes"]["DS_Lane"] == ["Florentino"]

    # Renaming an existing personal pool via pool_id updates in place without creating a second row
    personal_list = client.get("/billing/hero-pools").json()["personal"]
    fs_pool = next(item for item in personal_list if item["team_name"] == "FS")
    renamed = client.put(
        "/billing/hero-pools",
        headers=ORIGIN,
        json={
            "scope": "personal",
            "team_name": "FS2",
            "lanes": {"Roam": ["Toro", "Zip"]},
            "pool_id": fs_pool["id"],
        },
    )
    assert renamed.status_code == 200
    assert renamed.json()["id"] == fs_pool["id"]
    assert renamed.json()["team_name"] == "FS2"
    after_rename = client.get("/billing/hero-pools").json()["personal"]
    assert len(after_rename) == len(personal_list)
    assert all(item["team_name"] != "FS" for item in after_rename)

    # Renaming onto another existing pool name in the same scope must fail with 409
    other = client.put(
        "/billing/hero-pools",
        headers=ORIGIN,
        json={"scope": "personal", "team_name": "BAC", "lanes": {"Mid": ["Liliana"]}, "create_only": True},
    )
    assert other.status_code == 200
    rename_conflict = client.put(
        "/billing/hero-pools",
        headers=ORIGIN,
        json={
            "scope": "personal",
            "team_name": "bac",
            "lanes": {"Roam": ["Toro"]},
            "pool_id": fs_pool["id"],
        },
    )
    assert rename_conflict.status_code == 409 and rename_conflict.json()["detail"] == "duplicate_team_name"

    # Member can read & update shared team pool, and loses access when removed
    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(team_member.id))
    assert client.get("/billing/hero-pools").json()["team"][0]["team_name"] == "Team A"
    assert (
        client.put(
            "/billing/hero-pools",
            headers=ORIGIN,
            json={"scope": "team", "team_name": "Team A", "lanes": {"DS_Lane": ["Omen"]}},
        ).status_code
        == 200
    )
    db.manage_team_member(team_owner.id, team_member.id, revoke_invite=False)
    assert client.get("/billing/hero-pools").json()["team"] == []
    assert client.delete(f"/billing/hero-pools/{pool_id}", headers=ORIGIN).status_code == 403

    monkeypatch.setattr(api.config, "env", "production")
    assert client.get("/billing/hero-pools").status_code == 404


def test_tournament_assignment_preserves_series_identity_and_team_permissions(sandbox):
    client, _, db, owner = sandbox
    order = db.reserve_billing_order(owner.id, "team_pro", 30, 23900, ORIGIN["Origin"])
    db.settle_billing_order(order["id"], "cs_test_tournament", 23900, "pi_tournament")
    member = db.register_user("tournament_friend", "test-password", display_name="Friend")
    db.invite_team_member(owner.id, member.username)
    db.respond_to_team_invite(member.id, owner.id, True)
    cup = {"id": "cup-one", "name": "MiniDraft Cup"}
    legacy = {**draft_game("before-tournaments"), "seriesName": "Shared matchup", "winner": "A"}
    first = {**draft_game("first-series-game"), "seriesName": "Shared matchup", "seriesId": "series-one"}
    second = {
        **draft_game("second-series-game"),
        "seriesName": "Shared matchup",
        "seriesId": "series-two",
        "tournament": cup,
    }
    assert client.put("/draft/session", json={"seriesGames": [legacy, first, second]}).status_code == 200
    personal = client.get("/draft/session").json()["seriesGames"]
    assert personal[0]["seriesId"] is None and personal[0]["tournament"] is None
    assert personal[2]["seriesId"] == second["seriesId"] and personal[2]["tournament"] == cup

    team = {"owner_id": owner.id, "tier": "team_pro"}
    assert (
        client.post(
            "/billing/team/history/batch",
            headers=ORIGIN,
            json={**team, "source_ids": [item["id"] for item in personal]},
        ).status_code
        == 200
    )
    entries = {row["game"]["id"]: row for row in client.get("/billing/team/history").json()}
    assert entries[second["id"]]["game"]["tournament"] == cup

    def assign(game_id: int, tournament: dict | None):
        return client.put(
            f"/billing/team/history/{game_id}/tournament", headers=ORIGIN, json={"tournament": tournament}
        )

    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(member.id))
    assert assign(entries[legacy["id"]]["id"], cup).status_code == 403
    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(owner.id))
    assert assign(entries[legacy["id"]]["id"], cup).status_code == 204
    assert assign(entries[first["id"]]["id"], {"id": "bad id", "name": "Invalid"}).status_code == 422

    # A later unassigned save in the legacy series inherits its shared tournament.
    another = {**legacy, "id": "another-legacy", "gameNumber": 2}
    assert (
        client.post(
            "/billing/team/history", headers=ORIGIN, json={**team, "source_id": another["id"], "game": another}
        ).status_code
        == 204
    )
    shared = {row["game"]["id"]: row["game"] for row in client.get("/billing/team/history").json()}
    assert shared[legacy["id"]]["winner"] == "A"
    assert shared[legacy["id"]]["tournament"] == shared[another["id"]]["tournament"] == cup
    assert shared[first["id"]]["tournament"] is None
    assert shared[second["id"]]["tournament"] == cup
    assert assign(entries[legacy["id"]]["id"], None).status_code == 204
    shared = {row["game"]["id"]: row["game"] for row in client.get("/billing/team/history").json()}
    assert shared[legacy["id"]]["tournament"] is None and shared[another["id"]]["tournament"] is None
    assert shared[second["id"]]["tournament"] == cup

    member_game = {**draft_game("member-tournament-game"), "seriesId": "member-series"}
    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(member.id))
    assert (
        client.post(
            "/billing/team/history",
            headers=ORIGIN,
            json={**team, "source_id": member_game["id"], "game": member_game},
        ).status_code
        == 204
    )
    rows = {row["game"]["id"]: row for row in client.get("/billing/team/history").json()}
    anchors = [rows[member_game["id"]]["id"], rows[legacy["id"]]["id"]]
    retrospective = {"id": "old-cup", "name": "Old Cup"}
    endpoint = "/billing/team/history/tournament"
    params = {"game_ids": anchors, "tournament": retrospective}
    assert client.put(endpoint, headers=ORIGIN, json=params).status_code == 403
    assert client.get("/billing/team/history").json() == list(rows.values())
    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(owner.id))
    assert client.put(endpoint, headers=ORIGIN, json={**params, "game_ids": [*anchors, 99999]}).status_code == 404
    assert client.get("/billing/team/history").json() == list(rows.values())
    assert client.put(endpoint, headers=ORIGIN, json={**params, "game_ids": []}).status_code == 422
    assert client.put(endpoint, headers=ORIGIN, json=params).status_code == 204
    after = {row["game"]["id"]: row for row in client.get("/billing/team/history").json()}
    for game in (member_game, legacy, another):
        original = rows[game["id"]]
        assert after[game["id"]] == {**original, "game": {**original["game"], "tournament": retrospective}}
    assert after[first["id"]] == rows[first["id"]] and after[second["id"]] == rows[second["id"]]
    assert client.get("/draft/session").json()["seriesGames"] == personal


def test_team_history_rename_keeps_group_identity_and_scope(sandbox):
    client, _, db, owner = sandbox
    order = db.reserve_billing_order(owner.id, "team_pro", 30, 23900, ORIGIN["Origin"])
    db.settle_billing_order(order["id"], "cs_test_rename", 23900, "pi_rename")
    member = db.register_user("rename_member", "test-password", display_name="Member")
    db.invite_team_member(owner.id, member.username)
    db.respond_to_team_invite(member.id, owner.id, True)
    cup = {"id": "cup-one", "name": "Old Cup"}
    legacy = {**draft_game("old-rename-game"), "seriesName": "Original name", "tournament": cup, "winner": "A"}
    rematch = {**draft_game("other-rename-game"), "seriesName": "Final", "seriesId": "other-match", "tournament": cup}
    team = {"owner_id": owner.id, "tier": "team_pro"}
    assert client.put("/draft/session", json={"seriesGames": [legacy, rematch]}).status_code == 200
    personal = client.get("/draft/session").json()["seriesGames"]

    def add(game):
        return client.post(
            "/billing/team/history", headers=ORIGIN, json={**team, "source_id": game["id"], "game": game}
        )

    def history():
        return {row["game"]["id"]: row for row in client.get("/billing/team/history").json()}

    def rename(game_id, target, name):
        return client.put(
            f"/billing/team/history/{game_id}/name", headers=ORIGIN, json={"target": target, "name": name}
        )

    assert add(legacy).status_code == add(rematch).status_code == 204
    legacy_next = {**legacy, "id": "old-rename-g2", "gameNumber": 2}
    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(member.id))
    assert add(legacy_next).status_code == 204
    before = history()
    member_row = before[legacy_next["id"]]["id"]
    owner_row = before[legacy["id"]]["id"]
    assert rename(member_row, "series", "Final").status_code == 403
    assert rename(member_row, "tournament", "New Cup").status_code == 403
    assert rename(member_row, "game", "Rematch notes").status_code == 403
    assert rename(owner_row, "game", "Opening").status_code == 403
    assert history() == before

    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(owner.id))
    assert rename(owner_row, "series", None).status_code == 422
    assert rename(owner_row, "game", "x" * 65).status_code == 422
    assert rename(owner_row, "tournament", "New Cup").status_code == 204
    assert rename(owner_row, "series", "Final").status_code == 204
    assert rename(owner_row, "game", "  Opening  ").status_code == 204
    names = {**cup, "name": "New Cup"}
    after = history()
    assert after[legacy["id"]]["game"] == {
        **before[legacy["id"]]["game"],
        "tournament": names,
        "seriesTitle": "Final",
        "gameName": "Opening",
        "gameNameShared": True,
    }
    assert after[legacy_next["id"]]["game"] == {
        **before[legacy_next["id"]]["game"],
        "tournament": names,
        "seriesTitle": "Final",
        "gameName": "Opening",
        "gameNameShared": True,
    }
    assert after[rematch["id"]]["game"] == {**before[rematch["id"]]["game"], "tournament": names}
    assert client.get("/draft/session").json()["seriesGames"] == personal

    stale = {**legacy, "id": "old-rename-g3", "gameNumber": 3}
    another_series = {**legacy, "id": "new-rename-match", "seriesId": "more-match"}
    assert add(stale).status_code == add(another_series).status_code == 204
    current = history()
    assert current[stale["id"]]["game"]["seriesTitle"] == "Final"
    assert current[stale["id"]]["game"]["gameName"] == "Opening"
    assert current[another_series["id"]]["game"]["tournament"] == names
    assert current[another_series["id"]]["game"]["gameName"] is None

    assert rename(owner_row, "game", None).status_code == 204
    g4 = {**legacy, "id": "old-rename-g4", "gameNumber": 4, "gameName": "Stale name", "gameNameShared": True}
    assert add(g4).status_code == 204
    current = history()
    for game in (legacy, legacy_next, stale, g4):
        assert current[game["id"]]["game"]["gameName"] is None
        assert current[game["id"]]["game"]["gameNameShared"] is True


def test_team_history_series_edit_keeps_side_mapping_and_legacy_identity(sandbox):
    client, _, db, owner = sandbox
    order = db.reserve_billing_order(owner.id, "team_pro", 30, 23900, ORIGIN["Origin"])
    db.settle_billing_order(order["id"], "cs_test_series_edit", 23900, "pi_series_edit")
    member = db.register_user("series_editor", "test-password", display_name="Member")
    db.invite_team_member(owner.id, member.username)
    db.respond_to_team_invite(member.id, owner.id, True)
    group = {"owner_id": owner.id, "tier": "team_pro"}
    g1 = {
        **draft_game("legacy-side-g1"),
        "seriesName": "",
        "blueTeamName": "Owls",
        "redTeamName": "Falcons",
        "blueSideTeam": "A",
        "winner": "A",
    }
    g2 = {
        **g1,
        "id": "legacy-side-g2",
        "gameNumber": 2,
        "blueTeamName": "Falcons",
        "redTeamName": "Owls",
        "blueSideTeam": "B",
        "winner": "B",
    }
    rematch = {**g1, "id": "side-rematch", "seriesId": "same-teams-new-series"}

    def share(game):
        return client.post(
            "/billing/team/history", headers=ORIGIN, json={**group, "source_id": game["id"], "game": game}
        )

    def history():
        return {row["game"]["id"]: row for row in client.get("/billing/team/history").json()}

    assert share(g1).status_code == share(rematch).status_code == 204
    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(member.id))
    assert share(g2).status_code == 204
    before = history()
    endpoint = f"/billing/team/history/{before[g2['id']]['id']}/series"
    edits = {
        "seriesTitle": "  Decider  ",
        "gameName": "Finals",
        "teams": {"teamAName": "New Owls", "teamBName": "New Falcons"},
    }
    assert client.put(endpoint, headers=ORIGIN, json=edits).status_code == 403
    assert history() == before
    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(owner.id))
    assert client.put(endpoint, headers=ORIGIN, json={"teams": {"teamAName": "Incomplete"}}).status_code == 422
    assert client.put(endpoint, headers=ORIGIN, json=edits).status_code == 204
    after = history()
    for game in (g1, g2):
        blue, red = ("New Owls", "New Falcons") if game["blueSideTeam"] == "A" else ("New Falcons", "New Owls")
        assert after[game["id"]]["game"] == {
            **before[game["id"]]["game"],
            "seriesName": "Owls vs Falcons",
            "seriesTitle": "Decider",
            "gameName": "Finals",
            "gameNameShared": True,
            "teamNamesShared": True,
            "blueTeamName": blue,
            "redTeamName": red,
        }
    assert after[rematch["id"]] == before[rematch["id"]]

    g3 = {**g2, "id": "legacy-side-g3", "gameNumber": 3}
    assert share(g3).status_code == 204
    new_game = history()[g3["id"]]["game"]
    assert new_game["blueTeamName"] == "New Falcons" and new_game["redTeamName"] == "New Owls"
    assert new_game["seriesName"] == "Owls vs Falcons" and new_game["gameName"] == "Finals"
    assert client.put(endpoint, headers=ORIGIN, json={"seriesTitle": "Decider 2"}).status_code == 204
    assert history()[g3["id"]]["game"]["gameName"] == "Finals"


def test_draft_sync_keeps_legacy_duplicate_heroes_without_sharing_invalid_games(sandbox):
    client, _, db, owner = sandbox
    legacy = {
        **draft_game("legacy-duplicate"),
        "seriesName": "Older series",
        "blueBans": ["Toro"],
        "bluePicks": ["Toro"],
        "gameNumber": 4,
        "winner": "A",
        "pickLanes": {"Toro": "Roam"},
    }
    edited = {**draft_game("continued-series"), "seriesId": "next-series", "seriesName": "Scrim"}
    db.save_user_draft_state(owner.id, {"updatedAt": 100, "seriesGames": [edited, legacy]}, 100)
    loaded = client.get("/draft/session")
    assert loaded.status_code == 200
    existing, previous = loaded.json()["seriesGames"]
    assert previous["blueBans"] == previous["bluePicks"] == ["Toro"]

    saved = client.put(
        "/draft/session",
        json={
            "updatedAt": 200,
            "blueBans": ["Zip"],
            "globalBans": {"seriesId": "next-series", "seriesTitle": "Renamed scrim", "gameNumber": 2},
            "seriesGames": [{**existing, "seriesTitle": "Renamed scrim"}, previous],
        },
    )
    assert saved.status_code == 200
    reloaded = client.get("/draft/session").json()
    assert reloaded["seriesGames"][1] == previous
    assert reloaded["seriesGames"][0]["seriesTitle"] == "Renamed scrim"
    assert reloaded["blueBans"] == ["Zip"] and reloaded["globalBans"]["gameNumber"] == 2

    order = db.reserve_billing_order(owner.id, "team_pro", 30, 23900, ORIGIN["Origin"])
    db.settle_billing_order(order["id"], "cs_test_legacy_draft", 23900, "pi_legacy_draft")
    team = {"owner_id": owner.id, "tier": "team_pro"}
    rejected = client.post(
        "/billing/team/history/batch", headers=ORIGIN, json={**team, "source_ids": [edited["id"], legacy["id"]]}
    )
    assert rejected.status_code == 422 and rejected.json()["detail"] == "invalid_team_game"
    rejected = client.post("/billing/team/history", headers=ORIGIN, json={**team, "source_id": legacy["id"]})
    assert rejected.status_code == 422 and rejected.json()["detail"] == "invalid_team_game"
    assert client.get("/billing/team/history").json() == []


def test_team_history_batch_series_copy_idempotent_and_atomic(sandbox, monkeypatch):
    client, _, db, owner = sandbox
    order = db.reserve_billing_order(owner.id, "team_pro", 30, 23900, ORIGIN["Origin"])
    db.settle_billing_order(order["id"], "cs_test_batch", 23900, "pi_batch")

    g1 = {**draft_game("series-g1"), "gameNumber": 1}
    g2 = {**draft_game("series-g2"), "gameNumber": 2}
    g3 = {**draft_game("series-g3"), "gameNumber": 3}
    g4 = {**draft_game("series-g4"), "gameNumber": 4}
    assert client.put("/draft/session", json={"seriesGames": [g1, g2, g3, g4], "updatedAt": 1}).status_code == 200

    # Copy 3 games of the series in chronological order -> 200 copied=3, skipped=0
    res = client.post(
        "/billing/team/history/batch",
        headers=ORIGIN,
        json={"owner_id": owner.id, "tier": "team_pro", "source_ids": [g1["id"], g2["id"], g3["id"]]},
    )
    assert res.status_code == 200
    assert res.json() == {"copied": 3, "skipped": 0}
    history = client.get("/billing/team/history").json()
    assert [entry["game"]["id"] for entry in history] == [g3["id"], g2["id"], g1["id"]]

    # Re-copying the same series is idempotent
    res_dup = client.post(
        "/billing/team/history/batch",
        headers=ORIGIN,
        json={"owner_id": owner.id, "tier": "team_pro", "source_ids": [g1["id"], g2["id"], g3["id"]]},
    )
    assert res_dup.status_code == 200
    assert res_dup.json() == {"copied": 0, "skipped": 3}

    # Partial overlap: g3 already exists, g4 is new
    res_partial = client.post(
        "/billing/team/history/batch",
        headers=ORIGIN,
        json={"owner_id": owner.id, "tier": "team_pro", "source_ids": [g3["id"], g4["id"]]},
    )
    assert res_partial.status_code == 200
    assert res_partial.json() == {"copied": 1, "skipped": 1}
    assert len(client.get("/billing/team/history").json()) == 4

    # Atomic rollback on history_full: 5 slots total, 4 used -> inserting 2 new games fails with 409 & 0 inserts
    monkeypatch.setattr(database_module, "TEAM_HISTORY_LIMIT", 5)
    g5 = {**draft_game("series-g5"), "gameNumber": 5}
    g6 = {**draft_game("series-g6"), "gameNumber": 6}
    assert (
        client.put("/draft/session", json={"seriesGames": [g1, g2, g3, g4, g5, g6], "updatedAt": 2}).status_code == 200
    )
    full = client.post(
        "/billing/team/history/batch",
        headers=ORIGIN,
        json={"owner_id": owner.id, "tier": "team_pro", "source_ids": [g5["id"], g6["id"]]},
    )
    assert full.status_code == 409 and full.json()["detail"] == "history_full"
    assert len(client.get("/billing/team/history").json()) == 4

    # Atomic rollback on game_not_found: 1 valid + 1 missing -> 404 & 0 inserts
    monkeypatch.setattr(database_module, "TEAM_HISTORY_LIMIT", 10)
    missing = client.post(
        "/billing/team/history/batch",
        headers=ORIGIN,
        json={"owner_id": owner.id, "tier": "team_pro", "source_ids": [g5["id"], "nonexistent-game"]},
    )
    assert missing.status_code == 404 and missing.json()["detail"] == "game_not_found"
    assert len(client.get("/billing/team/history").json()) == 4

    # Fallback snapshot payload succeeds even before PUT /draft/session syncs g7 to user_draft_states
    g7 = {**draft_game("series-g7-unsynced"), "gameNumber": 7}
    unsynced = client.post(
        "/billing/team/history/batch",
        headers=ORIGIN,
        json={
            "owner_id": owner.id,
            "tier": "team_pro",
            "source_ids": [g7["id"]],
            "games": [g7],
        },
    )
    assert unsynced.status_code == 200
    assert unsynced.json() == {"copied": 1, "skipped": 0}
    assert len(client.get("/billing/team/history").json()) == 5

    # Reject malformed draft game payloads with duplicate in-game heroes or > 5 picks
    dup_hero = {**draft_game("dup-hero-game"), "bluePicks": ["Violet"], "redPicks": ["Violet"]}
    assert (
        client.post(
            "/billing/team/history/batch",
            headers=ORIGIN,
            json={"owner_id": owner.id, "tier": "team_pro", "source_ids": [dup_hero["id"]], "games": [dup_hero]},
        ).status_code
        == 422
    )
    too_many_picks = {
        **draft_game("too-many-picks"),
        "bluePicks": ["Violet", "Tulen", "Thane", "Aoi", "Omen", "Florentino"],
    }
    assert (
        client.post(
            "/billing/team/history/batch",
            headers=ORIGIN,
            json={
                "owner_id": owner.id,
                "tier": "team_pro",
                "source_ids": [too_many_picks["id"]],
                "games": [too_many_picks],
            },
        ).status_code
        == 422
    )


def test_live_billing_mode_uses_https_production_origins_and_rejects_test_events(tmp_path, monkeypatch):
    from src.billing import apply_checkout_result, hosted_checkout_url
    from src.config import Config

    live_cfg = Config(env="production")
    assert not live_cfg.billing_enabled
    monkeypatch.setattr(live_cfg, "stripe_secret_key", "rk_live_fixture")
    monkeypatch.setattr(live_cfg, "stripe_webhook_secret", WEBHOOK_SECRET)
    assert live_cfg.stripe_livemode and live_cfg.billing_enabled

    # Test key in production or live key in development must never enable billing
    prod_with_test = Config(env="production")
    monkeypatch.setattr(prod_with_test, "stripe_secret_key", "sk_test_fixture")
    monkeypatch.setattr(prod_with_test, "stripe_webhook_secret", WEBHOOK_SECRET)
    assert not prod_with_test.billing_enabled and not prod_with_test.stripe_livemode

    dev_with_live = Config(env="development")
    monkeypatch.setattr(dev_with_live, "stripe_secret_key", "rk_live_fixture")
    monkeypatch.setattr(dev_with_live, "stripe_webhook_secret", WEBHOOK_SECRET)
    assert not dev_with_live.billing_enabled and not dev_with_live.stripe_livemode

    # Kill-switch disables live mode even when live keys exist
    monkeypatch.setattr(live_cfg, "stripe_live_enabled", False)
    assert not live_cfg.billing_enabled and not live_cfg.stripe_livemode
    monkeypatch.setattr(live_cfg, "stripe_live_enabled", True)

    # Full production API flow over https://minidraft.app
    monkeypatch.setattr(api.config, "env", "production")
    monkeypatch.setattr(api.config, "cors_origins", ["https://minidraft.app", "https://www.minidraft.app"])
    monkeypatch.setattr(api.config, "stripe_secret_key", "rk_live_fixture")
    monkeypatch.setattr(api.config, "stripe_webhook_secret", WEBHOOK_SECRET)
    monkeypatch.setattr(api.config, "stripe_live_enabled", True)
    monkeypatch.setattr(api.config.paths, "app_db_path", tmp_path / "live_billing.db")
    monkeypatch.setattr(api, "_billing_rate_limiter", RateLimiter(max_attempts=12))
    monkeypatch.setattr(api, "_team_rate_limiter", RateLimiter(max_attempts=40, window_seconds=60))

    class LiveFakeCheckout(FakeCheckout):
        def create(self, params, options):
            self.last_params = params
            key = options["idempotency_key"]
            assert key.startswith("minidraft-live-")
            if key not in self.by_key:
                session_id = f"cs_live_example{len(self.by_key)}"
                data = make_session(
                    params["client_reference_id"],
                    session_id,
                    params["line_items"][0]["price_data"]["unit_amount"],
                    livemode=True,
                )
                self.by_key[key] = session_id
                self.by_id[session_id] = data
            return self.retrieve(self.by_key[key])

    fake = LiveFakeCheckout()
    monkeypatch.setattr(
        api,
        "make_stripe_client",
        lambda _key: SimpleNamespace(v1=SimpleNamespace(checkout=SimpleNamespace(sessions=fake))),
    )
    db = api.get_user_db()
    user = db.register_user(USERNAME, "test-password", display_name="Live Tester")
    prod_origin = {"Origin": "https://minidraft.app"}

    with TestClient(api.app, base_url="https://minidraft.app") as client:
        client.cookies.set(SESSION_COOKIE_NAME, db.create_session(user.id))
        me = client.get("/auth/me").json()
        assert me["stripe_sandbox_enabled"] is True
        assert me["stripe_livemode"] is True
        assert me["user"]["stripe_livemode"] is True

        # Loopback origin must be rejected in production
        bad_origin = client.post(
            "/billing/checkout",
            headers=ORIGIN,
            json={"tier": "pro", "days": 30, "expected_username": USERNAME},
        )
        assert bad_origin.status_code == 403

        ok = client.post(
            "/billing/checkout",
            headers=prod_origin,
            json={"tier": "pro", "days": 30, "expected_username": USERNAME},
        )
        assert ok.status_code == 200
        assert ok.json()["url"] == "https://checkout.stripe.com/c/pay/example"

        live_session = fake.by_id["cs_live_example0"]
        # Test session / non-live event must be rejected in live mode
        test_event = {
            **live_session,
            "id": "cs_test_spoofed",
            "livemode": False,
            "status": "complete",
            "payment_status": "paid",
            "payment_intent": "pi_spoof",
        }
        assert event(client, test_event).status_code == 400
        with pytest.raises(ValueError, match="checkout_unavailable"):
            hosted_checkout_url(stripe.checkout.Session.construct_from(test_event, None), expected_livemode=True)
        with pytest.raises(ValueError, match="checkout_session_mismatch"):
            apply_checkout_result(
                db,
                stripe.checkout.Session.construct_from(test_event, None),
                "checkout.session.completed",
                expected_livemode=True,
            )

        complete = {
            **live_session,
            "status": "complete",
            "payment_status": "paid",
            "payment_intent": "pi_live_0",
        }
        assert event(client, complete).status_code == 204
        assert client.get("/billing").json()["active_pass"]["tier"] == "pro"


def test_cancel_uncreated_order_and_normalized_cors_origin(tmp_path, monkeypatch):
    monkeypatch.setattr(api.config, "env", "production")
    monkeypatch.setattr(api.config, "cors_origins", ["https://MINIDRAFT.APP/"])
    monkeypatch.setattr(api.config, "stripe_secret_key", "rk_live_fixture")
    monkeypatch.setattr(api.config, "stripe_webhook_secret", WEBHOOK_SECRET)
    monkeypatch.setattr(api.config, "stripe_live_enabled", True)
    monkeypatch.setattr(api.config.paths, "app_db_path", tmp_path / "cancel_uncreated.db")
    monkeypatch.setattr(api, "_billing_rate_limiter", RateLimiter(max_attempts=12))

    class FailingCheckout(FakeCheckout):
        def create(self, params, options):
            raise stripe.APIConnectionError("network down")

    fake = FailingCheckout()
    monkeypatch.setattr(
        api,
        "make_stripe_client",
        lambda _key: SimpleNamespace(v1=SimpleNamespace(checkout=SimpleNamespace(sessions=fake))),
    )
    db = api.get_user_db()
    user = db.register_user(USERNAME, "test-password", display_name="Cancel Tester")

    with TestClient(api.app, base_url="https://minidraft.app") as client:
        client.cookies.set(SESSION_COOKIE_NAME, db.create_session(user.id))
        # Trailing-slash / case-insensitive CORS origin must be accepted
        headers = {"Origin": "https://minidraft.app"}
        err = client.post(
            "/billing/checkout",
            headers=headers,
            json={"tier": "pro", "days": 30, "expected_username": USERNAME},
        )
        assert err.status_code == 502

        summary = client.get("/billing").json()
        assert len(summary["orders"]) == 1
        pending = summary["orders"][0]
        assert pending["status"] == "pending"

        # Cancelling an uncreated order (stripe_session_id is None) must succeed cleanly via DB without calling Stripe
        cancel_res = client.post(
            f"/billing/orders/{pending['id']}/cancel",
            headers=headers,
            json={"expected_username": USERNAME},
        )
        assert cancel_res.status_code == 204
        after = client.get("/billing").json()
        assert after["orders"][0]["status"] == "closed"


def test_free_pro_promo_claim_and_expiry(sandbox, monkeypatch):
    client, _, db, user = sandbox
    future_ts = int(time.time()) + 5 * 86400
    monkeypatch.setattr(api.config, "free_promo_until", str(future_ts))

    me = client.get("/auth/me").json()
    assert me["free_promo_until"] == future_ts
    assert me["user"]["is_paid"] is False
    assert me["user"]["draft_history_limit"] == 14

    summary = client.get("/billing").json()
    assert summary["promo_claimable"] is True
    assert summary["promo_expires_at"] == future_ts

    claimed = client.post("/billing/promo/claim", headers=ORIGIN, json={"expected_username": USERNAME})
    assert claimed.status_code == 200
    assert claimed.json()["tier"] == "pro"
    assert claimed.json()["expires_at"] == future_ts

    after_me_status = client.get("/auth/me").json()
    assert after_me_status["free_promo_until"] is None
    after_me = after_me_status["user"]
    assert after_me["is_paid"] is True
    assert after_me["draft_history_limit"] == 500
    assert client.get("/billing").json()["promo_claimable"] is False

    # Cannot claim twice
    dup = client.post("/billing/promo/claim", headers=ORIGIN, json={"expected_username": USERNAME})
    assert dup.status_code == 409 and dup.json()["detail"] == "promo_already_claimed"

    # Paid user cannot claim over existing active pass
    paid_user = db.register_user("already_paid", "test-password", display_name="Paid")
    order = db.reserve_billing_order(paid_user.id, "pro", 30, 5900, ORIGIN["Origin"])
    db.settle_billing_order(order["id"], "cs_test_paid_promo", 5900, "pi_paid_promo")
    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(paid_user.id))
    assert client.get("/billing").json()["promo_claimable"] is False
    over = client.post("/billing/promo/claim", headers=ORIGIN, json={"expected_username": "already_paid"})
    assert over.status_code == 409 and over.json()["detail"] == "pass_active"

    # Save > 14 games & > 2 hero pools on promo user, then expire promo and verify data stays intact
    client.cookies.set(SESSION_COOKIE_NAME, db.create_session(user.id))
    games = [draft_game(f"promo-g-{i}") for i in range(16)]
    assert client.put("/draft/session", json={"seriesGames": games, "updatedAt": 1}).status_code == 200
    for idx in range(3):
        db.upsert_hero_pool(user.id, "personal", f"Team-{idx}", {"DS_Lane": ["Florentino"]})

    monkeypatch.setattr(api.config, "free_promo_until", str(int(time.time()) - 10))
    with db._connect() as conn:
        conn.execute("UPDATE billing_passes SET expires_at = ? WHERE user_id = ?", (int(time.time()) - 10, user.id))

    expired_me = client.get("/auth/me").json()
    assert expired_me["free_promo_until"] is None
    assert expired_me["user"]["is_paid"] is False
    assert expired_me["user"]["draft_history_limit"] == 14
    assert len(client.get("/draft/session").json()["seriesGames"]) == 16
    assert len(db.list_hero_pools(user.id)["personal"]) == 3

    ended = client.post("/billing/promo/claim", headers=ORIGIN, json={"expected_username": USERNAME})
    assert ended.status_code == 410 and ended.json()["detail"] == "promo_ended"
