import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS_FILE = ROOT / "data" / "hero_skills_full.json"
HEROES_FILE = ROOT / "data" / "heroes_130_full.json"
PATCHES_DIR = ROOT / "data" / "hero_patches"


def apply_all_patches():
    with open(SKILLS_FILE, "r", encoding="utf-8") as f:
        skills_catalog = json.load(f)

    with open(HEROES_FILE, "r", encoding="utf-8") as f:
        heroes_130 = json.load(f)

    heroes_map = {h["name"]: h for h in heroes_130}

    patch_files = sorted(PATCHES_DIR.glob("*.json"))
    applied_count = 0

    for patch_file in patch_files:
        hero_name = patch_file.stem
        with open(patch_file, "r", encoding="utf-8") as f:
            skills = json.load(f)

        skills_catalog["heroes"][hero_name] = skills
        if hero_name in heroes_map:
            heroes_map[hero_name]["skills"] = skills
        applied_count += 1

    skills_catalog["total_skills"] = sum(len(s) for s in skills_catalog["heroes"].values())

    with open(SKILLS_FILE, "w", encoding="utf-8") as f:
        json.dump(skills_catalog, f, indent=2, ensure_ascii=False)

    with open(HEROES_FILE, "w", encoding="utf-8") as f:
        json.dump(heroes_130, f, indent=2, ensure_ascii=False)

    print(f"Successfully applied {applied_count} hero patches! Total skills: {skills_catalog['total_skills']}")


def update_hero(hero_name: str, skills: list[dict]):
    with open(SKILLS_FILE, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    catalog["heroes"][hero_name] = skills
    catalog["total_skills"] = sum(len(s) for s in catalog["heroes"].values())

    with open(SKILLS_FILE, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)

    with open(HEROES_FILE, "r", encoding="utf-8") as f:
        h130 = json.load(f)

    for h in h130:
        if h["name"] == hero_name:
            h["skills"] = skills
            break

    with open(HEROES_FILE, "w", encoding="utf-8") as f:
        json.dump(h130, f, indent=2, ensure_ascii=False)

    print(f"Successfully applied {len(skills)} skills for {hero_name}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        patch_file = Path(sys.argv[1])
        hero_name = patch_file.stem
        with open(patch_file, "r", encoding="utf-8") as f:
            skills = json.load(f)
        update_hero(hero_name, skills)
    else:
        apply_all_patches()
