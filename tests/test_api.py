import json

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
    assert payload.get("dataset_metadata") is not None
    assert payload["dataset_metadata"]["total_matches"] >= 4000
    assert payload["dataset_metadata"]["total_heroes"] == 130


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


def test_matrix_and_heuristic_routes_removed_and_matrix_core():
    from src.api import predictor
    from src.schemas import DraftStateRequest

    payload = {
        "mode": "pick",
        "side": "blue",
        "phase": 1,
        "ally_picks": ["Rouie", "Billow"],
        "enemy_picks": ["TeeMee", "Hayate"],
        "ally_bans": ["Goverra", "Dyadia"],
        "enemy_bans": ["Heino", "Dolia"],
        "global_bans": ["Marja"],
        "top_k": 5,
    }
    assert client.post("/predict/matrix", json=payload).status_code == 404
    assert client.post("/predict/heuristic", json=payload).status_code == 404

    data = predictor.predict_matrix(DraftStateRequest(**payload))
    assert data.architecture == "EmpiricalMatrixRules"
    assert data.mode == "pick"
    assert len(data.recommendations) == 5
    rec_names = {r.hero_name for r in data.recommendations}
    assert "Marja" not in rec_names
    assert "Rouie" not in rec_names
    assert len(data.blue_next_picks) == 2
    assert len(data.red_next_picks) == 2


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
    assert "<title>MiniDraft" in response.text
    assert 'property="og:title"' in response.text
    assert 'rel="canonical"' in response.text


def test_seo_robots_and_sitemap_served():
    robots = client.get("/robots.txt")
    assert robots.status_code == 200
    assert "text/plain" in robots.headers["content-type"]
    assert "Sitemap: https://minidraft.app/sitemap.xml" in robots.text
    assert "Disallow: /auth/" in robots.text

    sitemap = client.get("/sitemap.xml")
    assert sitemap.status_code == 200
    assert "xml" in sitemap.headers["content-type"]
    assert "<loc>https://minidraft.app/</loc>" in sitemap.text
    assert "<loc>https://minidraft.app/privacy</loc>" in sitemap.text


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

    # Verify alias-normalized roles
    hero_by_name = {h["name"]: h for h in data["hero_details"]}
    # Celica (Brunhilda) must resolve to Carry, not fallback to Fighter
    celica_hero = hero_by_name.get("Celica") or hero_by_name.get("Brunhilda")
    assert celica_hero is not None
    assert celica_hero["role"] == "Carry"
    assert "Dragon_Lane" in celica_hero["lane"]

    mortos_hero = hero_by_name.get("Mortos") or hero_by_name.get("Arthur")
    assert mortos_hero is not None
    assert mortos_hero["role"] == "Fighter"

    riktor_hero = hero_by_name.get("Riktor") or hero_by_name.get("Richter")
    assert riktor_hero is not None
    assert riktor_hero["role"] == "Fighter"

    # Verify exact parity with RoV_Pro_Draft_Master_2026.xlsx Hero_Tier_List_2026 sheet
    assert hero_by_name["Rouie"]["tier"] == "S+"
    assert hero_by_name["Sinestrea"]["tier"] == "S+"
    assert hero_by_name["Marja"]["tier"] == "S+"
    assert hero_by_name["Eland'orr"]["tier"] == "S+"
    assert hero_by_name["Toro"]["tier"] == "S+"
    assert hero_by_name["Dolia"]["tier"] == "S+"
    assert hero_by_name["Florentino"]["tier"] == "S"
    assert hero_by_name["Tamyn"]["tier"] == "S"
    assert hero_by_name["Astrid"]["tier"] == "S"
    assert hero_by_name["Wisp"]["tier"] == "S"
    assert hero_by_name["Airi"]["tier"] == "S"
    assert hero_by_name["Mina"]["tier"] == "S"
    assert hero_by_name["Murad"]["tier"] == "S"
    assert hero_by_name["Mganga"]["tier"] == "S"
    assert hero_by_name["Valhein"]["tier"] == "S"
    assert hero_by_name["Skud"]["tier"] == "S"
    assert hero_by_name["Enzo"]["tier"] == "S"
    assert hero_by_name["Taara"]["tier"] == "S"
    assert hero_by_name["Evita"]["tier"] == "S"
    assert hero_by_name["Alice"]["tier"] == "A"
    assert hero_by_name["Annette"]["tier"] == "A"
    assert hero_by_name["Edras"]["tier"] == "A"
    assert hero_by_name["Cresht"]["tier"] == "A"
    assert hero_by_name["Wiro"]["tier"] == "A"
    assert hero_by_name["Zanis"]["tier"] == "A"
    assert hero_by_name["Ata"]["tier"] == "A"
    assert hero_by_name["Chaugnar"]["tier"] == "B"
    assert hero_by_name["Aya"]["tier"] == "B"
    assert hero_by_name["Krizzix"]["tier"] == "B"
    assert hero_by_name["Bijan"]["tier"] == "C"
    assert hero_by_name["Flowborn (Mage)"]["tier"] == "C"


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


def test_combat_rune_recommendation_endpoint():
    response = client.get(
        "/combat/rune-recommendation",
        params={"my_hero": "Omen", "enemy_hero": "Biron", "lane": "DS_Lane", "level": 2},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["my_hero"] == "Omen"
    assert data["enemy_hero"] == "Biron"
    assert "recommended_preset" in data
    assert "trade_verdict" in data
    assert len(data["detailed_runes"]) >= 3

    # Invalid hero or lane returns 422
    bad_res = client.get(
        "/combat/rune-recommendation",
        params={"my_hero": "NonExistentHero", "enemy_hero": "Biron"},
    )
    assert bad_res.status_code == 422
    bad_lane = client.get(
        "/combat/rune-recommendation",
        params={"my_hero": "Omen", "enemy_hero": "Biron", "lane": "InvalidLane"},
    )
    assert bad_lane.status_code == 422


def test_combat_stats_rejects_bad_build():
    response = client.post("/combat/stats", json={"build": {"hero": "Valhein", "items": ["Not An Item"]}})
    assert response.status_code == 422
    bool_arcana = client.post("/combat/stats", json={"build": {"hero": "Valhein", "arcana": {"Onslaught": True}}})
    assert bool_arcana.status_code == 422

    # Valid target includes burst & procs; duel accepts enable_actives=False; Rankbreaker alias resolves screenshots
    stats_res = client.post(
        "/combat/stats",
        json={
            "build": {"hero": "Tulen", "level": 15, "items": ["Hecate's Diadem"]},
            "target": {"hero": "Toro", "level": 15},
        },
    )
    assert stats_res.status_code == 200
    stats_data = stats_res.json()
    assert "burst" in stats_data and stats_data["burst"] > 0
    assert "procs" in stats_data

    duel_res = client.post(
        "/combat/duel",
        json={
            "a": {"hero": "Toro", "level": 15, "items": ["Rock Shield", "Mail of Pain"], "enable_actives": False},
            "b": {"hero": "Hayate", "level": 15, "items": ["Fafnir's Talon"], "enable_kiting": True},
        },
    )
    assert duel_res.status_code == 200
    assert duel_res.json()["simulation"]["a"]["kiting"]["interval_multiplier"] > 1.0

    import src.api as api_mod

    item_alias = client.get("/combat/item-screenshots/Rankbreaker")
    assert item_alias.status_code == 200
    assert item_alias.json()["folder"] == "Broken Spears"
    if (api_mod.ITEMS_DIR / "Broken Spears").is_dir():
        assert len(item_alias.json()["screenshots"]) >= 1


def test_draft_session_persistence_endpoints(tmp_path, monkeypatch):
    from src.config import config

    temp_session_file = tmp_path / "draft_session_state.json"
    monkeypatch.setattr(config.paths, "draft_session_path", temp_session_file)

    # 1. Initial GET returns clean default state
    r_init = client.get("/draft/session")
    assert r_init.status_code == 200
    assert r_init.json()["stepIndex"] == 0
    assert r_init.json()["bluePicks"] == []
    assert r_init.json()["fromTeamHistory"] is False

    # 2. PUT saves active board, global bans, and recorded series games to disk
    payload = {
        "stepIndex": 5,
        "bluePicks": ["Rouie"],
        "redPicks": [],
        "blueBans": ["Florentino", "Liliana"],
        "redBans": ["Billow", "Dolia"],
        "pickLanes": {"Rouie": "Mid"},
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
        "fromTeamHistory": True,
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
                "redBans": ["Eland'orr", "TeeMee", "Riktor", "Yena"],
                "bluePicks": ["Thane", "Capheny", "Krixi", "Nakroth", "Skud"],
                "redPicks": ["Toro", "Hayate", "Raz", "Biron", "Kriknak"],
                "pickLanes": {"Thane": "Roam", "Toro": "Roam", "Krixi": "Mid"},
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
    assert saved["fromTeamHistory"] is True
    assert saved["pickLanes"] == {"Rouie": "Mid"}
    assert saved["globalBans"]["teamAName"] == "BAC"
    assert saved["globalBans"]["seriesName"] == "BAC vs BRU"
    assert saved["globalBans"]["gameNumber"] == 2
    assert len(saved["seriesGames"]) == 1
    assert saved["seriesGames"][0]["seriesName"] == "BAC vs BRU"
    assert saved["seriesGames"][0]["blueTeamName"] == "BRU"
    assert saved["seriesGames"][0]["pickLanes"] == {"Thane": "Roam", "Toro": "Roam", "Krixi": "Mid"}
    assert saved["updatedAt"] == 1761650000000

    # 4. Old records load with automatic lanes and keep their recorded picks.
    del payload["seriesGames"][0]["pickLanes"]
    del payload["fromTeamHistory"]
    temp_session_file.write_text(json.dumps(payload), encoding="utf-8")
    legacy_state = client.get("/draft/session").json()
    assert legacy_state["fromTeamHistory"] is False
    legacy_game = legacy_state["seriesGames"][0]
    assert legacy_game["pickLanes"] == {}
    assert legacy_game["bluePicks"] == payload["seriesGames"][0]["bluePicks"]

    # 5. DELETE clears persisted session
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
            "enemy_bans": ["Lumburr", "Helen", "Rouie", "Riktor"],
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
                "Riktor",
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

    assert len(step17_recs) > 0
    chosen_hero = r_step17.json()["recommendations"][0]["hero_name"]

    r_step18 = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 2,
            "ally_picks": blue_picks,
            "enemy_picks": [*red_picks_4, chosen_hero],
            "ally_bans": blue_bans,
            "enemy_bans": red_bans,
            "top_k": 1,
        },
    )
    assert r_step18.status_code == 200
    blue_final_win = r_step18.json()["recommendations"][0]["predicted_win_rate_pct"]
    expected_blue_win = round(100.0 - step17_recs[chosen_hero], 2)
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


