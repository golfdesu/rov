import json
import sys
from pathlib import Path
import pandas as pd

ROOT_DIR = Path(__file__).resolve().parents[4]
DATA_DIR = ROOT_DIR / "data"


def main():
    heroes_json = DATA_DIR / "heroes_130_full.json"
    heroes_csv = DATA_DIR / "heroes_130_summary.csv"
    matches_json = DATA_DIR / "matches_draft_full.json"
    stats_csv = DATA_DIR / "hero_draft_stats.csv"

    for p in [heroes_json, heroes_csv, matches_json, stats_csv]:
        if not p.exists():
            print(f"[FAIL] Missing required data file: {p}")
            sys.exit(1)

    with open(heroes_json, "r", encoding="utf-8") as f:
        heroes = json.load(f)
    with open(matches_json, "r", encoding="utf-8") as f:
        matches = json.load(f)

    heroes_df = pd.read_csv(heroes_csv)
    stats_df = pd.read_csv(stats_csv)

    assert len(heroes) == 130, f"Expected 130 heroes, found {len(heroes)}"
    assert len(heroes_df) == 130, f"Expected 130 rows in heroes_130_summary.csv, found {len(heroes_df)}"
    assert len(stats_df) == 130, f"Expected 130 rows in hero_draft_stats.csv, found {len(stats_df)}"

    hero_set = set(heroes_df["name"].tolist())
    unmapped = set()
    invalid_games = 0
    full_18_games = 0
    for g in matches:
        bp, rp = g.get("blue_picks", []), g.get("red_picks", [])
        bb, rb = g.get("blue_bans", []), g.get("red_bans", [])
        if len(bp) != 5 or len(rp) != 5:
            invalid_games += 1
        if len(bp) == 5 and len(rp) == 5 and len(bb) == 4 and len(rb) == 4:
            full_18_games += 1
        for h in bp + rp + bb + rb:
            if h not in hero_set:
                unmapped.add(h)

    if unmapped or invalid_games > 0:
        print(f"[FAIL] Unmapped heroes: {unmapped} | Invalid games: {invalid_games}")
        sys.exit(1)

    min_skills = min(len(h.get("skills", [])) for h in heroes)
    print(
        f"[PASS] RoV Data Guardian Audit Passed: {len(heroes)} heroes (min {min_skills} skills), "
        f"{len(matches):,} total pro games ({full_18_games:,} full 18-step games), 0 unmapped names."
    )


if __name__ == "__main__":
    main()
