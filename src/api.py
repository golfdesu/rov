from fastapi import FastAPI, HTTPException

from src.predictor import RoVDraftPredictor
from src.schemas import DraftPredictionResponse, DraftStateRequest, HealthResponse

app = FastAPI(
    title="RoV SOTA Draft Intelligence API",
    description="Production-grade MOBA Draft Pick/Ban Recommendation & Win-Probability Serving Engine.",
    version="1.0.0",
)

predictor = RoVDraftPredictor()


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
    }


@app.post("/predict", response_model=DraftPredictionResponse)
def predict_draft(request: DraftStateRequest):
    try:
        return predictor.predict(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
