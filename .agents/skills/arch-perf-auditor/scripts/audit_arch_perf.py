"""Automated architecture, DSA, SQLite query plan, latency, sync, and leakage audit."""

from __future__ import annotations

import argparse
import sqlite3
import statistics
import sys
import tempfile
import time
from contextlib import closing
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[4]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def audit_sqlite_query_plans() -> None:
    from src.db import UserDatabase

    with tempfile.TemporaryDirectory() as tmp:
        db = UserDatabase(Path(tmp) / "audit_qp.db")
        user = db.register_user("audit_qp_user", "strong-password-123")
        db.create_session(user.id)
        db.record_daily_visit(client_id="audit_cid_1", user_id=user.id, visit_date_override="2026-11-20")
        db.record_daily_visit(client_id="audit_cid_1", user_id=user.id, visit_date_override="2026-11-21")

        with closing(sqlite3.connect(db.db_path)) as conn:
            plan_rows = conn.execute(
                "EXPLAIN QUERY PLAN SELECT token_hash FROM auth_sessions WHERE user_id = ? "
                "ORDER BY created_at DESC, rowid DESC LIMIT 9",
                (user.id,),
            ).fetchall()
        plan_text = " ".join(str(r[-1]) for r in plan_rows).upper()
        assert "IDX_AUTH_SESSIONS_USER_CREATED" in plan_text, f"Missing composite index use: {plan_text}"
        assert "USE TEMP B-TREE" not in plan_text, f"Unexpected temp B-tree sort: {plan_text}"

        stats = db.get_admin_stats()
        assert stats["retention"]["total_tracked_clients"] == 1
        assert stats["retention"]["returning_clients"] == 1
    print("[PASS] SQLite Query Plan & CTE Retention Audit")


def audit_serving_gnn_cache_and_latency(skip_bench: bool = False) -> None:
    from src.predictor import RoVDraftPredictor
    from src.schemas import DraftStateRequest

    predictor = RoVDraftPredictor()
    assert predictor.model._cached_h_gnn is not None, "GNN embedding cache must be initialized after eval()"

    req_direct = DraftStateRequest(
        mode="pick",
        side="blue",
        phase=1,
        ally_picks=["Yena", "Toro"],
        enemy_picks=["Hayate", "Krixi"],
        ally_bans=["Florentino"],
        enemy_bans=["Nakroth"],
        top_k=5,
        use_lookahead=False,
    )
    cached_resp = predictor.predict(req_direct)
    predictor.model.invalidate_gnn_cache()
    uncached_resp = predictor.predict(req_direct)
    assert [r.hero_name for r in cached_resp.recommendations] == [r.hero_name for r in uncached_resp.recommendations], (
        "Cached and uncached hero rankings diverge"
    )
    for c_rec, u_rec in zip(cached_resp.recommendations, uncached_resp.recommendations, strict=True):
        assert abs(c_rec.probability_pct - u_rec.probability_pct) < 1e-4

    predictor.model.precompute_gnn_embeddings()
    if skip_bench:
        print("[PASS] Serving GNN Cache Equivalence Audit (--skip-bench)")
        return

    req_depth2 = req_direct.model_copy(update={"use_lookahead": True, "lookahead_depth": 2})
    # Warm up once before timing
    predictor.predict(req_direct)
    direct_ms = []
    for _ in range(5):
        t0 = time.perf_counter()
        predictor.predict(req_direct)
        direct_ms.append((time.perf_counter() - t0) * 1000.0)

    predictor.predict(req_depth2)
    depth2_ms = []
    for _ in range(3):
        t0 = time.perf_counter()
        predictor.predict(req_depth2)
        depth2_ms.append((time.perf_counter() - t0) * 1000.0)

    print(
        f"[PASS] Serving GNN Cache Audit (direct median={statistics.median(direct_ms):.1f} ms, "
        f"depth-2 median={statistics.median(depth2_ms):.1f} ms)"
    )


def audit_ml_split_and_leakage_guard() -> None:
    from src.train_sota_model import load_sota_data_and_graphs

    _, _, hero_features, *_, train_games, val_games = load_sota_data_and_graphs()
    assert hero_features.shape == (130, 37)
    train_sids = {str(g.get("series_id", "")).strip() for g in train_games if g.get("series_id")}
    val_sids = {str(g.get("series_id", "")).strip() for g in val_games if g.get("series_id")}
    overlap = train_sids & val_sids
    assert not overlap, f"Series leaked across train/val boundary: {sorted(overlap)[:5]}"

    with tempfile.TemporaryDirectory() as tmp:
        try:
            load_sota_data_and_graphs(dataset_path=Path(tmp) / "nonexistent_training.json")
        except FileNotFoundError:
            pass
        else:
            raise AssertionError("Expected FileNotFoundError when curated training dataset is missing")

    print(f"[PASS] ML Split & Leakage Audit (train={len(train_games)}, val={len(val_games)}, series_overlap=0)")


def audit_fail_closed_and_sync_merge() -> None:
    from src.db import UserDatabase

    cfg_text = (ROOT_DIR / "src" / "config.py").read_text(encoding="utf-8")
    assert "chayanin5392" not in cfg_text, "Hardcoded admin username fallback detected in src/config.py"

    with tempfile.TemporaryDirectory() as tmp:
        db = UserDatabase(Path(tmp) / "audit_sync.db")
        user = db.register_user("audit_sync_user", "strong-password-123")
        base_entry = {
            "id": "p-1",
            "signature": "s1|G1|blue|Valhein,Hayate,Toro,Krixi,Zuka|Tel'Annas,Yorn,Thane,Tulen,Butterfly|Murad|Florentino",
            "recordedAt": "2026-11-22T10:00:00Z",
            "gameNumber": 1,
            "gameCount": 1,
            "startingSide": "blue",
            "playerSide": "blue",
            "bluePicks": ["Valhein", "Hayate", "Toro", "Krixi", "Zuka"],
            "redPicks": ["Tel'Annas", "Yorn", "Thane", "Tulen", "Butterfly"],
            "blueBans": ["Murad"],
            "redBans": ["Florentino"],
            "playerEstimate": 50.0,
        }
        first = db.save_user_practice_history(
            user.id, {"entries": [base_entry], "updatedAt": 5_000_000_000_000}, 5_000_000_000_000
        )
        second_entry = {**base_entry, "id": "p-2", "signature": "s2|G1|red|...", "recordedAt": "2026-11-22T10:05:00Z"}
        merged = db.save_user_practice_history(
            user.id, {"entries": [second_entry], "updatedAt": 4_000_000_000_000}, 4_000_000_000_000
        )
        assert {e["id"] for e in merged["entries"]} == {"p-1", "p-2"}, "Practice merge dropped concurrent entry"
        assert merged["updatedAt"] > first["updatedAt"], "Practice merge failed to advance updatedAt monotonically"

    print("[PASS] Fail-Closed Admin & Sync Monotonic Revision Audit")


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit RoV architecture, DSA, SQLite plans, cache & leakage.")
    parser.add_argument("--skip-bench", action="store_true", help="Skip CPU inference latency timing")
    args = parser.parse_args()

    print("=" * 70)
    print("RoV Architecture, Data Structures & Best-Practice Auditor")
    print("=" * 70)
    audit_sqlite_query_plans()
    audit_serving_gnn_cache_and_latency(skip_bench=args.skip_bench)
    audit_ml_split_and_leakage_guard()
    audit_fail_closed_and_sync_merge()
    print("=" * 70)
    print("[OK] ALL ARCH-PERF & BEST-PRACTICE AUDITS PASSED!")
    print("=" * 70)


if __name__ == "__main__":
    main()
