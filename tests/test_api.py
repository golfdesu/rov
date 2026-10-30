from fastapi.testclient import TestClient

from src.api import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "healthy"
    assert payload["model_loaded"] is True
    assert payload["num_heroes"] == 130


def test_predict_endpoint():
    response = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_picks": ["Rouie", "Billow"],
            "enemy_picks": ["TeeMee", "Hayate"],
            "ally_bans": ["Goverra", "Dyadia"],
            "enemy_bans": ["Heino", "Dolia"],
            "global_bans": ["Marja"],
            "top_k": 5,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "pick"
    assert len(data["recommendations"]) == 5
    rec_names = {r["hero_name"] for r in data["recommendations"]}
    assert "Marja" not in rec_names
    assert "Rouie" not in rec_names
    assert len(data["blue_next_picks"]) == 2
    assert len(data["red_next_picks"]) == 2


def test_predict_matrix_endpoint():
    response = client.post(
        "/predict/matrix",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_picks": ["Rouie", "Billow"],
            "enemy_picks": ["TeeMee", "Hayate"],
            "ally_bans": ["Goverra", "Dyadia"],
            "enemy_bans": ["Heino", "Dolia"],
            "global_bans": ["Marja"],
            "top_k": 5,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["architecture"] == "EmpiricalMatrixRules"
    assert data["mode"] == "pick"
    assert len(data["recommendations"]) == 5
    rec_names = {r["hero_name"] for r in data["recommendations"]}
    assert "Marja" not in rec_names
    assert "Rouie" not in rec_names
    assert len(data["blue_next_picks"]) == 2
    assert len(data["red_next_picks"]) == 2


def test_predict_next_picks_ghost_forecast():
    response = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "red",
            "phase": 1,
            "ally_picks": [],
            "enemy_picks": ["Butterfly"],
            "ally_bans": ["Goverra", "Dyadia"],
            "enemy_bans": ["Heino", "Billow"],
            "top_k": 5,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["blue_next_picks"]) == 2
    assert len(data["red_next_picks"]) == 2
    blue_forecast_names = [r["hero_name"] for r in data["blue_next_picks"]]
    assert len(set(blue_forecast_names)) == 2
    assert "Butterfly" not in blue_forecast_names
    blue_forecast_lanes = [r["primary_lane"] for r in data["blue_next_picks"]]
    assert blue_forecast_lanes[0] != blue_forecast_lanes[1]


def test_ban_pick_bidirectional_intelligence():
    # Direction 1: Ban Mina + Florentino -> predicts/unlocks Omen
    r1 = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_bans": ["Mina", "Florentino"],
            "top_k": 5,
        },
    )
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["blue_next_picks"][0]["hero_name"] == "Omen"
    assert set(d1["blue_next_picks"][0]["triggered_by"]) == {"Mina", "Florentino"}
    assert d1["ban_unlocked_heroes"][0]["hero_name"] == "Omen"

    # Direction 2: Pick Omen -> predicts Phase 2 bans Mina & Florentino
    r2 = client.post(
        "/predict",
        json={
            "mode": "ban",
            "side": "blue",
            "phase": 2,
            "ally_picks": ["Omen"],
            "ally_bans": ["Billow", "Dolia"],
            "top_k": 5,
        },
    )
    assert r2.status_code == 200
    d2 = r2.json()
    next_ban_names = [b["hero_name"] for b in d2["blue_next_bans"]]
    assert next_ban_names == ["Mina", "Florentino"]
    assert d2["blue_next_bans"][0]["triggered_by"] == ["Omen"]


def test_web_ui_served():
    response = client.get("/")
    assert response.status_code == 200
    assert "RoV Draft Intelligence" in response.text


def test_web_static_assets_served():
    assert client.get("/manifest.webmanifest").status_code == 200
    assert client.get("/favicon.svg").status_code == 200
    assert client.get("/avatars/Airi.jpg").status_code == 200


