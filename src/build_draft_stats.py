import math
from collections import defaultdict
from pathlib import Path
import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"


def main():
    heroes_df = pd.read_csv(DATA_DIR / "heroes_130_summary.csv")
    matches_df = pd.read_csv(DATA_DIR / "matches_draft_flat.csv", keep_default_na=False)

    hero_names = sorted(heroes_df["name"].tolist())
    total_games = len(matches_df)
    print(f"Computing draft statistics across {total_games} professional games for {len(hero_names)} heroes...")

    blue_pick_cols = [f"blue_pick_{i}" for i in range(1, 6)]
    red_pick_cols = [f"red_pick_{i}" for i in range(1, 6)]
    phase1_ban_cols = ["blue_ban_1", "red_ban_1", "blue_ban_2", "red_ban_2"]
    phase2_ban_cols = ["red_ban_3", "blue_ban_3", "red_ban_4", "blue_ban_4"]

    lane_keys = ["ds_lane_picks", "jungle_picks", "mid_picks", "dragon_lane_picks", "roam_picks"]
    stats = {
        h: {
            "picks": 0,
            "wins": 0,
            "blue_picks": 0,
            "red_picks": 0,
            "ds_lane_picks": 0,
            "jungle_picks": 0,
            "mid_picks": 0,
            "dragon_lane_picks": 0,
            "roam_picks": 0,
            "bans_total": 0,
            "bans_phase1": 0,
            "bans_phase2": 0,
        }
        for h in hero_names
    }

    # Pairwise counts: (hero_a, hero_b)
    synergy_games = defaultdict(int)
    synergy_wins = defaultdict(int)
    matchup_games = defaultdict(int)
    matchup_wins = defaultdict(int)  # hero_a wins against hero_b

    for _, row in matches_df.iterrows():
        blue_win = int(row["blue_win"])
        b_picks = [row[c] for c in blue_pick_cols if row[c] in stats]
        r_picks = [row[c] for c in red_pick_cols if row[c] in stats]
        p1_bans = [row[c] for c in phase1_ban_cols if row[c] in stats]
        p2_bans = [row[c] for c in phase2_ban_cols if row[c] in stats]

        # Bans
        for h in p1_bans:
            stats[h]["bans_total"] += 1
            stats[h]["bans_phase1"] += 1
        for h in p2_bans:
            stats[h]["bans_total"] += 1
            stats[h]["bans_phase2"] += 1

        # Blue picks (h1=DS, h2=Jungle, h3=Mid, h4=Dragon/Carry, h5=Roam)
        for idx, h in enumerate(b_picks):
            stats[h]["picks"] += 1
            stats[h]["blue_picks"] += 1
            if blue_win == 1:
                stats[h]["wins"] += 1
            if idx < 5:
                stats[h][lane_keys[idx]] += 1

        # Red picks (h1=DS, h2=Jungle, h3=Mid, h4=Dragon/Carry, h5=Roam)
        for idx, h in enumerate(r_picks):
            stats[h]["picks"] += 1
            stats[h]["red_picks"] += 1
            if blue_win == 0:
                stats[h]["wins"] += 1
            if idx < 5:
                stats[h][lane_keys[idx]] += 1

        # Synergy (same team)
        for i in range(len(b_picks)):
            for j in range(len(b_picks)):
                if i != j:
                    ha, hb = b_picks[i], b_picks[j]
                    synergy_games[(ha, hb)] += 1
                    if blue_win == 1:
                        synergy_wins[(ha, hb)] += 1

        for i in range(len(r_picks)):
            for j in range(len(r_picks)):
                if i != j:
                    ha, hb = r_picks[i], r_picks[j]
                    synergy_games[(ha, hb)] += 1
                    if blue_win == 0:
                        synergy_wins[(ha, hb)] += 1

        # Counter / Matchup (opposing teams)
        for hb in b_picks:
            for hr in r_picks:
                matchup_games[(hb, hr)] += 1
                matchup_games[(hr, hb)] += 1
                if blue_win == 1:
                    matchup_wins[(hb, hr)] += 1
                elif blue_win == 0:
                    matchup_wins[(hr, hb)] += 1

    # Save hero_draft_stats.csv
    lane_labels = ["DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"]
    hero_rows = []
    for h in hero_names:
        s = stats[h]
        p = s["picks"]
        b = s["bans_total"]
        presence = (p + b) / total_games * 100.0
        wr = (s["wins"] / p * 100.0) if p > 0 else 50.0
        smoothed_wr = ((s["wins"] + 5.0) / (p + 10.0)) * 100.0
        lane_counts = [s[k] for k in lane_keys]
        main_lane = lane_labels[int(np.argmax(lane_counts))] if p > 0 else "Unknown"
        hero_rows.append({
            "name": h,
            "main_pro_lane": main_lane,
            "picks": p,
            "wins": s["wins"],
            "win_rate_pct": round(wr, 2),
            "smoothed_win_rate_pct": round(smoothed_wr, 2),
            "pick_rate_pct": round(p / total_games * 100.0, 2),
            "ban_rate_pct": round(b / total_games * 100.0, 2),
            "presence_pct": round(presence, 2),
            "blue_picks": s["blue_picks"],
            "red_picks": s["red_picks"],
            "ds_lane_picks": s["ds_lane_picks"],
            "jungle_picks": s["jungle_picks"],
            "mid_picks": s["mid_picks"],
            "dragon_lane_picks": s["dragon_lane_picks"],
            "roam_picks": s["roam_picks"],
            "bans_phase1": s["bans_phase1"],
            "bans_phase2": s["bans_phase2"],
        })

    stats_df = pd.DataFrame(hero_rows)
    stats_path = DATA_DIR / "hero_draft_stats.csv"
    stats_df.to_csv(stats_path, index=False, encoding="utf-8-sig")

    # Save top synergy & counter pairs and full matrices
    synergy_rows = []
    for (ha, hb), g in synergy_games.items():
        if ha < hb and g >= 5:
            w = synergy_wins[(ha, hb)]
            wr = w / g * 100.0
            # Expected co-occurrence under independence
            pa = stats[ha]["picks"] / total_games
            pb = stats[hb]["picks"] / total_games
            expected_g = max(1.0, total_games * 2 * (10 / 130) * pa * pb * 10)
            lift = g / max(1.0, (stats[ha]["picks"] * stats[hb]["picks"]) / total_games)
            synergy_rows.append({
                "hero_a": ha,
                "hero_b": hb,
                "games_together": g,
                "wins_together": w,
                "win_rate_pct": round(wr, 2),
                "co_pick_lift": round(lift, 3),
            })
    synergy_df = pd.DataFrame(synergy_rows).sort_values(by=["games_together", "win_rate_pct"], ascending=False)
    synergy_path = DATA_DIR / "synergy_matrix.csv"
    synergy_df.to_csv(synergy_path, index=False, encoding="utf-8-sig")

    counter_rows = []
    for (ha, hb), g in matchup_games.items():
        if g >= 5:
            w = matchup_wins[(ha, hb)]
            wr = w / g * 100.0
            smoothed_adv = ((w + 5.0) / (g + 10.0)) - 0.5
            counter_rows.append({
                "hero": ha,
                "opponent_hero": hb,
                "games_against": g,
                "wins_against": w,
                "win_rate_against_pct": round(wr, 2),
                "smoothed_advantage": round(smoothed_adv * 100.0, 2),
            })
    counter_df = pd.DataFrame(counter_rows).sort_values(by=["games_against", "win_rate_against_pct"], ascending=False)
    counter_path = DATA_DIR / "counter_matrix.csv"
    counter_df.to_csv(counter_path, index=False, encoding="utf-8-sig")

    print(f"Saved hero draft stats to: {stats_path}")
    print(f"Saved {len(synergy_df)} synergy pairs to: {synergy_path}")
    print(f"Saved {len(counter_df)} matchup/counter pairs to: {counter_path}")

    print("\nTop 10 Most Present Heroes in Pro Play (2024-2026):")
    print(stats_df.sort_values("presence_pct", ascending=False).head(10)[
        ["name", "main_pro_lane", "picks", "ban_rate_pct", "presence_pct", "win_rate_pct"]
    ].to_string(index=False))


if __name__ == "__main__":
    main()
