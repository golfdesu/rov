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


def test_compute_markov_retention_matches_reference_implementation() -> None:
    from datetime import date, timedelta

    from src.analytics import _compute_markov_retention

    client_dates = {
        "c_d0_only": {"2026-11-27"},
        "c_retained_streak": {"2026-11-20", "2026-11-21", "2026-11-22", "2026-11-25"},
        "c_resurrect": {"2026-11-18", "2026-11-22", "2026-11-27"},
        "c_same_day": {"2026-11-24"},
    }
    first_seen = {cid: min(days) for cid, days in client_dates.items()}
    today_dt = date(2026, 11, 27)

    got = _compute_markov_retention(client_dates, "2026-11-27")

    # Brute-force reference calculation
    new_stay = new_leave = ret_stay = ret_leave = dorm_res = dorm_stay = 0
    for cid, days in client_dates.items():
        fs = date.fromisoformat(first_seen[cid])
        age = (today_dt - fs).days
        for off in range(age):
            d_cur = (fs + timedelta(days=off)).isoformat()
            d_next = (fs + timedelta(days=off + 1)).isoformat()
            cur_a, next_a = d_cur in days, d_next in days
            if off == 0:
                if next_a:
                    new_stay += 1
                else:
                    new_leave += 1
            elif cur_a:
                if next_a:
                    ret_stay += 1
                else:
                    ret_leave += 1
            else:
                if next_a:
                    dorm_res += 1
                else:
                    dorm_stay += 1

    assert got["transitions"]["new_sample"] == new_stay + new_leave
    assert got["transitions"]["retained_sample"] == ret_stay + ret_leave
    assert got["transitions"]["dormant_sample"] == dorm_res + dorm_stay
    assert got["survival_curve"][0]["eligible"] == 4
    assert got["survival_curve"][3]["survived"] == 2


def test_combat_stasis_blocks_skill_casts_and_rune_recommender_works() -> None:
    from src.combat_calculator import Build, CombatEngine, simulate_duel

    engine = CombatEngine()
    stats_a = engine.build_stats(Build(hero="Arum", level=4))
    stats_b = engine.build_stats(Build(hero="Toro", level=15))
    skills_a = engine.skill_damage(stats_a, stats_b, Build(hero="Arum", level=4))
    skills_b = engine.skill_damage(stats_b, stats_a, Build(hero="Toro", level=15))

    # Ultimate puts Arum in self-stasis at t=0. Skill 1 becomes ready at t=1.0 with cooldown=99s:
    # if Skill 1 mistakenly cast during self-stasis it would deal 0 dmg and burn its 99s CD.
    test_skills_a = []
    for sk in skills_a:
        copy = dict(sk)
        if sk["slot"] == "Ultimate":
            copy["cooldown"] = 99.0
            test_skills_a.append(copy)
        elif sk["slot"] == "Skill 1":
            copy["ready"] = 1.0
            copy["cooldown"] = 99.0
            copy["raw_damage"] = 500.0
            test_skills_a.append(copy)

    skill1_name = next(sk["name"] for sk in test_skills_a if sk["slot"] == "Skill 1")
    sim = simulate_duel(
        (stats_a, test_skills_a, engine.basic_attack(stats_a, stats_b), []),
        (stats_b, skills_b, engine.basic_attack(stats_b, stats_a), []),
    )
    assert sim["a"]["damage_breakdown"].get(skill1_name, 0) > 0

    rec = engine.recommend_matchup_runes("Florentino", "Omen", level=1)
    assert "recommended_preset" in rec
    assert rec["recommended_preset"]["name"]
    assert len(rec["recommended_preset"]["runes"]) >= 1
