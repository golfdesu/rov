"""High-performance automated draft screenshot processor using Global Hungarian Bipartite Matching.

Reads draft broadcast screenshots, matches hero portraits using linear_sum_assignment
against the template bank in data/broadcast_templates/, solves a global 2D bipartite
assignment across the screenshot batch against candidate games in data/matches_draft_full.json,
extracts chronological pick order, files the screenshots, and records ground truth in
data/true_pick_order.json.
"""

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.optimize import linear_sum_assignment

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TEMPLATES_DIR = DATA_DIR / "broadcast_templates"
TRUE_ORDER_PATH = DATA_DIR / "true_pick_order.json"
MATCHES_PATH = DATA_DIR / "matches_draft_full.json"

# League overlay coordinate presets
LEAGUE_LAYOUTS = {
    "aog": {
        "blue_xs": [0.022, 0.115, 0.208, 0.300, 0.393],
        "red_xs": [0.887, 0.795, 0.702, 0.610, 0.518],  # Mirrored: right-to-left
        "y_top": 0.26,
        "y_bottom": 0.78,
        "card_w": 0.090,
    },
    "rpl": {
        "blue_xs": [0.003, 0.076, 0.149, 0.222, 0.295],
        "red_xs": [0.922, 0.849, 0.776, 0.703, 0.630],  # Mirrored: right-to-left
        "y_top": 0.27,
        "y_bottom": 0.79,
        "card_w": 0.072,
    },
    "gcs": {
        "blue_xs": [0.003, 0.089, 0.175, 0.261, 0.347],
        "red_xs": [0.914, 0.828, 0.742, 0.656, 0.570],  # Mirrored: right-to-left
        "y_top": 0.26,
        "y_bottom": 0.78,
        "card_w": 0.084,
    },
    "apl": {
        "blue_xs": [0.015, 0.111, 0.207, 0.303, 0.399],
        "red_xs": [0.889, 0.793, 0.697, 0.601, 0.505],  # Mirrored: right-to-left
        "y_top": 0.37,
        "y_bottom": 0.88,
        "card_w": 0.092,
    },
}

LEAGUE_SERIES_PREFIXES = {
    "aog": "Arena_of_Glory_2026",
    "rpl": "RoV_Pro_League_2026",
    "gcs": "Garena_Challenger_Series_2026",
    "apl": "Arena_of_Valor_Premier_League_2026",
}

TARGET_SIZE = (64, 80)
SKIP_CONFLICT_MARGIN = 20.0

TEAM_CODES = {
    # AOG
    "RRQ VN": "rrq",
    "BOOM VN": "boom",
    "FL": "fl",
    "FPL": "fpl",
    "GAM": "gam",
    "BOX": "box",
    "1S": "1s",
    "SECRET": "secret",
    "TEAM SECRET": "secret",
    "SP": "sp",
    # RPL
    "KOG": "kog",
    "BRU": "bru",
    "GJC": "gjc",
    "HD": "hd",
    "TEN": "ten",
    "TENACITY": "ten",
    "FS": "fs",
    "BAC": "bac",
    "EA": "ea",
    "SLX": "slx",
    "SOLYX": "slx",
    # GCS & APL
    "CARNIFEX": "cfx",
    "TIMELESS": "tl",
    "ONE": "one",
    "HKA": "hka",
    "ANK": "ank",
    "BMG": "bmg",
    "DCG": "dcg",
    "FW": "fw",
    "LIT": "lit",
}


def load_templates():
    templates = {}
    for p in TEMPLATES_DIR.glob("*.png"):
        templates[p.stem] = np.array(Image.open(p).convert("RGB"), dtype=np.float32)
    return templates


def extract_crops(im, layout):
    W, H = im.size
    y_top = layout["y_top"]
    y_bot = layout["y_bottom"]
    cw = layout["card_w"]

    b_crops = []
    for x in layout["blue_xs"]:
        box = (int(W * x), int(H * y_top), int(W * (x + cw)), int(H * y_bot))
        c = im.crop(box).convert("RGB").resize(TARGET_SIZE, Image.Resampling.LANCZOS)
        b_crops.append(np.array(c, dtype=np.float32))

    r_crops = []
    for x in layout["red_xs"]:
        box = (int(W * x), int(H * y_top), int(W * (x + cw)), int(H * y_bot))
        c = im.crop(box).convert("RGB").resize(TARGET_SIZE, Image.Resampling.LANCZOS)
        r_crops.append(np.array(c, dtype=np.float32))

    return b_crops, r_crops


