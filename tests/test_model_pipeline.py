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


def test_league_conditioning_encoding_and_forward():
    import numpy as np
    import torch

    from src.train_sota_model import (
        PERFORMANCE_GLOBAL_LEAGUE_WEIGHTS,
        RoVDraftGNNTransformer,
        encode_league_id,
        get_league_vector,
    )

    assert encode_league_id("RPL 2026 Winter") == 0
    assert encode_league_id("AOG 2026 Winter") == 1
    assert encode_league_id("GCS 2026 Summer") == 2
    assert encode_league_id("APL 2026") == 3
    assert encode_league_id("AIC 2025") == 3
    assert get_league_vector("RPL") == (1.0, 0.0, 0.0, 0.0)
    assert get_league_vector("GCS") == (0.0, 0.0, 1.0, 0.0)
    assert get_league_vector("GLOBAL") == PERFORMANCE_GLOBAL_LEAGUE_WEIGHTS
    assert abs(sum(PERFORMANCE_GLOBAL_LEAGUE_WEIGHTS) - 1.0) < 1e-6

    predictor = RoVDraftPredictor()
    priors = dict(predictor.ckpt["priors"])
    priors["league_pick_log_priors"] = np.zeros((4, 130), dtype=np.float32)
    priors["league_ban_p1_log_priors"] = np.zeros((4, 130), dtype=np.float32)
    priors["league_ban_p2_log_priors"] = np.zeros((4, 130), dtype=np.float32)
    # Give Hero 0 a strong RPL boost and Hero 1 a strong GCS boost
    priors["league_pick_log_priors"][0, 0] = 3.0
    priors["league_pick_log_priors"][2, 1] = 3.0

    model = RoVDraftGNNTransformer(
        num_heroes=130,
        hero_features=predictor.ckpt["hero_features"],
        lane_probs=predictor.ckpt["lane_probs"],
        graphs=predictor.ckpt["graphs"],
        priors=priors,
        d_model=256,
        nhead=4,
        num_layers=1,
    )
    model.eval()
    assert model.has_league_conditioning is True
    assert model.meta_dim == 11
    assert model.w_pick.numel() == 9

    B = 2
    zeros_vec = torch.zeros((B, 130), dtype=torch.float32)
    unavail = torch.zeros((B, 130), dtype=torch.bool)
    th = torch.zeros((B, 17), dtype=torch.long)
    tt = torch.zeros((B, 17), dtype=torch.long)
    ts = torch.zeros((B, 17), dtype=torch.long)
    tpad = torch.ones((B, 17), dtype=torch.bool)
    meta_rpl_vs_gcs = torch.tensor(
        [
            [0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0],
        ],
        dtype=torch.float32,
    )
    act = torch.ones(B, dtype=torch.long)
    ph = torch.ones(B, dtype=torch.long)

    with torch.no_grad():
        logits, q_win = model(
            zeros_vec, zeros_vec, zeros_vec, zeros_vec, unavail, th, tt, ts, tpad, meta_rpl_vs_gcs, act, ph
        )
    assert logits.shape == (2, 130)
    assert q_win.shape == (2, 130)
    # Row 0 (RPL) should favor Hero 0 relative to Row 1 (GCS), and Row 1 (GCS) should favor Hero 1
    assert float(logits[0, 0] - logits[1, 0]) > 0.5
    assert float(logits[1, 1] - logits[0, 1]) > 0.5


def test_heuristic_checkpoint_exists_and_loads():
    heuristic_model_path = config.paths.models_dir / "sota_draft_gnn_transformer_heuristic.pt"
    if not heuristic_model_path.exists():
        pytest.skip("Heuristic model checkpoint not found (pending pull from H100)")
    predictor = RoVDraftPredictor(model_path=heuristic_model_path)
    assert len(predictor.hero_names) == 130
    assert predictor.val_loss < 3.0
    assert predictor.architecture == "RoVDraftGNNTransformer"


def test_partial_ban_find_matching_step():
    from src.search.draft_mcts import DRAFT_STEPS, DraftMinimaxSearch

    predictor = RoVDraftPredictor()
    searcher = DraftMinimaxSearch(predictor)
    # 1/2 phase-1 Blue bans recorded (partial ban) + 2 Blue picks + 1 Red pick; next is Red Pick 2
    step_idx = searcher.find_matching_step(
        side_val=1,
        act_type=1,
        phase=1,
        b_picks_len=2,
        r_picks_len=1,
        b_bans_len=1,
        r_bans_len=2,
    )
    assert DRAFT_STEPS[step_idx] == (6, 1, 1, 1)


