"""Apply all 4 skill patch batches to data/hero_skills_full.json.

This updates all skills with exact numerical arrays, cooldowns, mana costs,
scaling formulas, and rich Thai descriptions, completely removing any placeholder artifacts.
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_JSON = REPO_ROOT / "data" / "hero_skills_full.json"
PATCH_FILES = [
    REPO_ROOT / "data" / "patches_part1.json",
    REPO_ROOT / "data" / "patches_part2.json",
    REPO_ROOT / "data" / "patches_part3.json",
    REPO_ROOT / "data" / "patches_part4.json",
]


def main():
    if not SKILLS_JSON.exists():
        print(f"Error: {SKILLS_JSON} does not exist!")
        return

    full_data = json.loads(SKILLS_JSON.read_text(encoding="utf-8"))
    heroes_dict: dict[str, list[dict]] = full_data.get("heroes", {})

    total_patched_heroes = 0
    total_patched_skills = 0

    for patch_path in PATCH_FILES:
        if not patch_path.exists():
            print(f"Warning: {patch_path} does not exist, skipping.")
            continue

        patch_data = json.loads(patch_path.read_text(encoding="utf-8"))
        print(f"Loaded patch {patch_path.name} with {len(patch_data)} heroes.")

        for hero_name, patch_skills in patch_data.items():
            if hero_name not in heroes_dict:
                print(f"  Hero {hero_name} not found in catalog, adding directly...")
                heroes_dict[hero_name] = patch_skills
                total_patched_heroes += 1
                total_patched_skills += len(patch_skills)
                continue

            existing_skills = heroes_dict[hero_name]
            total_patched_heroes += 1

            for ps in patch_skills:
                slot = ps.get("slot", "")
                name = ps.get("name", "")

                matched = None
                for es in existing_skills:
                    if es.get("slot") == slot or es.get("name") == name:
                        matched = es
                        break

                if matched:
                    # Preserve icon_url if exists
                    icon_url = matched.get("icon_url")
                    matched.update(ps)
                    if icon_url:
                        matched["icon_url"] = icon_url
                    total_patched_skills += 1
                else:
                    existing_skills.append(ps)
                    total_patched_skills += 1

    # Final cleanup of any lingering artifacts across the whole catalog
    cleared_placeholders = 0
    for hero_name, skills in heroes_dict.items():
        for s in skills:
            for k in ["desc_th", "description"]:
                v = s.get(k)
                if v and ("x(+x)" in v or "(+0)" in v):
                    s[k] = v.replace("x(+x)", "").replace("(+0)", "").strip()
                    cleared_placeholders += 1

    full_data["heroes"] = heroes_dict
    SKILLS_JSON.write_text(json.dumps(full_data, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "=" * 60)
    print("Successfully applied patches!")
    print(f"  Total Patched Heroes: {total_patched_heroes}")
    print(f"  Total Patched Skills: {total_patched_skills}")
    print(f"  Cleared Artifact Placeholders: {cleared_placeholders}")
    print(f"  Saved to: {SKILLS_JSON}")
    print("=" * 60)


if __name__ == "__main__":
    main()
