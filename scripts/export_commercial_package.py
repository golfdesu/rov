"""Export Commercial RoV Pro Draft Intelligence 2026 Package (.xlsx + .csv + ZIP).

Generates a commercial-grade analytics bundle from the verified 2026 Tier-1
pro games (RPL, AOG, GCS, APL, AIC) featuring:
  1. True Chronological Pick Order (B1..B5 / R1..R5 from broadcast HUD screenshots)
  2. Post-Swap In-Game 5-Lane Assignments (DS Lane, Jungle, Mid, Dragon Lane, Roam)
  3. Bradley-Terry Log-Odds Delta-2 & Empirical Bayes Shrinkage Synergy/Counter Engine
  4. Role-Aware Direct In-Lane 1v1 Counter Matchups & Kit Mechanism Grounding
"""

import json
import math
import zipfile
from collections import Counter, defaultdict
from datetime import datetime
from itertools import combinations
from pathlib import Path

import openpyxl
import pandas as pd
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
EXPORT_ROOT = BASE_DIR / "exports"
PACKAGE_NAME = "RoV_Pro_Draft_Intelligence_2026"
PACKAGE_DIR = EXPORT_ROOT / PACKAGE_NAME
CSV_DIR = PACKAGE_DIR / "raw_csv"

# Post-swap in-game lane order for GCS 2026 Summer Grand Final (DCG vs ANK)
GCS_FINAL_LANES = {
    ("Garena_Challenger_Series_2026_Summer/Playoffs_S1067", 1): {
        "blue": ["Marja", "Butterfly", "Yue", "Violet", "Y'bneth"],
        "red": ["Qi", "Eland'orr", "Liliana", "Edras", "Wiro"],
    },
    ("Garena_Challenger_Series_2026_Summer/Playoffs_S1067", 2): {
        "blue": ["Tamyn", "Eland'orr", "Liliana", "Edras", "Toro"],
        "red": ["Biron", "Aoi", "Ignis", "Valhein", "Baldum"],
    },
    ("Garena_Challenger_Series_2026_Summer/Playoffs_S1067", 3): {
        "blue": ["Riktor", "Tachi", "Rouie", "Tel'Annas", "Y'bneth"],
        "red": ["Yena", "Airi", "Lorion", "Stuart", "Dyadia"],
    },
    ("Garena_Challenger_Series_2026_Summer/Playoffs_S1067", 4): {
        "blue": ["Ryoma", "Sinestrea", "Rouie", "Valhein", "TeeMee"],
        "red": ["Mina", "Nakroth", "Zata", "Stuart", "Thane"],
    },
    ("Garena_Challenger_Series_2026_Summer/Playoffs_S1067", 5): {
        "blue": ["Zuka", "Murad", "Zata", "Tachi", "Dolia"],
        "red": ["Ryoma", "Zephys", "Annette", "Airi", "Dyadia"],
    },
    ("Garena_Challenger_Series_2026_Summer/Playoffs_S1067", 6): {
        "blue": ["Biron", "Taara", "Mganga", "Wisp", "Zip"],
        "red": ["Yena", "Astrid", "Lorion", "Maloch", "Ata"],
    },
}


def normalize_league_code(league_name: str) -> str:
    s = league_name.upper()
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


def load_datasets():
    with open(DATA_DIR / "true_pick_order.json", encoding="utf-8") as f:
        true_order_data = json.load(f).get("games", [])

    with open(DATA_DIR / "matches_draft_full.json", encoding="utf-8") as f:
        full_matches = json.load(f)

    heroes_df = pd.read_csv(DATA_DIR / "heroes_130_summary.csv")

    tier_overrides: dict[str, str] = {}
    overrides_file = DATA_DIR / "hero_tier_overrides.json"
    if overrides_file.exists():
        try:
            with open(overrides_file, encoding="utf-8") as f:
                raw_ov = json.load(f).get("overrides", {})
                for k, v in raw_ov.items():
                    if isinstance(v, dict) and "tier" in v:
                        tier_overrides[k] = v["tier"]
                    elif isinstance(v, str):
                        tier_overrides[k] = v
        except Exception:
            tier_overrides = {}

    return true_order_data, full_matches, heroes_df, tier_overrides


def explain_counter_mechanic(c_meta: dict, t_meta: dict, is_same_lane: bool, ban_lift: float = 1.0) -> str:
    tags = []
    c_name = c_meta.get("name", "")
    if c_name == "Riktor":
        tags.append("Damage Block (Retaliate) + Bush Knockup")
    if (c_meta.get("has_suppress") or c_name in ("Mina", "Roxie", "Baldum")) and (
        t_meta.get("has_mobility")
        or t_meta.get("has_immunity")
        or t_meta.get("primary_role") in ("Fighter", "Warrior", "Assassin")
    ):
        tags.append("Suppress/Taunt Lockdown vs Mobility")
    if c_meta.get("has_true_damage") and (
        t_meta.get("has_shield")
        or t_meta.get("has_heal_sustain")
        or t_meta.get("primary_role") in ("Tank", "Fighter", "Warrior")
    ):
        tags.append("True Damage vs Shield/Sustain")
    if c_meta.get("has_immunity") and t_meta.get("has_hard_cc"):
        tags.append("CC Immunity vs Hard CC")
    if c_meta.get("has_mobility") and t_meta.get("attack_range") == "Ranged" and not t_meta.get("has_mobility"):
        tags.append("Backline Dive vs Immobile Carry")
    if c_meta.get("has_hard_cc") and t_meta.get("has_mobility") and "Suppress/Taunt Lockdown vs Mobility" not in tags:
        tags.append("Hard CC Lockdown vs Mobile Target")
    if ban_lift >= 1.35:
        tags.append("High Preemptive Protective Ban Target")
    if not tags:
        scope = "In-Lane Trade" if is_same_lane else "Teamfight"
        tags.append(f"{c_meta.get('primary_role', 'Hero')} vs {t_meta.get('primary_role', 'Hero')} ({scope})")
    return " + ".join(tags[:2])


def explain_synergy_mechanic(a_meta: dict, b_meta: dict) -> str:
    tags = []
    r_a = a_meta.get("primary_role", "")
    r_b = b_meta.get("primary_role", "")
    if (a_meta.get("has_suppress") or b_meta.get("has_suppress")) and (
        "Assassin" in (r_a, r_b) or "Mage" in (r_a, r_b) or "Carry" in (r_a, r_b) or "Marksman" in (r_a, r_b)
    ):
        tags.append("Suppress Lockdown + Burst Follow-Up")
    elif (a_meta.get("has_hard_cc") or b_meta.get("has_hard_cc")) and (
        a_meta.get("has_true_damage") or b_meta.get("has_true_damage") or "Assassin" in (r_a, r_b)
    ):
        tags.append("CC Setup + Finisher Combo")
    if (
        a_meta.get("has_shield")
        or a_meta.get("has_heal_sustain")
        or b_meta.get("has_shield")
        or b_meta.get("has_heal_sustain")
    ) and (
        "Carry" in (r_a, r_b)
        or "Marksman" in (r_a, r_b)
        or "Assassin" in (r_a, r_b)
        or "Fighter" in (r_a, r_b)
        or "Warrior" in (r_a, r_b)
    ):
        tags.append("Carry Peel & Sustain")
    if a_meta.get("has_mobility") and b_meta.get("has_mobility"):
        tags.append("High-Tempo Dive & Rotation")
    if a_meta.get("damage_type") != b_meta.get("damage_type") and {
        a_meta.get("damage_type"),
        b_meta.get("damage_type"),
    } >= {"Physical", "Magic"}:
        tags.append("Mixed Physical/Magic Threat")
    if not tags:
        tags.append(f"{r_a} + {r_b} Tactical Pairing")
    return " + ".join(tags[:2])


