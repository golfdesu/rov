import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.config import config
from src.predictor import RoVDraftPredictor
from src.schemas import DraftStateRequest
from src.search.draft_mcts import DraftMinimaxSearch, DraftSearchState

client = TestClient(app)


def test_draft_search_state_transitions():
    state = DraftSearchState(
        blue_picks=(),
        red_picks=(),
        blue_bans=(),
        red_bans=(),
        global_bans=(10,),
        step_idx=0,
    )
    assert state.step_idx == 0
    assert state.acting_side == 0  # Blue
    assert state.action_type == 0  # Ban
    assert state.phase == 1

    # Step 0: Blue ban hero 1
    next_s = state.transition(1)
    assert next_s.step_idx == 1
    assert next_s.blue_bans == (1,)
    assert next_s.acting_side == 1  # Red
    assert next_s.action_type == 0  # Ban

    unavail = next_s.get_unavailable_set()
    assert 1 in unavail
    assert 10 in unavail


def test_minimax_lookahead_evaluation():
    archive_path = config.paths.models_dir / "archive" / "sota_draft_gnn_transformer.pt"
    if not (config.paths.sota_model_path.exists() or archive_path.exists()):
        pytest.skip("SOTA model checkpoint not present")

    predictor = RoVDraftPredictor()
    search = DraftMinimaxSearch(predictor)

    # Simulate mid-draft: Blue Pick 1 (step 4)
    # Step 0..3 are 4 bans
    b_ban_ids = (predictor.hero_to_id["Goverra"], predictor.hero_to_id["Dyadia"])
    r_ban_ids = (predictor.hero_to_id["Heino"], predictor.hero_to_id["Dolia"])
    root_state = DraftSearchState(
        blue_picks=(),
        red_picks=(),
        blue_bans=b_ban_ids,
        red_bans=r_ban_ids,
        global_bans=(predictor.hero_to_id["Marja"],),
        step_idx=4,
    )

    candidates = [
        predictor.hero_to_id["Rouie"],
        predictor.hero_to_id["Billow"],
        predictor.hero_to_id["Aoi"],
    ]

    res = search.search_lookahead_win_rates(root_state, candidates, depth=2, branch_factor=3)
    assert len(res) == len(candidates)
    for hid in candidates:
        assert hid in res
        val = res[hid]
        assert 0.0 <= val <= 100.0


def test_predictor_with_lookahead_enabled():
    archive_path = config.paths.models_dir / "archive" / "sota_draft_gnn_transformer.pt"
    if not (config.paths.sota_model_path.exists() or archive_path.exists()):
        pytest.skip("SOTA model checkpoint not present")

    predictor = RoVDraftPredictor()
    req = DraftStateRequest(
        mode="pick",
        side="blue",
        phase=1,
        ally_picks=[],
        enemy_picks=[],
        ally_bans=["Goverra", "Dyadia"],
        enemy_bans=["Heino", "Dolia"],
        global_bans=["Marja"],
        top_k=5,
        use_lookahead=True,
        lookahead_depth=2,
    )
    resp = predictor.predict(req)
    assert len(resp.recommendations) == 5
    for rec in resp.recommendations:
        assert rec.lookahead_win_rate_pct is not None
        assert 0.0 <= rec.lookahead_win_rate_pct <= 100.0
        assert rec.hero_name not in ["Goverra", "Dyadia", "Heino", "Dolia", "Marja"]


def test_api_predict_with_lookahead():
    response = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "red",
            "phase": 1,
            "ally_picks": [],
            "enemy_picks": ["Rouie"],
            "ally_bans": ["Dyadia", "Dolia"],
            "enemy_bans": ["Goverra", "Heino"],
            "global_bans": ["Marja"],
            "top_k": 3,
            "use_lookahead": True,
            "lookahead_depth": 2,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["recommendations"]) == 3
    for rec in data["recommendations"]:
        assert rec["lookahead_win_rate_pct"] is not None
        assert rec["hero_name"] != "Rouie"
