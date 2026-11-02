import math
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
    blue_ban_cols = [f"blue_ban_{i}" for i in range(1, 5)]
    red_ban_cols = [f"red_ban_{i}" for i in range(1, 5)]
    phase1_ban_cols = ["blue_ban_1", "red_ban_1", "blue_ban_2", "red_ban_2"]
    phase2_ban_cols = ["red_ban_3", "blue_ban_3", "red_ban_4", "blue_ban_4"]
    hero_meta = {row["name"]: row.to_dict() for _, row in heroes_df.iterrows()}

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
            "weighted_bans_p2": 0.0,
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
    same_lane_games = defaultdict(float)
    same_lane_wins = defaultdict(float)
    co_ban_same_team = defaultdict(float)
    co_p2ban_same_team = defaultdict(float)
    total_effective_games = 0.0

    for _, row in matches_df.iterrows():
        yr = int(row["year"]) if str(row.get("year", "2025")).isdigit() else 2025
        weight = get_recency_weight(yr)
        total_effective_games += weight
        blue_win = int(row["blue_win"])

        b_picks = [row[c] for c in blue_pick_cols if row[c] in stats]
        r_picks = [row[c] for c in red_pick_cols if row[c] in stats]
        b_bans = [row[c] for c in blue_ban_cols if row[c] in stats]
        r_bans = [row[c] for c in red_ban_cols if row[c] in stats]
        b_bans_p2 = [row[c] for c in blue_ban_cols[2:4] if row[c] in stats]
        r_bans_p2 = [row[c] for c in red_ban_cols[2:4] if row[c] in stats]
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
            stats[h]["weighted_bans_p2"] += weight
            stats[h]["bans_phase2"] += 1

        # Same-team protective ban tracking: (picked_target_hero, banned_counter_hero)
        for hp in b_picks:
            for hb in b_bans:
                co_ban_same_team[(hp, hb)] += weight
            for hb in b_bans_p2:
                co_p2ban_same_team[(hp, hb)] += weight
        for hp in r_picks:
            for hb in r_bans:
                co_ban_same_team[(hp, hb)] += weight
            for hb in r_bans_p2:
                co_p2ban_same_team[(hp, hb)] += weight

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

        # Counter / Matchup (opposing teams, recency weighted + exact same-lane 1v1 tracking)
        for i, hb in enumerate(b_picks):
            for j, hr in enumerate(r_picks):
                matchup_games[(hb, hr)] += weight
                matchup_games[(hr, hb)] += weight
                if blue_win == 1:
                    matchup_wins[(hb, hr)] += weight
                elif blue_win == 0:
                    matchup_wins[(hr, hb)] += weight

                if i == j and i < 5:
                    same_lane_games[(hb, hr)] += weight
                    same_lane_games[(hr, hb)] += weight
                    if blue_win == 1:
                        same_lane_wins[(hb, hr)] += weight
                    elif blue_win == 0:
                        same_lane_wins[(hr, hb)] += weight

    # Compute Bayesian base win probabilities, log-odds (Bradley-Terry baseline), and normalized 5-lane vectors
    hero_base_prob = {}
    hero_logit = {}
    hero_lane_vec = {}
    for h in hero_names:
        s = stats[h]
        p_prob = min(max((s["weighted_wins"] + 5.0) / (s["weighted_picks"] + 10.0), 0.05), 0.95)
        hero_base_prob[h] = p_prob
        hero_logit[h] = math.log(p_prob / (1.0 - p_prob))
        l_arr = np.array([s[k] for k in lane_keys], dtype=np.float64) + 0.1
        hero_lane_vec[h] = l_arr / np.linalg.norm(l_arr)

    def get_counter_alignment(c_name: str, t_name: str) -> float:
        cm = hero_meta.get(c_name, {})
        tm = hero_meta.get(t_name, {})
        lane_cos = float(np.dot(hero_lane_vec[c_name], hero_lane_vec[t_name]))
        kit_bonus = 0.0
        if (cm.get("has_suppress") or c_name in ("Mina", "Roxie", "Baldum")) and (
            tm.get("has_mobility") or tm.get("has_immunity") or tm.get("primary_role") in ("Warrior", "Assassin")
        ):
            kit_bonus += 0.45
        if (
            cm.get("has_true_damage")
            and (tm.get("has_shield") or tm.get("has_heal_sustain") or tm.get("primary_role") in ("Tank", "Warrior"))
            and (lane_cos >= 0.25 or c_name == "Mina")
        ):
            kit_bonus += 0.35
        if cm.get("primary_role") == "Assassin" and tm.get("primary_role") in ("Marksman", "Mage"):
            kit_bonus += 0.35
        if lane_cos < 0.30 and kit_bonus < 0.35:
            return 0.0
        return min(1.15, 0.35 + 0.85 * lane_cos + kit_bonus)

    # Save hero_draft_stats.csv
    lane_labels = ["DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"]
    hero_rows = []
    for h in hero_names:
        s = stats[h]
        p = s["picks"]
        wp = s["weighted_picks"]
        wb = s["weighted_bans"]
        presence_pct = (wp + wb) / total_effective_games * 100.0
        wr = (s["wins"] / p * 100.0) if p > 0 else 50.0
        smoothed_wr = ((s["weighted_wins"] + 3.0) / (wp + 6.0)) * 100.0
        lane_counts = [s[k] for k in lane_keys]
        main_lane = lane_labels[int(np.argmax(lane_counts))] if wp > 0 else "Unknown"
        hero_rows.append(
            {
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
            }
        )

    stats_df = pd.DataFrame(hero_rows)
    stats_path = DATA_DIR / "hero_draft_stats.csv"
    stats_df.to_csv(stats_path, index=False, encoding="utf-8-sig")

    # Save top synergy & counter pairs using Bradley-Terry Log-Odds Delta-2 + Empirical Bayes shrinkage (K=12)
    prior_k = 12.0
    synergy_rows = []
    for (ha, hb), g in synergy_games.items():
        if ha < hb and g >= 3.0:
            w = synergy_wins[(ha, hb)]
            wr = w / g * 100.0
            exp_wr = 1.0 / (1.0 + math.exp(-(hero_logit[ha] + hero_logit[hb])))
            post_wr = (w + prior_k * exp_wr) / (g + prior_k)
            delta2_lift = post_wr - exp_wr
            z_score = (w - g * exp_wr) / math.sqrt(g * exp_wr * (1.0 - exp_wr) + 1.0)
            lift = g / max(1e-4, (stats[ha]["weighted_picks"] * stats[hb]["weighted_picks"]) / total_effective_games)
            synergy_rows.append(
                {
                    "hero_a": ha,
                    "hero_b": hb,
                    "games_together": round(g, 1),
                    "wins_together": round(w, 1),
                    "win_rate_pct": round(wr, 2),
                    "expected_wr_pct": round(exp_wr * 100.0, 2),
                    "posterior_wr_pct": round(post_wr * 100.0, 2),
                    "synergy_delta2_pct": round(delta2_lift * 100.0, 2),
                    "synergy_z_score": round(z_score, 3),
                    "co_pick_lift": round(lift, 3),
                }
            )
    synergy_df = pd.DataFrame(synergy_rows).sort_values(
        by=["synergy_delta2_pct", "games_together"], ascending=[False, False]
    )
    synergy_path = DATA_DIR / "synergy_matrix.csv"
    synergy_df.to_csv(synergy_path, index=False, encoding="utf-8-sig")

    total_team_games = max(1.0, 2.0 * total_effective_games)

    def get_censor_imputation(c_hero: str, t_hero: str, exp_wr_ct: float) -> tuple[float, float, float]:
        obs_b = co_ban_same_team[(t_hero, c_hero)] + 1.5 * co_p2ban_same_team[(t_hero, c_hero)]
        exp_b = stats[t_hero]["weighted_picks"] * (
            (stats[c_hero]["weighted_bans"] + 1.5 * stats[c_hero]["weighted_bans_p2"]) / total_team_games
        )
        excess_b = max(0.0, obs_b - exp_b)
        b_lift = (obs_b + 5.0) / (exp_b + 5.0)
        b_z = (obs_b - exp_b) / math.sqrt(exp_b + 2.0)
        align_w = get_counter_alignment(c_hero, t_hero)
        if b_lift > 1.15 and excess_b > 1.5 and align_w > 0.0:
            g_cen = min(18.0, 0.45 * excess_b * align_w)
            p_thr = min(0.82, exp_wr_ct + 0.14 + 0.04 * min(b_z, 4.0))
            return g_cen, g_cen * p_thr, b_lift
        return 0.0, 0.0, b_lift

    counter_rows = []
    for ha in hero_names:
        for hb in hero_names:
            if ha == hb:
                continue
            g = matchup_games[(ha, hb)]
            w = matchup_wins[(ha, hb)]
            exp_wr = 1.0 / (1.0 + math.exp(-(hero_logit[ha] - hero_logit[hb])))

            # Forward censoring (hb team bans ha) + Reverse censoring (ha team bans hb) for skew-symmetry
            g_cen_fwd, w_cen_fwd, ban_lift = get_censor_imputation(ha, hb, exp_wr)
            g_cen_rev, w_cen_rev, _ = get_censor_imputation(hb, ha, 1.0 - exp_wr)
            g_censor = g_cen_fwd + g_cen_rev
            w_censor = w_cen_fwd + (g_cen_rev - w_cen_rev)

            if (g + g_censor) >= 3.0:
                wr = (w / g * 100.0) if g > 0 else (exp_wr * 100.0)
                played_post_wr = (w + prior_k * exp_wr) / (g + prior_k)
                played_delta2 = played_post_wr - exp_wr
                post_wr = (w + w_censor + prior_k * exp_wr) / (g + g_censor + prior_k)
                delta2_adv = post_wr - exp_wr
                g_eff = g + g_censor
                w_eff = w + w_censor
                z_score = (w_eff - g_eff * exp_wr) / math.sqrt(g_eff * exp_wr * (1.0 - exp_wr) + 1.0)
                sl_g = same_lane_games[(ha, hb)]
                sl_w = same_lane_wins[(ha, hb)]
                sl_wr = (sl_w / sl_g * 100.0) if sl_g > 0 else 0.0
                counter_rows.append(
                    {
                        "hero": ha,
                        "opponent_hero": hb,
                        "games_against": round(g, 1),
                        "wins_against": round(w, 1),
                        "win_rate_against_pct": round(wr, 2),
                        "expected_wr_pct": round(exp_wr * 100.0, 2),
                        "posterior_wr_pct": round(post_wr * 100.0, 2),
                        "played_delta2_pct": round(played_delta2 * 100.0, 2),
                        "smoothed_advantage": round(delta2_adv * 100.0, 2),
                        "counter_z_score": round(z_score, 3),
                        "protective_ban_lift": round(ban_lift, 2),
                        "censored_ban_equiv_games": round(g_cen_fwd, 1),
                        "same_lane_games": round(sl_g, 1),
                        "same_lane_wins": round(sl_w, 1),
                        "same_lane_wr_pct": round(sl_wr, 2),
                    }
                )
    counter_df = pd.DataFrame(counter_rows).sort_values(
        by=["smoothed_advantage", "games_against"], ascending=[False, False]
    )
    counter_path = DATA_DIR / "counter_matrix.csv"
    counter_df.to_csv(counter_path, index=False, encoding="utf-8-sig")

    print(f"Saved recency-weighted hero draft stats to: {stats_path}")
    print(f"Saved {len(synergy_df)} Bradley-Terry Delta-2 synergy pairs to: {synergy_path}")
    print(f"Saved {len(counter_df)} Censoring-Adjusted Bradley-Terry Delta-2 matchup/counter pairs to: {counter_path}")


if __name__ == "__main__":
    main()