def build_dataframes():
    true_order_games, full_matches, heroes_df, tier_overrides = load_datasets()
    match_lookup = {(m["series_id"], int(m["game_number"])): m for m in full_matches}
    hero_meta = {row["name"]: row.to_dict() for _, row in heroes_df.iterrows()}

    draft_rows = []
    hero_picks = Counter()
    hero_wins = Counter()
    hero_bans_p1 = Counter()
    hero_bans_p2 = Counter()
    hero_b1_picks = Counter()
    hero_b1_wins = Counter()
    hero_r1r2_picks = Counter()
    hero_r5_picks = Counter()
    hero_r5_wins = Counter()
    hero_blue_picks = Counter()
    hero_red_picks = Counter()
    hero_lane_counts = defaultdict(lambda: Counter())

    hero_p1_pb = Counter()
    hero_p2_pb = Counter()
    hero_p3_pb = Counter()
    hero_p3_picks = Counter()
    hero_p3_wins = Counter()
    p1_tot = 0
    p2_tot = 0
    p3_tot = 0
    p1_months = {"January", "February", "March", "April", "May"}
    p2_months = {"June", "July", "August"}
    p3_months = {"September", "October", "November", "December"}
    evita_first_idx = None

    duo_games = Counter()
    duo_wins = Counter()
    duo_lane_pairs = defaultdict(lambda: Counter())

    vs_games = Counter()
    vs_wins = Counter()
    same_lane_vs_games = Counter()
    same_lane_vs_wins = Counter()
    same_lane_role_counts = defaultdict(lambda: Counter())
    co_ban_same_team = Counter()
    co_p2ban_same_team = Counter()

    league_summary = defaultdict(lambda: {"games": 0, "blue_wins": 0, "red_wins": 0})
    lane_names = ["DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"]

    def parse_date_key(tg):
        key = (tg["series_id"], int(tg["game_number"]))
        m = match_lookup.get(key, {})
        d_str = m.get("date", tg.get("date", ""))
        if not isinstance(d_str, str):
            return datetime(2026, 1, 1), key[0], key[1]
        clean_d = d_str.split(" - ")[0].strip()
        try:
            dt = datetime.strptime(clean_d, "%B %d, %Y")
        except Exception:
            dt = datetime(2026, 1, 1)
        return dt, key[0], key[1]

    true_order_games = sorted(true_order_games, key=parse_date_key)

    for idx, tg in enumerate(true_order_games, start=1):
        key = (tg["series_id"], int(tg["game_number"]))
        m = match_lookup.get(key, {})

        league_full = m.get("league", "Unknown")
        league_code = normalize_league_code(league_full)
        year = int(m.get("year", 2026))
        stage = m.get("stage", "")
        date_str = m.get("date", tg.get("date", ""))
        bestof = m.get("bestof", 5)
        length = m.get("length", "") or "N/A"
        blue_team = m.get("blue_team", tg.get("blue_team", ""))
        red_team = m.get("red_team", tg.get("red_team", ""))
        blue_win = int(m.get("blue_win", 0))
        winner_team = blue_team if blue_win == 1 else red_team
        winner_side = "Blue" if blue_win == 1 else "Red"

        m_name = date_str.split()[0] if date_str else ""
        if m_name in p1_months:
            p1_tot += 1
        elif m_name in p2_months:
            p2_tot += 1
        elif m_name in p3_months:
            p3_tot += 1

        league_summary[league_code]["games"] += 1
        if blue_win == 1:
            league_summary[league_code]["blue_wins"] += 1
        else:
            league_summary[league_code]["red_wins"] += 1

        # Bans (padded to 4 if short)
        b_bans = list(m.get("blue_bans", [])) + ["None"] * 4
        r_bans = list(m.get("red_bans", [])) + ["None"] * 4
        b_bans = b_bans[:4]
        r_bans = r_bans[:4]

        for b in b_bans[:2] + r_bans[:2]:
            if b and b != "None":
                hero_bans_p1[b] += 1
        for b in b_bans[2:4] + r_bans[2:4]:
            if b and b != "None":
                hero_bans_p2[b] += 1

        # True chronological picks
        b_true = list(tg["blue_picks"])
        r_true = list(tg["red_picks"])

        # Patch-Split (P1 Spring, P2 Summer/APL, P3 Winter/Championship) tracking
        game_pb = set(b_true + r_true)
        for b in b_bans + r_bans:
            if b and b != "None":
                game_pb.add(b)
        if "Evita" in game_pb and evita_first_idx is None:
            evita_first_idx = idx

        if m_name in p1_months:
            for h in game_pb:
                hero_p1_pb[h] += 1
        elif m_name in p2_months:
            for h in game_pb:
                hero_p2_pb[h] += 1
        elif m_name in p3_months:
            for h in game_pb:
                hero_p3_pb[h] += 1
            for h in b_true:
                hero_p3_picks[h] += 1
                if blue_win == 1:
                    hero_p3_wins[h] += 1
            for h in r_true:
                hero_p3_picks[h] += 1
                if blue_win == 0:
                    hero_p3_wins[h] += 1

        for hp in set(b_true):
            for hb in b_bans:
                if hb and hb != "None":
                    co_ban_same_team[(hp, hb)] += 1
            for hb in b_bans[2:4]:
                if hb and hb != "None":
                    co_p2ban_same_team[(hp, hb)] += 1
        for hp in set(r_true):
            for hb in r_bans:
                if hb and hb != "None":
                    co_ban_same_team[(hp, hb)] += 1
            for hb in r_bans[2:4]:
                if hb and hb != "None":
                    co_p2ban_same_team[(hp, hb)] += 1

        # Post-swap in-game lanes (h1=DS, h2=JG, h3=Mid, h4=AD, h5=Roam)
        if key in GCS_FINAL_LANES:
            b_lanes = GCS_FINAL_LANES[key]["blue"]
            r_lanes = GCS_FINAL_LANES[key]["red"]
        else:
            b_lanes = list(m.get("blue_picks", b_true))
            r_lanes = list(m.get("red_picks", r_true))

        b_hero_lane = {}
        r_hero_lane = {}
        for h_lane, lname in zip(b_lanes, lane_names):
            hero_lane_counts[h_lane][lname] += 1
            b_hero_lane[h_lane] = lname
        for h_lane, lname in zip(r_lanes, lane_names):
            hero_lane_counts[h_lane][lname] += 1
            r_hero_lane[h_lane] = lname

        # Pick & win tracking
        hero_b1_picks[b_true[0]] += 1
        if blue_win == 1:
            hero_b1_wins[b_true[0]] += 1

        hero_r1r2_picks[r_true[0]] += 1
        hero_r1r2_picks[r_true[1]] += 1
        hero_r5_picks[r_true[4]] += 1
        if blue_win == 0:
            hero_r5_wins[r_true[4]] += 1

        for h in b_true:
            hero_picks[h] += 1
            hero_blue_picks[h] += 1
            if blue_win == 1:
                hero_wins[h] += 1

        for h in r_true:
            hero_picks[h] += 1
            hero_red_picks[h] += 1
            if blue_win == 0:
                hero_wins[h] += 1

        # Synergy tracking + Role Pairing
        for h1, h2 in combinations(sorted(set(b_true)), 2):
            duo_games[(h1, h2)] += 1
            if blue_win == 1:
                duo_wins[(h1, h2)] += 1
            l1 = b_hero_lane.get(h1, "Flex")
            l2 = b_hero_lane.get(h2, "Flex")
            duo_lane_pairs[(h1, h2)][f"{l1} + {l2}"] += 1

        for h1, h2 in combinations(sorted(set(r_true)), 2):
            duo_games[(h1, h2)] += 1
            if blue_win == 0:
                duo_wins[(h1, h2)] += 1
            l1 = r_hero_lane.get(h1, "Flex")
            l2 = r_hero_lane.get(h2, "Flex")
            duo_lane_pairs[(h1, h2)][f"{l1} + {l2}"] += 1

        # Counter tracking (All-Role + Direct Same-Lane 1v1)
        for bh in set(b_true):
            for rh in set(r_true):
                vs_games[(bh, rh)] += 1
                vs_games[(rh, bh)] += 1
                if blue_win == 1:
                    vs_wins[(bh, rh)] += 1
                else:
                    vs_wins[(rh, bh)] += 1

        for lane_idx, lname in enumerate(lane_names):
            if lane_idx < len(b_lanes) and lane_idx < len(r_lanes):
                bh = b_lanes[lane_idx]
                rh = r_lanes[lane_idx]
                same_lane_vs_games[(bh, rh)] += 1
                same_lane_vs_games[(rh, bh)] += 1
                same_lane_role_counts[(bh, rh)][lname] += 1
                same_lane_role_counts[(rh, bh)][lname] += 1
                if blue_win == 1:
                    same_lane_vs_wins[(bh, rh)] += 1
                else:
                    same_lane_vs_wins[(rh, bh)] += 1

        draft_rows.append(
            {
                "Match_ID": f"M2026_{idx:04d}",
                "Year": year,
                "League_Code": league_code,
                "League_Name": league_full,
                "Stage": stage,
                "Series_ID": tg["series_id"],
                "Game_Number": int(tg["game_number"]),
                "Best_Of": bestof,
                "Date": date_str,
                "Duration": length,
                "Blue_Team": blue_team,
                "Red_Team": red_team,
                "Winner_Team": winner_team,
                "Winner_Side": winner_side,
                "Blue_Win": blue_win,
                # Phase 1 Bans
                "Blue_Ban_1": b_bans[0],
                "Red_Ban_1": r_bans[0],
                "Blue_Ban_2": b_bans[1],
                "Red_Ban_2": r_bans[1],
                # Phase 1 True Picks
                "B1_Pick": b_true[0],
                "R1_Pick": r_true[0],
                "R2_Pick": r_true[1],
                "B2_Pick": b_true[1],
                "B3_Pick": b_true[2],
                "R3_Pick": r_true[2],
                # Phase 2 Bans
                "Red_Ban_3": r_bans[2],
                "Blue_Ban_3": b_bans[2],
                "Red_Ban_4": r_bans[3],
                "Blue_Ban_4": b_bans[3],
                # Phase 2 True Picks
                "R4_Pick": r_true[3],
                "B4_Pick": b_true[3],
                "B5_Pick": b_true[4],
                "R5_Pick": r_true[4],
                # Post-Swap In-Game Lanes (Blue)
                "Blue_DS_Lane": b_lanes[0],
                "Blue_Jungle": b_lanes[1],
                "Blue_Mid": b_lanes[2],
                "Blue_Dragon_Lane": b_lanes[3],
                "Blue_Roam": b_lanes[4],
                # Post-Swap In-Game Lanes (Red)
                "Red_DS_Lane": r_lanes[0],
                "Red_Jungle": r_lanes[1],
                "Red_Mid": r_lanes[2],
                "Red_Dragon_Lane": r_lanes[3],
                "Red_Roam": r_lanes[4],
            }
        )

    total_games = len(draft_rows)
    evita_eligible = (total_games - evita_first_idx + 1) if evita_first_idx is not None else max(p3_tot, 1)
    volkath_eligible = p1_tot + p2_tot
    df_drafts = pd.DataFrame(draft_rows)

    # Build Hero Tier List 2026 DataFrame + Bayesian Log-Odds Baseline
    hero_rows = []
    hero_base_wr = {}
    hero_smoothed_wr = {}
    hero_logit = {}

    for _, hrow in heroes_df.iterrows():
        hname = hrow["name"]
        picks = hero_picks[hname]
        wins = hero_wins[hname]
        losses = picks - wins
        b_p1 = hero_bans_p1[hname]
        b_p2 = hero_bans_p2[hname]
        total_bans = b_p1 + b_p2
        tot_pb = picks + total_bans

        # Patch-Split & Meta Momentum Framework (3 Major Splits of 2026)
        ann_pres = tot_pb / total_games if total_games else 0.0
        r1 = hero_p1_pb[hname] / p1_tot if p1_tot else 0.0
        r2 = hero_p2_pb[hname] / p2_tot if p2_tot else 0.0
        r3 = hero_p3_pb[hname] / p3_tot if p3_tot else 0.0

        if hname == "Evita":
            recent_pres = hero_p3_pb[hname] / evita_eligible if evita_eligible else 0.0
            recent_wr = (hero_p3_wins[hname] / hero_p3_picks[hname]) if hero_p3_picks[hname] > 0 else 0.0
            trend = "▲ Rising"
            status = "Late-Season Release"
            eligible_games = evita_eligible
        elif hname == "Zanis":
            recent_pres = r3
            recent_wr = (hero_p3_wins[hname] / hero_p3_picks[hname]) if hero_p3_picks[hname] > 0 else 0.0
            trend = "▲ Rising"
            status = "Late-Season Rework"
            eligible_games = total_games
        elif hname == "Volkath":
            recent_pres = 0.0
            recent_wr = 0.0
            trend = "🔒 Disabled"
            status = "Tournament Disabled (Bug Ban)"
            eligible_games = volkath_eligible  # Jan - Jul 2026 (P1 + P2)
        else:
            recent_pres = r3
            recent_wr = (hero_p3_wins[hname] / hero_p3_picks[hname]) if hero_p3_picks[hname] > 0 else 0.0
            delta = recent_pres - r1
            if delta >= 0.10:
                trend = "▲ Rising"
            elif delta <= -0.10:
                trend = "▼ Falling"
            else:
                trend = "● Stable"

            if hname == "Tamyn":
                status = "Mid-Year Release"
            elif r2 > 0.20 and r1 < 0.10:
                status = "Mid-Year Patch Surge"
            elif delta <= -0.15:
                status = "Fallen / Nerfed Meta"
            else:
                status = "Full Season Meta"
            eligible_games = total_games

        pick_rate = picks / eligible_games if eligible_games else 0.0
        ban_rate = total_bans / eligible_games if eligible_games else 0.0
        win_rate = wins / picks if picks > 0 else 0.0
        smoothed_p = min(max((wins + 5.0) / (picks + 10.0), 0.05), 0.95)
        hero_base_wr[hname] = win_rate
        hero_smoothed_wr[hname] = smoothed_p
        hero_logit[hname] = math.log(smoothed_p / (1.0 - smoothed_p))

        # Determine competitive tier based on Recent Patch Presence with curated overrides
        if hname in ("Evita",):
            tier = "S"
        elif hname in ("Zanis", "Ata"):
            tier = "A"
        elif hname == "Volkath":
            tier = "B"
        elif hname in ("Moren", "Bijan", "Flowborn (Mage)"):
            tier = "C"
        elif hname == "Aya":
            tier = "C" if recent_pres < 0.04 else "B"
        elif recent_pres >= 0.45:
            tier = "S+"
        elif recent_pres >= 0.25:
            tier = "S"
        elif recent_pres >= 0.12:
            tier = "A"
        elif recent_pres >= 0.04:
            tier = "B"
        else:
            tier = "C"

        lcounts = hero_lane_counts[hname]
        if picks > 0 and lcounts:
            main_lane = lcounts.most_common(1)[0][0]
            ds_pct = lcounts["DS_Lane"] / picks
            jg_pct = lcounts["Jungle"] / picks
            mid_pct = lcounts["Mid"] / picks
            ad_pct = lcounts["Dragon_Lane"] / picks
            roam_pct = lcounts["Roam"] / picks
        else:
            main_lane = "Unpicked"
            ds_pct = jg_pct = mid_pct = ad_pct = roam_pct = 0.0

        hero_rows.append(
            {
                "Hero": hname,
                "Tier_2026": tier,
                "Meta_Trend": trend,
                "Meta_Status": status,
                "Primary_Role": hrow["primary_role"],
                "Secondary_Role": hrow["secondary_role"] if pd.notna(hrow["secondary_role"]) else "-",
                "Main_Pro_Lane": main_lane,
                "Recent_Patch_Presence": round(recent_pres, 4),
                "Recent_Patch_Win_Rate": round(recent_wr, 4),
                "Annual_Presence": round(ann_pres, 4),
                "Spring_Presence": round(r1, 4),
                "Summer_APL_Presence": round(r2, 4),
                "Pick_Rate": round(pick_rate, 4),
                "Ban_Rate": round(ban_rate, 4),
                "Total_Picks": picks,
                "Total_Bans": total_bans,
                "Phase1_Bans": b_p1,
                "Phase2_Bans": b_p2,
                "Wins": wins,
                "Losses": losses,
                "Win_Rate": round(win_rate, 4),
                "Bayesian_WR": round(smoothed_p, 4),
                "B1_First_Picks": hero_b1_picks[hname],
                "R1_R2_Picks": hero_r1r2_picks[hname],
                "R5_Last_Picks": hero_r5_picks[hname],
                "Blue_Side_Picks": hero_blue_picks[hname],
                "Red_Side_Picks": hero_red_picks[hname],
                "DS_Lane_Share": round(ds_pct, 4),
                "Jungle_Share": round(jg_pct, 4),
                "Mid_Share": round(mid_pct, 4),
                "Dragon_Lane_Share": round(ad_pct, 4),
                "Roam_Share": round(roam_pct, 4),
            }
        )

    df_heroes = pd.DataFrame(hero_rows)
    df_heroes.sort_values(
        by=["Recent_Patch_Presence", "Total_Picks", "Win_Rate"], ascending=[False, False, False], inplace=True
    )
    df_heroes.insert(0, "Rank", range(1, len(df_heroes) + 1))

    # Build Top Synergies DataFrame using Bradley-Terry Log-Odds Delta-2 + Empirical Bayes Shrinkage (K=12)
    prior_k = 12.0
    synergy_rows = []
    for (h1, h2), gcount in duo_games.items():
        if gcount < 10:
            continue
        wcount = duo_wins[(h1, h2)]
        lcount = gcount - wcount
        wr = wcount / gcount
        # Bradley-Terry additive log-odds expected synergy win rate
        exp_wr = 1.0 / (1.0 + math.exp(-(hero_logit.get(h1, 0.0) + hero_logit.get(h2, 0.0))))
        post_wr = (wcount + prior_k * exp_wr) / (gcount + prior_k)
        delta2_lift = post_wr - exp_wr
        z_score = (wcount - gcount * exp_wr) / math.sqrt(gcount * exp_wr * (1.0 - exp_wr) + 1.0)
        # Co-pick lift relative to independent team selection
        expected_co_picks = max(1e-4, (hero_picks[h1] * hero_picks[h2]) / (2.0 * total_games))
        co_pick_lift = gcount / expected_co_picks
        top_role_pair = duo_lane_pairs[(h1, h2)].most_common(1)[0][0] if duo_lane_pairs[(h1, h2)] else "Flex"
        mech_tag = explain_synergy_mechanic(hero_meta.get(h1, {}), hero_meta.get(h2, {}))

        synergy_rows.append(
            {
                "Hero_A": h1,
                "Hero_B": h2,
                "Primary_Lane_Pair": top_role_pair,
                "Games_Together": gcount,
                "Wins": wcount,
                "Losses": lcount,
                "Raw_Duo_WR": round(wr, 4),
                "Expected_BT_WR": round(exp_wr, 4),
                "Posterior_EB_WR": round(post_wr, 4),
                "Synergy_Delta2_Lift": round(delta2_lift, 4),
                "Synergy_Z_Score": round(z_score, 2),
                "Co_Pick_Lift": round(co_pick_lift, 2),
                "Synergy_Mechanism": mech_tag,
            }
        )
    df_synergy = pd.DataFrame(synergy_rows)
    df_synergy.sort_values(
        by=["Synergy_Delta2_Lift", "Synergy_Z_Score", "Games_Together"],
        ascending=[False, False, False],
        inplace=True,
    )
    df_synergy = df_synergy.head(300).copy()
    df_synergy.insert(0, "Rank", range(1, len(df_synergy) + 1))

    # Precompute 5-lane unit vectors for role alignment in Preemptive / Protective Ban Censoring
    all_hero_names = sorted(heroes_df["name"].tolist())
    hero_lane_vec = {}
    for hname in all_hero_names:
        lc = hero_lane_counts[hname]
        vec = [float(lc[ln]) + 0.1 for ln in lane_names]
        norm = math.sqrt(sum(v * v for v in vec))
        hero_lane_vec[hname] = [v / norm for v in vec]

    total_team_games = max(1.0, 2.0 * float(total_games))

    def get_counter_alignment(c_name: str, t_name: str) -> float:
        cm = hero_meta.get(c_name, {})
        tm = hero_meta.get(t_name, {})
        v_c = hero_lane_vec.get(c_name, [0.447] * 5)
        v_t = hero_lane_vec.get(t_name, [0.447] * 5)
        lane_cos = sum(a * b for a, b in zip(v_c, v_t))
        kit_bonus = 0.0
        if (cm.get("has_suppress") or c_name in ("Mina", "Roxie", "Baldum")) and (
            tm.get("has_mobility")
            or tm.get("has_immunity")
            or tm.get("primary_role") in ("Fighter", "Warrior", "Assassin")
        ):
            kit_bonus += 0.45
        if (
            cm.get("has_true_damage")
            and (
                tm.get("has_shield")
                or tm.get("has_heal_sustain")
                or tm.get("primary_role") in ("Tank", "Fighter", "Warrior")
            )
            and (lane_cos >= 0.25 or c_name == "Mina")
        ):
            kit_bonus += 0.35
        if cm.get("primary_role") == "Assassin" and tm.get("primary_role") in ("Carry", "Marksman", "Mage"):
            kit_bonus += 0.35
        if lane_cos < 0.30 and kit_bonus < 0.35:
            return 0.0
        return min(1.15, 0.35 + 0.85 * lane_cos + kit_bonus)

    def get_censor_imputation(c_hero: str, t_hero: str, exp_wr_ct: float) -> tuple[float, float, float]:
        obs_b = float(co_ban_same_team[(t_hero, c_hero)] + 1.5 * co_p2ban_same_team[(t_hero, c_hero)])
        c_bans_all = float(hero_bans_p1[c_hero] + hero_bans_p2[c_hero])
        c_bans_p2 = float(hero_bans_p2[c_hero])
        exp_b = float(hero_picks[t_hero]) * ((c_bans_all + 1.5 * c_bans_p2) / total_team_games)
        excess_b = max(0.0, obs_b - exp_b)
        b_lift = (obs_b + 5.0) / (exp_b + 5.0)
        b_z = (obs_b - exp_b) / math.sqrt(exp_b + 2.0)
        align_w = get_counter_alignment(c_hero, t_hero)
        if b_lift > 1.15 and excess_b > 1.5 and align_w > 0.0:
            g_cen = min(18.0, 0.45 * excess_b * align_w)
            p_thr = min(0.82, exp_wr_ct + 0.14 + 0.04 * min(b_z, 4.0))
            return g_cen, g_cen * p_thr, b_lift
        return 0.0, 0.0, b_lift

    # Build Top Counters DataFrame (All-Role Matchups, Censoring-Adjusted Bradley-Terry Delta-2 + EB Shrinkage)
    counter_rows = []
    candidate_pairs = (
        set(vs_games.keys())
        | set((t, c) for (t, c) in co_ban_same_team.keys())
        | set((c, t) for (t, c) in co_ban_same_team.keys())
    )
    for h_counter, h_target in candidate_pairs:
        if h_counter == h_target or h_counter not in hero_meta or h_target not in hero_meta:
            continue
        gcount = vs_games[(h_counter, h_target)]
        wcount = vs_wins[(h_counter, h_target)]
        lcount = gcount - wcount
        exp_wr = 1.0 / (1.0 + math.exp(-(hero_logit.get(h_counter, 0.0) - hero_logit.get(h_target, 0.0))))
        g_cen_fwd, w_cen_fwd, ban_lift = get_censor_imputation(h_counter, h_target, exp_wr)
        g_cen_rev, w_cen_rev, _ = get_censor_imputation(h_target, h_counter, 1.0 - exp_wr)
        g_censor = g_cen_fwd + g_cen_rev
        w_censor = w_cen_fwd + (g_cen_rev - w_cen_rev)

        if gcount < 10 and (gcount + g_censor) < 9.0:
            continue
        wr = (wcount / gcount) if gcount > 0 else exp_wr
        played_post_wr = (wcount + prior_k * exp_wr) / (gcount + prior_k)
        played_delta2 = played_post_wr - exp_wr
        post_wr = (wcount + w_censor + prior_k * exp_wr) / (gcount + g_censor + prior_k)
        delta2_adv = post_wr - exp_wr
        if delta2_adv <= 0.02:
            continue
        g_eff = gcount + g_censor
        w_eff = wcount + w_censor
        z_score = (w_eff - g_eff * exp_wr) / math.sqrt(g_eff * exp_wr * (1.0 - exp_wr) + 1.0)
        sl_g = same_lane_vs_games[(h_counter, h_target)]
        sl_w = same_lane_vs_wins[(h_counter, h_target)]
        sl_wr = sl_w / sl_g if sl_g > 0 else 0.0
        mech_tag = explain_counter_mechanic(
            hero_meta.get(h_counter, {}),
            hero_meta.get(h_target, {}),
            is_same_lane=(sl_g >= 5),
            ban_lift=ban_lift,
        )

        counter_rows.append(
            {
                "Counter_Hero": h_counter,
                "Target_Enemy_Hero": h_target,
                "Matchup_Games": gcount,
                "Wins_vs_Target": wcount,
                "Losses_vs_Target": lcount,
                "Raw_WR_vs_Target": round(wr, 4),
                "Expected_BT_WR": round(exp_wr, 4),
                "Played_Delta2_Lift": round(played_delta2, 4),
                "Protective_Ban_Lift": round(ban_lift, 2),
                "Censored_Ban_Equiv": round(g_cen_fwd, 1),
                "Posterior_EB_WR": round(post_wr, 4),
                "Counter_Delta2_Lift": round(delta2_adv, 4),
                "Counter_Z_Score": round(z_score, 2),
                "Same_Lane_Games": sl_g,
                "Same_Lane_WR": round(sl_wr, 4),
                "Counter_Mechanism": mech_tag,
            }
        )
    df_counters = pd.DataFrame(counter_rows)
    df_counters.sort_values(
        by=["Counter_Delta2_Lift", "Counter_Z_Score", "Matchup_Games"],
        ascending=[False, False, False],
        inplace=True,
    )
    df_counters = df_counters.head(300).copy()
    df_counters.insert(0, "Rank", range(1, len(df_counters) + 1))

    # Build Direct In-Lane 1v1 Counters DataFrame (Strictly Same Post-Swap Role, with Censoring Adjustment)
    lane_counter_rows = []
    lane_candidates = set(same_lane_vs_games.keys()) | candidate_pairs
    for h_counter, h_target in lane_candidates:
        if h_counter == h_target or h_counter not in hero_meta or h_target not in hero_meta:
            continue
        sl_g = same_lane_vs_games[(h_counter, h_target)]
        v_c = hero_lane_vec.get(h_counter, [0.0] * 5)
        v_t = hero_lane_vec.get(h_target, [0.0] * 5)
        lane_cos = sum(a * b for a, b in zip(v_c, v_t))
        exp_wr = 1.0 / (1.0 + math.exp(-(hero_logit.get(h_counter, 0.0) - hero_logit.get(h_target, 0.0))))
        g_cen_fwd, w_cen_fwd, ban_lift = get_censor_imputation(h_counter, h_target, exp_wr)
        g_cen_inlane = g_cen_fwd * lane_cos if lane_cos >= 0.65 else 0.0
        w_cen_inlane = w_cen_fwd * lane_cos if lane_cos >= 0.65 else 0.0

        if sl_g < 6 and (sl_g + g_cen_inlane) < 7.0:
            continue
        sl_w = same_lane_vs_wins[(h_counter, h_target)]
        sl_l = sl_g - sl_w
        sl_wr = (sl_w / sl_g) if sl_g > 0 else exp_wr
        played_post_wr = (sl_w + 8.0 * exp_wr) / (sl_g + 8.0)
        played_delta2 = played_post_wr - exp_wr
        post_wr = (sl_w + w_cen_inlane + 8.0 * exp_wr) / (sl_g + g_cen_inlane + 8.0)
        delta2_adv = post_wr - exp_wr
        if delta2_adv <= 0.02:
            continue
        g_eff = sl_g + g_cen_inlane
        w_eff = sl_w + w_cen_inlane
        z_score = (w_eff - g_eff * exp_wr) / math.sqrt(g_eff * exp_wr * (1.0 - exp_wr) + 1.0)
        if same_lane_role_counts[(h_counter, h_target)]:
            main_lane = same_lane_role_counts[(h_counter, h_target)].most_common(1)[0][0]
        else:
            best_idx = max(range(5), key=lambda k: v_c[k] * v_t[k])
            main_lane = lane_names[best_idx]
        mech_tag = explain_counter_mechanic(
            hero_meta.get(h_counter, {}),
            hero_meta.get(h_target, {}),
            is_same_lane=True,
            ban_lift=ban_lift,
        )

        lane_counter_rows.append(
            {
                "Lane_Role": main_lane,
                "Counter_Hero": h_counter,
                "Lane_Opponent": h_target,
                "Same_Lane_Games": sl_g,
                "Same_Lane_Wins": sl_w,
                "Same_Lane_Losses": sl_l,
                "Raw_InLane_WR": round(sl_wr, 4),
                "Expected_BT_WR": round(exp_wr, 4),
                "Played_InLane_Lift": round(played_delta2, 4),
                "Protective_Ban_Lift": round(ban_lift, 2),
                "Censored_Ban_Equiv": round(g_cen_inlane, 1),
                "Posterior_InLane_WR": round(post_wr, 4),
                "InLane_Delta2_Lift": round(delta2_adv, 4),
                "InLane_Z_Score": round(z_score, 2),
                "All_Role_Games": vs_games[(h_counter, h_target)],
                "Counter_Mechanism": mech_tag,
            }
        )
    df_lane_counters = pd.DataFrame(lane_counter_rows)
    df_lane_counters.sort_values(
        by=["InLane_Delta2_Lift", "InLane_Z_Score", "Same_Lane_Games"],
        ascending=[False, False, False],
        inplace=True,
    )
    df_lane_counters = df_lane_counters.head(250).copy()
    df_lane_counters.insert(0, "Rank", range(1, len(df_lane_counters) + 1))

    # Build Executive Summary Table
    summary_rows = []
    league_display = {
        "AOG": "Arena of Glory (Vietnam)",
        "RPL": "RoV Pro League (Thailand)",
        "GCS": "Garena Challenger Series (Taiwan)",
        "APL": "Arena of Valor Premier League (International)",
        "AIC": "Arena of Valor International Championship (International)",
    }
    total_blue_w = sum(v["blue_wins"] for v in league_summary.values())
    total_red_w = sum(v["red_wins"] for v in league_summary.values())
    for lcode in ["AOG", "RPL", "GCS", "APL", "AIC"]:
        if lcode not in league_summary:
            continue
        st = league_summary[lcode]
        g = st["games"]
        bw = st["blue_wins"]
        rw = st["red_wins"]
        summary_rows.append(
            {
                "League_Code": lcode,
                "Tournament_Region": league_display.get(lcode, lcode),
                "Verified_2026_Games": g,
                "Blue_Side_Wins": bw,
                "Red_Side_Wins": rw,
                "Blue_Win_Rate": round(bw / g, 4) if g else 0.0,
                "Red_Win_Rate": round(rw / g, 4) if g else 0.0,
                "True_Pick_Order_Coverage": 1.0,
            }
        )
    summary_rows.append(
        {
            "League_Code": "ALL TIER-1",
            "Tournament_Region": "Combined 2026 Tier-1 Pro Archive",
            "Verified_2026_Games": total_games,
            "Blue_Side_Wins": total_blue_w,
            "Red_Side_Wins": total_red_w,
            "Blue_Win_Rate": round(total_blue_w / total_games, 4) if total_games else 0.0,
            "Red_Win_Rate": round(total_red_w / total_games, 4) if total_games else 0.0,
            "True_Pick_Order_Coverage": 1.0,
        }
    )
    df_summary = pd.DataFrame(summary_rows)

    return df_summary, df_heroes, df_drafts, df_synergy, df_counters, df_lane_counters


