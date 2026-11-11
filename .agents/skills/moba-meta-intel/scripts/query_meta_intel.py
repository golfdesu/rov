#!/usr/bin/env python3
"""RoV MOBA Meta Intelligence CLI (Patch-Aware & Recency-Weighted).

Analyzes contested pick/ban rates, flex picks, duo synergies, and hero statistics
across 4,329 professional games (RPL, APL, AIC, AOG, GCS). Incorporates hand-maintained
tier overrides (data/hero_tier_overrides.json), patch history (data/hero_patch_history.json),
recency weighting, and Laplace Bayesian smoothed win rates.

Usage:
    python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --tier-list --top 25
    python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --emerging --top 15
    python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --flex-picks
    python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --duo-synergy --min-games 20
    python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --hero-stats Evita --verbose
    python .agents/skills/moba-meta-intel/scripts/query_meta_intel.py --summary
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
TIER_OVERRIDES_PATH = REPO_ROOT / "data" / "hero_tier_overrides.json"
PATCH_HISTORY_PATH = REPO_ROOT / "data" / "hero_patch_history.json"

HERO_ALIASES = {
    "Arthur": "Mortos",
    "Brunhilda": "Celica",
    "Richter": "Riktor",
    "Diaochan": "Diao Chan",
}

NEW_HEROES_2026 = {"Evita", "Tamyn", "Flowborn (Marksman)", "Flowborn (Mage)"}
TIER_RANKS = {"S+": 5, "S": 4, "A": 3, "B": 2, "C": 1}


def normalize_hero(h: str) -> str:
    return HERO_ALIASES.get(h, h)


def is_blue_win(m: dict) -> bool:
    bw = m.get("blue_win")
    return bw is True or bw == 1 or bw == "1"


def get_recency_weight(year_val: int | str) -> float:
    try:
        yr = int(year_val)
    except (ValueError, TypeError):
        yr = 2026
    if yr >= 2026:
        return 1.0
    elif yr == 2025:
        return 0.5
    else:
        return 0.2


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


def load_tier_overrides() -> dict[str, dict]:
    if not TIER_OVERRIDES_PATH.exists():
        return {}
    try:
        data = json.loads(TIER_OVERRIDES_PATH.read_text(encoding="utf-8"))
        raw_overrides = data.get("overrides", {})
        return {normalize_hero(k): v for k, v in raw_overrides.items()}
    except Exception as e:
        print(f"[WARN] Failed to load hero_tier_overrides.json: {e}")
        return {}


def load_patch_badges() -> dict[str, tuple[str, str]]:
    """Returns mapping of hero -> (badge_str, details_str)."""
    badges: dict[str, tuple[str, str]] = {}
    for h in NEW_HEROES_2026:
        badges[h] = ("[NEW 2026]", "New hero release in 2026 season")

    if not PATCH_HISTORY_PATH.exists():
        return badges

    try:
        data = json.loads(PATCH_HISTORY_PATH.read_text(encoding="utf-8"))
        changes = data.get("changes", [])
        latest_changes: dict[str, dict] = {}
        for c in changes:
            h = normalize_hero(c.get("hero") or "")
            d = c.get("date") or ""
            if not h or not d:
                continue
            if h not in latest_changes or d > latest_changes[h].get("date", ""):
                latest_changes[h] = c

        for h, c in latest_changes.items():
            if h in NEW_HEROES_2026:
                continue
            date_str = c.get("date", "")
            if date_str >= "2026-01-01":
                mm = date_str[5:7]
                field = (c.get("field") or "").lower()
                desc = f"{date_str}: {c.get('skill', '')} {c.get('field', '')} ({c.get('after', '')})"
                if "nerf" in field:
                    badges[h] = (f"[NERF {mm}/26]", desc)
                elif any(w in field for w in ["buff", "new", "damage", "bonus", "lifesteal", "shield", "cooldown"]):
                    badges[h] = (f"[BUFF {mm}/26]", desc)
                else:
                    badges[h] = (f"[PATCH {mm}/26]", desc)
    except Exception as e:
        print(f"[WARN] Failed to load hero_patch_history.json: {e}")

    return badges


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


def run_tier_list(
    matches: list[dict],
    top: int = 25,
    use_recency: bool = True,
    apply_overrides: bool = True,
    verbose: bool = False,
) -> None:
    total_games = len(matches)
    if total_games == 0:
        print("[WARN] No games match the specified criteria.")
        return

    overrides = load_tier_overrides() if apply_overrides else {}
    patch_badges = load_patch_badges()

    weighted_picks = Counter()
    weighted_bans = Counter()
    weighted_wins = Counter()
    raw_picks = Counter()
    raw_bans = Counter()
    total_effective_weight = 0.0

    for m in matches:
        w = get_recency_weight(m.get("year", 2026)) if use_recency else 1.0
        total_effective_weight += w
        b_picks = [normalize_hero(h) for h in m.get("blue_picks") or []]
        r_picks = [normalize_hero(h) for h in m.get("red_picks") or []]
        b_bans = [normalize_hero(h) for h in m.get("blue_bans") or []]
        r_bans = [normalize_hero(h) for h in m.get("red_bans") or []]
        b_win = is_blue_win(m)

        for h in b_picks:
            weighted_picks[h] += w
            raw_picks[h] += 1
            if b_win:
                weighted_wins[h] += w
        for h in r_picks:
            weighted_picks[h] += w
            raw_picks[h] += 1
            if not b_win:
                weighted_wins[h] += w
        for h in b_bans + r_bans:
            weighted_bans[h] += w
            raw_bans[h] += 1

    all_heroes = set(weighted_picks.keys()) | set(weighted_bans.keys())
    stats = []

    for h in all_heroes:
        wp = weighted_picks[h]
        wb = weighted_bans[h]
        presence = (wp + wb) / total_effective_weight * 100.0 if total_effective_weight else 0.0
        # Laplace Bayesian smoothing: prior 50% with strength 6
        smoothed_wr = ((weighted_wins[h] + 3.0) / (wp + 6.0)) * 100.0

        is_overridden = False
        override_reason = ""
        if h in overrides:
            tier = overrides[h].get("tier", "A")
            is_overridden = True
            override_reason = overrides[h].get("reason", "")
        else:
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

        badge, patch_detail = patch_badges.get(h, ("", ""))
        stats.append(
            (
                h,
                tier,
                is_overridden,
                presence,
                raw_picks[h],
                raw_bans[h],
                smoothed_wr,
                badge,
                override_reason,
                patch_detail,
            )
        )

    # Sort priority: Tier Rank (S+ > S > A > B > C), then presence descending
    stats.sort(
        key=lambda x: (TIER_RANKS.get(x[1], 0), x[3]),
        reverse=True,
    )

    mode_desc = "Recency-Weighted + Patch-Aware" if use_recency else "Flat All-Time"
    print("=" * 88)
    print(f"RoV Pro Meta Tier List ({mode_desc} | Top {min(top, len(stats))} Contested Heroes | {total_games:,} Games)")
    print("Note: (*) indicates hand-maintained tier override (low sample size / patch rework)")
    print("=" * 88)
    print(
        f"{'Rank':<5} {'Hero':<17} {'Tier':<6} {'Presence%':<11} {'Picks':<6} {'Bans':<6} {'S-WinRate%':<12} {'Patch / Status'}"
    )
    print("-" * 88)

    shown = stats[:top]
    for i, (h, tier, is_ov, pres, p_cnt, b_cnt, swr, badge, _, _) in enumerate(shown, 1):
        tier_str = f"{tier}*" if is_ov else tier
        print(f"#{i:<4} {h:<17} {tier_str:<6} {pres:>6.1f}%     {p_cnt:>5}  {b_cnt:>5}   {swr:>6.1f}%     {badge}")
    print("=" * 88)

    if verbose:
        overridden_items = [item for item in shown if item[2] or item[7]]
        if overridden_items:
            print("\n[Deep Intel: Tier Overrides & Patch Details]")
            for h, tier, is_ov, _, _, _, _, badge, reason, p_desc in overridden_items:
                if is_ov and reason:
                    print(f"  • {h} ({tier}* Override): {reason}")
                elif badge and p_desc:
                    print(f"  • {h} {badge}: {p_desc}")
            print("=" * 88)


def run_emerging(matches: list[dict], top: int = 15, min_2026_games: int = 10) -> None:
    """Detects rising / emerging meta heroes (surge in 2026 pick/ban vs historical past)."""
    m_2026 = [m for m in matches if str(m.get("year", "")) == "2026"]
    m_past = [m for m in matches if str(m.get("year", "")) in ("2024", "2025")]

    tot_26 = len(m_2026)
    tot_past = len(m_past)
    if tot_26 == 0 or tot_past == 0:
        print("[WARN] Need both 2026 and prior year data to compute emerging meta surge.")
        return

    p_26 = Counter()
    b_26 = Counter()
    p_past = Counter()
    b_past = Counter()

    for m in m_2026:
        for h in [normalize_hero(x) for x in (m.get("blue_picks") or []) + (m.get("red_picks") or [])]:
            p_26[h] += 1
        for h in [normalize_hero(x) for x in (m.get("blue_bans") or []) + (m.get("red_bans") or [])]:
            b_26[h] += 1

    for m in m_past:
        for h in [normalize_hero(x) for x in (m.get("blue_picks") or []) + (m.get("red_picks") or [])]:
            p_past[h] += 1
        for h in [normalize_hero(x) for x in (m.get("blue_bans") or []) + (m.get("red_bans") or [])]:
            b_past[h] += 1

    patch_badges = load_patch_badges()
    surges = []
    for h in set(p_26.keys()) | set(b_26.keys()):
        cnt_26 = p_26[h] + b_26[h]
        if cnt_26 < min_2026_games:
            continue
        pres_26 = cnt_26 / tot_26 * 100.0
        pres_past = (p_past[h] + b_past[h]) / tot_past * 100.0 if tot_past else 0.0
        delta = pres_26 - pres_past
        badge, _ = patch_badges.get(h, ("", ""))
        surges.append((h, delta, pres_26, pres_past, p_26[h], b_26[h], badge))

    surges.sort(key=lambda x: x[1], reverse=True)

    print("=" * 88)
    print(f"RoV Emerging Meta Surge (Top {min(top, len(surges))} Rising Heroes in 2026 Season vs Historical Baseline)")
    print("=" * 88)
    print(
        f"{'Rank':<5} {'Hero':<18} {'Surge Delta':<13} {'2026 Pres%':<12} {'Past Pres%':<12} {'2026 P/B':<10} {'Status'}"
    )
    print("-" * 88)
    for i, (h, delta, pr_26, pr_past, p, b, badge) in enumerate(surges[:top], 1):
        sign = "+" if delta >= 0 else ""
        print(
            f"#{i:<4} {h:<18} {sign}{delta:>5.1f}%        {pr_26:>6.1f}%       {pr_past:>6.1f}%       {p:>3}P/{b:<3}B   {badge}"
        )
    print("=" * 88)


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

        for i in range(len(b_picks)):
            for j in range(i + 1, len(b_picks)):
                pair = (b_picks[i], b_picks[j])
                pair_games[pair] += 1
                if b_win:
                    pair_wins[pair] += 1

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


def run_hero_stats(matches: list[dict], hero_name: str, verbose: bool = False) -> None:
    norm_hero = normalize_hero(hero_name)
    overrides = load_tier_overrides()
    patch_badges = load_patch_badges()

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
    smoothed_wr = ((wins + 3.0) / (picks + 6.0)) * 100.0
    b_wr = (blue_wins / blue_games * 100.0) if blue_games else 0.0
    r_wr = (red_wins / red_games * 100.0) if red_games else 0.0

    print("=" * 72)
    print(f"Professional Tournament Profile: {norm_hero}")
    if norm_hero in overrides:
        ov = overrides[norm_hero]
        print(f"System Tier Override : {ov.get('tier')}* ({ov.get('reason')})")
    badge, p_desc = patch_badges.get(norm_hero, ("", ""))
    if badge:
        print(f"Patch Alignment Status: {badge} -> {p_desc}")
    print("=" * 72)
    print(f"Total Matches Sampled: {total_games:,}")
    print(f"Contested Presence   : {presence:.1f}% ({picks + bans:,} Picks + Bans)")
    print(f"Picks / Bans         : {picks:,} Picks / {bans:,} Bans")
    print(f"Raw Win Rate         : {win_rate:.1f}% ({wins:,} Wins / {picks:,} Games) [Smoothed: {smoothed_wr:.1f}%]")
    print(f"Blue Side Record     : {b_wr:.1f}% ({blue_wins:,}W - {blue_games - blue_wins:,}L)")
    print(f"Red Side Record      : {r_wr:.1f}% ({red_wins:,}W - {red_games - red_wins:,}L)")
    print("\n[Top 5 Most Frequent Teammates]")
    for ally, cnt in partners.most_common(5):
        print(f"  - {ally:<16}: {cnt:,} games together")
    print("=" * 72)


def main() -> None:
    parser = argparse.ArgumentParser(description="RoV MOBA Meta Intelligence CLI (Patch-Aware & Recency-Weighted)")
    parser.add_argument("--summary", action="store_true", help="Print dataset overview")
    parser.add_argument("--tier-list", action="store_true", help="Print contested meta tier list")
    parser.add_argument("--emerging", action="store_true", help="Print rising / surge heroes in 2026 vs past")
    parser.add_argument("--flex-picks", action="store_true", help="List flexible multi-lane heroes")
    parser.add_argument("--duo-synergy", action="store_true", help="Print top winning duo pairs")
    parser.add_argument("--hero-stats", type=str, help="Print deep tournament stats for a hero")
    parser.add_argument("--league", type=str, help="Filter by league (e.g. RPL, APL, AIC, AOG, GCS)")
    parser.add_argument("--min-year", type=int, default=2024, help="Filter minimum tournament year (default 2024)")
    parser.add_argument("--top", type=int, default=25, help="Number of items to display")
    parser.add_argument("--min-games", type=int, default=15, help="Minimum games for synergy/flex")
    parser.add_argument("--all-time", action="store_true", help="Disable recency weighting (flat all-time count)")
    parser.add_argument(
        "--no-overrides",
        action="store_true",
        help="Disable hand-maintained tier overrides from hero_tier_overrides.json",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Print deep intel on tier overrides & patch notes",
    )
    args = parser.parse_args()

    matches = load_matches(league_filter=args.league, min_year=args.min_year)

    if args.summary:
        run_summary(matches)
    elif args.tier_list:
        run_tier_list(
            matches,
            top=args.top,
            use_recency=not args.all_time,
            apply_overrides=not args.no_overrides,
            verbose=args.verbose,
        )
    elif args.emerging:
        run_emerging(matches, top=args.top)
    elif args.flex_picks:
        run_flex_picks(min_games=args.min_games)
    elif args.duo_synergy:
        run_duo_synergy(matches, min_games=args.min_games)
    elif args.hero_stats:
        run_hero_stats(matches, args.hero_stats, verbose=args.verbose)
    else:
        # Default behavior: summary + tier list top 15
        run_summary(matches)
        print()
        run_tier_list(
            matches,
            top=15,
            use_recency=not args.all_time,
            apply_overrides=not args.no_overrides,
            verbose=args.verbose,
        )


if __name__ == "__main__":
    main()
