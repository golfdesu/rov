import json
import sys
from pathlib import Path

import pandas as pd

ROOT_DIR = Path(__file__).resolve().parents[4]
DATA_DIR = ROOT_DIR / "data"
TRUE_ORDER_JSON = DATA_DIR / "true_pick_order.json"
SCREENSHOT_DIR = DATA_DIR / "draft_screenshots"


def audit_true_pick_order(matches: list[dict]) -> list[str]:
    """Checks each true-order game against Liquipedia: same 10 heroes, same sides, screenshot exists."""
    if not TRUE_ORDER_JSON.exists():
        return []
    games = json.loads(TRUE_ORDER_JSON.read_text(encoding="utf-8")).get("games", [])
    by_key = {(m["series_id"], m["game_number"]): m for m in matches}
    errors = []
    seen = set()
    for g in games:
        key = (g.get("series_id"), g.get("game_number"))
        label = f"{key[0]} game {key[1]}"
        if key in seen:
            errors.append(f"{label}: duplicate entry")
        seen.add(key)
        m = by_key.get(key)
        if m is None:
            errors.append(f"{label}: not found in matches_draft_full.json")
            continue
        for side in ("blue", "red"):
            picks = g.get(f"{side}_picks", [])
            if len(picks) != 5 or sorted(picks) != sorted(m[f"{side}_picks"]):
                errors.append(f"{label}: {side}_picks {picks} is not a reordering of Liquipedia {m[f'{side}_picks']}")
        if g.get("source") not in ("screenshot", "manual"):
            errors.append(f"{label}: source must be 'screenshot' or 'manual', got {g.get('source')!r}")
        shot = g.get("screenshot")
        if g.get("source") == "screenshot" and not (shot and (SCREENSHOT_DIR / shot).exists()):
            errors.append(f"{label}: screenshot file missing: {shot}")
    print(f"[INFO] true_pick_order.json: {len(games)} games checked")
    return errors


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

    order_errors = audit_true_pick_order(matches)
    if order_errors:
        print(f"[FAIL] true_pick_order.json has {len(order_errors)} problem(s):")
        for e in order_errors:
            print(f"  - {e}")
        sys.exit(1)

    min_skills = min(len(h.get("skills", [])) for h in heroes)
    print(
        f"[PASS] RoV Data Guardian Audit Passed: {len(heroes)} heroes (min {min_skills} skills), "
        f"{len(matches):,} total pro games ({full_18_games:,} full 18-step games), 0 unmapped names."
    )


if __name__ == "__main__":
    main()