def style_worksheet(ws, pct_cols: list[str], color_scale_cols: list[str], hero_tier_map: dict[str, str] | None = None):
    header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="F8FAFC")
    zebra_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    white_fill = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
    body_font = Font(name="Calibri", size=10, color="0F172A")
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    max_row = ws.max_row
    max_col = ws.max_column

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(max_col)}{max_row}"

    is_draft_sheet = ws.title == "True_Draft_Log_2026"
    is_hero_sheet = ws.title == "Hero_Tier_List_2026"
    is_counter_sheet = ws.title in {"Top_Counters_2026", "Direct_Lane_Counters_2026"}
    is_synergy_sheet = ws.title == "Top_Synergies_2026"

    # Blue and Red distinct themes for True_Draft_Log_2026
    blue_header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    blue_header_font = Font(name="Calibri", size=11, bold=True, color="DBEAFE")
    red_header_fill = PatternFill(start_color="881337", end_color="881337", fill_type="solid")
    red_header_font = Font(name="Calibri", size=11, bold=True, color="FECDD3")

    blue_even_fill = PatternFill(start_color="EFF6FF", end_color="EFF6FF", fill_type="solid")
    blue_odd_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    blue_pick_font = Font(name="Calibri", size=10, bold=True, color="1E40AF")
    blue_norm_font = Font(name="Calibri", size=10, color="1E3A8A")

    red_even_fill = PatternFill(start_color="FFF1F2", end_color="FFF1F2", fill_type="solid")
    red_odd_fill = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
    red_pick_font = Font(name="Calibri", size=10, bold=True, color="9F1239")
    red_norm_font = Font(name="Calibri", size=10, color="881337")

    winner_blue_fill = PatternFill(start_color="DBEAFE", end_color="DBEAFE", fill_type="solid")
    winner_blue_font = Font(name="Calibri", size=10, bold=True, color="1E40AF")
    winner_red_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
    winner_red_font = Font(name="Calibri", size=10, bold=True, color="991B1B")

    # Tier styles
    tier_styles = {
        "S+": {
            "fill": PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid"),
            "font": Font(name="Calibri", size=10, bold=True, color="92400E"),
        },
        "S": {
            "fill": PatternFill(start_color="FCE7F3", end_color="FCE7F3", fill_type="solid"),
            "font": Font(name="Calibri", size=10, bold=True, color="9D174D"),
        },
        "A": {
            "fill": PatternFill(start_color="D1FAE5", end_color="D1FAE5", fill_type="solid"),
            "font": Font(name="Calibri", size=10, bold=True, color="065F46"),
        },
        "B": {
            "fill": PatternFill(start_color="E0F2FE", end_color="E0F2FE", fill_type="solid"),
            "font": Font(name="Calibri", size=10, bold=True, color="075985"),
        },
        "C": {
            "fill": PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid"),
            "font": Font(name="Calibri", size=10, bold=False, color="475569"),
        },
    }

    trend_styles = {
        "▲ Rising": {
            "fill": PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid"),
            "font": Font(name="Calibri", size=10, bold=True, color="166534"),
        },
        "▼ Falling": {
            "fill": PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid"),
            "font": Font(name="Calibri", size=10, bold=True, color="991B1B"),
        },
        "● Stable": {
            "fill": PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid"),
            "font": Font(name="Calibri", size=10, bold=False, color="475569"),
        },
        "🔒 Disabled": {
            "fill": PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid"),
            "font": Font(name="Calibri", size=10, bold=True, color="B45309"),
        },
    }

    col_names = {}
    blue_cols = set()
    red_cols = set()
    pick_cols = set()
    winner_col = None
    tier_col = None
    trend_col = None

    for col_idx in range(1, max_col + 1):
        cell = ws.cell(row=1, column=col_idx)
        name = str(cell.value or "")
        col_names[col_idx] = name

        if is_draft_sheet:
            if name.startswith("Blue_") or name in {"B1_Pick", "B2_Pick", "B3_Pick", "B4_Pick", "B5_Pick"}:
                blue_cols.add(col_idx)
                if "_Pick" in name or name.startswith("B"):
                    pick_cols.add(col_idx)
            elif name.startswith("Red_") or name in {"R1_Pick", "R2_Pick", "R3_Pick", "R4_Pick", "R5_Pick"}:
                red_cols.add(col_idx)
                if "_Pick" in name or name.startswith("R"):
                    pick_cols.add(col_idx)
            elif name == "Winner_Side":
                winner_col = col_idx
        elif is_hero_sheet and name == "Tier_2026":
            tier_col = col_idx
        elif is_hero_sheet and name == "Meta_Trend":
            trend_col = col_idx

        # Header coloring
        if col_idx in blue_cols:
            cell.fill = blue_header_fill
            cell.font = blue_header_font
        elif col_idx in red_cols:
            cell.fill = red_header_fill
            cell.font = red_header_font
        else:
            cell.fill = header_fill
            cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=False)
        cell.border = thin_border

    ws.row_dimensions[1].height = 26

    pct_col_indices = {idx for idx, name in col_names.items() if name in pct_cols}
    center_col_indices = {
        idx
        for idx, name in col_names.items()
        if name
        in {
            "Rank",
            "Tier_2026",
            "Meta_Trend",
            "Meta_Status",
            "Winner_Side",
            "Best_Of",
            "Game_Number",
            "Year",
            "League_Code",
        }
    }
    text_col_indices = {
        idx
        for idx, name in col_names.items()
        if name
        in {
            "Hero",
            "Primary_Role",
            "Secondary_Role",
            "Main_Pro_Lane",
            "Tournament_Region",
            "Match_ID",
            "League_Name",
            "Stage",
            "Series_ID",
            "Date",
            "Duration",
            "Blue_Team",
            "Red_Team",
            "Winner_Team",
            "Hero_A",
            "Hero_B",
            "Primary_Lane_Pair",
            "Synergy_Mechanism",
            "Counter_Hero",
            "Target_Enemy_Hero",
            "Lane_Role",
            "Lane_Opponent",
            "Counter_Mechanism",
        }
        or "Ban_" in name
        or "_Pick" in name
        or "_Lane" in name
    }

    for row_idx in range(2, max_row + 1):
        is_even = row_idx % 2 == 0
        default_row_fill = zebra_fill if is_even else white_fill
        for col_idx in range(1, max_col + 1):
            cell = ws.cell(row=row_idx, column=col_idx)
            cell.border = thin_border

            if col_idx in blue_cols:
                cell.fill = blue_even_fill if is_even else blue_odd_fill
                cell.font = blue_pick_font if col_idx in pick_cols else blue_norm_font
            elif col_idx in red_cols:
                cell.fill = red_even_fill if is_even else red_odd_fill
                cell.font = red_pick_font if col_idx in pick_cols else red_norm_font
            elif col_idx == winner_col:
                val = str(cell.value or "")
                # Check column 15 (Blue_Win) directly for true ground truth
                win_val = ws.cell(row=row_idx, column=15).value
                if win_val == 1 or val == "Blue":
                    cell.fill = winner_blue_fill
                    cell.font = winner_blue_font
                elif win_val == 0 or val == "Red":
                    cell.fill = winner_red_fill
                    cell.font = winner_red_font
                else:
                    cell.fill = default_row_fill
                    cell.font = body_font
            elif col_idx == tier_col:
                h_name = str(ws.cell(row=row_idx, column=2).value or "")
                tier_resolved = hero_tier_map.get(h_name, "C") if hero_tier_map else "C"
                t_style = tier_styles.get(tier_resolved, tier_styles["C"])
                cell.fill = t_style["fill"]
                cell.font = t_style["font"]
            elif col_idx == trend_col:
                t_val = str(cell.value or "")
                t_style = trend_styles.get(t_val, trend_styles["● Stable"])
                cell.fill = t_style["fill"]
                cell.font = t_style["font"]
            elif is_counter_sheet and col_names.get(col_idx) == "Counter_Hero":
                cell.fill = PatternFill(start_color="ECFDF5", end_color="ECFDF5", fill_type="solid")
                cell.font = Font(name="Calibri", size=10, bold=True, color="065F46")
            elif is_counter_sheet and col_names.get(col_idx) == "Target_Enemy_Hero":
                cell.fill = PatternFill(start_color="FFF1F2", end_color="FFF1F2", fill_type="solid")
                cell.font = Font(name="Calibri", size=10, bold=True, color="9F1239")
            elif is_synergy_sheet and col_names.get(col_idx) in ("Hero_A", "Hero_B"):
                cell.fill = PatternFill(start_color="EFF6FF", end_color="EFF6FF", fill_type="solid")
                cell.font = Font(name="Calibri", size=10, bold=True, color="1E40AF")
            else:
                cell.fill = default_row_fill
                cell.font = body_font

            if col_idx in pct_col_indices:
                cell.number_format = "0.0%"
                cell.alignment = Alignment(horizontal="right", vertical="center")
            elif col_idx in center_col_indices:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            elif col_idx in text_col_indices:
                cell.alignment = Alignment(horizontal="left", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="right", vertical="center")

    # Apply 3-color conditional formatting scale to target metric columns
    for idx, name in col_names.items():
        if name in color_scale_cols and max_row >= 3:
            col_letter = get_column_letter(idx)
            rng = f"{col_letter}2:{col_letter}{max_row}"
            rule = ColorScaleRule(
                start_type="min",
                start_color="FEE2E2",
                mid_type="percentile",
                mid_value=50,
                mid_color="FEF9C3",
                end_type="max",
                end_color="DCFCE7",
            )
            ws.conditional_formatting.add(rng, rule)

    # Dynamic Tier conditional formatting on Hero_Tier_List_2026
    if is_hero_sheet and tier_col is not None:
        col_letter = get_column_letter(tier_col)
        rng = f"{col_letter}2:{col_letter}{max_row}"
        for tier, style in tier_styles.items():
            rule = CellIsRule(
                operator="equal",
                formula=[f'"{tier}"'],
                fill=style["fill"],
                font=style["font"],
            )
            ws.conditional_formatting.add(rng, rule)

    # Dynamic Meta_Trend conditional formatting on Hero_Tier_List_2026
    if is_hero_sheet and trend_col is not None:
        col_letter = get_column_letter(trend_col)
        rng = f"{col_letter}2:{col_letter}{max_row}"
        for t_label, t_style in trend_styles.items():
            rule = CellIsRule(
                operator="equal",
                formula=[f'"{t_label}"'],
                fill=t_style["fill"],
                font=t_style["font"],
            )
            ws.conditional_formatting.add(rng, rule)

    # Dynamic Winner_Side conditional formatting on True_Draft_Log_2026
    if is_draft_sheet and winner_col is not None:
        col_letter = get_column_letter(winner_col)
        rng = f"{col_letter}2:{col_letter}{max_row}"
        rule_blue = CellIsRule(
            operator="equal",
            formula=['"Blue"'],
            fill=winner_blue_fill,
            font=winner_blue_font,
        )
        rule_red = CellIsRule(
            operator="equal",
            formula=['"Red"'],
            fill=winner_red_fill,
            font=winner_red_font,
        )
        ws.conditional_formatting.add(rng, rule_blue)
        ws.conditional_formatting.add(rng, rule_red)

    # Auto-fit column widths (sampled up to 250 rows for speed)
    sample_limit = min(max_row, 250)
    for col_idx in range(1, max_col + 1):
        col_letter = get_column_letter(col_idx)
        max_len = len(str(ws.cell(row=1, column=col_idx).value or ""))
        for row_idx in range(2, sample_limit + 1):
            val = ws.cell(row=row_idx, column=col_idx).value
            if col_idx in pct_col_indices and isinstance(val, (int, float)):
                val_str = f"{val * 100:.1f}%"
            else:
                val_str = str(val or "")
            if len(val_str) > max_len:
                max_len = len(val_str)
        ws.column_dimensions[col_letter].width = min(max(max_len + 4, 11), 38)


