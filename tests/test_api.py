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


def test_web_ui_served():
    response = client.get("/")
    assert response.status_code == 200
    assert "RoV Draft Assistant" in response.text


def test_web_static_assets_served():
    assert client.get("/app.js").status_code == 200
    assert client.get("/styles.css").status_code == 200
    assert client.get("/manifest.webmanifest").status_code == 200


def test_api_routes_not_shadowed_by_static_mount():
    assert client.get("/health").json()["status"] == "healthy"
    assert len(client.get("/heroes").json()["heroes"]) == 130


def test_hero_images_served():
    response = client.get("/hero_images.json")
    assert response.status_code == 200
    images = response.json()
    assert len(images) > 100
    assert all(url.startswith("https://") for url in images.values())


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
