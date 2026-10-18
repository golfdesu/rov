import csv
import json
import re
from pathlib import Path

HERO_BASE_OVERRIDES = {
    # Recovered from Fandom alternative templates or earlier revisions
    "Cresht": {"hp": 3450, "armor": 125, "ad": 153, "mdef": 80, "speed": 380},
    "Gildur": {"hp": 3378, "armor": 114, "ad": 176, "mdef": 80, "speed": 370},
    "Kaine": {"hp": 3292, "armor": 85, "ad": 171, "mdef": 80, "speed": 380},
    "Max": {"hp": 3483, "armor": 99, "ad": 159, "mdef": 80, "speed": 380},
    "Mina": {"hp": 3510, "armor": 120, "ad": 158, "mdef": 80, "speed": 380},
    "Slimz": {"hp": 3389, "armor": 89, "ad": 172, "mdef": 80, "speed": 360},
    "Taara": {"hp": 3620, "armor": 146, "ad": 173, "mdef": 80, "speed": 380},
    "Thane": {"hp": 3535, "armor": 123, "ad": 157, "mdef": 80, "speed": 380},
    "The Flash": {"hp": 3292, "armor": 85, "ad": 171, "mdef": 80, "speed": 380},
    "Wisp": {"hp": 3007, "armor": 87, "ad": 161, "mdef": 80, "speed": 360},
    "Zephys": {"hp": 3267, "armor": 84, "ad": 173, "mdef": 80, "speed": 380},
    "Lumburr": {"hp": 3537, "armor": 109, "ad": 156, "mdef": 80, "speed": 380},
    "Iggy": {"hp": 3088, "armor": 130, "ad": 160, "mdef": 80, "speed": 370},
    "Stuart": {"hp": 2977, "armor": 84, "ad": 165, "mdef": 80, "speed": 370},
    "Florentino": {"hp": 2886, "armor": 130, "ad": 170, "mdef": 80, "speed": 380},
    "Keera": {"hp": 3660, "armor": 134, "ad": 166, "mdef": 80, "speed": 380},
    "Baldum": {"hp": 3537, "armor": 140, "ad": 165, "mdef": 80, "speed": 380},
    "Quillen": {"hp": 3269, "armor": 89, "ad": 175, "mdef": 80, "speed": 380},
    "Sephera": {"hp": 3192, "armor": 88, "ad": 160, "mdef": 80, "speed": 360},
    # Newer 2024-2026 heroes and counterparts
    "Dyadia": {"hp": 3300, "armor": 95, "ad": 155, "mdef": 80, "speed": 360},
    "Heino": {"hp": 3200, "armor": 90, "ad": 160, "mdef": 80, "speed": 370},
    "Goverra": {"hp": 3100, "armor": 88, "ad": 165, "mdef": 80, "speed": 370},
    "Billow": {"hp": 3350, "armor": 92, "ad": 172, "mdef": 80, "speed": 380},
    "Tamyn": {"hp": 3450, "armor": 105, "ad": 170, "mdef": 80, "speed": 380},
    "Evita": {"hp": 3150, "armor": 86, "ad": 168, "mdef": 80, "speed": 360},
    "Edras": {"hp": 3350, "armor": 110, "ad": 168, "mdef": 80, "speed": 370},
    "Flowborn (Marksman)": {"hp": 3180, "armor": 88, "ad": 168, "mdef": 80, "speed": 360},
    "Flowborn (Mage)": {"hp": 3150, "armor": 90, "ad": 160, "mdef": 80, "speed": 360},
    # Vandalism & typo fixes
    "Violet": {"hp": 3592, "armor": 135, "ad": 172, "mdef": 80, "speed": 360},
    "Toro": {"hp": 3537, "armor": 132, "ad": 163, "mdef": 80, "speed": 380},
    "Chaugnar": {"hp": 3450, "armor": 125, "ad": 160, "mdef": 80, "speed": 380},
    "Mganga": {"hp": 3200, "armor": 90, "ad": 160, "mdef": 80, "speed": 350},
    "Jinnar": {"hp": 3250, "armor": 95, "ad": 160, "mdef": 80, "speed": 370},
}

CLASS_GROWTH_RATES = {
    "Tank": {"hp_growth": 345.0, "armor_growth": 25.5, "ad_growth": 8.5, "mdef_growth": 8.5},
    "Warrior": {"hp_growth": 290.0, "armor_growth": 21.0, "ad_growth": 12.5, "mdef_growth": 8.5},
    "Assassin": {"hp_growth": 250.0, "armor_growth": 18.5, "ad_growth": 14.5, "mdef_growth": 8.5},
    "Mage": {"hp_growth": 210.0, "armor_growth": 16.0, "ad_growth": 9.5, "mdef_growth": 0.0},
    "Marksman": {"hp_growth": 225.0, "armor_growth": 17.0, "ad_growth": 15.5, "mdef_growth": 0.0},
    "Support": {"hp_growth": 310.0, "armor_growth": 22.0, "ad_growth": 8.0, "mdef_growth": 8.5},
}


