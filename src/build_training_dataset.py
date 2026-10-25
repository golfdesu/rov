"""Build curated training datasets for RoVDraftGNNTransformer with flexible slicing.

Merges ground-truth chronological pick orders from data/true_pick_order.json
with master tournament draft games from data/matches_draft_full.json, allowing
custom filtering by year, league, date, and true-pick-order verification status.
"""

import argparse
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MATCHES_FULL_PATH = DATA_DIR / "matches_draft_full.json"
TRUE_ORDER_PATH = DATA_DIR / "true_pick_order.json"
DEFAULT_OUTPUT_PATH = DATA_DIR / "matches_training.json"


def parse_args():
    parser = argparse.ArgumentParser(description="Build curated training dataset for RoV SOTA Model")
    parser.add_argument("--min-year", type=int, default=2024, help="Earliest match year to include (default: 2024)")
    parser.add_argument("--max-year", type=int, default=2026, help="Latest match year to include (default: 2026)")
    parser.add_argument(
        "--leagues",
        nargs="+",
        default=None,
        help="Filter by specific leagues (e.g., --leagues RPL AOG GCS APL AIC)",
    )
    parser.add_argument(
        "--only-true-order",
        action="store_true",
        help="Only include games with 100% verified chronological pick order from broadcast screenshots",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Output JSON file path (default: data/matches_training.json)",
    )
    parser.add_argument(
        "--flat-csv",
        type=Path,
        default=None,
        help="Optional flattened CSV output path",
    )
    return parser.parse_args()


def load_true_pick_order_lookup():
    if not TRUE_ORDER_PATH.exists():
        print(f"Warning: {TRUE_ORDER_PATH} not found. All games will be marked as heuristic order.")
        return {}

    with open(TRUE_ORDER_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    lookup = {}
    for g in data.get("games", []):
        sid = g.get("series_id")
        gnum = g.get("game_number")
        if sid and gnum is not None:
            lookup[(sid, int(gnum))] = g
    return lookup


def normalize_league_token(league_str: str) -> str:
    s = league_str.upper()
    if "PRO LEAGUE" in s or "RPL" in s:
        return "RPL"
    if "GLORY" in s or "AOG" in s:
        return "AOG"
    if "CHALLENGER" in s or "GCS" in s:
        return "GCS"
    if "PREMIER LEAGUE" in s or "APL" in s:
        return "APL"
    if "INTERNATIONAL" in s or "AIC" in s:
        return "AIC"
    return s


def build_training_dataset(
    min_year: int = 2024,
    max_year: int = 2026,
    leagues: list[str] | None = None,
    only_true_order: bool = False,
    output_path: Path = DEFAULT_OUTPUT_PATH,
    flat_csv_path: Path | None = None,
):
    with open(MATCHES_FULL_PATH, "r", encoding="utf-8") as f:
        all_games = json.load(f)

    true_lookup = load_true_pick_order_lookup()
    print(f"Loaded {len(all_games)} raw pro games from {MATCHES_FULL_PATH.name}")
    print(f"Loaded {len(true_lookup)} ground-truth games from {TRUE_ORDER_PATH.name}")

    allowed_leagues = {lg.upper() for lg in leagues} if leagues else None

    curated_games = []
    stats_by_league = {}
    stats_by_year = {}
    true_order_count = 0

    for g in all_games:
        # Check complete 18-step draft (5 picks each, 4 bans each)
        if len(g.get("blue_picks", [])) < 5 or len(g.get("red_picks", [])) < 5:
            continue
        if len(g.get("blue_bans", [])) < 4 or len(g.get("red_bans", [])) < 4:
            continue

        # Year filter
        year_str = str(g.get("year", "2026"))
        year_val = int(year_str) if year_str.isdigit() else 2026
        if year_val < min_year or year_val > max_year:
            continue

        # League filter
        lg_code = normalize_league_token(g.get("league", ""))
        if allowed_leagues and lg_code not in allowed_leagues:
            continue

        key = (g.get("series_id"), int(g.get("game_number", 0)))
        has_true = key in true_lookup

        if only_true_order and not has_true:
            continue

        # Create curated record
        record = dict(g)
        record["is_true_order"] = has_true

        if has_true:
            true_order_count += 1
            true_info = true_lookup[key]
            # Replace picks with true chronological pick order
            record["blue_picks"] = list(true_info["blue_picks"])
            record["red_picks"] = list(true_info["red_picks"])
            record["true_pick_source"] = true_info.get("source", "screenshot")
            record["true_screenshot"] = true_info.get("screenshot", "")
        else:
            record["true_pick_source"] = "liquipedia_lane_order"
            record["true_screenshot"] = ""

        curated_games.append(record)

        # Accumulate stats
        stats_by_league[lg_code] = stats_by_league.get(lg_code, 0) + 1
        stats_by_year[year_val] = stats_by_year.get(year_val, 0) + 1

    # Chronological sort
    curated_games.sort(
        key=lambda x: (
            int(x.get("year", 2026)) if str(x.get("year", "2026")).isdigit() else 2026,
            str(x.get("date", "")),
            x.get("series_id", ""),
            int(x.get("game_number", 0)),
        )
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(curated_games, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 70)
    print("TRAINING DATASET GENERATION SUMMARY")
    print("=" * 70)
    print(f"Output File              : {output_path}")
    print(f"Total Filtered Games     : {len(curated_games)}")
    pct_true = (true_order_count / len(curated_games) * 100) if curated_games else 0.0
    print(f"True Pick Order Games    : {true_order_count} ({pct_true:.1f}%)")
    print(f"Lane Heuristic Games     : {len(curated_games) - true_order_count}")
    print("\nBreakdown by Year:")
    for y in sorted(stats_by_year):
        print(f"  {y}: {stats_by_year[y]} games")
    print("\nBreakdown by League:")
    for lk in sorted(stats_by_league):
        print(f"  {lk}: {stats_by_league[lk]} games")
    print("=" * 70)

    if flat_csv_path:
        import pandas as pd

        from scrape_matches import format_flat_row

        flat_rows = [format_flat_row(cg) for cg in curated_games]
        df = pd.DataFrame(flat_rows)
        df.to_csv(flat_csv_path, index=False, encoding="utf-8-sig")
        print(f"Saved flattened CSV to: {flat_csv_path}")

    return curated_games


def main():
    args = parse_args()
    build_training_dataset(
        min_year=args.min_year,
        max_year=args.max_year,
        leagues=args.leagues,
        only_true_order=args.only_true_order,
        output_path=args.output,
        flat_csv_path=args.flat_csv,
    )


if __name__ == "__main__":
    main()