def compute_draft_split_bounds(ws_drafts) -> dict[str, int]:
    """Compute 1-based Excel row bounds and denominators for P1/P2/P3 splits and hero eligibility."""
    max_draft_row = ws_drafts.max_row
    p1_months = {"January", "February", "March", "April", "May"}
    p2_months = {"June", "July", "August"}
    p3_months = {"September", "October", "November", "December"}
    p1_tot = 0
    p2_tot = 0
    p3_tot = 0
    first_evita_row = None
    pb_cols = list(range(16, 20)) + list(range(26, 30)) + list(range(34, 44))

    for r in range(2, max_draft_row + 1):
        d_val = str(ws_drafts.cell(row=r, column=9).value or "").strip()
        mon = d_val.split()[0] if d_val else ""
        if mon in p1_months:
            p1_tot += 1
        elif mon in p2_months:
            p2_tot += 1
        elif mon in p3_months:
            p3_tot += 1
        if first_evita_row is None:
            for c in pb_cols:
                if ws_drafts.cell(row=r, column=c).value == "Evita":
                    first_evita_row = r
                    break

    p1_start = 2
    p1_end = 1 + p1_tot
    p2_start = p1_end + 1
    p2_end = p1_end + p2_tot
    p3_start = p2_end + 1
    p3_end = max_draft_row
    evita_eligible = (max_draft_row - first_evita_row + 1) if first_evita_row is not None else max(p3_tot, 1)
    volkath_eligible = p1_tot + p2_tot
    return {
        "max_draft_row": max_draft_row,
        "p1_start": p1_start,
        "p1_end": p1_end,
        "p1_tot": p1_tot,
        "p2_start": p2_start,
        "p2_end": p2_end,
        "p2_tot": p2_tot,
        "p3_start": p3_start,
        "p3_end": p3_end,
        "p3_tot": p3_tot,
        "evita_eligible": evita_eligible,
        "volkath_eligible": volkath_eligible,
    }