def test_series_winning_heroes_adaptation_boost():
    base_payload = {
        "mode": "pick",
        "side": "blue",
        "phase": 1,
        "ally_picks": [],
        "enemy_picks": [],
        "ally_bans": ["Rouie", "Billow"],
        "enemy_bans": ["Dolia", "TeeMee"],
        "top_k": 10,
    }
    r_base = client.post("/predict", json=base_payload)
    assert r_base.status_code == 200
    base_json = r_base.json()
    base_recs = base_json["recommendations"]
    target_hero = base_recs[0]["hero_name"]
    base_prob = base_recs[0]["probability_pct"]
    base_forecast_prob = base_json["blue_next_picks"][0]["probability_pct"]

    r_boost = client.post(
        "/predict",
        json={**base_payload, "series_winning_heroes": [target_hero], "use_lookahead": True},
    )
    assert r_boost.status_code == 200
    boost_json = r_boost.json()
    boost_map = {r["hero_name"]: r["probability_pct"] for r in boost_json["recommendations"]}
    assert boost_map[target_hero] > base_prob
    assert boost_json["blue_next_picks"][0]["hero_name"] == target_hero
    assert boost_json["blue_next_picks"][0]["probability_pct"] > base_forecast_prob


def test_per_lane_quota_in_sota_and_matrix_modes():
    from src.api import predictor
    from src.schemas import DraftStateRequest

    payload = {
        "mode": "pick",
        "side": "blue",
        "phase": 2,
        "ally_picks": ["Yena", "Aoi", "Liliana", "Hayate"],
        "enemy_picks": ["Florentino", "Keera", "Krixi", "Capheny"],
        "ally_bans": ["Rouie", "Billow", "Dolia", "Toro"],
        "enemy_bans": ["TeeMee", "Marja", "Heino", "Goverra"],
        "top_k": 50,
    }
    resp = client.post("/predict", json=payload)
    assert resp.status_code == 200
    sota_recs = resp.json()["recommendations"]
    matrix_recs = [r.model_dump() for r in predictor.predict_matrix(DraftStateRequest(**payload)).recommendations]
    for label, recs in (("SOTA", sota_recs), ("Matrix", matrix_recs)):
        assert len(recs) == 50
        for lane in ("DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"):
            lane_recs = [r for r in recs if r["primary_lane"] == lane]
            assert len(lane_recs) >= 5, f"{label} returned <5 heroes for {lane}"
            assert lane_recs[0]["probability_pct"] > 0.0


def test_predict_matrix_forecasts_and_series_winner_parity():
    from src.api import predictor
    from src.schemas import DraftStateRequest

    # 1. Next picks must fill distinct lanes and respect per-side global bans
    d_picks = predictor.predict_matrix(
        DraftStateRequest(
            mode="pick",
            side="blue",
            phase=1,
            ally_picks=["Rouie"],
            enemy_picks=["TeeMee"],
            ally_bans=["Goverra", "Dyadia"],
            enemy_bans=["Heino", "Dolia"],
            blue_global_bans=["Billow"],
            red_global_bans=["Hayate"],
            top_k=5,
        )
    )
    assert len(d_picks.blue_next_picks) == 2
    assert len(d_picks.red_next_picks) == 2
    blue_lanes = [r.primary_lane for r in d_picks.blue_next_picks]
    red_lanes = [r.primary_lane for r in d_picks.red_next_picks]
    assert blue_lanes[0] != blue_lanes[1]
    assert red_lanes[0] != red_lanes[1]
    assert all(r.hero_name != "Billow" for r in d_picks.blue_next_picks)
    assert all(r.hero_name != "Hayate" for r in d_picks.red_next_picks)

    # 2. Next bans must be populated when ban slots remain (Phase 2 Omen protection bans)
    d_bans = predictor.predict_matrix(
        DraftStateRequest(
            mode="ban",
            side="blue",
            phase=2,
            ally_picks=["Omen"],
            enemy_picks=["Hayate"],
            ally_bans=["Billow", "Dolia"],
            enemy_bans=["Rouie", "TeeMee"],
            top_k=5,
        )
    )
    assert len(d_bans.blue_next_bans) == 2
    assert len(d_bans.red_next_bans) == 2
    assert [b.hero_name for b in d_bans.blue_next_bans] == ["Mina", "Florentino"]

    # 3. Series winning heroes adaptation boost in matrix mode
    target_hero = d_picks.recommendations[2].hero_name
    base_prob = d_picks.recommendations[2].probability_pct
    d_boost = predictor.predict_matrix(
        DraftStateRequest(
            mode="pick",
            side="blue",
            phase=1,
            ally_picks=["Rouie"],
            enemy_picks=["TeeMee"],
            ally_bans=["Goverra", "Dyadia"],
            enemy_bans=["Heino", "Dolia"],
            blue_global_bans=["Billow"],
            red_global_bans=["Hayate"],
            series_winning_heroes=[target_hero],
            top_k=10,
        )
    )
    boost_map = {r.hero_name: r.probability_pct for r in d_boost.recommendations}
    assert boost_map[target_hero] > base_prob


def test_apl_and_aic_league_presets_succeed():
    for league in ("APL", "AIC"):
        r = client.post(
            "/predict",
            json={
                "mode": "pick",
                "side": "blue",
                "phase": 1,
                "ally_picks": ["Rouie"],
                "enemy_picks": ["TeeMee"],
                "league": league,
                "top_k": 5,
            },
        )
        assert r.status_code == 200, f"Failed for league {league}: {r.text}"
        data = r.json()
        assert len(data["recommendations"]) == 5


def test_hero_screenshots_endpoint(tmp_path, monkeypatch):
    import src.api as api_mod

    # 1. Test canonical hero Omen
    r_omen = client.get("/combat/hero-screenshots/Omen")
    assert r_omen.status_code == 200
    d_omen = r_omen.json()
    assert d_omen["hero"] == "Omen"

    # If running in environment where gitignored heroes/ exists, verify real files
    if api_mod.HEROES_DIR.is_dir():
        assert len(d_omen["skill_screenshots"]) >= 4
        assert len(d_omen["status_screenshots"]) >= 1
        assert all(s.startswith("/heroes-media/Omen/skill/") for s in d_omen["skill_screenshots"])

    # 2. Test alias Mortos -> Arthur
    r_mortos = client.get("/combat/hero-screenshots/Mortos")
    assert r_mortos.status_code == 200
    d_mortos = r_mortos.json()
    assert d_mortos["folder"] == "Arthur"
    if api_mod.HEROES_DIR.is_dir():
        assert len(d_mortos["skill_screenshots"]) >= 4

    # 3. Test non-existent hero
    r_none = client.get("/combat/hero-screenshots/NonExistentHero")
    assert r_none.status_code == 200
    assert r_none.json()["skill_screenshots"] == []

    # 4. Mock directory with mock files to verify parsing in headless CI environments
    mock_heroes_dir = tmp_path / "mock_heroes"
    mock_omen_skill = mock_heroes_dir / "Omen" / "skill"
    mock_omen_status = mock_heroes_dir / "Omen" / "status"
    mock_omen_skill.mkdir(parents=True)
    mock_omen_status.mkdir(parents=True)
    (mock_omen_skill / "skill1.jpg").write_text("fake")
    (mock_omen_status / "status_lv1.jpg").write_text("fake")

    mock_arthur_skill = mock_heroes_dir / "Arthur" / "skill"
    mock_arthur_skill.mkdir(parents=True)
    (mock_arthur_skill / "skill1.jpg").write_text("fake")

    monkeypatch.setattr(api_mod, "HEROES_DIR", mock_heroes_dir)

    r_mock = client.get("/combat/hero-screenshots/Omen")
    assert r_mock.status_code == 200
    d_mock = r_mock.json()
    assert len(d_mock["skill_screenshots"]) == 1
    assert len(d_mock["status_screenshots"]) == 1
    assert d_mock["skill_screenshots"][0] == "/heroes-media/Omen/skill/skill1.jpg"
    assert d_mock["status_screenshots"][0] == "/heroes-media/Omen/status/status_lv1.jpg"

    r_mock_mortos = client.get("/combat/hero-screenshots/Mortos")
    assert r_mock_mortos.status_code == 200
    d_mock_mortos = r_mock_mortos.json()
    assert d_mock_mortos["folder"] == "Arthur"
    assert len(d_mock_mortos["skill_screenshots"]) == 1
    assert d_mock_mortos["skill_screenshots"][0] == "/heroes-media/Arthur/skill/skill1.jpg"

    # 5. Path traversal security checks (blocked by handler or route matcher)
    r_traversal_win = client.get("/combat/hero-screenshots/..%5C..%5CWindows")
    assert r_traversal_win.status_code == 400
    r_traversal_slash = client.get("/combat/hero-screenshots/..%2F..%2Fetc")
    assert r_traversal_slash.status_code in (400, 404)

    # 6. Natural & canonical skill slot sort verification
    mock_veres_skill = mock_heroes_dir / "Veres" / "skill"
    mock_veres_skill.mkdir(parents=True)
    for fname in (
        "skill4.jpg",
        "ultimate.jpg",
        "skill2_v2.jpg",
        "skill2.jpg",
        "skill1_cannon.jpg",
        "skill1_rapid.jpg",
        "passive.jpg",
        "passive_awakened.jpg",
    ):
        (mock_veres_skill / fname).write_text("fake")

    r_mock_veres = client.get("/combat/hero-screenshots/Veres")
    assert r_mock_veres.status_code == 200
    d_mock_veres = r_mock_veres.json()
    assert [p.split("/")[-1] for p in d_mock_veres["skill_screenshots"]] == [
        "passive.jpg",
        "skill1_rapid.jpg",
        "skill1_cannon.jpg",
        "skill2.jpg",
        "skill2_v2.jpg",
        "ultimate.jpg",
        "skill4.jpg",
        "passive_awakened.jpg",
    ]


