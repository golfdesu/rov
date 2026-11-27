"""Verify ONNX Runtime draft inference parity against PyTorch."""

from __future__ import annotations

import pytest

from src.config import config
from src.predictor import RoVDraftPredictor
from src.schemas import DraftStateRequest


def test_onnx_backend_matches_torch_parity(monkeypatch):
    onnx_path = config.paths.sota_model_path.with_suffix(".onnx")
    if not onnx_path.exists():
        pytest.skip("Exported ONNX artifact not found; run python scripts/export_onnx.py")

    monkeypatch.setenv("ROV_INFERENCE_BACKEND", "torch")
    pt_predictor = RoVDraftPredictor()
    assert pt_predictor.inference_backend == "torch"

    monkeypatch.setenv("ROV_INFERENCE_BACKEND", "onnx")
    ort_predictor = RoVDraftPredictor()
    assert ort_predictor.inference_backend == "onnx"

    sample_requests = [
        DraftStateRequest(
            mode="ban",
            phase=1,
            side="blue",
            ally_bans=["Aoi", "Keera"],
            enemy_bans=["Florentino", "Hayate"],
            ally_picks=[],
            enemy_picks=[],
            league="RPL",
            top_k=5,
        ),
        DraftStateRequest(
            mode="pick",
            phase=1,
            side="red",
            ally_bans=["Keera", "Yena"],
            enemy_bans=["Aoi", "Stuart"],
            ally_picks=["Zip"],
            enemy_picks=["Tulen"],
            league="GLOBAL",
            top_k=5,
        ),
        DraftStateRequest(
            mode="pick",
            phase=2,
            side="blue",
            ally_bans=["Aoi", "Stuart", "Billow"],
            enemy_bans=["Keera", "Yena", "Valhein"],
            ally_picks=["Tulen", "Riktor", "Kriknak"],
            enemy_picks=["Zip", "Violet", "Liliana"],
            league="RPL",
            top_k=5,
        ),
    ]

    for req in sample_requests:
        pt_resp = pt_predictor.predict(req)
        ort_resp = ort_predictor.predict(req)
        pt_top = [rec.hero_name for rec in pt_resp.recommendations]
        ort_top = [rec.hero_name for rec in ort_resp.recommendations]
        assert ort_top == pt_top
        for pt_rec, ort_rec in zip(pt_resp.recommendations, ort_resp.recommendations, strict=True):
            assert abs(ort_rec.probability_pct - pt_rec.probability_pct) < 1e-2
            assert abs(ort_rec.predicted_win_rate_pct - pt_rec.predicted_win_rate_pct) < 1e-2


def test_torch_fallback_and_invalid_backend(monkeypatch):
    monkeypatch.setenv("ROV_INFERENCE_BACKEND", "torch")
    predictor = RoVDraftPredictor()
    assert predictor.inference_backend == "torch"
    assert predictor.onnx_model is None

    monkeypatch.setenv("ROV_INFERENCE_BACKEND", "invalid_backend")
    with pytest.raises(ValueError, match="ROV_INFERENCE_BACKEND"):
        RoVDraftPredictor()
