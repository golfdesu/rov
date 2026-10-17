import json
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.predictor import LANE_LABELS, RoVDraftPredictor
from src.schemas import DraftPredictionResponse, DraftStateRequest, HealthResponse
from src.search.draft_mcts import DRAFT_STEPS

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
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

# Precompute rich hero metadata catalog
hero_summary_path = DATA_DIR / "heroes_130_summary.csv"
hero_images_path = WEB_DIR / "hero_images.json"

hero_details_cache: list[dict] = []
try:
    summary_df = pd.read_csv(hero_summary_path).set_index("name") if hero_summary_path.exists() else None
    images_dict = json.loads(hero_images_path.read_text(encoding="utf-8")) if hero_images_path.exists() else {}

    lane_probs = predictor.ckpt.get("lane_probs")
    for i, name in enumerate(predictor.hero_names):
        role = "Warrior"
        tier = "A"
        if summary_df is not None and name in summary_df.index:
            row = summary_df.loc[name]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            role = str(row["primary_role"]) if pd.notna(row.get("primary_role")) else "Warrior"
            tier = str(row["meta_tier_2026"]) if pd.notna(row.get("meta_tier_2026")) else "A"

        primary_lane = "DS_Lane (ออฟเลน)"
        if lane_probs is not None and i < len(lane_probs):
            lane_idx = int(np.argmax(lane_probs[i]))
            primary_lane = LANE_LABELS[lane_idx] if lane_idx < len(LANE_LABELS) else primary_lane

        hero_details_cache.append(
            {
                "id": i,
                "name": name,
                "role": role,
                "lane": primary_lane,
                "tier": tier,
                "image_url": images_dict.get(name),
            }
        )
except Exception:
    hero_details_cache = [
        {"id": i, "name": name, "role": "Warrior", "lane": "DS_Lane", "tier": "A"}
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


@app.post("/predict", response_model=DraftPredictionResponse)
def predict_draft(request: DraftStateRequest):
    try:
        return predictor.predict(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# Mounted last so the API routes above take precedence over static files.
if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