def test_item_screenshots_endpoint(tmp_path, monkeypatch):
    import src.api as api_mod

    # 1. Single card item
    res_amulet = client.get("/combat/item-screenshots/Amulet%20of%20Longevity")
    assert res_amulet.status_code == 200
    data_amulet = res_amulet.json()
    assert data_amulet["item"] == "Amulet of Longevity"
    if api_mod.ITEMS_DIR.is_dir():
        assert len(data_amulet["screenshots"]) == 1
        assert data_amulet["screenshots"][0].endswith("item_card.jpg")
    assert data_amulet["details"] is not None
    assert data_amulet["details"]["category"] == "defense"

    # 2. Multi-card item (Jungle/Support)
    res_aqua = client.get("/combat/item-screenshots/Aquaflame%20-%20Accelerate")
    assert res_aqua.status_code == 200
    data_aqua = res_aqua.json()
    assert data_aqua["item"] == "Aquaflame - Accelerate"
    if api_mod.ITEMS_DIR.is_dir():
        assert len(data_aqua["screenshots"]) == 4
        assert [p.split("/")[-1] for p in data_aqua["screenshots"]] == [
            "item_card_1.jpg",
            "item_card_2.jpg",
            "item_card_3.jpg",
            "item_card_4.jpg",
        ]
    assert len(data_aqua["pages_info"]) == 4

    # 3. Non-existent item returns empty screenshots gracefully
    res_fake = client.get("/combat/item-screenshots/NonExistentItem999")
    assert res_fake.status_code == 200
    assert res_fake.json()["screenshots"] == []

    # 4. Traversal protection
    res_trav = client.get("/combat/item-screenshots/..%5C..%5Cwindows")
    assert res_trav.status_code == 400
    res_trav_slash = client.get("/combat/item-screenshots/..%2F..%2Fetc")
    assert res_trav_slash.status_code in (400, 404)

    # 5. Item alias and shorthand resolution
    res_troy = client.get("/combat/item-screenshots/Troy's%20Medallion")
    assert res_troy.status_code == 200
    assert res_troy.json()["folder"] == "Medallion of Troy"
    if api_mod.ITEMS_DIR.is_dir():
        assert len(res_troy.json()["screenshots"]) == 1

    res_fafnir = client.get("/combat/item-screenshots/Fafnir")
    assert res_fafnir.status_code == 200
    assert res_fafnir.json()["folder"] == "Fafnir's Talon"
    if api_mod.ITEMS_DIR.is_dir():
        assert len(res_fafnir.json()["screenshots"]) == 1

    # 6. Mock ITEMS_DIR so file enumeration, natural page sorting, and aliases run on CI without gitignored item/
    mock_items_dir = tmp_path / "mock_items"
    (mock_items_dir / "Amulet of Longevity").mkdir(parents=True)
    (mock_items_dir / "Amulet of Longevity" / "item_card.jpg").write_text("fake")
    (mock_items_dir / "Aquaflame - Accelerate").mkdir(parents=True)
    for page_num in (4, 1, 3, 2):
        (mock_items_dir / "Aquaflame - Accelerate" / f"item_card_{page_num}.jpg").write_text("fake")
    (mock_items_dir / "Broken Spears").mkdir(parents=True)
    (mock_items_dir / "Broken Spears" / "item_card.jpg").write_text("fake")
    (mock_items_dir / "Medallion of Troy").mkdir(parents=True)
    (mock_items_dir / "Medallion of Troy" / "item_card.jpg").write_text("fake")
    (mock_items_dir / "Fafnir's Talon").mkdir(parents=True)
    (mock_items_dir / "Fafnir's Talon" / "item_card.jpg").write_text("fake")

    monkeypatch.setattr(api_mod, "ITEMS_DIR", mock_items_dir)

    m_amulet = client.get("/combat/item-screenshots/Amulet%20of%20Longevity").json()
    assert m_amulet["screenshots"] == ["/items-media/Amulet of Longevity/item_card.jpg"]

    m_aqua = client.get("/combat/item-screenshots/Aquaflame%20-%20Accelerate").json()
    assert [p.split("/")[-1] for p in m_aqua["screenshots"]] == [
        "item_card_1.jpg",
        "item_card_2.jpg",
        "item_card_3.jpg",
        "item_card_4.jpg",
    ]
    assert client.get("/combat/item-screenshots/Rankbreaker").json()["screenshots"] == [
        "/items-media/Broken Spears/item_card.jpg"
    ]
    assert client.get("/combat/item-screenshots/Troy's%20Medallion").json()["screenshots"] == [
        "/items-media/Medallion of Troy/item_card.jpg"
    ]
    assert client.get("/combat/item-screenshots/Fafnir").json()["screenshots"] == [
        "/items-media/Fafnir's Talon/item_card.jpg"
    ]


def test_heroes_endpoint_returns_nonzero_presence_rate():
    res = client.get("/heroes")
    assert res.status_code == 200
    heroes = res.json()["hero_details"]
    assert len(heroes) == 130
    nonzero = [h for h in heroes if h["presence_rate"] > 0]
    assert len(nonzero) >= 50


def test_predict_rejects_duplicate_alias_and_cross_team_heroes():
    r_dup = client.post(
        "/predict",
        json={"mode": "pick", "side": "blue", "phase": 1, "ally_picks": ["Nakroth", "Nakroth"]},
    )
    assert r_dup.status_code == 422

    r_alias = client.post(
        "/predict",
        json={"mode": "pick", "side": "blue", "phase": 1, "ally_picks": ["Arthur", "Mortos"]},
    )
    assert r_alias.status_code == 422

    r_cross = client.post(
        "/predict",
        json={"mode": "pick", "side": "blue", "phase": 1, "ally_picks": ["Arthur"], "enemy_picks": ["Mortos"]},
    )
    assert r_cross.status_code == 422

    r_ban_pick = client.post(
        "/predict",
        json={"mode": "pick", "side": "blue", "phase": 1, "ally_picks": ["Arthur"], "enemy_bans": ["Mortos"]},
    )
    assert r_ban_pick.status_code == 422


def test_predict_lookahead_step_alignment_parity():
    base = {
        "mode": "pick",
        "side": "blue",
        "phase": 1,
        "ally_picks": ["Toro"],
        "enemy_picks": ["Marja"],
        "ally_bans": ["Rouie"],
        "enemy_bans": ["Hayate"],
        "top_k": 30,
    }
    r_raw = client.post("/predict", json={**base, "use_lookahead": False})
    r_look = client.post("/predict", json={**base, "use_lookahead": True})
    assert r_raw.status_code == 200
    assert r_look.status_code == 200
    raw_by_hero = {r["hero_name"]: r["predicted_win_rate_pct"] for r in r_raw.json()["recommendations"]}
    look_top = r_look.json()["recommendations"][0]
    assert look_top["hero_name"] in raw_by_hero
    assert abs(raw_by_hero[look_top["hero_name"]] - look_top["predicted_win_rate_pct"]) < 0.05


def test_drive_relative_and_alphanumeric_alias_handling():
    assert client.get("/combat/hero-screenshots/C:").status_code == 400
    assert client.get("/combat/item-screenshots/C:").status_code == 400
    assert client.get("/combat/hero-screenshots/.").status_code in (400, 404)
    assert client.get("/combat/item-screenshots/.").status_code in (400, 404)

    r_alias = client.post(
        "/predict",
        json={"mode": "pick", "side": "blue", "phase": 1, "ally_picks": ["TheJoker", "FlowbornMM"], "top_k": 3},
    )
    assert r_alias.status_code == 200
    rec_names = {r["hero_name"] for r in r_alias.json()["recommendations"]}
    assert "Stuart" not in rec_names
    assert "Flowborn (Marksman)" not in rec_names