def score_image_against_game(b_crops, r_crops, g, templates):
    bp, rp = g["blue_picks"], g["red_picks"]

    C_b = np.zeros((5, 5), dtype=np.float32)
    for i in range(5):
        for j in range(5):
            C_b[i, j] = np.mean(np.abs(b_crops[i] - templates[bp[j]]))
    r_b, c_b = linear_sum_assignment(C_b)
    cost_b = float(C_b[r_b, c_b].sum())
    assign_b = [bp[c] for c in c_b]
    max_slot_b = float(C_b[r_b, c_b].max())

    C_r = np.zeros((5, 5), dtype=np.float32)
    for i in range(5):
        for j in range(5):
            C_r[i, j] = np.mean(np.abs(r_crops[i] - templates[rp[j]]))
    r_r, c_r = linear_sum_assignment(C_r)
    cost_r = float(C_r[r_r, c_r].sum())
    assign_r = [rp[c] for c in c_r]
    max_slot_r = float(C_r[r_r, c_r].max())

    return cost_b + cost_r, assign_b, assign_r, max(max_slot_b, max_slot_r)


def match_image_against_candidates(b_crops, r_crops, candidate_games, templates):
    scored = []
    for g in candidate_games:
        cost, assign_b, assign_r, _ = score_image_against_game(b_crops, r_crops, g, templates)
        scored.append((cost, g, assign_b, assign_r))
    scored.sort(key=lambda x: x[0])
    return scored


def _parse_match_datetime(dt_str: str) -> datetime:
    try:
        return datetime.strptime(f"2026 {dt_str}", "%Y %B %d, 2026 - %H:%M")
    except ValueError:
        return datetime(2026, 1, 1)


def build_apl_series_schedule(all_matches):
    """Computes (stage_folder, stage_code, day_num, match_in_day) for every APL 2026 series."""
    stage_configs = [
        ("Wildcard", "wildcard", "wc"),
        ("Swiss_Stage", "swiss_stage", "ss"),
        ("Playoffs", "playoffs", "po"),
    ]
    schedule = {}
    for stage_token, folder_name, stage_code in stage_configs:
        series_dates = {}
        for m in all_matches:
            sid = m.get("series_id", "")
            if f"Premier_League_2026_{stage_token}" in sid:
                series_dates[sid] = m.get("date", "")
        sorted_sids = sorted(
            series_dates.items(),
            key=lambda x: (_parse_match_datetime(x[1]), int(x[0].split("_S")[-1])),
        )
        unique_days = sorted({_parse_match_datetime(dt).date() for _, dt in sorted_sids})
        day_index = {d: i + 1 for i, d in enumerate(unique_days)}
        day_match_counters = {}
        for sid, dt in sorted_sids:
            d_obj = _parse_match_datetime(dt).date()
            d_num = day_index[d_obj]
            day_match_counters[d_num] = day_match_counters.get(d_num, 0) + 1
            m_in_day = day_match_counters[d_num]
            schedule[sid] = (folder_name, stage_code, d_num, m_in_day)
    return schedule


def format_apl_filename(series_id, game_num, blue_team, red_team, apl_schedule):
    folder_name, stage_code, day_num, match_num = apl_schedule.get(
        series_id, ("swiss_stage", "ss", 1, int(series_id.split("_S")[-1]))
    )
    t1_code = TEAM_CODES.get(blue_team, blue_team.lower().replace(" ", ""))
    t2_code = TEAM_CODES.get(red_team, red_team.lower().replace(" ", ""))
    fname = f"2026_{stage_code}_d{day_num}_m{match_num}_g{game_num}_apl_{t1_code}_vs_{t2_code}.png"
    rel_path = f"2026_apl/{folder_name}/{fname}"
    return rel_path


def format_aog_filename(series_id, game_num, blue_team, red_team):
    s_idx = int(series_id.split("_S")[-1])
    match_num = s_idx
    if s_idx <= 6:
        week = 1
        day = 1 if s_idx <= 2 else (2 if s_idx <= 4 else 3)
    elif s_idx <= 17:
        week = 2
        day = 4 if s_idx <= 10 else (5 if s_idx <= 14 else 6)
    elif s_idx <= 28:
        week = 3
        day = 7 if s_idx <= 19 else (8 if s_idx <= 22 else (9 if s_idx <= 25 else 10))
    elif s_idx <= 36:
        week = 4
        day = 11 if s_idx <= 31 else (12 if s_idx <= 34 else 13)
    elif s_idx <= 917:
        week = 5
        day = 14 if s_idx <= 908 else (15 if s_idx <= 911 else (16 if s_idx <= 914 else 17))
    elif s_idx <= 929:
        week = 6
        day = 18 if s_idx <= 920 else (19 if s_idx <= 923 else (20 if s_idx <= 926 else 21))
    elif s_idx <= 935:
        week = 7
        day = 22 if s_idx <= 932 else 23
    else:
        week = 8
        day = 24 if s_idx <= 938 else 25

    t1_code = TEAM_CODES.get(blue_team, blue_team.lower().replace(" ", ""))
    t2_code = TEAM_CODES.get(red_team, red_team.lower().replace(" ", ""))

    fname = f"2026_w{week}_d{day}_m{match_num}_g{game_num}_win_aog_{t1_code}_vs_{t2_code}.png"
    rel_path = f"2026_aog_winter/week{week}/{fname}"
    return rel_path


