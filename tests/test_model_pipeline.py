import pytest

from src.config import config
from src.predictor import RoVDraftPredictor
from src.schemas import DraftStateRequest


def test_sota_checkpoint_exists_and_loads():
    assert config.paths.sota_model_path.exists()
    predictor = RoVDraftPredictor()
    assert len(predictor.hero_names) == 130
    assert predictor.val_loss < 2.90


def test_predictor_masks_unavailable_heroes():
    predictor = RoVDraftPredictor()
    unavailable = ["Marja", "Hayate", "Billow", "Toro", "TeeMee", "Rouie"]
    req = DraftStateRequest(
        mode="pick",
        side="blue",
        phase=1,
        ally_picks=["Marja"],
        enemy_picks=["Hayate", "Billow"],
        ally_bans=["Toro"],
        enemy_bans=["TeeMee"],
        global_bans=["Rouie"],
        top_k=10,
    )
    resp = predictor.predict(req)
    assert len(resp.recommendations) == 10
    returned_names = {r.hero_name for r in resp.recommendations}
    for banned_or_picked in unavailable:
        assert banned_or_picked not in returned_names

    for r in resp.recommendations:
        assert 0.0 < r.probability_pct <= 100.0
        assert 0.0 < r.predicted_win_rate_pct < 100.0


def test_invalid_hero_raises_value_error():
    predictor = RoVDraftPredictor()
    req = DraftStateRequest(ally_picks=["NotARealHeroName123"])
    with pytest.raises(ValueError):
        predictor.predict(req)