def test_multi_user_auth_and_database_isolation(tmp_path, monkeypatch):
    from src.config import config

    monkeypatch.setattr(config.paths, "app_db_path", tmp_path / "rov_test.db")
    monkeypatch.setattr(config, "stripe_secret_key", "")

    client_a = TestClient(app)
    client_b = TestClient(app)

    # Unauthenticated combat builds sync requires login
    assert client_a.get("/auth/me").json()["authenticated"] is False
    assert client_a.get("/combat/builds").status_code == 401

    # Register User A
    reg_a = client_a.post(
        "/auth/register",
        json={"username": "User_Alpha", "password": "secret-pass-a", "display_name": "Alpha"},
    )
    assert reg_a.status_code == 201
    assert reg_a.json()["authenticated"] is True
    assert reg_a.json()["user"]["username"] == "user_alpha"

    # Duplicate registration blocked (case-insensitive)
    assert (
        client_b.post("/auth/register", json={"username": "user_alpha", "password": "other-password"}).status_code
        == 409
    )

    # Register User B
    reg_b = client_b.post("/auth/register", json={"username": "user_beta", "password": "secret-pass-b"})
    assert reg_b.status_code == 201

    # Save isolated draft + combat builds for User A
    r_put_draft_a = client_a.put(
        "/draft/session",
        json={"stepIndex": 2, "bluePicks": ["Hayate"], "updatedAt": 1761650001000},
    )
    assert r_put_draft_a.status_code == 200
    r_put_combat_a = client_a.put(
        "/combat/builds",
        json={"a": {"hero": "Valhein", "level": 12, "items": ["Claves Sancti"]}, "updatedAt": 1761650002000},
    )
    assert r_put_combat_a.status_code == 200

    # User B must see empty clean state (zero leakage from User A)
    assert client_b.get("/draft/session").json()["stepIndex"] == 0
    assert client_b.get("/draft/session").json()["bluePicks"] == []
    assert client_b.get("/combat/builds").json()["a"] is None

    # Save distinct state for User B
    assert (
        client_b.put(
            "/draft/session",
            json={"stepIndex": 4, "redPicks": ["Toro"], "updatedAt": 1761650003000},
        ).status_code
        == 200
    )

    # Verify both remain strictly isolated
    assert client_a.get("/draft/session").json()["bluePicks"] == ["Hayate"]
    assert client_a.get("/combat/builds").json()["a"]["hero"] == "Valhein"
    assert client_b.get("/draft/session").json()["redPicks"] == ["Toro"]
    assert client_b.get("/draft/session").json()["bluePicks"] == []

    # Logout and login verification
    assert client_a.post("/auth/logout").json()["authenticated"] is False
    assert client_a.get("/combat/builds").status_code == 401
    # X-Expected-User protects against silent no-op saves after expiry and cross-tab account switches
    assert (
        client_a.put("/draft/session", json={"stepIndex": 1}, headers={"X-Expected-User": "user_alpha"}).status_code
        == 401
    )
    assert (
        client_b.put("/draft/session", json={"stepIndex": 1}, headers={"X-Expected-User": "user_alpha"}).status_code
        == 409
    )
    assert client_a.post("/auth/login", json={"username": "user_alpha", "password": "wrong"}).status_code == 401

    login_a = client_a.post("/auth/login", json={"username": "USER_ALPHA", "password": "secret-pass-a"})
    assert login_a.status_code == 200
    assert login_a.json()["authenticated"] is True
    assert client_a.get("/draft/session").json()["bluePicks"] == ["Hayate"]
    assert client_a.get("/combat/builds").json()["a"]["level"] == 12

    # > 20 seriesGames is allowed and DELETE writes a tombstone timestamp to prevent offline resurrection
    many_games = [
        {
            "id": f"g-{i}",
            "gameNumber": (i % 7) + 1,
            "timestamp": "12:00:00",
            "seriesName": f"S{i // 7}",
            "blueTeamName": "BAC",
            "redTeamName": "TLN",
            "blueSideTeam": "A",
            "blueBans": [],
            "redBans": [],
            "bluePicks": [],
            "redPicks": [],
            "blueWinRate": 50.0,
        }
        for i in range(25)
    ]
    r_many = client_a.put(
        "/draft/session",
        json={"seriesGames": many_games, "updatedAt": 1761650004000},
        headers={"X-Expected-User": "user_alpha"},
    )
    assert r_many.status_code == 200
    assert len(client_a.get("/draft/session").json()["seriesGames"]) == 25

    assert client_a.delete("/draft/session", headers={"X-Expected-User": "user_alpha"}).status_code == 200
    cleared = client_a.get("/draft/session").json()
    assert cleared["stepIndex"] == 0
    assert cleared["seriesGames"] == []
    assert cleared["updatedAt"] > 0

    # Practice history cross-device sync is isolated from main Draft Board & protected by X-Expected-User
    assert client_b.get("/draft/practice-history").json() == {
        "entries": [],
        "updatedAt": 0,
        "deletedIds": [],
        "clearedAt": 0,
    }
    practice_entry = {
        "id": "p-1",
        "signature": "sess1|G1|blue|Valhein,Hayate,Toro,Krixi,Zuka|Tel'Annas,Yorn,Thane,Tulen,Butterfly|Murad|Florentino",
        "recordedAt": "2026-11-21T13:00:00Z",
        "gameNumber": 1,
        "gameCount": 3,
        "startingSide": "blue",
        "playerSide": "blue",
        "bluePicks": ["Valhein", "Hayate", "Toro", "Krixi", "Zuka"],
        "redPicks": ["Tel'Annas", "Yorn", "Thane", "Tulen", "Butterfly"],
        "blueBans": ["Murad"],
        "redBans": ["Florentino"],
        "playerEstimate": 54.2,
    }
    assert (
        client_a.put(
            "/draft/practice-history",
            json={"entries": [practice_entry], "updatedAt": 1761650005000},
            headers={"X-Expected-User": "user_alpha"},
        ).status_code
        == 200
    )
    # Concurrent second device saving a newer game without p-1 merges both entries instead of clobbering p-1
    practice_entry_2 = {
        **practice_entry,
        "id": "p-2",
        "signature": "sess2|G1|red|Tel'Annas,Yorn,Thane,Tulen,Butterfly|Valhein,Hayate,Toro,Krixi,Zuka|Florentino|Murad",
        "recordedAt": "2026-11-21T14:00:00Z",
        "playerSide": "red",
    }
    res_merge = client_a.put(
        "/draft/practice-history",
        json={"entries": [practice_entry_2], "updatedAt": 1761650006000},
        headers={"X-Expected-User": "user_alpha"},
    )
    assert res_merge.status_code == 200
    assert {e["id"] for e in res_merge.json()["entries"]} == {"p-1", "p-2"}
    # Explicit deletedIds removes p-1 across devices without dropping p-2
    res_del = client_a.put(
        "/draft/practice-history",
        json={"entries": [practice_entry_2], "updatedAt": 1761650007000, "deletedIds": ["p-1"]},
        headers={"X-Expected-User": "user_alpha"},
    )
    assert res_del.status_code == 200
    assert [e["id"] for e in res_del.json()["entries"]] == ["p-2"]
    # Stale timestamp must not overwrite or resurrect deleted Practice history
    res_stale_p = client_a.put(
        "/draft/practice-history",
        json={"entries": [practice_entry], "updatedAt": 1761650004000},
        headers={"X-Expected-User": "user_alpha"},
    )
    assert res_stale_p.status_code == 200
    assert [e["id"] for e in res_stale_p.json()["entries"]] == ["p-2"]
    res_p_a = client_a.get("/draft/practice-history", headers={"X-Expected-User": "user_alpha"})
    assert res_p_a.status_code == 200
    assert [e["id"] for e in res_p_a.json()["entries"]] == ["p-2"]
    # Stale draft session PUT returns authoritative newer DB state instead of echoing stale request
    newer_ts = int(cleared["updatedAt"]) + 2000
    stale_ts = int(cleared["updatedAt"]) + 1000
    assert (
        client_a.put(
            "/draft/session",
            json={"bluePicks": ["Hayate"], "updatedAt": newer_ts},
            headers={"X-Expected-User": "user_alpha"},
        ).status_code
        == 200
    )
    res_stale_draft = client_a.put(
        "/draft/session",
        json={"bluePicks": ["Yorn"], "updatedAt": stale_ts},
        headers={"X-Expected-User": "user_alpha"},
    )
    assert res_stale_draft.status_code == 200
    assert res_stale_draft.json()["bluePicks"] == ["Hayate"]
    assert res_stale_draft.json()["updatedAt"] == newer_ts
    assert client_b.get("/draft/practice-history").json()["entries"] == []
    assert (
        client_b.put(
            "/draft/practice-history",
            json={"entries": [], "updatedAt": 1},
            headers={"X-Expected-User": "user_alpha"},
        ).status_code
        == 409
    )
    assert client_a.delete("/draft/practice-history", headers={"X-Expected-User": "user_alpha"}).status_code == 200
    assert client_a.get("/draft/practice-history").json()["entries"] == []
    assert client_a.get("/draft/practice-history").json()["updatedAt"] > 0


def test_sota_only_locked_endpoints_and_engine_normalization(tmp_path, monkeypatch):
    from src.config import config

    monkeypatch.setattr(config.paths, "app_db_path", tmp_path / "sota_only.db")
    guest_client = TestClient(app)
    reg_client = TestClient(app)

    sample = {"mode": "pick", "side": "blue", "phase": 1, "top_k": 3}

    # SOTA /predict works, while alternative model endpoints are gone for all callers
    assert guest_client.post("/predict", json=sample).status_code == 200
    assert guest_client.post("/predict/matrix", json=sample).status_code == 404
    assert guest_client.post("/predict/heuristic", json=sample).status_code == 404

    reg_res = reg_client.post("/auth/register", json={"username": "regular_player", "password": "user-pass-123"})
    assert reg_res.status_code == 201
    assert "can_switch_model" not in reg_res.json()["user"]
    assert reg_client.post("/predict/matrix", json=sample).status_code == 404
    assert reg_client.post("/predict/heuristic", json=sample).status_code == 404

    # Any legacy engine value is coerced cleanly to sota
    saved_user = reg_client.put("/draft/session", json={"engine": "matrix", "updatedAt": 1761650004000})
    assert saved_user.status_code == 200
    assert saved_user.json()["engine"] == "sota"
    assert reg_client.get("/draft/session").json()["engine"] == "sota"


def test_production_mode_lockdown_and_anti_scraping(tmp_path, monkeypatch):
    from src.config import config

    monkeypatch.setattr(config.paths, "app_db_path", tmp_path / "prod_lockdown.db")
    guest_client = TestClient(app)
    session_file = tmp_path / "draft_session_state.json"
    monkeypatch.setattr(config.paths, "draft_session_path", session_file)
    monkeypatch.setattr(config, "env", "production")

    # 1. Docs, OpenAPI schema, metadata, alt model routes, and hidden media/asset paths return 404 in production
    for blocked_path in (
        "/docs",
        "/docs/",
        "/redoc",
        "/redoc/",
        "/openapi.json",
        "/openapi.json/",
        "/dataset_metadata.json",
        "http://testserver//dataset_metadata.json",
        "http://testserver/./dataset_metadata.json",
        "http://testserver/%2e/dataset_metadata.json",
        "http://testserver/foo/../dataset_metadata.json",
        "/Dataset_Metadata.json",
        "/items",
        "/items/blade.png",
        "/Items/blade.png",
        "/items%5cblade.png",
        "/enchantments/veda.png",
        "/skills/liliana.png",
        "/heroes-media/Liliana/skill/s1.jpg",
        "/HEROES-MEDIA/Liliana/skill/s1.jpg",
        "/items-media/Attack/blade.jpg",
    ):
        assert guest_client.get(blocked_path).status_code == 404, f"Expected 404 for {blocked_path}"
    assert guest_client.post("/predict/matrix", json={"mode": "pick"}).status_code == 404
    assert guest_client.post("/predict/heuristic", json={"mode": "pick"}).status_code == 404

    # 2. Combat Lab & /combat/builds endpoints return 404 for both Guest and authenticated users in production
    assert guest_client.get("/combat/catalog").status_code == 404
    assert guest_client.get("/combat/builds").status_code == 404
    assert guest_client.put("/combat/builds", json={"updatedAt": 123}).status_code == 404
    assert guest_client.delete("/combat/builds").status_code == 404

    reg_client = TestClient(app)
    assert (
        reg_client.post("/auth/register", json={"username": "prod_reg_user", "password": "user-pass-999"}).status_code
        == 201
    )
    assert reg_client.get("/combat/builds").status_code == 404
    assert reg_client.put("/combat/builds", json={"updatedAt": 123}).status_code == 404
    assert reg_client.get("/combat/catalog").status_code == 404

    assert guest_client.post("/combat/stats", json={"build": {"hero": "Liliana", "level": 15}}).status_code == 404
    assert (
        guest_client.post(
            "/combat/duel",
            json={
                "a": {"hero": "Liliana", "level": 15},
                "b": {"hero": "Toro", "level": 15},
            },
        ).status_code
        == 404
    )
    assert guest_client.get("/combat/rune-recommendation", params={"hero": "Liliana"}).status_code == 404
    assert guest_client.get("/combat/hero-screenshots/Liliana").status_code == 404
    assert guest_client.get("/combat/item-screenshots/Claves%20Sancti").status_code == 404

    # 3. /health strips internal architecture, val_loss, and dataset_metadata in production
    health_res = guest_client.get("/health")
    assert health_res.status_code == 200
    health_data = health_res.json()
    assert health_data == {"status": "healthy", "model_loaded": True}
    assert "val_loss" not in health_data
    assert "dataset_metadata" not in health_data
    assert health_res.headers.get("X-Content-Type-Options") == "nosniff"
    assert health_res.headers.get("X-Frame-Options") == "DENY"
    assert health_res.headers.get("Cache-Control") == "no-store"

    # 4. /heroes strips proprietary pro rates & tier_reason for everyone in production
    for client_ctx in (guest_client, reg_client):
        prod_heroes = client_ctx.get("/heroes").json()["hero_details"]
        assert len(prod_heroes) == 130
        assert "win_rate" not in prod_heroes[0]
        assert "pick_rate" not in prod_heroes[0]
        assert "ban_rate" not in prod_heroes[0]
        assert "presence_rate" not in prod_heroes[0]
        assert "tier_reason" not in prod_heroes[0]
        assert set(prod_heroes[0].keys()) == {"id", "name", "role", "lane", "main_pro_lane", "tier", "image_url"}

    # 5. Unauthenticated /draft/session does not read/write shared file on disk in production
    put_guest = guest_client.put("/draft/session", json={"stepIndex": 3, "bluePicks": ["Liliana"], "updatedAt": 999})
    assert put_guest.status_code == 200
    assert not session_file.exists()
    assert guest_client.get("/draft/session").json()["bluePicks"] == []

    # 6. /predict enforces top_k <= 25, architecture redaction, error sanitization, global_bans bounds, and 413 body limit
    for client_ctx in (guest_client, reg_client):
        pred_res = client_ctx.post("/predict", json={"mode": "pick", "side": "blue", "phase": 1, "top_k": 50})
        assert pred_res.status_code == 200
        pred_json = pred_res.json()
        assert len(pred_json["recommendations"]) == 25
        assert pred_json["architecture"] == "RoV Draft AI"

    hero_pool = guest_client.get("/heroes").json()["heroes"]
    assert (
        guest_client.post(
            "/predict",
            json={"mode": "pick", "side": "blue", "phase": 1, "global_bans": hero_pool[:21]},
        ).status_code
        == 400
    )
    assert (
        guest_client.post(
            "/predict",
            json={
                "mode": "ban",
                "side": "blue",
                "phase": 1,
                "global_bans": hero_pool[:15],
                "red_global_bans": hero_pool[15:41],
            },
        ).status_code
        == 400
    )
    bad_hero = guest_client.post(
        "/predict",
        json={"mode": "pick", "side": "blue", "phase": 1, "ally_picks": ["NotAHeroXYZ"]},
    )
    assert bad_hero.status_code == 422
    assert "NotAHeroXYZ" not in bad_hero.json()["detail"]
    assert (
        guest_client.post(
            "/predict",
            json={"mode": "pick", "side": "blue", "phase": 1, "ally_picks": ["A" * 65]},
        ).status_code
        == 422
    )
    huge_payload = '{"mode":"pick","pad":"' + ("x" * (270 * 1024)) + '"}'
    assert (
        guest_client.post(
            "/predict",
            content=huge_payload,
            headers={"Content-Type": "application/json"},
        ).status_code
        == 413
    )

    # 7. Path normalizer & isolated dist-prod bundle sanity checks
    from src.api import _normalize_request_path

    assert _normalize_request_path("//dataset_metadata.json") == "/dataset_metadata.json"
    assert _normalize_request_path("/foo/../Items\\blade.png") == "/items/blade.png"

    dist_prod = config.paths.frontend_dist_prod_dir
    if dist_prod.is_dir():
        import re

        prod_texts = [
            (dist_prod / "index.html").read_text(encoding="utf-8"),
            *(p.read_text(encoding="utf-8") for p in (dist_prod / "assets").glob("*.js")),
        ]
        combined = "\n".join(prod_texts)
        assert not re.search(
            r"predict/matrix|predict/heuristic|heuristic|bayes matrix|empirical matrix|3,512|\bgnn\b|transformer",
            combined,
            flags=re.IGNORECASE,
        )