def format_dest_path(league, series_id, game_num, blue_team, red_team, apl_schedule):
    if league == "apl":
        return format_apl_filename(series_id, game_num, blue_team, red_team, apl_schedule)
    if league == "aog":
        return format_aog_filename(series_id, game_num, blue_team, red_team)
    t1_code = TEAM_CODES.get(blue_team, blue_team.lower().replace(" ", ""))
    t2_code = TEAM_CODES.get(red_team, red_team.lower().replace(" ", ""))
    s_idx = int(series_id.split("_S")[-1])
    season = "win" if "Winter" in series_id else ("sum" if "Summer" in series_id else "spr")
    season_full = "winter" if "Winter" in series_id else ("summer" if "Summer" in series_id else "spring")
    fname = f"2026_m{s_idx}_g{game_num}_{season}_{league}_{t1_code}_vs_{t2_code}.png"
    return f"2026_{league}_{season_full}/{fname}"


def filter_candidates_for_target(all_matches, existing_keys, league, input_dir: Path | None = None):
    prefix = LEAGUE_SERIES_PREFIXES[league]
    stage_filter = None
    if league == "apl" and input_dir is not None:
        dir_str = input_dir.as_posix().lower()
        if "wildcard" in dir_str:
            stage_filter = "Wildcard"
        elif "swiss_stage" in dir_str:
            stage_filter = "Swiss_Stage"
        elif "playoffs" in dir_str:
            stage_filter = "Playoffs"

    candidates = []
    for m in all_matches:
        sid = m.get("series_id", "")
        if prefix not in sid:
            continue
        if stage_filter and stage_filter not in sid:
            continue
        if (sid, m["game_number"]) not in existing_keys:
            candidates.append(m)
    return candidates