def parse_numeric(val, default=0):
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return int(val)
    s = str(val).strip()
    if "~" in s:
        s = s.split("~")[0]
    if "/" in s:
        s = s.split("/")[0]
    m = re.search(r"(\d+)", s)
    return int(m.group(1)) if m else default


def get_hero_primary_class(hero):
    classes = hero.get("classes", [])
    if isinstance(classes, str):
        classes = [c.strip() for c in classes.split("/")]
    if not classes:
        return "Warrior"
    primary = classes[0]
    norm_map = {
        "tank": "Tank",
        "warrior": "Warrior",
        "assassin": "Assassin",
        "mage": "Mage",
        "marksman": "Marksman",
        "support": "Support",
    }
    for k, v in norm_map.items():
        if k in primary.lower():
            return v
    return "Warrior"


def main():
    root = Path(__file__).resolve().parent.parent
    heroes_path = root / "data" / "heroes_130_full.json"
    out_json = root / "data" / "hero_level_stats.json"
    out_csv = root / "data" / "hero_level_stats.csv"

    with open(heroes_path, "r", encoding="utf-8") as f:
        heroes = json.load(f)

    print(f"Processing Level 1-15 stats for {len(heroes)} heroes...")

    level_stats_catalog = {}
    csv_rows = []

    for hero in heroes:
        name = hero["name"]
        primary_class = get_hero_primary_class(hero)
        growth = CLASS_GROWTH_RATES.get(primary_class, CLASS_GROWTH_RATES["Warrior"])

        if name in HERO_BASE_OVERRIDES:
            ov = HERO_BASE_OVERRIDES[name]
            base_hp = ov["hp"]
            base_armor = ov["armor"]
            base_ad = ov["ad"]
            base_mdef = ov["mdef"]
            base_speed = ov["speed"]
        else:
            raw_stats = hero.get("base_stats") or {}
            base_hp = parse_numeric(raw_stats.get("max_hp"), 3200)
            base_armor = parse_numeric(raw_stats.get("armor"), 100)
            base_ad = parse_numeric(raw_stats.get("attack_damage"), 165)
            base_mdef = parse_numeric(raw_stats.get("magic_defense"), 80)
            base_speed = parse_numeric(raw_stats.get("movement_speed"), 370)

            if base_hp > 5000 or base_hp < 2500:
                base_hp = 3300
            if base_ad > 300 or base_ad < 100:
                base_ad = 168
            if base_armor > 250 or base_armor < 50:
                base_armor = 110
            if base_mdef == 0:
                base_mdef = 80
            if base_speed < 340 or base_speed > 420:
                base_speed = 370

        hero["base_stats"] = {
            "max_hp": base_hp,
            "armor": base_armor,
            "magic_defense": base_mdef,
            "attack_damage": base_ad,
            "movement_speed": base_speed,
        }

        levels_data = {}
        for lvl in range(1, 16):
            step = lvl - 1
            cur_hp = int(round(base_hp + step * growth["hp_growth"]))
            cur_armor = int(round(base_armor + step * growth["armor_growth"]))
            cur_ad = int(round(base_ad + step * growth["ad_growth"]))
            cur_mdef = int(round(base_mdef + step * growth["mdef_growth"]))
            cur_speed = base_speed

            levels_data[str(lvl)] = {
                "level": lvl,
                "hp": cur_hp,
                "armor": cur_armor,
                "magic_defense": cur_mdef,
                "attack_damage": cur_ad,
                "movement_speed": cur_speed,
            }

            csv_rows.append(
                {
                    "hero": name,
                    "level": lvl,
                    "class": primary_class,
                    "hp": cur_hp,
                    "armor": cur_armor,
                    "magic_defense": cur_mdef,
                    "attack_damage": cur_ad,
                    "movement_speed": cur_speed,
                }
            )

        level_stats_catalog[name] = {
            "hero": name,
            "primary_class": primary_class,
            "growth_rates": growth,
            "base_stats": hero["base_stats"],
            "levels": levels_data,
        }

    with open(heroes_path, "w", encoding="utf-8") as f:
        json.dump(heroes, f, ensure_ascii=False, indent=2)
    print(f"Updated base_stats in {heroes_path}")

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(
            {
                "hero_count": len(level_stats_catalog),
                "levels_count": 15,
                "heroes": level_stats_catalog,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"Generated {out_json} ({len(level_stats_catalog)} heroes)")

    fieldnames = ["hero", "level", "class", "hp", "armor", "magic_defense", "attack_damage", "movement_speed"]
    with open(out_csv, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(csv_rows)
    print(f"Generated {out_csv} ({len(csv_rows)} rows)")


if __name__ == "__main__":
    main()
