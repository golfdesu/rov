"""Apply in-game Level 1 base stats (data/hero_status_lv1.json) to the hero catalogs.

Updates base_stats and attack_range in heroes_130_full.json, then rebuilds the Level 1-15
table in hero_level_stats.json/.csv from the new Level 1 values. Heroes with a Level 15
screenshot (data/hero_status_lv15.json) get their own measured growth; the rest use the
class growth rates of their primary_role.
"""

import csv
import json
from pathlib import Path

from build_hero_level_stats import CLASS_GROWTH_RATES, get_hero_primary_class

ROOT = Path(__file__).resolve().parent.parent
STATUS_FILE = ROOT / "data" / "hero_status_lv1.json"
STATUS_LV15_FILE = ROOT / "data" / "hero_status_lv15.json"
HEROES_FILE = ROOT / "data" / "heroes_130_full.json"
LEVEL_JSON = ROOT / "data" / "hero_level_stats.json"
LEVEL_CSV = ROOT / "data" / "hero_level_stats.csv"
MAX_LEVEL = 15
GROWTH_FIELDS = {
    "hp_growth": ("max_hp", "hp"),
    "armor_growth": ("armor", "armor"),
    "ad_growth": ("attack_damage", "attack_damage"),
    "mdef_growth": ("magic_defense", "magic_defense"),
}


def measured_growth(base, lv15):
    return {g: (lv15[key15] - base[key1]) / (MAX_LEVEL - 1) for g, (key1, key15) in GROWTH_FIELDS.items()}


def main():
    status = json.loads(STATUS_FILE.read_text(encoding="utf-8"))["heroes"]
    status_lv15 = json.loads(STATUS_LV15_FILE.read_text(encoding="utf-8"))["heroes"]
    heroes = json.loads(HEROES_FILE.read_text(encoding="utf-8"))
    level_doc = json.loads(LEVEL_JSON.read_text(encoding="utf-8"))
    catalog = level_doc["heroes"]

    names = {h["name"] for h in heroes}
    if names != set(status) or names != set(catalog):
        raise SystemExit(f"Hero sets differ: {sorted(names ^ set(status))} {sorted(names ^ set(catalog))}")

    for hero in heroes:
        s = status[hero["name"]]
        hero["base_stats"] = {
            "max_hp": s["hp"],
            "armor": s["armor"],
            "magic_defense": s["magic_defense"],
            "attack_damage": s["attack_damage"],
            "movement_speed": int(s["movement_speed"]),
        }
        hero["attack_range"] = s["attack_range"]

    csv_rows = []
    for hero in heroes:
        name = hero["name"]
        entry = catalog[name]
        base = hero["base_stats"]
        entry["primary_class"] = get_hero_primary_class(hero)
        if name in status_lv15:
            growth = measured_growth(base, status_lv15[name])
            entry["growth_source"] = "measured_lv15"
        else:
            growth = CLASS_GROWTH_RATES[entry["primary_class"]]
            entry["growth_source"] = "class_estimate"
        entry["growth_rates"] = growth
        levels = {}
        for lvl in range(1, MAX_LEVEL + 1):
            step = lvl - 1
            row = {
                "level": lvl,
                "hp": int(round(base["max_hp"] + step * growth["hp_growth"])),
                "armor": int(round(base["armor"] + step * growth["armor_growth"])),
                "magic_defense": int(round(base["magic_defense"] + step * growth["mdef_growth"])),
                "attack_damage": int(round(base["attack_damage"] + step * growth["ad_growth"])),
                "movement_speed": base["movement_speed"],
            }
            levels[str(lvl)] = row
            csv_rows.append({"hero": name, "class": entry["primary_class"], **row})
        entry["base_stats"] = base
        entry["levels"] = levels

    HEROES_FILE.write_text(json.dumps(heroes, ensure_ascii=False, indent=2), encoding="utf-8")
    LEVEL_JSON.write_text(json.dumps(level_doc, ensure_ascii=False, indent=2), encoding="utf-8")
    fieldnames = ["hero", "level", "class", "hp", "armor", "magic_defense", "attack_damage", "movement_speed"]
    with open(LEVEL_CSV, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(csv_rows)
    print(f"Applied in-game Level 1 stats to {len(heroes)} heroes ({len(csv_rows)} level rows)")


if __name__ == "__main__":
    main()
