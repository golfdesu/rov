"""Regression tests for backend validation, billing pass precedence, telemetry races, and tombstones."""

from __future__ import annotations

import time
from pathlib import Path

import pytest
from pydantic import ValidationError

from src.db import UserDatabase
from src.schemas import (
    MAX_EPOCH_MS,
    CombatBuildsSyncSchema,
    DraftSessionStateSchema,
    PracticeHistorySyncSchema,
)


def _create_user(db: UserDatabase, username: str) -> int:
    user = db.register_user(username, "secret1234")
    return user.id


def test_sync_schemas_reject_updated_at_above_max_epoch_ms() -> None:
    huge = 9223372036854775807
    with pytest.raises(ValidationError):
        DraftSessionStateSchema(updatedAt=huge)
    with pytest.raises(ValidationError):
        CombatBuildsSyncSchema(updatedAt=huge)
    with pytest.raises(ValidationError):
        PracticeHistorySyncSchema(updatedAt=huge)
    with pytest.raises(ValidationError):
        PracticeHistorySyncSchema(clearedAt=huge)

    ok_state = DraftSessionStateSchema(updatedAt=MAX_EPOCH_MS)
    assert ok_state.updatedAt == MAX_EPOCH_MS


def test_fmt_epoch_handles_extreme_timestamps_in_admin_users_report(tmp_path: Path) -> None:
    db = UserDatabase(tmp_path / "app.db")
    uid = _create_user(db, "extreme_ts_user")
    db.save_user_draft_state(uid, {"stepIndex": 0}, updated_at=9223372036854775807)

    report = db.get_admin_users_report()
    row = next(item for item in report["users"] if item["username"] == "extreme_ts_user")
    assert row["last_draft_save_th"] is None


def test_claim_promo_source_and_team_pass_precedence(tmp_path: Path) -> None:
    db = UserDatabase(tmp_path / "app.db")
    now = int(time.time())
    owner_id = _create_user(db, "team_owner")
    member_id = _create_user(db, "pro_member")

    # Member claims Free Pro promo first -> returned dict must include source="promo_free"
    promo_res = db.claim_free_pro_promo(member_id, now + 86400)
    assert promo_res["tier"] == "pro"
    assert promo_res["source"] == "promo_free"

    # Owner gets active team_pro pass and invites member
    with db._connect() as conn:
        conn.execute(
            "INSERT INTO billing_passes(user_id, tier, expires_at) VALUES (?, 'team_pro', ?)",
            (owner_id, now + 86400 * 30),
        )
        conn.execute(
            "INSERT INTO team_memberships(owner_id, user_id, tier) VALUES (?, ?, 'team_pro')",
            (owner_id, member_id),
        )

    active_pass, _orders, snap_status, _promo = db.get_billing_snapshot(member_id, None)
    auth_status = db.user_pass_status(member_id)

    assert active_pass is not None
    assert active_pass["tier"] == "team_pro"
    assert active_pass["is_owner"] == 0
    assert snap_status is not None and snap_status[:2] == ("team_pro", "team_member")
    assert auth_status is not None and auth_status[:2] == ("team_pro", "team_member")

    # Owner still preserves paid/manual source rather than being misclassified as team_member
    owner_status = db.user_pass_status(owner_id)
    assert owner_status is not None and owner_status[:2] == ("team_pro", "manual")


def test_predict_before_visit_preserves_first_seen_and_device_count(tmp_path: Path) -> None:
    db = UserDatabase(tmp_path / "app.db")
    cid = "guest_client_123456"

    # Simulate an earlier visit on 2026-11-20
    db.record_daily_visit(client_id=cid, user_id=None, device_type="mobile", visit_date_override="2026-11-20")

    # On a later day, predict telemetry runs before visit telemetry
    db.record_predict_telemetry(user_id=None, client_id=cid, elapsed_ms=12, use_lookahead=False)
    today_str = db.record_daily_visit(client_id=cid, user_id=None, device_type="mobile")

    with db._connect() as conn:
        visit = conn.execute(
            "SELECT first_seen_date, device_type FROM daily_visits WHERE client_id = ? AND visit_date = ?",
            (cid, today_str),
        ).fetchone()
        dev_cnt = conn.execute(
            "SELECT count FROM site_events_daily WHERE event_date = ? AND metric_key = 'device_mobile'",
            (today_str,),
        ).fetchone()

    assert visit is not None
    assert visit["first_seen_date"] == "2026-11-20"
    assert visit["device_type"] == "mobile"
    assert dev_cnt is not None and int(dev_cnt["count"]) == 1


def test_clear_practice_history_tombstone_is_monotonic(tmp_path: Path) -> None:
    db = UserDatabase(tmp_path / "app.db")
    uid = _create_user(db, "clock_skew_user")
    future_client_ts = int(time.time() * 1000) + 3_600_000  # 1 hour ahead

    db.save_user_practice_history(
        uid,
        {
            "entries": [
                {
                    "id": "p1",
                    "signature": "sig1",
                    "recordedAt": "2026-11-27T10:00:00Z",
                    "gameNumber": 1,
                    "gameCount": 1,
                    "startingSide": "blue",
                    "playerSide": "blue",
                    "bluePicks": ["Valhein", "Krixi", "Thane", "Fennik", "Alice"],
                    "redPicks": ["Violet", "Tulen", "Lumburr", "Nakroth", "Zephys"],
                }
            ],
            "updatedAt": future_client_ts,
        },
        updated_at=future_client_ts,
    )

    tomb = db.clear_user_practice_history(uid)
    assert tomb > future_client_ts
    stored = db.get_user_practice_history(uid)
    assert stored is not None
    assert stored["updatedAt"] == tomb
    assert stored["clearedAt"] == tomb
    assert stored["entries"] == []
