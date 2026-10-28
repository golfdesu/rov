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