def test_update_profile_only_changes_display_name(tmp_path, monkeypatch):
    from src.config import config

    monkeypatch.setattr(config.paths, "app_db_path", tmp_path / "profile.db")
    owner, other, fresh = TestClient(app), TestClient(app), TestClient(app)
    username = "profile_owner"
    password = "test-profile-password"
    credentials = {"username": username, "password": password}
    account = owner.post("/auth/register", json=credentials).json()["user"]
    other.post("/auth/register", json={"username": "profile_other", "password": password})
    assert owner.put("/draft/session", json={"bluePicks": ["Hayate"]}).status_code == 200

    profile = {"user_id": account["id"], "display_name": "  ชื่อใหม่ Mini Draft  "}
    assert fresh.put("/auth/profile", json=profile).status_code == 401
    assert other.put("/auth/profile", json=profile).status_code == 409
    assert owner.put("/auth/profile", json={**profile, "display_name": "   "}).status_code == 422
    assert owner.put("/auth/profile", json={**profile, "display_name": "x" * 41}).status_code == 422
    assert owner.put("/auth/profile", json={**profile, "username": "new_username"}).status_code == 422

    response = owner.put("/auth/profile", json=profile)
    assert response.status_code == 200
    updated = response.json()["user"]
    assert updated == {
        **account,
        "display_name": "ชื่อใหม่ Mini Draft",
        "display_name_is_custom": True,
        "display_label": "ชื่อใหม่ Mini Draft",
        "display_name_changes_remaining": 2,
    }
    assert owner.get("/auth/me").json()["user"] == updated
    assert fresh.post("/auth/login", json=credentials).json()["user"] == updated
    assert fresh.get("/draft/session", headers={"X-Expected-User": username}).json()["bluePicks"] == ["Hayate"]
    assert other.get("/auth/me").json()["user"]["display_name"] == "profile_other"
    assert owner.put("/auth/username", json={"username": "new_username"}).status_code in {404, 405}


def test_display_name_quota_and_cooldown_are_shared_across_sessions(tmp_path, monkeypatch):
    import time
    from concurrent.futures import ThreadPoolExecutor
    from types import SimpleNamespace

    from src import db as db_mod
    from src.config import config

    clock = int(time.time())
    cooldown = 14 * 24 * 60 * 60
    monkeypatch.setattr(db_mod, "time", SimpleNamespace(time=lambda: clock, monotonic=time.monotonic))
    monkeypatch.setattr(config.paths, "app_db_path", tmp_path / "profile_cooldown.db")
    first, second = TestClient(app), TestClient(app)
    credentials = {"username": "profile_cooldown", "password": "cooldown-test-password"}
    account = first.post("/auth/register", json=credentials).json()["user"]
    assert account["display_name_changes_remaining"] == 3
    assert account["display_name_next_change_at"] is None
    assert second.post("/auth/login", json=credentials).status_code == 200

    def change(client, name):
        return client.put("/auth/profile", json={"user_id": account["id"], "display_name": name})

    assert change(first, " @profile_cooldown ").json()["user"] == account
    assert change(first, "   ").status_code == 422
    assert change(first, "First name").json()["user"]["display_name_changes_remaining"] == 2
    assert change(second, "Second name").json()["user"]["display_name_changes_remaining"] == 1

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = [
            pool.submit(change, first, "Third name from first session"),
            pool.submit(change, second, "Third name from second session"),
        ]
        responses = [result.result() for result in results]

    assert sorted(response.status_code for response in responses) == [200, 429]
    changed = next(response.json()["user"] for response in responses if response.status_code == 200)
    blocked = next(response for response in responses if response.status_code == 429)
    first_unlock = clock + cooldown
    assert changed["display_name_changes_remaining"] == 0
    assert changed["display_name_next_change_at"] == first_unlock
    assert blocked.json()["detail"] == {"code": "display_name_cooldown", "available_at": first_unlock}
    assert blocked.headers["Retry-After"] == str(cooldown)
    assert second.get("/auth/me").json()["user"] == changed
    assert change(first, changed["display_name"]).json()["user"] == changed

    clock = first_unlock - 1
    remaining = change(second, "Too early")
    assert remaining.status_code == 429
    assert remaining.headers["Retry-After"] == "1"

    clock = first_unlock
    afterward = change(second, "New name after two weeks")
    assert afterward.status_code == 200
    assert afterward.json()["user"]["display_name_next_change_at"] == clock + cooldown
    assert change(first, "Another immediate change").status_code == 429


def test_privacy_policy_and_google_oauth_flow(tmp_path, monkeypatch):
    from urllib.parse import parse_qs, urlparse

    import src.api as api_mod
    from src.config import config

    monkeypatch.setattr(config.paths, "app_db_path", tmp_path / "google_auth.db")
    monkeypatch.setattr(api_mod, "_user_db", None)
    monkeypatch.setattr(config, "google_client_id", "")
    monkeypatch.setattr(config, "google_client_secret", "")

    client = TestClient(app)

    # 1. Privacy policy page is publicly accessible
    priv = client.get("/privacy")
    assert priv.status_code == 200
    assert "Privacy Policy" in priv.text

    # 2. Unconfigured Google login reports disabled in /auth/me and 503 on /auth/google/login
    assert client.get("/auth/me").json()["google_login_enabled"] is False
    assert client.get("/auth/google/login", follow_redirects=False).status_code == 503

    # 3. Configure Google OAuth + mock token exchange and id_token verification
    monkeypatch.setattr(config, "google_client_id", "test-client-id.apps.googleusercontent.com")
    monkeypatch.setattr(config, "google_client_secret", "test-client-secret-value")
    monkeypatch.setattr(config, "google_redirect_uri", "http://testserver/auth/google/callback")
    assert client.get("/auth/me").json()["google_login_enabled"] is True

    login_res = client.get("/auth/google/login", follow_redirects=False)
    assert login_res.status_code == 302
    loc = urlparse(login_res.headers["location"])
    assert loc.netloc == "accounts.google.com"
    qs = parse_qs(loc.query)
    assert qs["client_id"] == ["test-client-id.apps.googleusercontent.com"]
    assert qs["code_challenge_method"] == ["S256"]
    oauth_state = qs["state"][0]
    assert len(oauth_state) >= 16

    # Tampered state must fail cleanly without creating session
    bad_cb = client.get(
        "/auth/google/callback?code=abc&state=wrong-state",
        follow_redirects=False,
    )
    assert bad_cb.status_code == 302
    assert "auth_error=invalid_state" in bad_cb.headers["location"]

    class _FakeTokenResp:
        status_code = 200

        def json(self):
            return {"id_token": "fake.jwt.token"}

    captured_token_post: dict = {}

    def _fake_httpx_post(url, data=None, timeout=None):
        captured_token_post["url"] = url
        captured_token_post["data"] = data
        return _FakeTokenResp()

    monkeypatch.setattr(api_mod.httpx, "post", _fake_httpx_post)
    monkeypatch.setattr(
        api_mod.google_id_token,
        "verify_oauth2_token",
        lambda token, req, aud, clock_skew_in_seconds=0: {
            "iss": "https://accounts.google.com",
            "aud": aud,
            "sub": "google-sub-12345",
            "email": "Coach.Alpha@gmail.com",
            "email_verified": True,
            "name": "Coach Alpha",
            "_skew": clock_skew_in_seconds,
        },
    )

    # Re-issue login to refresh state cookie after invalid_state cleared it
    login_res2 = client.get("/auth/google/login", follow_redirects=False)
    oauth_state2 = parse_qs(urlparse(login_res2.headers["location"]).query)["state"][0]

    cb_res = client.get(
        f"/auth/google/callback?code=auth-code-xyz&state={oauth_state2}",
        follow_redirects=False,
    )
    assert cb_res.status_code == 302
    assert cb_res.headers["location"] == "/"
    assert captured_token_post["data"]["code"] == "auth-code-xyz"
    assert len(captured_token_post["data"]["code_verifier"]) > 20

    me = client.get("/auth/me").json()
    assert me["authenticated"] is True
    assert me["user"]["username"] == "coach.alpha"
    assert me["user"]["display_name"] == "Coach Alpha"
    assert me["user"]["email"] == "coach.alpha@gmail.com"
    assert me["user"]["auth_provider"] == "google"
    assert me["user"]["display_label"] == "Coach"

    # Password login must never work against a Google-only account
    assert client.post("/auth/login", json={"username": "coach.alpha", "password": "!google-oauth"}).status_code == 401

    profile = {"user_id": me["user"]["id"], "display_name": "Coach"}
    assert client.put("/auth/profile", json=profile).json()["user"] == me["user"]
    profile["display_name"] = "Coach Mini Draft"
    assert client.put("/auth/profile", json=profile).status_code == 200
    client.post("/auth/logout")
    login_again = client.get("/auth/google/login", follow_redirects=False)
    state_again = parse_qs(urlparse(login_again.headers["location"]).query)["state"][0]
    assert (
        client.get(f"/auth/google/callback?code=again&state={state_again}", follow_redirects=False).status_code == 302
    )
    signed_in_again = client.get("/auth/me").json()["user"]
    assert signed_in_again == {
        **me["user"],
        "display_name": profile["display_name"],
        "display_name_is_custom": True,
        "display_label": profile["display_name"],
        "display_name_changes_remaining": 2,
    }

    # Unverified email must be rejected
    monkeypatch.setattr(
        api_mod.google_id_token,
        "verify_oauth2_token",
        lambda token, req, aud, clock_skew_in_seconds=0: {
            "iss": "https://accounts.google.com",
            "aud": aud,
            "sub": "google-sub-999",
            "email": "unverified@gmail.com",
            "email_verified": False,
        },
    )
    unauth_client = TestClient(app)
    r3 = unauth_client.get("/auth/google/login", follow_redirects=False)
    s3 = parse_qs(urlparse(r3.headers["location"]).query)["state"][0]
    cb_unverified = unauth_client.get(f"/auth/google/callback?code=c&state={s3}", follow_redirects=False)
    assert cb_unverified.status_code == 302
    assert "auth_error=email_unverified" in cb_unverified.headers["location"]
    assert unauth_client.get("/auth/me").json()["authenticated"] is False


