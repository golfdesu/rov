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


def test_items_catalog():
    assert config.paths.items_json_path.exists()
    with open(config.paths.items_json_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    items = catalog["items"]
    assert catalog["count"] == len(items) >= 100
    assert len({i["slug"] for i in items}) == len(items), "Duplicate item slugs"
    assert sum(1 for i in items if i["tier"] == 3) >= 50

    units = catalog["stat_units"]
    for i in items:
        for key, value in i["stats"].items():
            assert key in units, f"{i['name']}: unknown stat {key}"
            assert value > 0, f"{i['name']}: non-positive {key}"

    by_name = {i["name"]: i for i in items}
    assert by_name["Fenrir's Tooth"]["stats"]["attack_damage"] == 180
    assert by_name["Boots of Speed"]["stats"]["movement_speed"] == 30

    # Patch-note overrides (data/items_overrides.json) must be applied on top of rovmeta
    assert by_name["Stealth Bracer"]["patch"] == "Beta 55"
    assert by_name["Light Shield"]["stats"]["max_hp"] == 1000
    assert by_name["Mail of Pain"]["stats"] == {"armor": 300, "attack_damage": 50, "max_hp": 700}
    assert by_name["Carano's Vow"]["stats"] == {"ability_power": 180, "magic_life_steal": 12, "movement_speed_pct": 5}


def test_hero_patch_history():
    assert config.paths.hero_patch_history_path.exists()
    with open(config.paths.hero_patch_history_path, "r", encoding="utf-8") as f:
        history = json.load(f)

    changes = history.get("changes", [])
    assert len(changes) >= 300
    assert history.get("heroes", 0) >= 90

    import re

    cjk_re = re.compile(r"[一-鿿]")
    for c in changes:
        for field in ("hero", "skill", "field", "before", "after"):
            val = c.get(field)
            assert not (val and cjk_re.search(val)), f"Untranslated CJK in {c['hero']} {c['skill']} {field}: {val}"


def test_hero_level_stats():
    assert config.paths.hero_level_stats_json_path.exists()
    assert config.paths.hero_level_stats_csv_path.exists()

    with open(config.paths.hero_level_stats_json_path, "r", encoding="utf-8") as f:
        stats_data = json.load(f)

    heroes_dict = stats_data.get("heroes", {})
    assert len(heroes_dict) == 130, f"Expected 130 heroes, got {len(heroes_dict)}"
    assert stats_data.get("levels_count") == 15

    df = pd.read_csv(config.paths.hero_level_stats_csv_path)
    assert len(df) == 130 * 15 == 1950

    for name, data in heroes_dict.items():
        assert "base_stats" in data
        assert "growth_rates" in data
        levels = data["levels"]
        assert len(levels) == 15

        lv1 = levels["1"]
        lv15 = levels["15"]
        assert 2000 <= lv1["hp"] <= 5000, f"{name}: invalid Lv.1 HP {lv1['hp']}"
        assert lv15["hp"] > lv1["hp"], f"{name}: Lv.15 HP {lv15['hp']} not > Lv.1 HP {lv1['hp']}"
        assert lv15["armor"] > lv1["armor"], f"{name}: Armor does not scale"
        assert lv15["attack_damage"] > lv1["attack_damage"], f"{name}: AD does not scale"
        assert lv1["movement_speed"] >= 340, f"{name}: Speed too low"


def test_arcana_catalog():
    assert config.paths.arcana_json_path.exists()
    with open(config.paths.arcana_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    arcana = data.get("arcana", [])
    assert len(arcana) == 90
    assert data.get("count") == 90

    colors = {a["color"] for a in arcana}
    assert colors == {"Red", "Purple", "Green"}

    for a in arcana:
        assert a["tier"] in (1, 2, 3)
        assert len(a["stats"]) >= 1
        for stat_name, stat_val in a["stats"].items():
            assert stat_val > 0, f"{a['name']}: non-positive {stat_name}"


def test_enchantments_catalog():
    assert config.paths.enchantments_json_path.exists()
    with open(config.paths.enchantments_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    enchantments = data.get("enchantments", [])
    assert len(enchantments) >= 25
    factions = {e["faction"] for e in enchantments}
    assert "Veda" in factions
    assert "Lokheim" in factions
    assert "Afata" in factions
    assert "League of Humans" in factions

    for e in enchantments:
        assert e["name"]
        assert len(e["description"]) >= 10
