import json
from pathlib import Path

DATA_PATH = Path("data/hero_skills_full.json")
with open(DATA_PATH, encoding="utf-8") as f:
    catalog = json.load(f)

heroes = catalog["heroes"]
print(f"Total heroes in catalog: {len(heroes)}")