def test_discord_oauth_flow(tmp_path, monkeypatch):
    from urllib.parse import parse_qs, urlparse

    import src.api as api_mod
    from src.config import config

    monkeypatch.setattr(config.paths, "app_db_path", tmp_path / "discord_auth.db")
    monkeypatch.setattr(api_mod, "_user_db", None)
    monkeypatch.setattr(config, "discord_client_id", "")
    monkeypatch.setattr(config, "discord_client_secret", "")

    client = TestClient(app)

    # 1. Unconfigured Discord reports disabled and returns 503 on login
    assert client.get("/auth/me").json()["discord_login_enabled"] is False
    assert client.get("/auth/discord/login", follow_redirects=False).status_code == 503

    # 2. Seed an existing Google user to verify verified vs unverified email linking rules
    db = api_mod.get_user_db()
    google_user = db.upsert_google_user("google-sub-seed", "shared.player@gmail.com", "Shared Player")

    # 3. Configure Discord OAuth and verify authorize redirect + PKCE
    monkeypatch.setattr(config, "discord_client_id", "123456789012345678")
    monkeypatch.setattr(config, "discord_client_secret", "discord-test-secret-xyz")
    monkeypatch.setattr(config, "discord_redirect_uri", "http://testserver/auth/discord/callback")
    assert client.get("/auth/me").json()["discord_login_enabled"] is True

    login_res = client.get("/auth/discord/login", follow_redirects=False)
    assert login_res.status_code == 302
    loc = urlparse(login_res.headers["location"])
    assert loc.netloc == "discord.com"
    qs = parse_qs(loc.query)
    assert qs["client_id"] == ["123456789012345678"]
    assert qs["code_challenge_method"] == ["S256"]
    assert qs["scope"] == ["identify email"]
    state_1 = qs["state"][0]

    # Tampered state must fail
    bad_cb = client.get("/auth/discord/callback?code=abc&state=bad", follow_redirects=False)
    assert bad_cb.status_code == 302
    assert "auth_error=discord_invalid_state" in bad_cb.headers["location"]

    class _FakeResp:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload

        def json(self):
            return self._payload

    # Unverified email on Discord must NOT hijack existing Google account
    monkeypatch.setattr(
        api_mod.httpx,
        "post",
        lambda url, data=None, headers=None, timeout=None: _FakeResp(200, {"access_token": "disc-tok-1"}),
    )
    monkeypatch.setattr(
        api_mod.httpx,
        "get",
        lambda url, headers=None, timeout=None: _FakeResp(
            200,
            {
                "id": "discord-uid-unverified",
                "username": "RoV.ScrimLead",
                "global_name": "Scrim Lead",
                "email": "shared.player@gmail.com",
                "verified": False,
            },
        ),
    )

    login_res2 = client.get("/auth/discord/login", follow_redirects=False)
    state_2 = parse_qs(urlparse(login_res2.headers["location"]).query)["state"][0]
    cb_res = client.get(f"/auth/discord/callback?code=disc-code&state={state_2}", follow_redirects=False)
    assert cb_res.status_code == 302
    assert cb_res.headers["location"] == "/"

    me = client.get("/auth/me").json()
    assert me["authenticated"] is True
    assert me["user"]["id"] != google_user.id
    assert me["user"]["username"] == "rov.scrimlead"
    assert me["user"]["display_name"] == "Scrim Lead"
    assert me["user"]["email"] is None
    assert me["user"]["auth_provider"] == "discord"

    # Verified matching email on Discord links cleanly to existing Google user
    client2 = TestClient(app)
    monkeypatch.setattr(
        api_mod.httpx,
        "get",
        lambda url, headers=None, timeout=None: _FakeResp(
            200,
            {
                "id": "discord-uid-verified",
                "username": "shared_disc",
                "global_name": "Shared Player",
                "email": "shared.player@gmail.com",
                "verified": True,
            },
        ),
    )
    login_res3 = client2.get("/auth/discord/login", follow_redirects=False)
    state_3 = parse_qs(urlparse(login_res3.headers["location"]).query)["state"][0]
    cb_linked = client2.get(f"/auth/discord/callback?code=disc-code-2&state={state_3}", follow_redirects=False)
    assert cb_linked.status_code == 302
    assert cb_linked.headers["location"] == "/"
    me2 = client2.get("/auth/me").json()
    assert me2["user"]["id"] == google_user.id
    assert me2["user"]["auth_provider"] == "discord"
    assert state_1 != state_2


def test_pricing_survey_endpoint_and_deduplication(tmp_path, monkeypatch):
    import sqlite3

    import src.api as api_mod
    from src.config import config

    db_file = tmp_path / "survey_test.db"
    monkeypatch.setattr(config.paths, "app_db_path", db_file)
    monkeypatch.setattr(api_mod._survey_rate_limiter, "max_attempts", 50)

    guest = TestClient(app)
    # Invalid choice or bad client_id rejected
    assert guest.post("/survey/pricing", json={"choice": "maybe", "client_id": "cid_12345678"}).status_code == 422
    assert guest.post("/survey/pricing", json={"choice": "willing", "client_id": "bad$id"}).status_code == 422

    # Guest submission persists once per client_id
    r_guest1 = guest.post("/survey/pricing", json={"choice": "not_willing", "client_id": "cid_guest_001"})
    assert r_guest1.status_code == 200
    assert r_guest1.json() == {"recorded": True, "choice": "not_willing"}
    assert "no-store" in r_guest1.headers.get("cache-control", "").lower()

    r_guest2 = guest.post("/survey/pricing", json={"choice": "willing", "client_id": "cid_guest_001"})
    assert r_guest2.status_code == 200

    # User A registers, sees pricing_survey_answered=False, then answers using same browser client_id
    user_a = TestClient(app)
    reg_a = user_a.post("/auth/register", json={"username": "survey_user_a", "password": "secret-pass-a"})
    assert reg_a.status_code == 201
    assert reg_a.json()["pricing_survey_answered"] is False
    assert reg_a.json()["pricing_survey_choice"] is None

    r_a = user_a.post("/survey/pricing", json={"choice": "willing", "client_id": "cid_guest_001"})
    assert r_a.status_code == 200
    me_a = user_a.get("/auth/me").json()
    assert me_a["pricing_survey_answered"] is True
    assert me_a["pricing_survey_choice"] == "willing"

    # User B sharing the same browser client_id stores an independent row without IntegrityError
    user_b = TestClient(app)
    reg_b = user_b.post("/auth/register", json={"username": "survey_user_b", "password": "secret-pass-b"})
    assert reg_b.status_code == 201
    r_b = user_b.post("/survey/pricing", json={"choice": "not_willing", "client_id": "cid_guest_001"})
    assert r_b.status_code == 200
    me_b = user_b.get("/auth/me").json()
    assert me_b["pricing_survey_answered"] is True
    assert me_b["pricing_survey_choice"] == "not_willing"

    with sqlite3.connect(db_file) as conn:
        rows = conn.execute(
            "SELECT user_id, client_id, choice, is_guest FROM pricing_survey_responses ORDER BY id ASC"
        ).fetchall()
    assert len(rows) == 2
    assert rows[0][2] == "willing"
    assert rows[0][3] == 0
    assert rows[1][1] is None
    assert rows[1][2] == "not_willing"
    assert rows[1][3] == 0

    # Non-admin and Guest receive 404 on /admin/stats, /admin/users, and /admin/analytics and is_admin=False
    assert guest.get("/admin/stats").status_code == 404
    assert guest.get("/admin/users").status_code == 404
    assert guest.get("/admin/analytics").status_code == 404
    assert user_a.get("/admin/stats").status_code == 404
    assert user_a.get("/admin/users").status_code == 404
    assert user_a.get("/admin/analytics").status_code == 404
    assert me_a["is_admin"] is False

    # Fail-closed by default: even username "chayanin5392" has no admin rights unless ROV_ADMIN_USERNAMES configures it
    monkeypatch.setattr(config, "admin_usernames", ())
    owner = TestClient(app)
    reg_owner = owner.post("/auth/register", json={"username": "chayanin5392", "password": "owner-secret-pass"})
    assert reg_owner.status_code == 201
    assert reg_owner.json()["is_admin"] is False
    assert owner.get("/admin/stats").status_code == 404
    assert owner.get("/admin/users").status_code == 404
    assert owner.get("/admin/analytics").status_code == 404

    # When configured via ROV_ADMIN_USERNAMES, owner receives is_admin=True and 200 on /admin/stats, /admin/users & /admin/analytics
    monkeypatch.setattr(config, "admin_usernames", ("chayanin5392",))
    assert owner.get("/auth/me").json()["is_admin"] is True
    assert user_a.put("/draft/session", json={"bluePicks": ["Hayate"], "updatedAt": 123456}).status_code == 200
    assert (
        user_a.post(
            "/predict",
            json={"mode": "pick", "side": "blue", "phase": 1, "ally_picks": ["Hayate"]},
        ).status_code
        == 200
    )
    assert (
        guest.post(
            "/predict",
            json={"mode": "pick", "side": "blue", "phase": 1, "ally_picks": ["Toro"]},
            headers={"X-Client-Id": "cid_guest_001"},
        ).status_code
        == 200
    )
    assert (
        guest.post(
            "/telemetry/event",
            json={
                "events": {"draft_completed_18": 1, "ai_adopt_top1": 2, "league_RPL": 1},
                "client_id": "cid_guest_001",
            },
        ).status_code
        == 200
    )
    assert guest.post("/telemetry/event", json={"events": {"draft_completed_18": 999}}).status_code == 422

    stats_res = owner.get("/admin/stats")
    assert stats_res.status_code == 200
    stats_body = stats_res.json()
    assert stats_body["users"]["total"] == 3
    assert stats_body["survey"]["total"] == 2
    assert stats_body["survey"]["willing_total"] == 1
    assert stats_body["survey"]["not_willing_total"] == 1
    assert stats_body["survey"]["willing_pct"] == 50.0

    users_res = owner.get("/admin/users")
    assert users_res.status_code == 200
    users_body = users_res.json()
    assert users_body["total_users"] == 3
    by_name = {u["username"]: u for u in users_body["users"]}
    assert by_name["survey_user_a"]["predict_calls"] == 1
    assert by_name["survey_user_a"]["draft_save_calls"] == 1
    assert by_name["survey_user_a"]["survey_choice"] == "willing"
    assert by_name["survey_user_b"]["survey_choice"] == "not_willing"

    analytics_res = owner.get("/admin/analytics")
    assert analytics_res.status_code == 200
    an = analytics_res.json()
    assert an["guest_vs_member_predicts"]["member"] == 1
    assert an["guest_vs_member_predicts"]["guest"] == 1
    assert an["feature_usage"]["draft_completed_18"] == 1
    assert an["feature_usage"]["leagues"]["RPL"] == 1
    assert an["ai_trust"]["top1_count"] == 2
    assert an["latency"]["total_requests"] == 2
    assert 0.0 <= an["usage_distribution"]["gini_coefficient"] <= 1.0
    assert "transitions" in an["markov_retention"]
    assert len(an["markov_retention"]["matrix_3x3"]) == 3
    assert "engaged" in an["bayesian_wtp"] and "casual" in an["bayesian_wtp"]
    assert "overall" in an["kaplan_meier_survival"]
    assert "segments" in an["btyd_alive"]
    assert "expected_alive_clients" in an["btyd_alive"]
    assert len(an["behavioral_signals"]) >= 5
    assert "latency_sla" in an["experiment_guardrails"]
    assert len(an["user_btyd_scores"]) == 3