def test_api_routes_not_shadowed_by_static_mount():
    assert client.get("/health").json()["status"] == "healthy"
    assert len(client.get("/heroes").json()["heroes"]) == 130


def test_hero_images_served():
    response = client.get("/hero_images.json")
    assert response.status_code == 200
    images = response.json()
    assert len(images) > 100
    assert all(url.startswith("/avatars/") or url.startswith("https://") for url in images.values())


def test_draft_steps_endpoint():
    response = client.get("/draft/steps")
    assert response.status_code == 200
    steps = response.json()["steps"]
    assert len(steps) == 18
    assert steps[0]["action"] == "ban"
    assert steps[0]["side"] == "blue"


def test_heroes_rich_details():
    response = client.get("/heroes")
    assert response.status_code == 200
    data = response.json()
    assert "hero_details" in data
    assert len(data["hero_details"]) == 130
    first = data["hero_details"][0]
    assert "role" in first
    assert "lane" in first
    assert "tier" in first


def test_combat_catalog():
    data = client.get("/combat/catalog").json()
    assert len(data["heroes"]) == 130
    assert len(data["arcana"]) == 30
    assert len(data["enchantments"]) == 33


def test_combat_duel_endpoint():
    response = client.post(
        "/combat/duel",
        json={
            "a": {"hero": "Valhein", "level": 12, "items": ["Fenrir's Tooth"], "arcana": {"Excalibur": 10}},
            "b": {"hero": "Toro", "level": 12, "items": ["Mail of Pain"]},
        },
    )
    assert response.status_code == 200
    assert response.json()["simulation"]["winner"] in {"a", "b", "draw", "timeout"}


def test_combat_stats_rejects_bad_build():
    response = client.post("/combat/stats", json={"build": {"hero": "Valhein", "items": ["Not An Item"]}})
    assert response.status_code == 422


def test_draft_session_persistence_endpoints(tmp_path, monkeypatch):
    from src.config import config

    temp_session_file = tmp_path / "draft_session_state.json"
    monkeypatch.setattr(config.paths, "draft_session_path", temp_session_file)

    # 1. Initial GET returns clean default state
    r_init = client.get("/draft/session")
    assert r_init.status_code == 200
    assert r_init.json()["stepIndex"] == 0
    assert r_init.json()["bluePicks"] == []

    # 2. PUT saves active board, global bans, and recorded series games to disk
    payload = {
        "stepIndex": 5,
        "bluePicks": ["Rouie"],
        "redPicks": [],
        "blueBans": ["Florentino", "Liliana"],
        "redBans": ["Billow", "Dolia"],
        "history": [
            {
                "stepIndex": 4,
                "bluePicks": [],
                "redPicks": [],
                "blueBans": ["Florentino", "Liliana"],
                "redBans": ["Billow", "Dolia"],
            }
        ],
        "winHistory": [50.0, 51.2, 49.8, 52.1, 54.5],
        "blueWinRate": 54.5,
        "useLookahead": True,
        "globalBans": {
            "seriesName": "BAC vs BRU",
            "teamAName": "BAC",
            "teamBName": "BRU",
            "teamAUsed": ["Toro", "Hayate"],
            "teamBUsed": ["Thane", "Capheny"],
            "universalBans": [],
            "blueSideTeam": "A",
            "gameNumber": 2,
        },
        "seriesGames": [
            {
                "id": "g1-test",
                "gameNumber": 1,
                "timestamp": "18:00:00",
                "seriesName": "BAC vs BRU",
                "blueTeamName": "BRU",
                "redTeamName": "BAC",
                "blueSideTeam": "B",
                "blueBans": ["Marja", "Keera", "Aoi", "Stuart"],
                "redBans": ["Eland'orr", "TeeMee", "Richter", "Yena"],
                "bluePicks": ["Thane", "Capheny", "Krixi", "Nakroth", "Skud"],
                "redPicks": ["Toro", "Hayate", "Raz", "Biron", "Kriknak"],
                "blueWinRate": 47.8,
            }
        ],
        "updatedAt": 1761650000000,
    }
    r_put = client.put("/draft/session", json=payload)
    assert r_put.status_code == 200
    assert temp_session_file.exists()

    # 3. Subsequent GET retrieves persisted state from disk (simulating host restart)
    r_get = client.get("/draft/session")
    assert r_get.status_code == 200
    saved = r_get.json()
    assert saved["stepIndex"] == 5
    assert saved["bluePicks"] == ["Rouie"]
    assert saved["globalBans"]["teamAName"] == "BAC"
    assert saved["globalBans"]["seriesName"] == "BAC vs BRU"
    assert saved["globalBans"]["gameNumber"] == 2
    assert len(saved["seriesGames"]) == 1
    assert saved["seriesGames"][0]["seriesName"] == "BAC vs BRU"
    assert saved["seriesGames"][0]["blueTeamName"] == "BRU"
    assert saved["updatedAt"] == 1761650000000

    # 4. DELETE clears persisted session
    r_del = client.delete("/draft/session")
    assert r_del.status_code == 200
    assert not temp_session_file.exists()
    assert client.get("/draft/session").json()["stepIndex"] == 0


