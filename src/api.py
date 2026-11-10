import json
import logging
import threading
import time
import uuid
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.combat_calculator import Build, get_engine
from src.config import config
from src.predictor import RoVDraftPredictor
from src.schemas import (
    CombatDuelRequest,
    CombatStatsRequest,
    DraftPredictionResponse,
    DraftSessionStateSchema,
    DraftStateRequest,
    HealthResponse,
)
from src.search.draft_mcts import DRAFT_STEPS

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
FRONTEND_DIST = FRONTEND_DIR / "dist"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

app = FastAPI(
    title="RoV SOTA Draft Intelligence API",
    description="Production-grade MOBA Draft Pick/Ban Recommendation & Win-Probability Serving Engine.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

predictor = RoVDraftPredictor()
heuristic_predictor: RoVDraftPredictor | None = None
_heuristic_predictor_lock = threading.Lock()


def get_heuristic_predictor() -> RoVDraftPredictor:
    global heuristic_predictor
    if heuristic_predictor is None:
        with _heuristic_predictor_lock:
            if heuristic_predictor is None:
                model_path = config.paths.models_dir / "sota_draft_gnn_transformer_heuristic.pt"
                if not model_path.exists():
                    raise HTTPException(
                        status_code=503,
                        detail=(
                            "Heuristic draft model artifact not found at models/sota_draft_gnn_transformer_heuristic.pt. "
                            "Please run HPO or training first via run_hpo_heuristic_h100.sbatch or train_sota_model.py."
                        ),
                    )
                heuristic_predictor = RoVDraftPredictor(model_path=model_path)
    return heuristic_predictor


logger = logging.getLogger(__name__)

# Precompute rich hero metadata catalog
hero_summary_path = DATA_DIR / "heroes_130_summary.csv"
hero_draft_stats_path = DATA_DIR / "hero_draft_stats.csv"
hero_images_path = FRONTEND_DIR / "public" / "hero_images.json"
hero_tier_stats_path = (
    DATA_DIR.parent / "exports" / "RoV_Pro_Draft_Intelligence_2026" / "raw_csv" / "hero_tier_stats_2026.csv"
)
hero_tier_overrides_path = getattr(config.paths, "hero_tier_overrides_path", DATA_DIR / "hero_tier_overrides.json")

hero_details_cache: list[dict] = []
try:
    summary_df = pd.read_csv(hero_summary_path).set_index("name") if hero_summary_path.exists() else None
    draft_stats_df = pd.read_csv(hero_draft_stats_path).set_index("name") if hero_draft_stats_path.exists() else None
    tier_stats_df = pd.read_csv(hero_tier_stats_path).set_index("Hero") if hero_tier_stats_path.exists() else None
    images_dict = json.loads(hero_images_path.read_text(encoding="utf-8")) if hero_images_path.exists() else {}

    tier_overrides: dict[str, str] = {}
    tier_reasons: dict[str, str] = {}
    if hero_tier_overrides_path.exists():
        try:
            raw_overrides = json.loads(hero_tier_overrides_path.read_text(encoding="utf-8"))
            for k, v in raw_overrides.get("overrides", {}).items():
                tier_overrides[k] = v["tier"] if isinstance(v, dict) and "tier" in v else str(v)
                if isinstance(v, dict) and "reason" in v:
                    tier_reasons[k] = str(v["reason"])
        except Exception:
            logger.exception("Failed to parse hero_tier_overrides.json")
            tier_overrides = {}
            tier_reasons = {}

    canonical_to_legacy = {"Mortos": "Arthur", "Celica": "Brunhilda", "Riktor": "Richter"}
    legacy_to_canonical = {"Arthur": "Mortos", "Brunhilda": "Celica", "Richter": "Riktor"}
    role_fallback = {
        "Fighter": "DS_Lane",
        "Warrior": "DS_Lane",
        "Assassin": "Jungle",
        "Mage": "Mid",
        "Carry": "Dragon_Lane",
        "Marksman": "Dragon_Lane",
        "Support": "Roam",
        "Tank": "Roam",
    }

    def normalize_role(r: str) -> str:
        aliases = {"Warrior": "Fighter", "Marksman": "Carry"}
        return aliases.get(r, r)

    lane_cols = [
        ("DS_Lane", "DS_Lane_Share"),
        ("Jungle", "Jungle_Share"),
        ("Mid", "Mid_Share"),
        ("Dragon_Lane", "Dragon_Lane_Share"),
        ("Roam", "Roam_Share"),
    ]
    draft_lane_cols = [
        ("DS_Lane", "ds_lane_picks"),
        ("Jungle", "jungle_picks"),
        ("Mid", "mid_picks"),
        ("Dragon_Lane", "dragon_lane_picks"),
        ("Roam", "roam_picks"),
    ]

    for i, name in enumerate(predictor.hero_names):
        lookup_name = legacy_to_canonical.get(name, name)
        role = "Fighter"
        tier = "C"
        rank = 999
        main_pro_lane = "DS_Lane"
        lane = "DS_Lane"
        presence_rate = 0.0
        pick_rate = 0.0
        ban_rate = 0.0
        win_rate = 50.0
        total_picks = 0
        total_bans = 0

        if tier_stats_df is not None and lookup_name in tier_stats_df.index:
            t_row = tier_stats_df.loc[lookup_name]
            if isinstance(t_row, pd.DataFrame):
                t_row = t_row.iloc[0]
            rank = int(t_row["Rank"]) if pd.notna(t_row.get("Rank")) else 999
            tier = str(t_row["Tier_2026"]) if pd.notna(t_row.get("Tier_2026")) else "C"
            role = normalize_role(str(t_row["Primary_Role"])) if pd.notna(t_row.get("Primary_Role")) else "Fighter"
            main_pro_lane = str(t_row["Main_Pro_Lane"]) if pd.notna(t_row.get("Main_Pro_Lane")) else "Unpicked"
            if pd.notna(t_row.get("Presence_Rate")):
                presence_rate = round(float(t_row["Presence_Rate"]) * 100, 1)
            if pd.notna(t_row.get("Pick_Rate")):
                pick_rate = round(float(t_row["Pick_Rate"]) * 100, 1)
            if pd.notna(t_row.get("Ban_Rate")):
                ban_rate = round(float(t_row["Ban_Rate"]) * 100, 1)
            if pd.notna(t_row.get("Win_Rate")):
                win_rate = round(float(t_row["Win_Rate"]) * 100, 1)
            if pd.notna(t_row.get("Total_Picks")):
                total_picks = int(t_row["Total_Picks"])
            if pd.notna(t_row.get("Total_Bans")):
                total_bans = int(t_row["Total_Bans"])

            if main_pro_lane == "Unpicked":
                lane = role_fallback.get(role, "DS_Lane")
            else:
                active_lanes = [main_pro_lane]
                for lname, col in lane_cols:
                    if lname != main_pro_lane and pd.notna(t_row.get(col)) and float(t_row[col]) >= 0.15:
                        active_lanes.append(lname)
                lane = ", ".join(active_lanes)
        elif summary_df is not None and lookup_name in summary_df.index:
            row = summary_df.loc[lookup_name]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            role = normalize_role(str(row["primary_role"])) if pd.notna(row.get("primary_role")) else "Fighter"
            tier = str(row["meta_tier_2026"]) if pd.notna(row.get("meta_tier_2026")) else "C"
            lane = role_fallback.get(role, "DS_Lane")
            main_pro_lane = lane
            if pd.notna(row.get("pro_win_rate_2026")):
                win_rate = round(float(row["pro_win_rate_2026"]), 1)
            if pd.notna(row.get("pro_pick_rate_2026")):
                pick_rate = round(float(row["pro_pick_rate_2026"]), 1)
            if pd.notna(row.get("pro_ban_rate_2026")):
                ban_rate = round(float(row["pro_ban_rate_2026"]), 1)
            presence_rate = round(pick_rate + ban_rate, 1)

            if draft_stats_df is not None and lookup_name in draft_stats_df.index:
                d_row = draft_stats_df.loc[lookup_name]
                if isinstance(d_row, pd.DataFrame):
                    d_row = d_row.iloc[0]
                if pd.notna(d_row.get("picks")):
                    total_picks = int(d_row["picks"])
                b1 = int(d_row["bans_phase1"]) if pd.notna(d_row.get("bans_phase1")) else 0
                b2 = int(d_row["bans_phase2"]) if pd.notna(d_row.get("bans_phase2")) else 0
                total_bans = b1 + b2
                if pd.notna(d_row.get("main_pro_lane")) and str(d_row["main_pro_lane"]) != "Unpicked":
                    main_pro_lane = str(d_row["main_pro_lane"])
                    lane_totals = [float(d_row[col]) if pd.notna(d_row.get(col)) else 0.0 for _, col in draft_lane_cols]
                    sum_lanes = sum(lane_totals)
                    active_lanes = [main_pro_lane]
                    if sum_lanes > 0:
                        for (lname, _), val in zip(draft_lane_cols, lane_totals):
                            if lname != main_pro_lane and (val / sum_lanes) >= 0.15:
                                active_lanes.append(lname)
                    lane = ", ".join(active_lanes)

        if name in tier_overrides:
            tier = tier_overrides[name]
        elif lookup_name in tier_overrides:
            tier = tier_overrides[lookup_name]

        tier_reason = tier_reasons.get(name) or tier_reasons.get(lookup_name) or ""

        img_url = (
            images_dict.get(name)
            or images_dict.get(legacy_to_canonical.get(name, ""))
            or images_dict.get(canonical_to_legacy.get(name, ""))
        )
        hero_details_cache.append(
            {
                "id": i,
                "name": name,
                "role": role,
                "lane": lane,
                "main_pro_lane": main_pro_lane,
                "tier": tier,
                "rank": rank,
                "presence_rate": presence_rate,
                "win_rate": win_rate,
                "pick_rate": pick_rate,
                "ban_rate": ban_rate,
                "total_picks": total_picks,
                "total_bans": total_bans,
                "tier_reason": tier_reason,
                "image_url": img_url,
            }
        )

    # Assign fallback 1..N presence ranks when exports CSV is absent (e.g. inside Docker container)
    if hero_details_cache and all(h["rank"] == 999 for h in hero_details_cache):
        sorted_by_presence = sorted(
            hero_details_cache,
            key=lambda h: (-h["presence_rate"], -h["pick_rate"], h["name"]),
        )
        for idx, h_entry in enumerate(sorted_by_presence, start=1):
            h_entry["rank"] = idx
except Exception:
    logger.exception("Failed to initialize hero_details_cache; falling back to default catalog")
    hero_details_cache = [
        {"id": i, "name": name, "role": "Fighter", "lane": "DS_Lane", "tier": "A"}
        for i, name in enumerate(predictor.hero_names)
    ]


@app.get("/health", response_model=HealthResponse)
def health_check():
    return HealthResponse(
        status="healthy",
        model_loaded=predictor.model is not None,
        architecture=predictor.architecture,
        num_heroes=len(predictor.hero_names),
        val_loss=round(predictor.val_loss, 5),
    )


@app.get("/heroes")
def list_heroes():
    return {
        "count": len(predictor.hero_names),
        "heroes": predictor.hero_names,
        "hero_details": hero_details_cache,
    }


@app.get("/draft/steps")
def get_draft_steps():
    return {
        "steps": [
            {
                "step": s[0],
                "phase": s[1],
                "action": "pick" if s[2] == 1 else "ban",
                "side": "blue" if s[3] == 0 else "red",
            }
            for s in DRAFT_STEPS
        ]
    }


_session_lock = threading.Lock()


@app.get("/draft/session", response_model=DraftSessionStateSchema)
def get_draft_session():
    session_path = config.paths.draft_session_path
    with _session_lock:
        if not session_path.exists():
            return DraftSessionStateSchema()
        try:
            raw = json.loads(session_path.read_text(encoding="utf-8"))
            return DraftSessionStateSchema.model_validate(raw)
        except Exception:
            return DraftSessionStateSchema()


@app.put("/draft/session", response_model=DraftSessionStateSchema)
def save_draft_session(session: DraftSessionStateSchema):
    session_path = config.paths.draft_session_path
    session_path.parent.mkdir(parents=True, exist_ok=True)
    with _session_lock:
        payload = json.dumps(session.model_dump(), ensure_ascii=False, indent=2)
        tmp_path = session_path.with_name(f"{session_path.stem}_{uuid.uuid4().hex[:8]}.tmp")
        try:
            tmp_path.write_text(payload, encoding="utf-8")
            for attempt in range(3):
                try:
                    tmp_path.replace(session_path)
                    break
                except PermissionError:
                    if attempt == 2:
                        session_path.write_text(payload, encoding="utf-8")
                    else:
                        time.sleep(0.05)
        finally:
            tmp_path.unlink(missing_ok=True)
    return session


@app.delete("/draft/session", response_model=DraftSessionStateSchema)
def clear_draft_session():
    session_path = config.paths.draft_session_path
    with _session_lock:
        if session_path.exists():
            session_path.unlink(missing_ok=True)
    return DraftSessionStateSchema()


@app.post("/predict", response_model=DraftPredictionResponse)
def predict_draft(request: DraftStateRequest):
    try:
        return predictor.predict(request)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/predict/matrix", response_model=DraftPredictionResponse)
def predict_matrix_draft(request: DraftStateRequest):
    try:
        return predictor.predict_matrix(request)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/predict/heuristic", response_model=DraftPredictionResponse)
def predict_heuristic_draft(request: DraftStateRequest):
    try:
        return get_heuristic_predictor().predict(request)
    except (ValueError, KeyError, IndexError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


_combat_catalog_cache = None


@app.get("/combat/catalog")
def combat_catalog():
    global _combat_catalog_cache
    if _combat_catalog_cache is None:
        _combat_catalog_cache = get_engine().catalog()
    return _combat_catalog_cache


@app.post("/combat/stats")
def combat_stats(request: CombatStatsRequest):
    engine = get_engine()
    try:
        build = Build(**request.build.model_dump())
        result = engine.build_stats(build)
        if request.target is not None:
            target = engine.build_stats(Build(**request.target.model_dump()))
            result["skills"] = engine.skill_damage(result, target, build)
            result["basic_attack"] = engine.basic_attack(result, target)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/combat/duel", response_model=dict)
def combat_duel(request: CombatDuelRequest):
    try:
        return get_engine().duel(Build(**request.a.model_dump()), Build(**request.b.model_dump()))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# Mounted last so the API routes above take precedence over static files.
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