def test_daily_visit_telemetry_and_retention_stats(tmp_path, monkeypatch):
    from datetime import datetime, timedelta, timezone

    import src.api as api_mod
    from src.config import config

    db_file = tmp_path / "retention_test.db"
    monkeypatch.setattr(config.paths, "app_db_path", db_file)
    monkeypatch.setattr(config, "admin_usernames", ("chayanin5392",))
    monkeypatch.setattr(api_mod._telemetry_rate_limiter, "max_attempts", 50)

    guest = TestClient(app)
    assert guest.post("/telemetry/visit", json={"client_id": "bad$id"}).status_code == 422

    # Same client_id visiting twice today counts only once
    r1 = guest.post("/telemetry/visit", json={"client_id": "cid_today_only"})
    r2 = guest.post("/telemetry/visit", json={"client_id": "cid_today_only"})
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["recorded"] is True
    today_str = r1.json()["visit_date"]

    # Seed yesterday's visits + a 3-day active regular + a >7d dormant returning client
    tz_th = timezone(timedelta(hours=7))
    now_th = datetime.now(tz_th)
    yesterday_str = (now_th - timedelta(days=1)).strftime("%Y-%m-%d")
    db = api_mod.get_user_db()
    db.record_daily_visit(client_id="cid_returning", user_id=None, visit_date_override=yesterday_str)
    db.record_daily_visit(client_id="cid_one_day", user_id=None, visit_date_override=yesterday_str)
    for offset in (3, 2, 1):
        db.record_daily_visit(
            client_id="cid_regular_3d",
            user_id=None,
            visit_date_override=(now_th - timedelta(days=offset)).strftime("%Y-%m-%d"),
        )
    for offset in (15, 14):
        db.record_daily_visit(
            client_id="cid_dormant_old",
            user_id=None,
            visit_date_override=(now_th - timedelta(days=offset)).strftime("%Y-%m-%d"),
        )

    owner = TestClient(app)
    reg = owner.post("/auth/register", json={"username": "chayanin5392", "password": "owner-secret-pass"})
    assert reg.status_code == 201
    r_ret = owner.post("/telemetry/visit", json={"client_id": "cid_returning"})
    assert r_ret.status_code == 200

    stats = owner.get("/admin/stats")
    assert stats.status_code == 200
    ret = stats.json()["retention"]
    assert ret["today_dau"] == 2
    assert ret["today_new"] == 1
    assert ret["today_returning"] == 1
    assert ret["total_tracked_clients"] == 5
    assert ret["returning_clients"] == 3
    assert ret["returning_pct"] == 60.0
    assert ret["active_returning_7d"] == 2
    assert ret["active_returning_7d_pct"] == 40.0
    assert ret["active_repeat_3plus_7d"] == 1
    assert ret["active_returned_once_7d"] == 1
    assert ret["dormant_returning"] == 1
    assert ret["d1_eligible"] == 4
    assert ret["d1_retained"] == 3
    assert ret["d1_pct"] == 75.0
    assert len(ret["daily_breakdown"]) == 6
    assert ret["daily_breakdown"][0]["date"] == today_str
    assert ret["daily_breakdown"][0]["new"] == 1
    assert ret["daily_breakdown"][0]["returning"] == 1

    # Verify auth_sessions lookup uses the composite (user_id, created_at) index instead of a full-table scan
    import sqlite3

    with sqlite3.connect(db_file) as conn:
        plan_rows = conn.execute(
            "EXPLAIN QUERY PLAN SELECT token_hash FROM auth_sessions WHERE user_id = ? "
            "ORDER BY created_at DESC, rowid DESC LIMIT 9",
            (1,),
        ).fetchall()
    plan_text = " ".join(str(r[-1]) for r in plan_rows).upper()
    assert "IDX_AUTH_SESSIONS_USER_CREATED" in plan_text
    assert "USE TEMP B-TREE" not in plan_text


def test_practice_clear_prevents_old_offline_resurrection_after_new_game(tmp_path, monkeypatch):
    """Clearing history then playing a new game must block an offline device's pre-clear game from returning."""
    import time

    from src.config import config

    monkeypatch.setattr(config.paths, "app_db_path", tmp_path / "clear_resurrect.db")
    device_a = TestClient(app)
    device_b = TestClient(app)
    creds = {"username": "clear_sync_user", "password": "secret-pass-123"}
    assert device_a.post("/auth/register", json=creds).status_code == 201
    assert device_b.post("/auth/login", json=creds).status_code == 200

    base_game = {
        "id": "p-old",
        "signature": "old|G1|blue|Valhein,Hayate,Toro,Krixi,Zuka|Tel'Annas,Yorn,Thane,Tulen,Butterfly|Murad|Florentino",
        "recordedAt": "2020-01-01T10:00:00Z",
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
    t0 = int(time.time() * 1000) - 5000
    assert device_a.put("/draft/practice-history", json={"entries": [base_game], "updatedAt": t0}).status_code == 200

    # Device A clears history, then records a brand-new post-clear game
    del_res = device_a.delete("/draft/practice-history")
    assert del_res.status_code == 200
    cleared_at = del_res.json()["clearedAt"]
    assert cleared_at > 0

    new_game = {
        **base_game,
        "id": "p-new",
        "signature": "new|G1|red|Tel'Annas,Yorn,Thane,Tulen,Butterfly|Valhein,Hayate,Toro,Krixi,Zuka|Florentino|Murad",
        "recordedAt": "2099-01-01T10:00:00Z",
        "playerSide": "red",
    }
    put_new = device_a.put("/draft/practice-history", json={"entries": [new_game], "updatedAt": cleared_at + 100})
    assert put_new.status_code == 200
    assert put_new.json()["clearedAt"] == cleared_at
    assert [e["id"] for e in put_new.json()["entries"]] == ["p-new"]

    # Device B comes back online and pushes its stale offline cache [p-old] with a newer wall clock
    res_b = device_b.put("/draft/practice-history", json={"entries": [base_game], "updatedAt": cleared_at + 500})
    assert res_b.status_code == 200
    assert res_b.json()["clearedAt"] == cleared_at
    assert [e["id"] for e in res_b.json()["entries"]] == ["p-new"]
    assert [e["id"] for e in device_a.get("/draft/practice-history").json()["entries"]] == ["p-new"]


def test_practice_merge_older_client_clock_bumps_server_revision(tmp_path):
    """Verify merging a new game with an older client updatedAt bumps stored updatedAt monotonically."""
    from src.db import UserDatabase

    db = UserDatabase(tmp_path / "merge_rev.db")
    user = db.register_user("sync_merge_user", "secret-pass-123")
    base_entry = {
        "id": "p-a",
        "signature": "sA|G1|blue|Valhein,Hayate,Toro,Krixi,Zuka|Tel'Annas,Yorn,Thane,Tulen,Butterfly|Murad|Florentino",
        "recordedAt": "2026-11-22T10:00:00Z",
        "gameNumber": 1,
        "gameCount": 1,
        "startingSide": "blue",
        "playerSide": "blue",
        "bluePicks": ["Valhein", "Hayate", "Toro", "Krixi", "Zuka"],
        "redPicks": ["Tel'Annas", "Yorn", "Thane", "Tulen", "Butterfly"],
        "blueBans": ["Murad"],
        "redBans": ["Florentino"],
        "playerEstimate": 52.0,
    }
    first = db.save_user_practice_history(
        user.id, {"entries": [base_entry], "updatedAt": 5_000_000_000_000}, 5_000_000_000_000
    )
    assert first["updatedAt"] == 5_000_000_000_000

    # Concurrent second device sends p-b with an older client clock (4_000_000_000_000 < 5_000_000_000_000)
    other_entry = {
        **base_entry,
        "id": "p-b",
        "signature": "sB|G1|red|Tel'Annas,Yorn,Thane,Tulen,Butterfly|Valhein,Hayate,Toro,Krixi,Zuka|Florentino|Murad",
        "recordedAt": "2026-11-22T10:05:00Z",
    }
    merged = db.save_user_practice_history(
        user.id, {"entries": [other_entry], "updatedAt": 4_000_000_000_000}, 4_000_000_000_000
    )
    assert {e["id"] for e in merged["entries"]} == {"p-a", "p-b"}
    assert merged["updatedAt"] > first["updatedAt"]


def test_predict_hero_pool_boost_and_strict_filter():
    off_meta_pool = ["Zanis", "Veera", "Butterfly"]

    # 1. Baseline without pool: off-meta heroes do not appear in Top 15
    base_res = client.post(
        "/predict",
        json={"mode": "pick", "side": "blue", "phase": 1, "top_k": 15},
    )
    assert base_res.status_code == 200
    base_recs = base_res.json()["recommendations"]
    base_names = [r["hero_name"] for r in base_recs]
    assert not (set(off_meta_pool) & set(base_names[:10]))

    # 2. Option A (pool_only=False): mixture prior lifts off-meta pool heroes into Top 15 without displacing #1 meta
    boosted_res = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "top_k": 15,
            "ally_pool": off_meta_pool,
            "pool_only": False,
        },
    )
    assert boosted_res.status_code == 200
    boosted_recs = boosted_res.json()["recommendations"]
    boosted_names = {r["hero_name"] for r in boosted_recs}
    assert set(off_meta_pool).issubset(boosted_names)
    assert boosted_recs[0]["hero_name"] == base_recs[0]["hero_name"]

    # 3. Option A in ban mode: enemy_pool surfaces off-meta signature picks for target banning
    ban_res = client.post(
        "/predict",
        json={
            "mode": "ban",
            "side": "blue",
            "phase": 1,
            "top_k": 15,
            "enemy_pool": off_meta_pool,
            "pool_only": False,
        },
    )
    assert ban_res.status_code == 200
    ban_names = {r["hero_name"] for r in ban_res.json()["recommendations"]}
    assert set(off_meta_pool).issubset(ban_names)

    # 4. Option B (pool_only=True): strictly returns available ally_pool heroes, falling back if exhausted
    strict_res = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "top_k": 10,
            "ally_pool": ["Zanis", "Veera"],
            "pool_only": True,
        },
    )
    assert strict_res.status_code == 200
    strict_names = [r["hero_name"] for r in strict_res.json()["recommendations"]]
    assert set(strict_names) == {"Zanis", "Veera"}

    exhausted_res = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_bans": ["Zanis"],
            "enemy_bans": ["Veera"],
            "top_k": 5,
            "ally_pool": ["Zanis", "Veera"],
            "pool_only": True,
        },
    )
    assert exhausted_res.status_code == 200
    assert len(exhausted_res.json()["recommendations"]) == 5