def test_phase1_and_phase2_lane_filtering_prevents_overlap():
    # Phase 1 Pick: Blue already picked Liliana (Mid) -> no Mid hero in recommendations, next picks, or enemy next bans
    r_p1 = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_picks": ["Liliana"],
            "enemy_picks": ["Hayate", "Toro"],
            "ally_bans": ["Billow", "Dolia"],
            "enemy_bans": ["Rouie", "TeeMee"],
            "top_k": 5,
        },
    )
    assert r_p1.status_code == 200
    d_p1 = r_p1.json()
    assert all(r["primary_lane"] != "Mid" for r in d_p1["recommendations"])
    assert all(r["primary_lane"] != "Mid" for r in d_p1["blue_next_picks"])
    assert all(r["primary_lane"] != "Mid" for r in d_p1["ban_unlocked_heroes"])
    assert all(r["primary_lane"] != "Mid" for r in d_p1["red_next_bans"])

    # Phase 2 Ban (FPL vs SGP Game 6 board): Red already picked Liliana (Mid), Zephys (Jungle), Flowborn (Dragon_Lane)
    # Blue's ban recommendations and Ghost Ban must target Red's remaining open lanes (DS_Lane / Roam), never Mid (Mganga)
    r_p2 = client.post(
        "/predict",
        json={
            "mode": "ban",
            "side": "blue",
            "phase": 2,
            "ally_picks": ["Hayate", "Marja", "Lorion"],
            "enemy_picks": ["Liliana", "Zephys", "Flowborn (Marksman)"],
            "ally_bans": ["Eland'orr", "Y'bneth", "Murad"],
            "enemy_bans": ["Lumburr", "Helen", "Rouie", "Richter"],
            "top_k": 5,
        },
    )
    assert r_p2.status_code == 200
    d_p2 = r_p2.json()
    open_enemy_lanes = {"DS_Lane", "Roam"}
    assert all(r["primary_lane"] in open_enemy_lanes for r in d_p2["recommendations"])
    assert all(r["primary_lane"] in open_enemy_lanes for r in d_p2["blue_next_bans"])
    assert all(r["primary_lane"] in open_enemy_lanes for r in d_p2["ban_unlocked_heroes"])
    assert all(r["hero_name"] != "Mganga" for r in d_p2["blue_next_bans"])
    assert d_p2["blue_next_bans"][0]["hero_name"] == d_p2["recommendations"][0]["hero_name"]