def inject_excel_formulas_and_watermark(wb: openpyxl.Workbook):
    """Inject native Excel formulas across all 6 worksheets and embed security watermarks."""
    # -------------------------------------------------------------
    # 1. Executive_Summary Formulas & Watermark Banner
    # -------------------------------------------------------------
    ws_sum = wb["Executive_Summary"]
    ws_drafts = wb["True_Draft_Log_2026"]
    bounds = compute_draft_split_bounds(ws_drafts)
    max_draft_row = bounds["max_draft_row"]
    total_summary_row = ws_sum.max_row
    last_league_row = total_summary_row - 1

    # Regional rows (2..last_league_row: AOG, RPL, GCS, APL, AIC)
    for r in range(2, total_summary_row):
        ws_sum.cell(row=r, column=3, value=f"=COUNTIF(True_Draft_Log_2026!$C$2:$C${max_draft_row}, A{r})")
        ws_sum.cell(
            row=r,
            column=4,
            value=f"=COUNTIFS(True_Draft_Log_2026!$C$2:$C${max_draft_row}, A{r}, True_Draft_Log_2026!$O$2:$O${max_draft_row}, 1)",
        )
        ws_sum.cell(row=r, column=5, value=f"=C{r}-D{r}")
        ws_sum.cell(row=r, column=6, value=f"=D{r}/C{r}")
        ws_sum.cell(row=r, column=7, value=f"=E{r}/C{r}")
        ws_sum.cell(row=r, column=8, value=f"=COUNTIF(True_Draft_Log_2026!$C$2:$C${max_draft_row}, A{r})/C{r}")

    # Combined summary row (ALL TIER-1)
    ws_sum.cell(row=total_summary_row, column=3, value=f"=SUM(C2:C{last_league_row})")
    ws_sum.cell(row=total_summary_row, column=4, value=f"=SUM(D2:D{last_league_row})")
    ws_sum.cell(row=total_summary_row, column=5, value=f"=SUM(E2:E{last_league_row})")
    ws_sum.cell(row=total_summary_row, column=6, value=f"=D{total_summary_row}/C{total_summary_row}")
    ws_sum.cell(row=total_summary_row, column=7, value=f"=E{total_summary_row}/C{total_summary_row}")
    ws_sum.cell(row=total_summary_row, column=8, value=f"=SUM(C2:C{last_league_row})/C{total_summary_row}")

    # Add Executive Watermark / Security Notice Banner
    banner_row = total_summary_row + 2
    banner_cell = ws_sum.cell(row=banner_row, column=1)
    banner_cell.value = (
        "CONFIDENTIAL & PROPRIETARY - RoV Pro Draft Intelligence 2026 | "
        "Licensed Single-User Copy | Unauthorized Distribution or Reselling Strictly Prohibited"
    )
    ws_sum.merge_cells(f"A{banner_row}:H{banner_row}")
    banner_cell.fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    banner_cell.font = Font(name="Calibri", size=10, bold=True, color="F5C451")
    banner_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws_sum.row_dimensions[banner_row].height = 24

    # -------------------------------------------------------------
    # 2. Hero_Tier_List_2026 Formulas
    # -------------------------------------------------------------
    ws_heroes = wb["Hero_Tier_List_2026"]
    p1_start, p1_end, p1_tot = bounds["p1_start"], bounds["p1_end"], bounds["p1_tot"]
    p2_start, p2_end, p2_tot = bounds["p2_start"], bounds["p2_end"], bounds["p2_tot"]
    p3_start, p3_end, p3_tot = bounds["p3_start"], bounds["p3_end"], bounds["p3_tot"]
    evita_eligible = bounds["evita_eligible"]
    volkath_eligible = bounds["volkath_eligible"]

    for r in range(2, ws_heroes.max_row + 1):
        # Rank (Column A / 1)
        ws_heroes.cell(row=r, column=1, value="=ROW()-1")

        # Tier_2026 formula based on Recent_Patch_Presence (I) with curated overrides
        ws_heroes.cell(
            row=r,
            column=3,
            value=(
                f'=IF(B{r}="Evita", "S", '
                f'IF(B{r}="Zanis", "A", '
                f'IF(B{r}="Ata", "A", '
                f'IF(B{r}="Volkath", "B", '
                f'IF(B{r}="Moren", "C", '
                f'IF(B{r}="Aya", "C", '
                f'IF(B{r}="Bijan", "C", '
                f'IF(B{r}="Flowborn (Mage)", "C", '
                f'IF(I{r}>=0.45, "S+", '
                f'IF(I{r}>=0.25, "S", '
                f'IF(I{r}>=0.12, "A", '
                f'IF(I{r}>=0.04, "B", "C"))))))))))))'
            ),
        )

        # Meta_Trend (Column D / 4)
        ws_heroes.cell(
            row=r,
            column=4,
            value=f'=IF(B{r}="Volkath", "🔒 Disabled", IF(I{r}-L{r}>=0.1, "▲ Rising", IF(I{r}-L{r}<=-0.1, "▼ Falling", "● Stable")))',
        )

        # Recent_Patch_Presence (Column I / 9) = Winter Split
        ws_heroes.cell(
            row=r,
            column=9,
            value=(
                f'=IF(B{r}="Volkath", 0, '
                f"(COUNTIF(True_Draft_Log_2026!$AH${p3_start}:$AQ${p3_end}, B{r}) + "
                f"COUNTIF(True_Draft_Log_2026!$P${p3_start}:$S${p3_end}, B{r}) + "
                f"COUNTIF(True_Draft_Log_2026!$Z${p3_start}:$AC${p3_end}, B{r})) / "
                f'IF(B{r}="Evita", {evita_eligible}, {p3_tot}))'
            ),
        )

        # Recent_Patch_Win_Rate (Column J / 10) = Winter Split Wins / Picks
        blue_w_p3 = "+".join(
            f"COUNTIFS(True_Draft_Log_2026!${col}${p3_start}:${col}${p3_end}, B{r}, True_Draft_Log_2026!$O${p3_start}:$O${p3_end}, 1)"
            for col in ["AH", "AI", "AJ", "AK", "AL"]
        )
        red_w_p3 = "+".join(
            f"COUNTIFS(True_Draft_Log_2026!${col}${p3_start}:${col}${p3_end}, B{r}, True_Draft_Log_2026!$O${p3_start}:$O${p3_end}, 0)"
            for col in ["AM", "AN", "AO", "AP", "AQ"]
        )
        picks_p3_expr = f"COUNTIF(True_Draft_Log_2026!$AH${p3_start}:$AQ${p3_end}, B{r})"
        ws_heroes.cell(
            row=r,
            column=10,
            value=f"=IF({picks_p3_expr}>0, ({blue_w_p3}+{red_w_p3})/{picks_p3_expr}, 0)",
        )

        # Annual_Presence (Column K / 11) = (Total_Picks + Total_Bans) / Total_Games
        ws_heroes.cell(row=r, column=11, value=f"=(P{r}+Q{r})/Executive_Summary!$C${total_summary_row}")

        # Spring_Presence (Column L / 12) = Spring Split
        ws_heroes.cell(
            row=r,
            column=12,
            value=(
                f"=(COUNTIF(True_Draft_Log_2026!$AH${p1_start}:$AQ${p1_end}, B{r}) + "
                f"COUNTIF(True_Draft_Log_2026!$P${p1_start}:$S${p1_end}, B{r}) + "
                f"COUNTIF(True_Draft_Log_2026!$Z${p1_start}:$AC${p1_end}, B{r})) / {p1_tot}"
            ),
        )

        # Summer_APL_Presence (Column M / 13) = Summer/APL Split
        ws_heroes.cell(
            row=r,
            column=13,
            value=(
                f"=(COUNTIF(True_Draft_Log_2026!$AH${p2_start}:$AQ${p2_end}, B{r}) + "
                f"COUNTIF(True_Draft_Log_2026!$P${p2_start}:$S${p2_end}, B{r}) + "
                f"COUNTIF(True_Draft_Log_2026!$Z${p2_start}:$AC${p2_end}, B{r})) / {p2_tot}"
            ),
        )

        # Pick_Rate (Column N / 14)
        ws_heroes.cell(
            row=r,
            column=14,
            value=f'=IF(B{r}="Evita", P{r}/{evita_eligible}, IF(B{r}="Volkath", P{r}/{volkath_eligible}, P{r}/Executive_Summary!$C${total_summary_row}))',
        )

        # Ban_Rate (Column O / 15)
        ws_heroes.cell(
            row=r,
            column=15,
            value=f'=IF(B{r}="Evita", Q{r}/{evita_eligible}, IF(B{r}="Volkath", Q{r}/{volkath_eligible}, Q{r}/Executive_Summary!$C${total_summary_row}))',
        )

        # Total_Picks (Column P / 16) = COUNTIF across all 10 lane positions in True_Draft_Log_2026
        ws_heroes.cell(row=r, column=16, value=f"=COUNTIF(True_Draft_Log_2026!$AH$2:$AQ${max_draft_row}, B{r})")

        # Total_Bans (Column Q / 17) = Phase1_Bans + Phase2_Bans
        ws_heroes.cell(row=r, column=17, value=f"=R{r}+S{r}")

        # Phase1_Bans (Column R / 18) = COUNTIF in Phase 1 bans (Columns P..S)
        ws_heroes.cell(row=r, column=18, value=f"=COUNTIF(True_Draft_Log_2026!$P$2:$S${max_draft_row}, B{r})")

        # Phase2_Bans (Column S / 19) = COUNTIF in Phase 2 bans (Columns Z..AC)
        ws_heroes.cell(row=r, column=19, value=f"=COUNTIF(True_Draft_Log_2026!$Z$2:$AC${max_draft_row}, B{r})")

        # Wins (Column T / 20) = Blue Wins + Red Wins across in-game lanes
        blue_w_expr = "+".join(
            f"COUNTIFS(True_Draft_Log_2026!${col}$2:${col}${max_draft_row}, B{r}, True_Draft_Log_2026!$O$2:$O${max_draft_row}, 1)"
            for col in ["AH", "AI", "AJ", "AK", "AL"]
        )
        red_w_expr = "+".join(
            f"COUNTIFS(True_Draft_Log_2026!${col}$2:${col}${max_draft_row}, B{r}, True_Draft_Log_2026!$O$2:$O${max_draft_row}, 0)"
            for col in ["AM", "AN", "AO", "AP", "AQ"]
        )
        ws_heroes.cell(row=r, column=20, value=f"={blue_w_expr}+{red_w_expr}")

        # Losses (Column U / 21) = Total_Picks - Wins
        ws_heroes.cell(row=r, column=21, value=f"=P{r}-T{r}")

        # Win_Rate (Column V / 22) = Wins / Total_Picks
        ws_heroes.cell(row=r, column=22, value=f"=IF(P{r}>0, T{r}/P{r}, 0)")

        # Bayesian_WR (Column W / 23) = (Wins + 5) / (Picks + 10) clamped to [0.05, 0.95]
        ws_heroes.cell(row=r, column=23, value=f"=MIN(MAX((T{r}+5)/(P{r}+10), 0.05), 0.95)")

        # B1_First_Picks (Column X / 24) = COUNTIF in B1_Pick (Column T)
        ws_heroes.cell(row=r, column=24, value=f"=COUNTIF(True_Draft_Log_2026!$T$2:$T${max_draft_row}, B{r})")

        # R1_R2_Picks (Column Y / 25) = COUNTIF in R1_Pick and R2_Pick (Columns U..V)
        ws_heroes.cell(row=r, column=25, value=f"=COUNTIF(True_Draft_Log_2026!$U$2:$V${max_draft_row}, B{r})")

        # R5_Last_Picks (Column Z / 26) = COUNTIF in R5_Pick (Column AG)
        ws_heroes.cell(row=r, column=26, value=f"=COUNTIF(True_Draft_Log_2026!$AG$2:$AG${max_draft_row}, B{r})")

        # Blue_Side_Picks (Column AA / 27) = COUNTIF in Blue Lanes (Columns AH..AL)
        ws_heroes.cell(row=r, column=27, value=f"=COUNTIF(True_Draft_Log_2026!$AH$2:$AL${max_draft_row}, B{r})")

        # Red_Side_Picks (Column AB / 28) = Total_Picks - Blue_Side_Picks
        ws_heroes.cell(row=r, column=28, value=f"=P{r}-AA{r}")

        # DS_Lane_Share (Column AC / 29)
        ws_heroes.cell(
            row=r,
            column=29,
            value=f"=IF(P{r}>0, (COUNTIF(True_Draft_Log_2026!$AH$2:$AH${max_draft_row}, B{r}) + COUNTIF(True_Draft_Log_2026!$AM$2:$AM${max_draft_row}, B{r}))/P{r}, 0)",
        )

        # Jungle_Share (Column AD / 30)
        ws_heroes.cell(
            row=r,
            column=30,
            value=f"=IF(P{r}>0, (COUNTIF(True_Draft_Log_2026!$AI$2:$AI${max_draft_row}, B{r}) + COUNTIF(True_Draft_Log_2026!$AN$2:$AN${max_draft_row}, B{r}))/P{r}, 0)",
        )

        # Mid_Share (Column AE / 31)
        ws_heroes.cell(
            row=r,
            column=31,
            value=f"=IF(P{r}>0, (COUNTIF(True_Draft_Log_2026!$AJ$2:$AJ${max_draft_row}, B{r}) + COUNTIF(True_Draft_Log_2026!$AO$2:$AO${max_draft_row}, B{r}))/P{r}, 0)",
        )

        # Dragon_Lane_Share (Column AF / 32)
        ws_heroes.cell(
            row=r,
            column=32,
            value=f"=IF(P{r}>0, (COUNTIF(True_Draft_Log_2026!$AK$2:$AK${max_draft_row}, B{r}) + COUNTIF(True_Draft_Log_2026!$AP$2:$AP${max_draft_row}, B{r}))/P{r}, 0)",
        )

        # Roam_Share (Column AG / 33)
        ws_heroes.cell(
            row=r,
            column=33,
            value=f"=IF(P{r}>0, (COUNTIF(True_Draft_Log_2026!$AL$2:$AL${max_draft_row}, B{r}) + COUNTIF(True_Draft_Log_2026!$AQ$2:$AQ${max_draft_row}, B{r}))/P{r}, 0)",
        )

    # -------------------------------------------------------------
    # 3. True_Draft_Log_2026 Formulas
    # -------------------------------------------------------------
    ws_drafts = wb["True_Draft_Log_2026"]
    for r in range(2, ws_drafts.max_row + 1):
        # Winner_Team (M) from Blue_Team (K) or Red_Team (L) via Blue_Win (O)
        ws_drafts.cell(row=r, column=13, value=f"=IF(O{r}=1, K{r}, L{r})")
        # Winner_Side (N)
        ws_drafts.cell(row=r, column=14, value=f'=IF(O{r}=1, "Blue", "Red")')

    # -------------------------------------------------------------
    # 4. Top_Synergies_2026 Formulas
    # -------------------------------------------------------------
    ws_synergy = wb["Top_Synergies_2026"]
    for r in range(2, ws_synergy.max_row + 1):
        # Rank (A)
        ws_synergy.cell(row=r, column=1, value="=ROW()-1")
        # Losses (G) = Games_Together (E) - Wins (F)
        ws_synergy.cell(row=r, column=7, value=f"=E{r}-F{r}")
        # Raw_Duo_WR (H) = Wins (F) / Games_Together (E)
        ws_synergy.cell(row=r, column=8, value=f"=IF(E{r}>0, F{r}/E{r}, 0)")
        # Expected_BT_WR (I) = (pA * pB) / (1 - pA - pB + 2 * pA * pB)
        vA = f"VLOOKUP(B{r}, Hero_Tier_List_2026!$B$2:$W$131, 22, FALSE)"
        vB = f"VLOOKUP(C{r}, Hero_Tier_List_2026!$B$2:$W$131, 22, FALSE)"
        ws_synergy.cell(row=r, column=9, value=f"=({vA}*{vB})/(1-{vA}-{vB}+2*{vA}*{vB})")
        # Posterior_EB_WR (J) = (Wins + 12 * Expected_BT_WR) / (Games + 12)
        ws_synergy.cell(row=r, column=10, value=f"=(F{r}+12*I{r})/(E{r}+12)")
        # Synergy_Delta2_Lift (K) = Posterior_EB_WR (J) - Expected_BT_WR (I)
        ws_synergy.cell(row=r, column=11, value=f"=J{r}-I{r}")
        # Synergy_Z_Score (L) = (Wins - Games * Expected_WR) / SQRT(Games * Expected_WR * (1 - Expected_WR) + 1)
        ws_synergy.cell(
            row=r,
            column=12,
            value=f"=(F{r}-E{r}*I{r})/SQRT(E{r}*I{r}*(1-I{r})+1)",
        )
        # Co_Pick_Lift (M) = Games / Expected_Co_Picks
        ws_synergy.cell(
            row=r,
            column=13,
            value=(
                f"=E{r}/MAX(0.0001, (VLOOKUP(B{r}, Hero_Tier_List_2026!$B$2:$P$131, 15, FALSE)*"
                f"VLOOKUP(C{r}, Hero_Tier_List_2026!$B$2:$P$131, 15, FALSE))/(2*Executive_Summary!$C${total_summary_row}))"
            ),
        )

    # -------------------------------------------------------------
    # 5. Top_Counters_2026 Formulas
    # -------------------------------------------------------------
    ws_counters = wb["Top_Counters_2026"]
    for r in range(2, ws_counters.max_row + 1):
        # Rank (A)
        ws_counters.cell(row=r, column=1, value="=ROW()-1")
        # Losses_vs_Target (F) = Matchup_Games (D) - Wins_vs_Target (E)
        ws_counters.cell(row=r, column=6, value=f"=D{r}-E{r}")
        # Raw_WR_vs_Target (G) = Wins_vs_Target (E) / Matchup_Games (D)
        ws_counters.cell(row=r, column=7, value=f"=IF(D{r}>0, E{r}/D{r}, 0)")
        # Expected_BT_WR (H) = (pC * (1 - pT)) / (pC + pT - 2 * pC * pT)
        vC = f"VLOOKUP(B{r}, Hero_Tier_List_2026!$B$2:$W$131, 22, FALSE)"
        vT = f"VLOOKUP(C{r}, Hero_Tier_List_2026!$B$2:$W$131, 22, FALSE)"
        ws_counters.cell(row=r, column=8, value=f"=({vC}*(1-{vT}))/({vC}+{vT}-2*{vC}*{vT})")
        # Played_Delta2_Lift (I) = Raw_WR (G) - Expected_BT_WR (H)
        ws_counters.cell(row=r, column=9, value=f"=G{r}-H{r}")
        # Counter_Delta2_Lift (M) = Posterior_EB_WR (L) - Expected_BT_WR (H)
        ws_counters.cell(row=r, column=13, value=f"=L{r}-H{r}")
        # Counter_Z_Score (N) = (Wins - Games * Expected_WR) / SQRT(Games * Expected_WR * (1 - Expected_WR) + 1)
        ws_counters.cell(
            row=r,
            column=14,
            value=f"=(E{r}-D{r}*H{r})/SQRT(D{r}*H{r}*(1-H{r})+1)",
        )

    # -------------------------------------------------------------
    # 6. Direct_Lane_Counters_2026 Formulas
    # -------------------------------------------------------------
    ws_lane = wb["Direct_Lane_Counters_2026"]
    for r in range(2, ws_lane.max_row + 1):
        # Rank (A)
        ws_lane.cell(row=r, column=1, value="=ROW()-1")
        # Same_Lane_Losses (G) = Same_Lane_Games (E) - Same_Lane_Wins (F)
        ws_lane.cell(row=r, column=7, value=f"=E{r}-F{r}")
        # Raw_InLane_WR (H) = Same_Lane_Wins (F) / Same_Lane_Games (E)
        ws_lane.cell(row=r, column=8, value=f"=IF(E{r}>0, F{r}/E{r}, 0)")
        # Expected_BT_WR (I) = (pC * (1 - pT)) / (pC + pT - 2 * pC * pT)
        vC = f"VLOOKUP(C{r}, Hero_Tier_List_2026!$B$2:$W$131, 22, FALSE)"
        vT = f"VLOOKUP(D{r}, Hero_Tier_List_2026!$B$2:$W$131, 22, FALSE)"
        ws_lane.cell(row=r, column=9, value=f"=({vC}*(1-{vT}))/({vC}+{vT}-2*{vC}*{vT})")
        # Played_InLane_Lift (J) = Raw_InLane_WR (H) - Expected_BT_WR (I)
        ws_lane.cell(row=r, column=10, value=f"=H{r}-I{r}")
        # InLane_Delta2_Lift (N) = Posterior_InLane_WR (M) - Expected_BT_WR (I)
        ws_lane.cell(row=r, column=14, value=f"=M{r}-I{r}")
        # InLane_Z_Score (O) = (Wins - Games * Expected_WR) / SQRT(Games * Expected_WR * (1 - Expected_WR) + 1)
        ws_lane.cell(
            row=r,
            column=15,
            value=f"=(F{r}-E{r}*I{r})/SQRT(E{r}*I{r}*(1-I{r})+1)",
        )

    # -------------------------------------------------------------
    # 7. Global Watermarks & Security Headers on Every Worksheet
    # -------------------------------------------------------------
    for ws in wb.worksheets:
        ws.oddHeader.center.text = "&B&11CONFIDENTIAL & PROPRIETARY - RoV Pro Draft Intelligence 2026"
        ws.oddFooter.left.text = "Licensed Esports Data | Unauthorized Distribution or Reselling Prohibited"
        ws.oddFooter.right.text = "Page &P of &N"

    # Set Document Metadata
    wb.properties.title = "RoV Pro Draft Intelligence 2026 - Master Analytics"
    wb.properties.creator = "RoV Pro Draft Intelligence"
    wb.properties.description = (
        f"Confidential & Proprietary Analytics Package ({max_draft_row - 1:,} Verified Pro Games)"
    )
    wb.properties.subject = "Tier-1 Pro Match Analytics, Synergy/Counter Matrix, and Lane Stats"