def test_lookahead_depth_3_and_4():
    from src.search.draft_mcts import DraftMinimaxSearch, DraftSearchState

    predictor = RoVDraftPredictor()
    ids = predictor.hero_to_id
    searcher = DraftMinimaxSearch(predictor)
    state = DraftSearchState(
        blue_picks=(ids["Marja"],),
        red_picks=(ids["Hayate"], ids["Toro"]),
        blue_bans=(ids["Rouie"], ids["Billow"]),
        red_bans=(ids["Eland'orr"], ids["Valhein"]),
        blue_global_bans=(),
        red_global_bans=(),
        step_idx=7,
        league="RPL",
    )
    cands = [ids["Florentino"], ids["Dolia"]]
    for depth in (3, 4):
        res = searcher.search_lookahead_win_rates(state, cands, depth=depth, branch_factor=2)
        assert set(res) == set(cands)
        assert all(0.0 <= v <= 100.0 for v in res.values())


def test_predict_matrix_ban_mode_and_forecast_sides():
    predictor = RoVDraftPredictor()
    req = DraftStateRequest(
        mode="ban",
        side="blue",
        phase=1,
        ally_picks=["Toro"],
        enemy_picks=["Marja"],
        ally_bans=["Rouie"],
        enemy_bans=["Eland'orr"],
        blue_global_bans=["Florentino"],
        red_global_bans=["Hayate"],
        top_k=5,
    )
    matrix = predictor.predict_matrix(req)
    assert matrix.architecture == "EmpiricalMatrixRules"
    rec_names = {r.hero_name for r in matrix.recommendations}
    assert "Hayate" not in rec_names  # Opponent already used in Global Ban
    for r in matrix.recommendations:
        assert 0.0 < r.predicted_win_rate_pct < 100.0
    for r in matrix.red_next_bans:
        assert r.hero_name not in {"Florentino"}


def test_predictor_top_k_25_and_aliases():
    predictor = RoVDraftPredictor()
    assert predictor.resolve_heroes(["Batman", "The Joker", "Payna", "Kilgrooth"]) == [
        "Kaine",
        "Stuart",
        "Helen",
        "Kil'Groth",
    ]
    req = DraftStateRequest(mode="pick", side="blue", phase=1, ally_picks=["Toro"], enemy_picks=["Marja"], top_k=30)
    resp = predictor.predict(req)
    assert len(resp.recommendations) == 30
    assert abs(sum(r.probability_pct for r in resp.recommendations)) <= 100.1


