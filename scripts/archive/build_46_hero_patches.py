import json
import os
from pathlib import Path

PATCHES_DIR = Path("data/hero_patches")
PATCHES_DIR.mkdir(parents=True, exist_ok=True)

all_heroes = {}

# 1. Group 1
with open("scripts/data_group1.json", "r", encoding="utf-8") as f:
    g1 = json.load(f)
    all_heroes.update(g1)
print(f"Loaded Group 1: {list(g1.keys())}")

# 2. Group 2
with open("scripts/extracted_group2_0.json", "r", encoding="utf-8") as f:
    g2 = json.load(f)
    all_heroes.update(g2)
print(f"Loaded Group 2: {list(g2.keys())}")

# 3. Group 3
with open("scripts/extracted_group3_0.json", "r", encoding="utf-8") as f:
    g3 = json.load(f)
    all_heroes.update(g3)
print(f"Loaded Group 3: {list(g3.keys())}")

# 4. Group 4
with open("scripts/extracted_12679_0.json", "r", encoding="utf-8") as f:
    g4 = json.load(f)
    all_heroes.update(g4)
print(f"Loaded Group 4: {list(g4.keys())}")

# 5. Group 5
with open("scripts/extracted_12722_0.json", "r", encoding="utf-8") as f:
    g5 = json.load(f)
    all_heroes.update(g5)
print(f"Loaded Group 5: {list(g5.keys())}")

# 6. Group 6
g6_heroes = ["Omega", "Ormarr", "Preyta", "Rouie", "Sephera"]
for i, h_name in enumerate(g6_heroes):
    p = f"scripts/extracted_group6_b{i}.json"
    if os.path.exists(p):
        with open(p, "r", encoding="utf-8") as f:
            skills = json.load(f)
            all_heroes[h_name] = skills
    else:
        print(f"Warning: {p} not found for {h_name}")
print(f"Loaded Group 6: {g6_heroes}")

# 7. Group 7
with open("scripts/extracted_group7_0.json", "r", encoding="utf-8") as f:
    g7 = json.load(f)
    all_heroes.update(g7)
print(f"Loaded Group 7: {list(g7.keys())}")

# 8. Group 8
with open("scripts/extracted_group8_0.json", "r", encoding="utf-8") as f:
    g8 = json.load(f)
    all_heroes.update(g8)
print(f"Loaded Group 8: {list(g8.keys())}")

print(f"\nTotal heroes in batch: {len(all_heroes)}")

REQUIRED_KEYS = [
    "slot",
    "name",
    "type",
    "damage_type",
    "cooldown",
    "mana_cost",
    "base_damage",
    "scaling",
    "desc_th",
    "description",
    "icon_url",
]

# Validation
errors = []
for hero, skills in all_heroes.items():
    if not isinstance(skills, list) or len(skills) < 4:
        errors.append(f"{hero}: invalid skills length ({len(skills) if isinstance(skills, list) else type(skills)})")
        continue
    for s_idx, skill in enumerate(skills):
        for k in REQUIRED_KEYS:
            if k not in skill:
                errors.append(f"{hero} skill {s_idx} ({skill.get('name')}): missing key '{k}'")
        if not isinstance(skill.get("cooldown"), list):
            errors.append(f"{hero} skill {s_idx}: cooldown is not a list")
        if not isinstance(skill.get("mana_cost"), list):
            errors.append(f"{hero} skill {s_idx}: mana_cost is not a list")
        if not isinstance(skill.get("base_damage"), list):
            errors.append(f"{hero} skill {s_idx}: base_damage is not a list")
        if not isinstance(skill.get("scaling"), dict):
            errors.append(f"{hero} skill {s_idx}: scaling is not a dict")
        if skill.get("desc_th") is None or skill.get("desc_th") == "":
            errors.append(f"{hero} skill {s_idx}: missing desc_th")

if errors:
    print(f"\nVALIDATION FAILED with {len(errors)} errors:")
    for e in errors[:20]:
        print(f"  - {e}")
    raise SystemExit(1)

print("\nAll 46 heroes passed schema validation!")

# Write individual patch files
for hero, skills in all_heroes.items():
    out_file = PATCHES_DIR / f"{hero}.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(skills, f, indent=2, ensure_ascii=False)

all_patches = list(PATCHES_DIR.glob("*.json"))
print(f"Successfully wrote {len(all_heroes)} patches.")
print(f"Total patch files in {PATCHES_DIR}: {len(all_patches)} / 130")