def write_excel_workbook(
    excel_path: Path,
    df_summary: pd.DataFrame,
    df_heroes: pd.DataFrame,
    df_drafts: pd.DataFrame,
    df_synergy: pd.DataFrame,
    df_counters: pd.DataFrame,
    df_lane_counters: pd.DataFrame,
):
    with pd.ExcelWriter(excel_path, engine="openpyxl") as writer:
        df_summary.to_excel(writer, sheet_name="Executive_Summary", index=False)
        df_heroes.to_excel(writer, sheet_name="Hero_Tier_List_2026", index=False)
        df_drafts.to_excel(writer, sheet_name="True_Draft_Log_2026", index=False)
        df_synergy.to_excel(writer, sheet_name="Top_Synergies_2026", index=False)
        df_counters.to_excel(writer, sheet_name="Top_Counters_2026", index=False)
        df_lane_counters.to_excel(writer, sheet_name="Direct_Lane_Counters_2026", index=False)

    wb = openpyxl.load_workbook(excel_path)

    inject_excel_formulas_and_watermark(wb)

    style_worksheet(
        wb["Executive_Summary"],
        pct_cols=["Blue_Win_Rate", "Red_Win_Rate", "True_Pick_Order_Coverage"],
        color_scale_cols=["Blue_Win_Rate"],
    )
    hero_tier_map = dict(zip(df_heroes["Hero"], df_heroes["Tier_2026"]))
    style_worksheet(
        wb["Hero_Tier_List_2026"],
        pct_cols=[
            "Recent_Patch_Presence",
            "Recent_Patch_Win_Rate",
            "Annual_Presence",
            "Spring_Presence",
            "Summer_APL_Presence",
            "Pick_Rate",
            "Ban_Rate",
            "Win_Rate",
            "Bayesian_WR",
            "DS_Lane_Share",
            "Jungle_Share",
            "Mid_Share",
            "Dragon_Lane_Share",
            "Roam_Share",
        ],
        color_scale_cols=[
            "Recent_Patch_Presence",
            "Recent_Patch_Win_Rate",
            "Annual_Presence",
            "Win_Rate",
            "Bayesian_WR",
        ],
        hero_tier_map=hero_tier_map,
    )
    style_worksheet(
        wb["True_Draft_Log_2026"],
        pct_cols=[],
        color_scale_cols=[],
    )
    style_worksheet(
        wb["Top_Synergies_2026"],
        pct_cols=["Raw_Duo_WR", "Expected_BT_WR", "Posterior_EB_WR", "Synergy_Delta2_Lift"],
        color_scale_cols=["Posterior_EB_WR", "Synergy_Delta2_Lift"],
    )
    style_worksheet(
        wb["Top_Counters_2026"],
        pct_cols=[
            "Raw_WR_vs_Target",
            "Expected_BT_WR",
            "Played_Delta2_Lift",
            "Posterior_EB_WR",
            "Counter_Delta2_Lift",
            "Same_Lane_WR",
        ],
        color_scale_cols=["Posterior_EB_WR", "Counter_Delta2_Lift"],
    )
    style_worksheet(
        wb["Direct_Lane_Counters_2026"],
        pct_cols=[
            "Raw_InLane_WR",
            "Expected_BT_WR",
            "Played_InLane_Lift",
            "Posterior_InLane_WR",
            "InLane_Delta2_Lift",
        ],
        color_scale_cols=["Posterior_InLane_WR", "InLane_Delta2_Lift"],
    )

    wb.save(excel_path)


