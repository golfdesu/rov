import json

import pandas as pd

from src.config import config


def test_heroes_130_completeness():
    assert config.paths.heroes_json_path.exists()
    assert config.paths.heroes_csv_path.exists()

    with open(config.paths.heroes_json_path, "r", encoding="utf-8") as f:
        heroes = json.load(f)

    assert len(heroes) == 130
    names = {h["name"] for h in heroes}
    for must_have in [
        "Evita",
        "Tamyn",
        "Flowborn (Marksman)",
        "Flowborn (Mage)",
        "Dyadia",
        "Goverra",
        "Heino",
        "Billow",
    ]:
        assert must_have in names, f"Missing hero: {must_have}"

    for h in heroes:
        assert len(h.get("skills", [])) >= 4, f"Hero {h['name']} has < 4 skills"


def test_matches_draft_integrity():
    assert config.paths.matches_json_path.exists()
    with open(config.paths.matches_json_path, "r", encoding="utf-8") as f:
        matches = json.load(f)

    assert len(matches) >= 4000
    heroes_df = pd.read_csv(config.paths.heroes_csv_path)
    valid_names = set(heroes_df["name"].tolist())

    for g in matches[:200]:
        assert len(g["blue_picks"]) == 5
        assert len(g["red_picks"]) == 5
        assert 1 <= len(g["blue_bans"]) <= 4
        assert 1 <= len(g["red_bans"]) <= 4
        for h in g["blue_picks"] + g["red_picks"] + g["blue_bans"] + g["red_bans"]:
            assert h in valid_names, f"Unmapped hero in match data: {h}"