def test_predict_draft_cli_invocation():
    import subprocess
    import sys

    from src.predict_draft_cli import build_sequence_tokens, load_predictor, predict_next_action, resolve_hero_list

    model, ckpt, hero_names, hero_to_id, heroes_df, stats_df = load_predictor()
    assert model is not None
    assert resolve_hero_list("Batman,Joker,Payna,Kil'grooth", hero_to_id) == ["Kaine", "Stuart", "Helen", "Kil'Groth"]

    th, tt, ts, tpad = build_sequence_tokens(["Toro"], ["Marja"], ["Rouie"], ["Hayate"], hero_to_id, side="red")
    assert th.shape == (1, 17)
    assert not bool(tpad[0, 0]) and bool(tpad[0, 5])
    assert ts[0, 0] < ts[0, 1]

    missing, recs, phase = predict_next_action(
        model,
        ckpt,
        hero_names,
        hero_to_id,
        heroes_df,
        stats_df,
        action_mode="pick",
        side="blue",
        phase=1,
        ally_picks=["Toro"],
        enemy_picks=["Marja"],
        top_k=5,
    )
    assert phase == 1
    assert len(recs) == 5
    assert "Toro" not in {r["hero"] for r in recs}

    proc = subprocess.run(
        [
            sys.executable,
            "src/predict_draft_cli.py",
            "--mode",
            "pick",
            "--side",
            "blue",
            "--phase",
            "1",
            "--ally-picks",
            "Toro",
            "--enemy-picks",
            "Marja",
            "--top-k",
            "3",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "#1" in proc.stdout and "#3" in proc.stdout


def test_predict_cli_aliases_ban_phase_and_completed_win_rate():
    from src.predict_draft_cli import load_predictor, predict_next_action
    from src.predictor import RoVDraftPredictor
    from src.schemas import DraftStateRequest

    model, ckpt, hero_names, hero_to_id, heroes_df, stats_df = load_predictor()

    _, recs_alias, phase_alias = predict_next_action(
        model,
        ckpt,
        hero_names,
        hero_to_id,
        heroes_df,
        stats_df,
        action_mode="pick",
        side="blue",
        phase=1,
        ally_picks=["Arthur"],
        top_k=5,
    )
    assert phase_alias == 1
    assert "Mortos" not in {r["hero"] for r in recs_alias}

    _, _, ban_phase_p1 = predict_next_action(
        model,
        ckpt,
        hero_names,
        hero_to_id,
        heroes_df,
        stats_df,
        action_mode="ban",
        side="blue",
        phase=None,
        ally_picks=["Toro", "Marja"],
        enemy_picks=["Rouie", "Hayate"],
        ally_bans=["Heino", "Dolia"],
        enemy_bans=["Goverra", "Dyadia"],
        top_k=3,
    )
    assert ban_phase_p1 == 1

    _, _, ban_phase_p2 = predict_next_action(
        model,
        ckpt,
        hero_names,
        hero_to_id,
        heroes_df,
        stats_df,
        action_mode="ban",
        side="blue",
        phase=None,
        ally_picks=["Toro", "Marja", "Krixi"],
        enemy_picks=["Rouie", "Hayate", "Murad"],
        ally_bans=["Heino", "Dolia"],
        enemy_bans=["Goverra", "Dyadia"],
        top_k=3,
    )
    assert ban_phase_p2 == 2

    blue_5 = ["Toro", "Florentino", "Nakroth", "Krixi", "Hayate"]
    red_5 = ["Thane", "Omen", "Paine", "Liliana", "Violet"]
    blue_bans = ["Rouie", "Heino", "Dolia", "Goverra"]
    red_bans = ["Dyadia", "Stuart", "Billow", "Enzo"]

    _, recs_done, _ = predict_next_action(
        model,
        ckpt,
        hero_names,
        hero_to_id,
        heroes_df,
        stats_df,
        action_mode="pick",
        side="blue",
        phase=2,
        ally_picks=blue_5,
        enemy_picks=red_5,
        ally_bans=blue_bans,
        enemy_bans=red_bans,
        top_k=1,
    )
    predictor = RoVDraftPredictor()
    api_resp = predictor.predict(
        DraftStateRequest(
            mode="pick",
            side="blue",
            phase=2,
            ally_picks=blue_5,
            enemy_picks=red_5,
            ally_bans=blue_bans,
            enemy_bans=red_bans,
            top_k=1,
        )
    )
    assert abs(recs_done[0]["pred_win_pct"] - api_resp.recommendations[0].predicted_win_rate_pct) < 0.05

    # Alphanumeric multi-word aliases & partial-ban completed 5v5 Step-17/18 parity
    from src.predict_draft_cli import resolve_hero_list

    assert predictor.resolve_heroes(["TheJoker", "FlowbornMM"]) == ["Stuart", "Flowborn (Marksman)"]
    assert resolve_hero_list("TheJoker,FlowbornMM", hero_to_id) == ["Stuart", "Flowborn (Marksman)"]

    r17 = predictor.predict(
        DraftStateRequest(
            mode="pick",
            side="red",
            phase=2,
            ally_picks=red_5[:4],
            enemy_picks=blue_5,
            ally_bans=[],
            enemy_bans=[],
            top_k=20,
            use_lookahead=False,
        )
    )
    chosen_red5 = r17.recommendations[0].hero_name
    r18 = predictor.predict(
        DraftStateRequest(
            mode="pick",
            side="blue",
            phase=2,
            ally_picks=blue_5,
            enemy_picks=[*red_5[:4], chosen_red5],
            ally_bans=[],
            enemy_bans=[],
            top_k=1,
            use_lookahead=False,
        )
    )
    assert (
        abs(
            r18.recommendations[0].predicted_win_rate_pct
            - round(100.0 - r17.recommendations[0].predicted_win_rate_pct, 2)
        )
        <= 0.02
    )