def main():
    PACKAGE_DIR.mkdir(parents=True, exist_ok=True)
    CSV_DIR.mkdir(parents=True, exist_ok=True)

    print("Building 2026 Commercial DataFrames with Bradley-Terry Delta-2 & In-Lane 1v1 Engine...")
    df_summary, df_heroes, df_drafts, df_synergy, df_counters, df_lane_counters = build_dataframes()

    # Save CSV files (UTF-8-SIG for seamless Excel & Pandas compatibility)
    df_summary.to_csv(CSV_DIR / "executive_summary_2026.csv", index=False, encoding="utf-8-sig")
    df_heroes.to_csv(CSV_DIR / "hero_tier_stats_2026.csv", index=False, encoding="utf-8-sig")
    df_drafts.to_csv(CSV_DIR / "true_draft_matches_2026.csv", index=False, encoding="utf-8-sig")
    df_synergy.to_csv(CSV_DIR / "synergy_combos_2026.csv", index=False, encoding="utf-8-sig")
    df_counters.to_csv(CSV_DIR / "counter_matchups_2026.csv", index=False, encoding="utf-8-sig")
    df_lane_counters.to_csv(CSV_DIR / "direct_lane_counters_2026.csv", index=False, encoding="utf-8-sig")
    print(f"Saved 6 raw CSV files to: {CSV_DIR}")

    # Save formatted Excel master workbook (handle Windows file lock if open in Excel)
    excel_path = PACKAGE_DIR / "RoV_Pro_Draft_Master_2026.xlsx"
    temp_excel_path = PACKAGE_DIR / "RoV_Pro_Draft_Master_2026_v2.xlsx"
    print(f"Formatting Master Excel Workbook: {excel_path.name}...")
    try:
        write_excel_workbook(excel_path, df_summary, df_heroes, df_drafts, df_synergy, df_counters, df_lane_counters)
        active_excel_path = excel_path
        if temp_excel_path.exists():
            temp_excel_path.unlink(missing_ok=True)
    except PermissionError:
        print(f"  [Note] {excel_path.name} is currently open in Excel; writing to {temp_excel_path.name} instead.")
        write_excel_workbook(
            temp_excel_path, df_summary, df_heroes, df_drafts, df_synergy, df_counters, df_lane_counters
        )
        active_excel_path = temp_excel_path

    # Remove legacy Data_Dictionary.md if present (not needed in package)
    (PACKAGE_DIR / "Data_Dictionary.md").unlink(missing_ok=True)

    # Create commercial ZIP archive
    zip_path = EXPORT_ROOT / f"{PACKAGE_NAME}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(PACKAGE_DIR.rglob("*")):
            if file_path.is_file():
                if file_path.name.startswith("~$"):
                    continue
                if active_excel_path == temp_excel_path and file_path == excel_path:
                    continue
                if file_path == temp_excel_path:
                    arcname = Path(PACKAGE_NAME) / "RoV_Pro_Draft_Master_2026.xlsx"
                else:
                    arcname = file_path.relative_to(EXPORT_ROOT)
                zf.write(file_path, arcname)

    print("=" * 70)
    print("COMMERCIAL DATA PACKAGE EXPORT COMPLETE")
    print("=" * 70)
    print(f"Folder : {PACKAGE_DIR}")
    print(f"Excel  : {active_excel_path} ({active_excel_path.stat().st_size / 1024:.1f} KB)")
    print(f"ZIP    : {zip_path} ({zip_path.stat().st_size / 1024:.1f} KB)")
    print(f"Games  : {len(df_drafts):,} (100% True Pick Order + 5-Lane Assignments)")
    print(f"Heroes : {len(df_heroes)} heroes analyzed")
    print("=" * 70)


if __name__ == "__main__":
    main()
