"""One-time & reusable migration script to normalize team abbreviations across all datasets."""

import json
import sys
from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from src.scrape_matches import format_flat_row, normalize_team

DATA_DIR = BASE_DIR / "data"

MATCHES_FULL_PATH = DATA_DIR / "matches_draft_full.json"
MATCHES_TRAIN_PATH = DATA_DIR / "matches_training.json"
TRUE_ORDER_PATH = DATA_DIR / "true_pick_order.json"
FLAT_CSV_PATH = DATA_DIR / "matches_draft_flat.csv"


def normalize_match_record(m: dict) -> tuple[dict, bool]:
    changed = False
    for key in ["blue_team", "red_team"]:
        raw = m.get(key)
        if raw:
            norm = normalize_team(raw)
            if norm != raw:
                m[key] = norm
                changed = True
    return m, changed


def main():
    print("Normalizing team names across all datasets...")

    # 1. matches_draft_full.json
    with open(MATCHES_FULL_PATH, "r", encoding="utf-8") as f:
        matches_full = json.load(f)

    full_changed_count = 0
    for m in matches_full:
        _, ch = normalize_match_record(m)
        if ch:
            full_changed_count += 1

    with open(MATCHES_FULL_PATH, "w", encoding="utf-8") as f:
        json.dump(matches_full, f, ensure_ascii=False, indent=2)
    print(f"matches_draft_full.json: Updated {full_changed_count} / {len(matches_full)} games")

    # 2. true_pick_order.json
    with open(TRUE_ORDER_PATH, "r", encoding="utf-8") as f:
        tp_data = json.load(f)

    tp_games = tp_data.get("games", [])
    tp_changed_count = 0
    for g in tp_games:
        _, ch = normalize_match_record(g)
        if ch:
            tp_changed_count += 1

    with open(TRUE_ORDER_PATH, "w", encoding="utf-8") as f:
        json.dump(tp_data, f, ensure_ascii=False, indent=2)
    print(f"true_pick_order.json: Updated {tp_changed_count} / {len(tp_games)} games")

    # 3. matches_training.json
    with open(MATCHES_TRAIN_PATH, "r", encoding="utf-8") as f:
        matches_train = json.load(f)

    train_changed_count = 0
    for m in matches_train:
        _, ch = normalize_match_record(m)
        if ch:
            train_changed_count += 1

    with open(MATCHES_TRAIN_PATH, "w", encoding="utf-8") as f:
        json.dump(matches_train, f, ensure_ascii=False, indent=2)
    print(f"matches_training.json: Updated {train_changed_count} / {len(matches_train)} games")

    # 4. matches_draft_flat.csv
    flat_rows = [format_flat_row(m) for m in matches_full]
    df_flat = pd.DataFrame(flat_rows)
    df_flat.to_csv(FLAT_CSV_PATH, index=False, encoding="utf-8-sig")
    print(f"matches_draft_flat.csv: Rebuilt {len(df_flat)} rows with normalized teams")

    print("Team normalization complete!")


if __name__ == "__main__":
    main()
