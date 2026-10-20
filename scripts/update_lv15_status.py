import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATUS_LV15_FILE = ROOT / "data" / "hero_status_lv15.json"
HEROES_FILE = ROOT / "data" / "heroes_130_full.json"

new_entries = {
    "Teeri": {
        "hp": 7326,
        "attack_damage": 380,
        "armor": 419,
        "magic_defense": 269,
        "movement_speed": 360,
        "source": "heroes/LINE_ALBUM_Lv15_261020_51.jpg",
    },
    "Bonnie": {
        "hp": 6844,
        "attack_damage": 296,
        "armor": 425,
        "magic_defense": 269,
        "movement_speed": 360,
        "source": "heroes/LINE_ALBUM_Lv15_261020_52.jpg",
    },
    "Sephera": {
        "hp": 6492,
        "attack_damage": 297,
        "armor": 381,
        "magic_defense": 269,
        "movement_speed": 360,
        "source": "heroes/LINE_ALBUM_Lv15_261020_53.jpg",
    },
    "Rourke": {
        "hp": 8160,
        "attack_damage": 363,
        "armor": 476,
        "magic_defense": 269,
        "movement_speed": 380,
        "source": "heroes/LINE_ALBUM_Lv15_261020_54.jpg",
    },
    "Ata": {
        "hp": 8410,
        "attack_damage": 293,
        "armor": 474,
        "magic_defense": 269,
        "movement_speed": 380,
        "source": "heroes/LINE_ALBUM_Lv15_261020_55.jpg",
    },
    "Wisp": {
        "hp": 7095,
        "attack_damage": 406,
        "armor": 435,
        "magic_defense": 269,
        "movement_speed": 360,
        "source": "heroes/LINE_ALBUM_Lv15_261020_56.jpg",
    },
    "Flowborn (Marksman)": {
        "hp": 7140,
        "attack_damage": 415,
        "armor": 444,
        "magic_defense": 269,
        "movement_speed": 360,
        "source": "heroes/LINE_ALBUM_Lv15_261020_57.jpg",
    },
    "Ming": {
        "hp": 8315,
        "attack_damage": 297,
        "armor": 450,
        "magic_defense": 269,
        "movement_speed": 370,
        "source": "heroes/LINE_ALBUM_Lv15_261020_59.jpg",
    },
    "Dolia": {
        "hp": 7140,
        "attack_damage": 330,
        "armor": 420,
        "magic_defense": 269,
        "movement_speed": 360,
        "source": "heroes/LINE_ALBUM_Lv15_261020_60.jpg",
    },
    "Ormarr": {
        "hp": 8970,
        "attack_damage": 332,
        "armor": 494,
        "magic_defense": 269,
        "movement_speed": 380,
        "source": "heroes/LINE_ALBUM_Lv15_261020_61.jpg",
    },
    "Biron": {
        "hp": 8400,
        "attack_damage": 385,
        "armor": 490,
        "magic_defense": 269,
        "movement_speed": 390,
        "source": "heroes/LINE_ALBUM_Lv15_261020_62.jpg",
    },
    "Kahlii": {
        "hp": 6731,
        "attack_damage": 314,
        "armor": 390,
        "magic_defense": 269,
        "movement_speed": 350,
        "source": "heroes/LINE_ALBUM_Lv15_261020_63.jpg",
    },
    "Ilumia": {
        "hp": 6487,
        "attack_damage": 297,
        "armor": 443,
        "magic_defense": 269,
        "movement_speed": 350,
        "source": "heroes/LINE_ALBUM_Lv15_261020_64.jpg",
    },
    "Brunhilda": {
        "hp": 7002,
        "attack_damage": 417,
        "armor": 408,
        "magic_defense": 269,
        "movement_speed": 350,
        "source": "heroes/LINE_ALBUM_Lv15_261020_65.jpg",
    },
    "Moren": {
        "hp": 7272,
        "attack_damage": 396,
        "armor": 441,
        "magic_defense": 269,
        "movement_speed": 360,
        "source": "heroes/LINE_ALBUM_Lv15_261020_66.jpg",
    },
    "Dyadia": {
        "hp": 7205,
        "attack_damage": 330,
        "armor": 421,
        "magic_defense": 269,
        "movement_speed": 360,
        "source": "heroes/LINE_ALBUM_Lv15_261020_67.jpg",
    },
    "Heino": {
        "hp": 7600,
        "attack_damage": 375,
        "armor": 444,
        "magic_defense": 269,
        "movement_speed": 370,
        "source": "heroes/LINE_ALBUM_Lv15_261020_68.jpg",
    },
    "Preyta": {
        "hp": 6659,
        "attack_damage": 317,
        "armor": 437,
        "magic_defense": 269,
        "movement_speed": 380,
        "source": "heroes/LINE_ALBUM_Lv15_261020_69.jpg",
    },
    "Arum": {
        "hp": 8929,
        "attack_damage": 286,
        "armor": 455,
        "magic_defense": 269,
        "movement_speed": 360,
        "source": "heroes/LINE_ALBUM_Lv15_261020_70.jpg",
    },
    "Evita": {
        "hp": 6871,
        "attack_damage": 287,
        "armor": 425,
        "magic_defense": 269,
        "movement_speed": 350,
        "source": "heroes/LINE_ALBUM_Lv15_261020_71.jpg",
    },
    "Flowborn (Mage)": {
        "hp": 7310,
        "attack_damage": 300,
        "armor": 444,
        "magic_defense": 269,
        "movement_speed": 360,
        "source": "heroes/LINE_ALBUM_Lv15_261020_72.jpg",
    },
    "Cresht": {
        "hp": 9601,
        "attack_damage": 301,
        "armor": 585,
        "magic_defense": 269,
        "movement_speed": 380,
        "source": "heroes/LINE_ALBUM_Lv15_261020_73.jpg",
    },
    "Azzen'Ka": {
        "hp": 6844,
        "attack_damage": 296,
        "armor": 425,
        "magic_defense": 269,
        "movement_speed": 360,
        "source": "heroes/LINE_ALBUM_Lv15_261020_74.jpg",
    },
    "Arthur": {
        "hp": 9260,
        "attack_damage": 346,
        "armor": 500,
        "magic_defense": 269,
        "movement_speed": 390,
        "source": "heroes/LINE_ALBUM_Lv15_261020_75.jpg",
    },
}


def main():
    with open(HEROES_FILE, encoding="utf-8") as f:
        heroes = {h["name"] for h in json.load(f)}

    for name in new_entries:
        assert name in heroes, f"Unknown hero: {name}"

    with open(STATUS_LV15_FILE, encoding="utf-8") as f:
        data = json.load(f)

    for name, stats in new_entries.items():
        data["heroes"][name] = stats

    data["hero_count"] = len(data["heroes"])

    with open(STATUS_LV15_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Updated {STATUS_LV15_FILE} with {len(new_entries)} heroes. Total: {data['hero_count']}")


if __name__ == "__main__":
    main()