def process_screenshots(input_files, dry_run=False, league="aog", input_dir: Path | None = None):
    templates = load_templates()
    layout = LEAGUE_LAYOUTS[league]

    with open(MATCHES_PATH, "r", encoding="utf-8") as f:
        all_matches = json.load(f)

    with open(TRUE_ORDER_PATH, "r", encoding="utf-8") as f:
        true_order_data = json.load(f)

    existing_keys = {(g["series_id"], g["game_number"]) for g in true_order_data["games"]}
    candidate_games = filter_candidates_for_target(all_matches, existing_keys, league, input_dir)
    apl_schedule = build_apl_series_schedule(all_matches) if league == "apl" else {}

    print(
        f"Loaded {len(templates)} templates, {len(candidate_games)} unrecorded candidate games for league '{league}'."
    )
    if not candidate_games:
        print("No unrecorded candidate games remain for this league/stage.")
        return

    n_imgs = len(input_files)
    n_cands = len(candidate_games)
    cost_matrix = np.zeros((n_imgs, n_cands), dtype=np.float32)
    max_slot_matrix = np.zeros((n_imgs, n_cands), dtype=np.float32)
    assignments_b = [[None] * n_cands for _ in range(n_imgs)]
    assignments_r = [[None] * n_cands for _ in range(n_imgs)]

    for i, fpath in enumerate(input_files):
        im = Image.open(fpath)
        b_crops, r_crops = extract_crops(im, layout)
        for j, g in enumerate(candidate_games):
            cost, ab, ar, max_slot_err = score_image_against_game(b_crops, r_crops, g, templates)
            cost_matrix[i, j] = cost
            max_slot_matrix[i, j] = max_slot_err
            assignments_b[i][j] = ab
            assignments_r[i][j] = ar

    # Global 2D Hungarian Bipartite Assignment across all screenshots in the batch
    row_ind, col_ind = linear_sum_assignment(cost_matrix)

    new_entries = []
    for i, j in zip(row_ind, col_ind):
        fpath = input_files[i]
        best_cost = float(cost_matrix[i, j])
        max_slot_err = float(max_slot_matrix[i, j])
        best_game = candidate_games[j]
        best_b = assignments_b[i][j]
        best_r = assignments_r[i][j]
        sid = best_game["series_id"]
        gnum = best_game["game_number"]

        sorted_row_costs = np.sort(cost_matrix[i])
        second_cost = float(sorted_row_costs[1]) if len(sorted_row_costs) > 1 else best_cost
        gap = second_cost - best_cost

        rel_dest = format_dest_path(league, sid, gnum, best_game["blue_team"], best_game["red_team"], apl_schedule)
        dest_abs = DATA_DIR / "draft_screenshots" / rel_dest

        row_min = float(cost_matrix[i].min())
        if best_cost - row_min > SKIP_CONFLICT_MARGIN:
            print(
                f"[SKIP] {fpath.name}: its best game is already claimed by another screenshot "
                f"(assigned cost {best_cost:.1f} vs own best {row_min:.1f}) — likely a duplicate capture."
            )
            continue

        print(f"Match: {fpath.name} -> {sid} G{gnum} ({best_game['blue_team']} vs {best_game['red_team']})")
        print(f"  Cost: {best_cost:.1f} (gap: {gap:.1f}, max_slot: {max_slot_err:.1f}) | Dest: {rel_dest}")
        if max_slot_err > 62.0:
            print(
                f"  [WARN] High single-slot L1 error ({max_slot_err:.1f} > 62.0) — verify image visually for broadcast overlay glitch!"
            )
        print(f"  Blue picks: {best_b}")
        print(f"  Red picks:  {best_r}")

        entry = {
            "series_id": sid,
            "game_number": gnum,
            "date": best_game.get("date", ""),
            "blue_team": best_game["blue_team"],
            "red_team": best_game["red_team"],
            "blue_picks": best_b,
            "red_picks": best_r,
            "source": "screenshot",
            "screenshot": rel_dest,
        }
        new_entries.append((fpath, dest_abs, entry))

    if not dry_run and new_entries:
        # Use two-phase rename via temporary paths to avoid overwriting when renaming in-place
        temp_moves = []
        for idx, (src_path, dest_path, entry) in enumerate(new_entries):
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            if src_path.resolve() != dest_path.resolve():
                tmp_path = dest_path.parent / f".__tmp_ingest_{idx}_{dest_path.name}"
                shutil.move(str(src_path), str(tmp_path))
                temp_moves.append((tmp_path, dest_path))
            true_order_data["games"].append(entry)

        for tmp_path, dest_path in temp_moves:
            shutil.move(str(tmp_path), str(dest_path))

        # Sort games by series and game_number
        true_order_data["games"].sort(key=lambda x: (x["series_id"], x["game_number"]))

        with open(TRUE_ORDER_PATH, "w", encoding="utf-8") as f:
            json.dump(true_order_data, f, ensure_ascii=False, indent=2)

        print(f"\nSuccessfully filed and recorded {len(new_entries)} games in data/true_pick_order.json.")
    elif dry_run:
        print(f"\n[Dry Run] Matched {len(new_entries)} games via global Hungarian assignment.")


def infer_league_from_dir(target_dir: Path, fallback: str = "aog") -> str:
    s = target_dir.as_posix().lower()
    for lg in ("apl", "aog", "rpl", "gcs"):
        if lg in s:
            return lg
    return fallback


def main():
    parser = argparse.ArgumentParser(description="Process draft broadcast screenshots")
    parser.add_argument("path", nargs="?", default=None, help="Optional folder path containing screenshots")
    parser.add_argument("--dir", dest="dir_opt", default=None, help="Directory containing screenshots to process")
    parser.add_argument("--dry-run", action="store_true", help="Run without moving files or updating JSON")
    parser.add_argument("--league", default=None, choices=["aog", "rpl", "gcs", "apl"], help="League preset")
    args = parser.parse_args()

    target_dir = Path(args.dir_opt or args.path) if (args.dir_opt or args.path) else (DATA_DIR / "draft_screenshots")
    if not target_dir.is_absolute():
        target_dir = (Path.cwd() / target_dir).resolve()

    league = args.league or infer_league_from_dir(target_dir, fallback="aog")

    files = sorted([f for f in target_dir.glob("*.png") if f.is_file()])
    if not files:
        print(f"No screenshots found in {target_dir}.")
        return

    print(f"Found {len(files)} screenshots in {target_dir} (league={league}).")
    process_screenshots(files, dry_run=args.dry_run, league=league, input_dir=target_dir)


if __name__ == "__main__":
    main()