def test_next_picks_anchored_on_sota_model_not_2024_lifts():
    r_g4 = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "red",
            "phase": 1,
            "ally_picks": [],
            "enemy_picks": ["TeeMee"],
            "ally_bans": ["Valhein", "Rouie"],
            "enemy_bans": ["Lorion", "Tamyn"],
            "blue_global_bans": [
                "Dolia",
                "Zata",
                "Eland'orr",
                "Astrid",
                "Marja",
                "Billow",
                "Wiro",
                "Violet",
                "Evita",
                "Biron",
                "Sinestrea",
                "Lorion",
                "Capheny",
                "Toro",
                "Yena",
            ],
            "red_global_bans": [
                "Mganga",
                "Butterfly",
                "Stuart",
                "Krizzix",
                "Mina",
                "Thane",
                "Astrid",
                "Valhein",
                "Iggy",
                "Maloch",
                "Y'bneth",
                "Billow",
                "Eland'orr",
                "Richter",
                "Ignis",
            ],
            "top_k": 5,
        },
    )
    assert r_g4.status_code == 200
    d_g4 = r_g4.json()
    red_next_names = [r["hero_name"] for r in d_g4["red_next_picks"]]
    assert "Erin" not in red_next_names
    assert "Zill" not in red_next_names
    assert d_g4["red_next_picks"][0]["hero_name"] == d_g4["recommendations"][0]["hero_name"]


def test_completed_5v5_draft_evaluates_exact_step17_matchup_win_rate():
    blue_picks = ["Yena", "Aoi", "Liliana", "Hayate", "Thane"]
    red_picks_4 = ["Florentino", "Keera", "Krixi", "Capheny"]
    blue_bans = ["Rouie", "Billow", "Dolia", "Toro"]
    red_bans = ["TeeMee", "Marja", "Heino", "Goverra"]

    r_step17 = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "red",
            "phase": 2,
            "ally_picks": red_picks_4,
            "enemy_picks": blue_picks,
            "ally_bans": red_bans,
            "enemy_bans": blue_bans,
            "top_k": 20,
        },
    )
    assert r_step17.status_code == 200
    step17_recs = {r["hero_name"]: r["predicted_win_rate_pct"] for r in r_step17.json()["recommendations"]}

    r_step18 = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 2,
            "ally_picks": blue_picks,
            "enemy_picks": [*red_picks_4, "Lumburr"],
            "ally_bans": blue_bans,
            "enemy_bans": red_bans,
            "top_k": 1,
        },
    )
    assert r_step18.status_code == 200
    blue_final_win = r_step18.json()["recommendations"][0]["predicted_win_rate_pct"]
    expected_blue_win = round(100.0 - step17_recs["Lumburr"], 2)
    assert abs(blue_final_win - expected_blue_win) <= 0.02


def test_lookahead_respects_open_lane_constraints():
    r_la = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 2,
            "ally_picks": ["Yena", "Aoi", "Liliana", "Hayate"],
            "enemy_picks": ["Florentino", "Keera", "Krixi", "Capheny"],
            "ally_bans": ["Rouie", "Billow", "Dolia", "Toro"],
            "enemy_bans": ["TeeMee", "Marja", "Heino", "Goverra"],
            "top_k": 20,
            "use_lookahead": True,
        },
    )
    assert r_la.status_code == 200
    top5 = r_la.json()["recommendations"][:5]
    assert all(r["primary_lane"] == "Roam" for r in top5)


def test_recommendations_counter_and_combo_trigger_reasons():
    # Enemy picked Hayate -> picks countering Hayate (e.g. Florentino, Omen, etc.) should have trigger_reason='counter'
    response = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_picks": [],
            "enemy_picks": ["Hayate"],
            "ally_bans": ["Rouie", "Billow"],
            "enemy_bans": ["Dolia", "TeeMee"],
            "top_k": 10,
        },
    )
    assert response.status_code == 200
    data = response.json()
    counter_recs = [r for r in data["recommendations"] if r.get("trigger_reason") == "counter"]
    assert len(counter_recs) > 0
    assert all("Hayate" in r["triggered_by"] for r in counter_recs)
