#!/usr/bin/env python3
"""RoV MOBA Meta Intelligence CLI.

Analyzes contested pick/ban rates, flex picks, duo synergies, and hero statistics
across 4,329 professional games (RPL, APL, AIC, AOG, GCS).

Usage:
    python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --summary
    python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --tier-list --top 15
    python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --flex-picks
    python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --duo-synergy --min-games 10
    python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --hero-stats Valhein
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
DATA_PATH = REPO_ROOT / "data" / "matches_draft_full.json"
STATS_PATH = REPO_ROOT / "data" / "hero_draft_stats.csv"

HERO_ALIASES = {
    "Arthur": "Mortos",
    "Brunhilda": "Celica",
    "Richter": "Riktor",
    "Diaochan": "Diao Chan",
}


def load_matches(league_filter: str | None = None, min_year: int = 2024) -> list[dict]:
    if not DATA_PATH.exists():
        print(f"[ERROR] Matches dataset not found at {DATA_PATH}")
        sys.exit(1)

    raw_data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    matches = raw_data if isinstance(raw_data, list) else raw_data.get("matches", [])

    filtered = []
    for m in matches:
        raw_yr = m.get("year", 2026)
        try:
            year = int(raw_yr)
        except (ValueError, TypeError):
            year = 2026

        if year < min_year:
            continue
        if league_filter and league_filter.lower() not in (m.get("league") or "").lower():
            continue
        filtered.append(m)
    return filtered


def normalize_hero(h: str) -> str:
    return HERO_ALIASES.get(h, h)


def is_blue_win(m: dict) -> bool:
    bw = m.get("blue_win")
    if bw is True or bw == 1 or bw == "1":
        return True
    return False


def run_summary(matches: list[dict]) -> None:
    print("=" * 72)
    print("RoV Professional Tournament Dataset Summary")
    print("=" * 72)
    print(f"Total Filtered Games : {len(matches):,}")
    leagues = Counter(m.get("league", "Unknown") for m in matches)
    years = Counter(m.get("year", "Unknown") for m in matches)

    print("\n[Games by League]")
    for league, count in leagues.most_common():
        print(f"  - {league:<22}: {count:,} games ({count / len(matches) * 100:.1f}%)")

    print("\n[Games by Year]")
    for yr, count in sorted(years.items(), key=lambda x: str(x[0])):
        print(f"  - {yr}: {count:,} games ({count / len(matches) * 100:.1f}%)")
    print("=" * 72)


def run_tier_list(matches: list[dict], top: int = 20) -> None:
    total_games = len(matches)
    if total_games == 0:
        print("[WARN] No games match the specified criteria.")
        return

    picks = Counter()
    bans = Counter()
    wins = Counter()

    for m in matches:
        b_picks = [normalize_hero(h) for h in m.get("blue_picks") or []]
        r_picks = [normalize_hero(h) for h in m.get("red_picks") or []]
        b_bans = [normalize_hero(h) for h in m.get("blue_bans") or []]
        r_bans = [normalize_hero(h) for h in m.get("red_bans") or []]
        b_win = is_blue_win(m)

        for h in b_picks:
            picks[h] += 1
            if b_win:
                wins[h] += 1
        for h in r_picks:
            picks[h] += 1
            if not b_win:
                wins[h] += 1
        for h in b_bans + r_bans:
            bans[h] += 1

    all_heroes = set(picks.keys()) | set(bans.keys())
    stats = []
    for h in all_heroes:
        p_cnt = picks[h]
        b_cnt = bans[h]
        presence = (p_cnt + b_cnt) / total_games * 100.0
        win_rate = (wins[h] / p_cnt * 100.0) if p_cnt > 0 else 0.0

        if presence >= 75.0:
            tier = "S+"
        elif presence >= 50.0:
            tier = "S"
        elif presence >= 25.0:
            tier = "A"
        elif presence >= 10.0:
            tier = "B"
        else:
            tier = "C"

        stats.append((h, tier, presence, p_cnt, b_cnt, win_rate))

    stats.sort(key=lambda x: x[2], reverse=True)

    print("=" * 78)
    print(f"RoV Tournament Meta Tier List (Top {min(top, len(stats))} Contested Heroes | {total_games:,} Games)")
    print("=" * 78)
    print(f"{'Rank':<5} {'Hero':<18} {'Tier':<5} {'Presence%':<11} {'Picks':<7} {'Bans':<7} {'WinRate%'}")
    print("-" * 78)
    for i, (h, tier, pres, p_cnt, b_cnt, wr) in enumerate(stats[:top], 1):
        print(f"#{i:<4} {h:<18} {tier:<5} {pres:>6.1f}%      {p_cnt:>5}   {b_cnt:>5}   {wr:>6.1f}%")
    print("=" * 78)


def run_flex_picks(min_games: int = 15) -> None:
    if not STATS_PATH.exists():
        print(f"[ERROR] hero_draft_stats.csv not found at {STATS_PATH}")
        sys.exit(1)

    import pandas as pd

    df = pd.read_csv(STATS_PATH)
    lane_cols = ["ds_lane_picks", "jungle_picks", "mid_picks", "dragon_lane_picks", "roam_picks"]
    lane_names = ["DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"]

    flex_heroes = []
    for _, row in df.iterrows():
        hero = row["name"]
        total_picks = int(row["picks"])
        tot_weighted = sum(row[col] for col in lane_cols)
        if total_picks < min_games or tot_weighted <= 0:
            continue

        shares = [
            (lane_names[i], (row[col] / tot_weighted) * 100.0)
            for i, col in enumerate(lane_cols)
            if (row[col] / tot_weighted) >= 0.15
        ]

        if len(shares) >= 2:
            shares.sort(key=lambda x: x[1], reverse=True)
            shares_str = ", ".join(f"{lane} ({pct:.0f}%)" for lane, pct in shares)
            flex_heroes.append((hero, total_picks, len(shares), shares_str))

    flex_heroes.sort(key=lambda x: x[1], reverse=True)

    print("=" * 78)
    print(f"RoV Pro Flex-Lane Versatility (Heroes with >= 15% presence in 2+ lanes | Min {min_games} Picks)")
    print("=" * 78)
    for hero, total, n_lanes, shares_str in flex_heroes:
        print(f"  • {hero:<16} ({total:>4} pro picks across {n_lanes} lanes): {shares_str}")
    print("=" * 78)


def run_duo_synergy(matches: list[dict], min_games: int = 15) -> None:
    pair_wins = Counter()
    pair_games = Counter()

    for m in matches:
        b_picks = sorted(set(normalize_hero(h) for h in m.get("blue_picks") or []))
        r_picks = sorted(set(normalize_hero(h) for h in m.get("red_picks") or []))
        b_win = is_blue_win(m)

        # Blue pairs
        for i in range(len(b_picks)):
            for j in range(i + 1, len(b_picks)):
                pair = (b_picks[i], b_picks[j])
                pair_games[pair] += 1
                if b_win:
                    pair_wins[pair] += 1

        # Red pairs
        for i in range(len(r_picks)):
            for j in range(i + 1, len(r_picks)):
                pair = (r_picks[i], r_picks[j])
                pair_games[pair] += 1
                if not b_win:
                    pair_wins[pair] += 1

    duo_list = []
    for pair, games in pair_games.items():
        if games >= min_games:
            wr = pair_wins[pair] / games * 100.0
            duo_list.append((pair, games, pair_wins[pair], wr))

    duo_list.sort(key=lambda x: x[3], reverse=True)

    print("=" * 78)
    print(f"Top Winning Pro Duo Synergies (Min {min_games} Games Together)")
    print("=" * 78)
    print(f"{'Rank':<5} {'Duo Pair':<34} {'Games':<8} {'Wins':<6} {'WinRate%'}")
    print("-" * 78)
    for i, (pair, games, w_cnt, wr) in enumerate(duo_list[:15], 1):
        pair_str = f"{pair[0]} + {pair[1]}"
        print(f"#{i:<4} {pair_str:<34} {games:>5}    {w_cnt:>4}   {wr:>6.1f}%")
    print("=" * 78)


def run_hero_stats(matches: list[dict], hero_name: str) -> None:
    norm_hero = normalize_hero(hero_name)
    total_games = len(matches)
    picks = 0
    bans = 0
    wins = 0
    blue_games = 0
    blue_wins = 0
    red_games = 0
    red_wins = 0
    partners = Counter()

    for m in matches:
        b_picks = [normalize_hero(h) for h in m.get("blue_picks") or []]
        r_picks = [normalize_hero(h) for h in m.get("red_picks") or []]
        b_bans = [normalize_hero(h) for h in m.get("blue_bans") or []]
        r_bans = [normalize_hero(h) for h in m.get("red_bans") or []]
        b_win = is_blue_win(m)

        if norm_hero in b_bans or norm_hero in r_bans:
            bans += 1

        if norm_hero in b_picks:
            picks += 1
            blue_games += 1
            if b_win:
                wins += 1
                blue_wins += 1
            for ally in b_picks:
                if ally != norm_hero:
                    partners[ally] += 1

        if norm_hero in r_picks:
            picks += 1
            red_games += 1
            if not b_win:
                wins += 1
                red_wins += 1
            for ally in r_picks:
                if ally != norm_hero:
                    partners[ally] += 1

    presence = (picks + bans) / total_games * 100.0 if total_games else 0.0
    win_rate = (wins / picks * 100.0) if picks else 0.0
    b_wr = (blue_wins / blue_games * 100.0) if blue_games else 0.0
    r_wr = (red_wins / red_games * 100.0) if red_games else 0.0

    print("=" * 72)
    print(f"Professional Tournament Profile: {norm_hero}")
    print("=" * 72)
    print(f"Total Matches Sampled: {total_games:,}")
    print(f"Contested Presence   : {presence:.1f}% ({picks + bans:,} Picks + Bans)")
    print(f"Picks / Bans         : {picks:,} Picks / {bans:,} Bans")
    print(f"Overall Win Rate     : {win_rate:.1f}% ({wins:,} Wins / {picks:,} Games)")
    print(f"Blue Side Record     : {b_wr:.1f}% ({blue_wins:,}W - {blue_games - blue_wins:,}L)")
    print(f"Red Side Record      : {r_wr:.1f}% ({red_wins:,}W - {red_games - red_wins:,}L)")
    print("\n[Top 5 Most Frequent Teammates]")
    for ally, cnt in partners.most_common(5):
        print(f"  - {ally:<16}: {cnt:,} games together")
    print("=" * 72)


def main() -> None:
    parser = argparse.ArgumentParser(description="RoV MOBA Meta Intelligence CLI")
    parser.add_argument("--summary", action="store_true", help="Print dataset overview")
    parser.add_argument("--tier-list", action="store_true", help="Print contested meta tier list")
    parser.add_argument("--flex-picks", action="store_true", help="List flexible multi-lane heroes")
    parser.add_argument("--duo-synergy", action="store_true", help="Print top winning duo pairs")
    parser.add_argument("--hero-stats", type=str, help="Print deep tournament stats for a hero")
    parser.add_argument("--league", type=str, help="Filter by league (e.g. RPL, APL, AIC, AOG, GCS)")
    parser.add_argument("--min-year", type=int, default=2024, help="Filter minimum tournament year")
    parser.add_argument("--top", type=int, default=15, help="Number of items to display")
    parser.add_argument("--min-games", type=int, default=15, help="Minimum games for synergy/flex")
    args = parser.parse_args()

    matches = load_matches(league_filter=args.league, min_year=args.min_year)

    if args.summary:
        run_summary(matches)
    elif args.tier_list:
        run_tier_list(matches, top=args.top)
    elif args.flex_picks:
        run_flex_picks(min_games=args.min_games)
    elif args.duo_synergy:
        run_duo_synergy(matches, min_games=args.min_games)
    elif args.hero_stats:
        run_hero_stats(matches, args.hero_stats)
    else:
        # Default behavior: summary + tier list
        run_summary(matches)
        print()
        run_tier_list(matches, top=10)


if __name__ == "__main__":
    main()
