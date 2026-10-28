import pytest

from src.config import config
from src.predictor import RoVDraftPredictor
from src.schemas import DraftStateRequest


def test_sota_checkpoint_exists_and_loads():
    archive_path = config.paths.models_dir / "archive" / "sota_draft_gnn_transformer.pt"
    if not (config.paths.sota_model_path.exists() or archive_path.exists()):
        pytest.skip("No model checkpoint present (pending training on HPC)")
    predictor = RoVDraftPredictor()
    assert len(predictor.hero_names) == 130
    assert predictor.val_loss < 3.05


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


def test_predictor_side_specific_global_bans():
    predictor = RoVDraftPredictor()
    blue_used = ["Florentino", "Liliana", "Hayate"]
    red_used = ["Nakroth", "Thane", "Toro"]
    req_blue = DraftStateRequest(
        mode="pick",
        side="blue",
        phase=1,
        ally_bans=["Billow"],
        enemy_bans=["Dolia"],
        blue_global_bans=blue_used,
        red_global_bans=red_used,
        top_k=20,
    )
    resp_blue = predictor.predict(req_blue)
    blue_recs = {r.hero_name for r in resp_blue.recommendations}
    for h in blue_used:
        assert h not in blue_recs
    for r in resp_blue.blue_next_picks:
        assert r.hero_name not in blue_used
    for r in resp_blue.red_next_picks:
        assert r.hero_name not in red_used


def test_predictor_side_specific_global_bans_in_ban_mode():
    predictor = RoVDraftPredictor()
    blue_used = ["Rouie", "Florentino"]
    red_used = ["Liliana", "Hayate"]
    req_ban = DraftStateRequest(
        mode="ban",
        side="blue",
        phase=1,
        blue_global_bans=blue_used,
        red_global_bans=red_used,
        top_k=20,
    )
    resp = predictor.predict(req_ban)
    rec_names = {r.hero_name for r in resp.recommendations}
    # Opponent (Red) already used Liliana and Hayate, so Blue should not ban them (Red can't pick them)
    for h in red_used:
        assert h not in rec_names
    # When opponent is Red, forecast red bans should not target Blue's already used heroes
    for r in resp.red_next_bans:
        assert r.hero_name not in blue_used
