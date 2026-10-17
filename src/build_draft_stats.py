from collections import defaultdict
from pathlib import Path
import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"


def get_recency_weight(year_val: int) -> float:
    if year_val >= 2026:
        return 1.0
    elif year_val == 2025:
        return 0.5
    else:
        return 0.2


def main():
    heroes_df = pd.read_csv(DATA_DIR / "heroes_130_summary.csv")
    matches_df = pd.read_csv(DATA_DIR / "matches_draft_flat.csv", keep_default_na=False)

    hero_names = sorted(heroes_df["name"].tolist())
    total_games = len(matches_df)
    print(f"Computing recency-weighted draft statistics across {total_games} pro games for {len(hero_names)} heroes...")

    blue_pick_cols = [f"blue_pick_{i}" for i in range(1, 6)]
    red_pick_cols = [f"red_pick_{i}" for i in range(1, 6)]
    phase1_ban_cols = ["blue_ban_1", "red_ban_1", "blue_ban_2", "red_ban_2"]
    phase2_ban_cols = ["red_ban_3", "blue_ban_3", "red_ban_4", "blue_ban_4"]

    lane_keys = ["ds_lane_picks", "jungle_picks", "mid_picks", "dragon_lane_picks", "roam_picks"]
    stats = {
        h: {
            "picks": 0,
            "wins": 0,
            "weighted_picks": 0.0,
            "weighted_wins": 0.0,
            "blue_picks": 0,
            "red_picks": 0,
            "ds_lane_picks": 0.0,
            "jungle_picks": 0.0,
            "mid_picks": 0.0,
            "dragon_lane_picks": 0.0,
            "roam_picks": 0.0,
            "bans_total": 0,
            "weighted_bans": 0.0,
            "bans_phase1": 0,
            "bans_phase2": 0,
        }
        for h in hero_names
    }

    # Pairwise counts with recency weights: (hero_a, hero_b)
    synergy_games = defaultdict(float)
    synergy_wins = defaultdict(float)
    matchup_games = defaultdict(float)
    matchup_wins = defaultdict(float)
    total_effective_games = 0.0

    for _, row in matches_df.iterrows():
        yr = int(row["year"]) if str(row.get("year", "2025")).isdigit() else 2025
        weight = get_recency_weight(yr)
        total_effective_games += weight
        blue_win = int(row["blue_win"])

        b_picks = [row[c] for c in blue_pick_cols if row[c] in stats]
        r_picks = [row[c] for c in red_pick_cols if row[c] in stats]
        p1_bans = [row[c] for c in phase1_ban_cols if row[c] in stats]
        p2_bans = [row[c] for c in phase2_ban_cols if row[c] in stats]

        # Bans
        for h in p1_bans:
            stats[h]["bans_total"] += 1
            stats[h]["weighted_bans"] += weight
            stats[h]["bans_phase1"] += 1
        for h in p2_bans:
            stats[h]["bans_total"] += 1
            stats[h]["weighted_bans"] += weight
            stats[h]["bans_phase2"] += 1

        # Blue picks (h1=DS, h2=Jungle, h3=Mid, h4=Dragon/Carry, h5=Roam)
        for idx, h in enumerate(b_picks):
            stats[h]["picks"] += 1
            stats[h]["weighted_picks"] += weight
            stats[h]["blue_picks"] += 1
            if blue_win == 1:
                stats[h]["wins"] += 1
                stats[h]["weighted_wins"] += weight
            if idx < 5:
                stats[h][lane_keys[idx]] += weight

        # Red picks (h1=DS, h2=Jungle, h3=Mid, h4=Dragon/Carry, h5=Roam)
        for idx, h in enumerate(r_picks):
            stats[h]["picks"] += 1
            stats[h]["weighted_picks"] += weight
            stats[h]["red_picks"] += 1
            if blue_win == 0:
                stats[h]["wins"] += 1
                stats[h]["weighted_wins"] += weight
            if idx < 5:
                stats[h][lane_keys[idx]] += weight

        # Synergy (same team, recency weighted)
        for i in range(len(b_picks)):
            for j in range(len(b_picks)):
                if i != j:
                    ha, hb = b_picks[i], b_picks[j]
                    synergy_games[(ha, hb)] += weight
                    if blue_win == 1:
                        synergy_wins[(ha, hb)] += weight

        for i in range(len(r_picks)):
            for j in range(len(r_picks)):
                if i != j:
                    ha, hb = r_picks[i], r_picks[j]
                    synergy_games[(ha, hb)] += weight
                    if blue_win == 0:
                        synergy_wins[(ha, hb)] += weight

        # Counter / Matchup (opposing teams, recency weighted)
        for hb in b_picks:
            for hr in r_picks:
                matchup_games[(hb, hr)] += weight
                matchup_games[(hr, hb)] += weight
                if blue_win == 1:
                    matchup_wins[(hb, hr)] += weight
                elif blue_win == 0:
                    matchup_wins[(hr, hb)] += weight

    # Save hero_draft_stats.csv
    lane_labels = ["DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"]
    hero_rows = []
    for h in hero_names:
        s = stats[h]
        p = s["picks"]
        b = s["bans_total"]
        wp = s["weighted_picks"]
        wb = s["weighted_bans"]
        presence_pct = (wp + wb) / total_effective_games * 100.0
        wr = (s["wins"] / p * 100.0) if p > 0 else 50.0
        smoothed_wr = ((s["weighted_wins"] + 3.0) / (wp + 6.0)) * 100.0
        lane_counts = [s[k] for k in lane_keys]
        main_lane = lane_labels[int(np.argmax(lane_counts))] if wp > 0 else "Unknown"
        hero_rows.append({
            "name": h,
            "main_pro_lane": main_lane,
            "picks": p,
            "wins": s["wins"],
            "win_rate_pct": round(wr, 2),
            "smoothed_win_rate_pct": round(smoothed_wr, 2),
            "pick_rate_pct": round(wp / total_effective_games * 100.0, 2),
            "ban_rate_pct": round(wb / total_effective_games * 100.0, 2),
            "presence_pct": round(presence_pct, 2),
            "blue_picks": s["blue_picks"],
            "red_picks": s["red_picks"],
            "ds_lane_picks": round(s["ds_lane_picks"], 1),
            "jungle_picks": round(s["jungle_picks"], 1),
            "mid_picks": round(s["mid_picks"], 1),
            "dragon_lane_picks": round(s["dragon_lane_picks"], 1),
            "roam_picks": round(s["roam_picks"], 1),
            "bans_phase1": s["bans_phase1"],
            "bans_phase2": s["bans_phase2"],
        })

    stats_df = pd.DataFrame(hero_rows)
    stats_path = DATA_DIR / "hero_draft_stats.csv"
    stats_df.to_csv(stats_path, index=False, encoding="utf-8-sig")

    # Save top synergy & counter pairs and full matrices
    synergy_rows = []
    for (ha, hb), g in synergy_games.items():
        if ha < hb and g >= 3.0:
            w = synergy_wins[(ha, hb)]
            wr = w / g * 100.0
            pa = stats[ha]["weighted_picks"] / total_effective_games
            pb = stats[hb]["weighted_picks"] / total_effective_games
            lift = g / max(1e-4, (stats[ha]["weighted_picks"] * stats[hb]["weighted_picks"]) / total_effective_games)
            synergy_rows.append({
                "hero_a": ha,
                "hero_b": hb,
                "games_together": round(g, 1),
                "wins_together": round(w, 1),
                "win_rate_pct": round(wr, 2),
                "co_pick_lift": round(lift, 3),
            })
    synergy_df = pd.DataFrame(synergy_rows).sort_values(by=["games_together", "win_rate_pct"], ascending=False)
    synergy_path = DATA_DIR / "synergy_matrix.csv"
    synergy_df.to_csv(synergy_path, index=False, encoding="utf-8-sig")

    counter_rows = []
    for (ha, hb), g in matchup_games.items():
        if g >= 3.0:
            w = matchup_wins[(ha, hb)]
            wr = w / g * 100.0
            smoothed_adv = ((w + 3.0) / (g + 6.0)) - 0.5
            counter_rows.append({
                "hero": ha,
                "opponent_hero": hb,
                "games_against": round(g, 1),
                "wins_against": round(w, 1),
                "win_rate_against_pct": round(wr, 2),
                "smoothed_advantage": round(smoothed_adv * 100.0, 2),
            })
    counter_df = pd.DataFrame(counter_rows).sort_values(by=["games_against", "win_rate_against_pct"], ascending=False)
    counter_path = DATA_DIR / "counter_matrix.csv"
    counter_df.to_csv(counter_path, index=False, encoding="utf-8-sig")

    print(f"Saved recency-weighted hero draft stats to: {stats_path}")
    print(f"Saved {len(synergy_df)} synergy pairs to: {synergy_path}")
    print(f"Saved {len(counter_df)} matchup/counter pairs to: {counter_path}")


if __name__ == "__main__":
    main()