def test_pool_never_recommends_filled_lanes_and_respects_pool_lanes():
    bru_lanes = {
        "DS_Lane": ["Bijan", "Bolt Baron", "Omen", "Charlotte"],
        "Jungle": ["Amily", "Sephera", "Max", "Paine"],
        "Mid": ["Aya", "Heino", "Mganga", "Natalya"],
        "Dragon_Lane": ["Moren", "Laville", "Slimz", "Celica"],
        "Roam": ["Roxie", "Omega", "Ormarr", "Helen"],
    }
    bru_flat = [h for hs in bru_lanes.values() for h in hs]

    # 1. Partial Roam-only deficit with <5 Roam heroes in pool: MUST NOT pad rank #5 with filled lanes
    res_pick5 = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 2,
            "ally_picks": ["Omen", "Paine", "Heino", "Laville"],
            "enemy_picks": ["Hayate", "Thane", "Krixi", "Aoi", "Yena"],
            "top_k": 50,
            "ally_pool": bru_flat,
            "ally_pool_lanes": bru_lanes,
            "pool_only": True,
        },
    )
    assert res_pick5.status_code == 200
    d5 = res_pick5.json()
    assert d5["missing_ally_lanes"] == ["Roam (โรมมิ่ง)"]
    rec5 = [r["hero_name"] for r in d5["recommendations"]]
    assert set(rec5) == {"Roxie", "Omega", "Ormarr", "Helen"}

    # 2. All Roam heroes in pool are banned/unavailable: MUST fall back to open-lane Roam meta heroes, not filled DS/Mid
    res_exhausted_lane = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 2,
            "ally_picks": ["Omen", "Paine", "Heino", "Laville"],
            "enemy_picks": ["Hayate", "Thane", "Krixi", "Aoi", "Yena"],
            "ally_bans": ["Roxie", "Omega"],
            "enemy_bans": ["Ormarr", "Helen"],
            "top_k": 10,
            "ally_pool": bru_flat,
            "ally_pool_lanes": bru_lanes,
            "pool_only": True,
        },
    )
    assert res_exhausted_lane.status_code == 200
    assert all(r["primary_lane"] == "Roam" for r in res_exhausted_lane.json()["recommendations"])

    # 3. Custom Hero Pool lane mapping: Aya (Mid) picked + DS/ADL/Roam picked -> Sephera (Jungle in pool) is still eligible
    res_flex_pool = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 2,
            "ally_picks": ["Omen", "Aya", "Laville", "Helen"],
            "enemy_picks": ["Hayate", "Thane", "Krixi", "Aoi", "Yena"],
            "top_k": 50,
            "ally_pool": bru_flat,
            "ally_pool_lanes": bru_lanes,
            "pool_only": True,
        },
    )
    assert res_flex_pool.status_code == 200
    d_flex = res_flex_pool.json()
    assert d_flex["missing_ally_lanes"] == ["Jungle (ป่า)"]
    assert set(r["hero_name"] for r in d_flex["recommendations"]) == {"Amily", "Sephera", "Max", "Paine"}

    # 4. Option A (pool_only=False): filled-lane pool hero (Veera Mid when Krixi already picked) must NOT enter Top 5
    res_opt_a = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_picks": ["Krixi", "Nakroth", "Hayate", "Florentino"],
            "enemy_picks": ["Omen", "Keera", "Iggy", "Violet", "Thane"],
            "top_k": 50,
            "ally_pool": ["Veera", "Iggy", "Raz", "Krizzix"],
            "pool_only": False,
        },
    )
    assert res_opt_a.status_code == 200
    top5_opt_a = [r["hero_name"] for r in res_opt_a.json()["recommendations"][:5]]
    assert "Veera" not in top5_opt_a and "Iggy" not in top5_opt_a

    # 5. Rouie saved in Roam pool + Krixi (Mid) -> both Mid & Roam marked covered
    res_rouie = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_picks": ["Rouie", "Krixi"],
            "enemy_picks": ["Hayate", "Thane"],
            "top_k": 10,
            "ally_pool": ["Rouie", "Krixi", "Florentino", "Nakroth", "Elsu"],
            "ally_pool_lanes": {
                "Roam": ["Rouie"],
                "Mid": ["Krixi"],
                "DS_Lane": ["Florentino"],
                "Jungle": ["Nakroth"],
                "Dragon_Lane": ["Elsu"],
            },
            "pool_only": True,
        },
    )
    assert res_rouie.status_code == 200
    d_rouie = res_rouie.json()
    assert set(d_rouie["missing_ally_lanes"]) == {"DS_Lane (ออฟเลน)", "Jungle (ป่า)", "Dragon_Lane (แครี่)"}
    assert set(r["hero_name"] for r in d_rouie["recommendations"]) == {"Florentino", "Nakroth", "Elsu"}

    # 6. pool_mode='off' produces exact pure-meta recommendations identical to omitting Hero Pool fields
    pure_base = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_picks": ["Rouie"],
            "enemy_picks": ["Hayate", "Thane"],
            "top_k": 10,
        },
    ).json()
    off_mode = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_picks": ["Rouie"],
            "enemy_picks": ["Hayate", "Thane"],
            "top_k": 10,
            "ally_pool": bru_flat,
            "ally_pool_lanes": bru_lanes,
            "pool_mode": "off",
        },
    ).json()
    assert off_mode["missing_ally_lanes"] == pure_base["missing_ally_lanes"]
    assert [(r["hero_name"], r["probability_pct"]) for r in off_mode["recommendations"]] == [
        (r["hero_name"], r["probability_pct"]) for r in pure_base["recommendations"]
    ]

    # 7. pool_mode='high' in ban mode restricts strictly to available enemy_pool heroes, with graceful fallback if exhausted
    ban_high = client.post(
        "/predict",
        json={
            "mode": "ban",
            "side": "blue",
            "phase": 1,
            "top_k": 10,
            "enemy_pool": ["Toro", "Lorion", "Florentino"],
            "pool_mode": "high",
        },
    )
    assert ban_high.status_code == 200
    assert {r["hero_name"] for r in ban_high.json()["recommendations"]} == {"Toro", "Lorion", "Florentino"}

    ban_high_exhausted = client.post(
        "/predict",
        json={
            "mode": "ban",
            "side": "blue",
            "phase": 1,
            "ally_bans": ["Toro", "Lorion"],
            "enemy_bans": ["Florentino"],
            "top_k": 5,
            "enemy_pool": ["Toro", "Lorion", "Florentino"],
            "pool_mode": "high",
        },
    )
    assert ban_high_exhausted.status_code == 200
    assert len(ban_high_exhausted.json()["recommendations"]) == 5


def test_draft_session_delete_beats_future_client_clock(tmp_path, monkeypatch):
    import time

    from src.config import config

    monkeypatch.setattr(config.paths, "app_db_path", tmp_path / "clock_skew.db")
    monkeypatch.setattr("src.api._user_db", None)

    skew_client = TestClient(app)
    assert (
        skew_client.post(
            "/auth/register", json={"username": "skewuser", "password": "CorrectHorseBattery!99"}
        ).status_code
        == 201
    )
    future_ts = int(time.time() * 1000) + 86_400_000
    put_res = skew_client.put(
        "/draft/session",
        json={
            "stepIndex": 1,
            "blueBans": ["Toro"],
            "updatedAt": future_ts,
        },
    )
    assert put_res.status_code == 200
    assert put_res.json()["blueBans"] == ["Toro"]

    del_res = skew_client.delete("/draft/session")
    assert del_res.status_code == 200
    assert del_res.json()["updatedAt"] > future_ts

    get_res = skew_client.get("/draft/session")
    assert get_res.status_code == 200
    assert get_res.json()["blueBans"] == []
    assert get_res.json()["updatedAt"] == del_res.json()["updatedAt"]


def test_ally_pool_lanes_inner_list_bounded():
    res = client.post(
        "/predict",
        json={
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_pool_lanes": {"Mid": [f"Hero{i}" for i in range(131)]},
        },
    )
    assert res.status_code == 422
