import json
import re
import time
from pathlib import Path
import requests
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "ROVResearchProject/1.0 (https://github.com/rov-draft-ai; contact@example.com)",
    "Accept-Encoding": "gzip",
}

TOURNAMENT_PAGES = [
    # RoV Pro League (Thailand) 2024-2026
    "RoV Pro League/2026/Winter/Group Stage",
    "RoV Pro League/2026/Winter/Playoffs",
    "RoV Pro League/2026/Summer/Group Stage",
    "RoV Pro League/2026/Summer/Playoffs",
    "RoV Pro League/2025/Winter/Group Stage",
    "RoV Pro League/2025/Winter/Playoffs",
    "RoV Pro League/2025/Summer/Group Stage",
    "RoV Pro League/2025/Summer/Playoffs",
    "RoV Pro League/2024/Winter/Group Stage",
    "RoV Pro League/2024/Winter/Playoffs",
    "RoV Pro League/2024/Summer/Group Stage",
    "RoV Pro League/2024/Summer/Playoffs",
    # Arena of Valor Premier League (International) 2024-2026
    "Arena of Valor Premier League/2026/Wildcard",
    "Arena of Valor Premier League/2026/Swiss Stage",
    "Arena of Valor Premier League/2026/Playoffs",
    "Arena of Valor Premier League/2025/Wildcard",
    "Arena of Valor Premier League/2025/Swiss Stage",
    "Arena of Valor Premier League/2025/Playoffs",
    "Arena of Valor Premier League/2024/Swiss Stage",
    "Arena of Valor Premier League/2024/Playoffs",
    # Arena of Valor International Championship (International) 2024-2025
    "Arena of Valor International Championship/2025/Group Stage",
    "Arena of Valor International Championship/2025/Knockout Stage",
    "Arena of Valor International Championship/2024/Swiss Stage",
    "Arena of Valor International Championship/2024/Knockout Stage",
    # Arena of Glory (Vietnam) 2025-2026
    "Arena of Glory/2026/Winter/Group Stage/First Leg",
    "Arena of Glory/2026/Winter/Group Stage/Second Leg",
    "Arena of Glory/2026/Winter/Playoffs",
    "Arena of Glory/2026/Spring/Group Stage 1",
    "Arena of Glory/2026/Spring/Group Stage 2",
    "Arena of Glory/2026/Spring/Playoffs",
    "Arena of Glory/2025/Winter/Group Stage 1",
    "Arena of Glory/2025/Winter/Group Stage 2",
    "Arena of Glory/2025/Winter/Playoffs",
    "Arena of Glory/2025/Spring/Group Stage 1",
    "Arena of Glory/2025/Spring/Group Stage 2",
    "Arena of Glory/2025/Spring/Playoffs",
    # Garena Challenger Series (Taiwan) 2025-2026
    "Garena Challenger Series/2026/Summer/Regular Season",
    "Garena Challenger Series/2026/Summer/Playoffs",
    "Garena Challenger Series/2026/Spring/Regular Season",
    "Garena Challenger Series/2026/Spring/Playoffs",
    "Garena Challenger Series/2025/Summer/Group Stage",
    "Garena Challenger Series/2025/Summer/Playoffs",
    "Garena Challenger Series/2025/Spring/Group Stage",
    "Garena Challenger Series/2025/Spring/Playoffs",
]


def build_hero_normalizer():
    """Build lookup dictionary mapping raw Liquipedia hero strings to canonical 130 RoV hero names."""
    df = pd.read_csv(DATA_DIR / "heroes_130_summary.csv")
    lookup = {}
    for name in df["name"]:
        key = re.sub(r"[^a-z0-9]", "", name.lower())
        lookup[key] = name
        lookup[name.lower()] = name

    # Special aliases used in Liquipedia templates
    aliases = {
        "riktor": "Richter",
        "richter": "Richter",
        "diaochan": "Diao Chan",
        "diao chan": "Diao Chan",
        "kilgroth": "Kil'Groth",
        "azzenka": "Azzen'Ka",
        "darcy": "D'Arcy",
        "elandorr": "Eland'orr",
        "telannas": "Tel'Annas",
        "ybneth": "Y'bneth",
        "lubu": "Lu Bu",
        "theflash": "The Flash",
        "flash": "The Flash",
        "wonderwoman": "Wonder Woman",
        "boltbaron": "Bolt Baron",
        "teemee": "TeeMee",
        "peura": "Helen",
        "payna": "Helen",
        "batman": "Kaine",
        "joker": "Stuart",
        "thejoker": "Stuart",
        "celica": "Brunhilda",
        "mortos": "Arthur",
        "flowborn": "Flowborn (Marksman)",
        "flowborn(marksman)": "Flowborn (Marksman)",
        "flowborn(archer)": "Flowborn (Marksman)",
        "flowborn/marksman": "Flowborn (Marksman)",
        "flowborn/archer": "Flowborn (Marksman)",
        "flowborn mm": "Flowborn (Marksman)",
        "flowborn(mage)": "Flowborn (Mage)",
        "flowborn/mage": "Flowborn (Mage)",
        "flowborn mage": "Flowborn (Mage)",
        "illumia": "Ilumia",
        "sikong zhen": "Bolt Baron",
        "sikong": "Bolt Baron",
        "jinna": "Jinnar",
        "wiro sableng": "Wiro",
        "ming shiyin": "Ming",
        "doria": "Dolia",
    }
    for k, v in aliases.items():
        lookup[k] = v
        lookup[re.sub(r"[^a-z0-9]", "", k)] = v

    def normalize(raw_name: str) -> str:
        if not raw_name:
            return ""
        s = raw_name.strip().lower()
        if s in lookup:
            return lookup[s]
        alnum = re.sub(r"[^a-z0-9]", "", s)
        return lookup.get(alnum, raw_name.strip().title())

    return normalize


def extract_balanced_templates(text: str, template_prefix: str):
    """Find all top-level {{TemplatePrefix ... }} blocks using brace balancing."""
    blocks = []
    pattern = re.compile(r"\{\{\s*" + re.escape(template_prefix) + r"\b", re.IGNORECASE)
    for m in pattern.finditer(text):
        start = m.start()
        depth = 0
        i = start
        n = len(text)
        while i < n - 1:
            if text[i:i + 2] == "{{":
                depth += 1
                i += 2
            elif text[i:i + 2] == "}}":
                depth -= 1
                i += 2
                if depth == 0:
                    blocks.append(text[start:i])
                    break
            else:
                i += 1
    return blocks


def fetch_liquipedia_wikitext_batches(pages):
    """Fetch wikitext for tournament pages in batches of 25 with polite rate-limiting."""
    results = {}
    batch_size = 25
    for i in range(0, len(pages), batch_size):
        batch = pages[i:i + batch_size]
        print(f"Fetching Liquipedia batch {i // batch_size + 1} ({len(batch)} pages)...")
        url = "https://liquipedia.net/arenaofvalor/api.php"
        params = {
            "action": "query",
            "prop": "revisions",
            "rvprop": "content",
            "redirects": 1,
            "titles": "|".join(batch),
            "format": "json",
        }
        r = requests.get(url, params=params, headers=HEADERS, timeout=30)
        r.raise_for_status()
        data = r.json()
        for p in data.get("query", {}).get("pages", {}).values():
            title = p.get("title")
            wt = p.get("revisions", [{}])[0].get("*", "") if "revisions" in p else ""
            if title and wt:
                results[title] = wt
        if i + batch_size < len(pages):
            time.sleep(1.5)
    return results


def parse_match_block(match_wt: str, tournament_page: str, series_idx: int, normalize_hero):
    """Parse a single {{Match ...}} block into ordered games with Global Ban tracking."""
    # Extract tournament metadata
    parts = tournament_page.split("/")
    league = parts[0]
    year = parts[1] if len(parts) > 1 else ""
    stage = "/".join(parts[2:]) if len(parts) > 2 else ""

    bestof_m = re.search(r"\|\s*bestof\s*=\s*(\d+)", match_wt)
    bestof = int(bestof_m.group(1)) if bestof_m else 5

    date_m = re.search(r"\|\s*date\s*=\s*([^\n|]+)", match_wt)
    match_date = re.sub(r"\{\{[^}]+\}\}", "", date_m.group(1)).strip() if date_m else ""

    opp1_m = re.search(r"\|\s*opponent1\s*=\s*\{\{(?:TeamOpponent|LiteralOpponent)\|([^|\n}]+)", match_wt)
    opp2_m = re.search(r"\|\s*opponent2\s*=\s*\{\{(?:TeamOpponent|LiteralOpponent)\|([^|\n}]+)", match_wt)
    team1 = opp1_m.group(1).strip().upper() if opp1_m else "TEAM1"
    team2 = opp2_m.group(1).strip().upper() if opp2_m else "TEAM2"

    # Find all |mapX={{Map ... }} blocks in order
    map_entries = []
    for map_num in range(1, 10):
        map_m = re.search(rf"\|\s*map{map_num}\s*=\s*(\{{\{{\s*Map\b)", match_wt, re.IGNORECASE)
        if not map_m:
            continue
        start = map_m.start(1)
        sub_blocks = extract_balanced_templates(match_wt[start:], "Map")
        if sub_blocks:
            map_entries.append((map_num, sub_blocks[0]))

    series_games = []
    # Track heroes already played by Team 1 and Team 2 in this series (Global Ban Pick)
    team1_used_heroes = []
    team2_used_heroes = []

    for game_num, map_wt in map_entries:
        t1side_m = re.search(r"\|\s*team1side\s*=\s*(blue|red)", map_wt, re.IGNORECASE)
        t2side_m = re.search(r"\|\s*team2side\s*=\s*(blue|red)", map_wt, re.IGNORECASE)
        winner_m = re.search(r"\|\s*winner\s*=\s*([12])", map_wt)
        len_m = re.search(r"\|\s*length\s*=\s*([0-9:]+)", map_wt)

        t1_side = t1side_m.group(1).lower() if t1side_m else ""
        t2_side = t2side_m.group(1).lower() if t2side_m else ""
        if not t1_side and t2_side:
            t1_side = "red" if t2_side == "blue" else "blue"
        elif not t2_side and t1_side:
            t2_side = "red" if t1_side == "blue" else "blue"

        winner = int(winner_m.group(1)) if winner_m else 0
        game_length = len_m.group(1) if len_m else ""

        t1_picks = []
        t2_picks = []
        for h_idx in range(1, 6):
            m1 = re.search(rf"\|\s*t1h{h_idx}\s*=\s*([^\n|}}]+)", map_wt)
            m2 = re.search(rf"\|\s*t2h{h_idx}\s*=\s*([^\n|}}]+)", map_wt)
            h1 = normalize_hero(m1.group(1)) if m1 and m1.group(1).strip() else ""
            h2 = normalize_hero(m2.group(1)) if m2 and m2.group(1).strip() else ""
            if h1:
                t1_picks.append(h1)
            if h2:
                t2_picks.append(h2)

        t1_bans = []
        t2_bans = []
        for b_idx in range(1, 5):
            mb1 = re.search(rf"\|\s*t1b{b_idx}\s*=\s*([^\n|}}]+)", map_wt)
            mb2 = re.search(rf"\|\s*t2b{b_idx}\s*=\s*([^\n|}}]+)", map_wt)
            b1 = normalize_hero(mb1.group(1)) if mb1 and mb1.group(1).strip() else ""
            b2 = normalize_hero(mb2.group(1)) if mb2 and mb2.group(1).strip() else ""
            if b1:
                t1_bans.append(b1)
            if b2:
                t2_bans.append(b2)

        # Require complete 5v5 picks to include in draft dataset
        if len(t1_picks) < 5 or len(t2_picks) < 5:
            continue

        # In Game 7 of BO7 (Ultimate Battle), Global Ban Pick resets
        is_ultimate_battle = (bestof == 7 and game_num == 7)
        t1_global_bans = [] if is_ultimate_battle else list(team1_used_heroes)
        t2_global_bans = [] if is_ultimate_battle else list(team2_used_heroes)

        # Normalize to Blue Side vs Red Side perspective
        if t1_side == "red":
            blue_team, red_team = team2, team1
            blue_picks, red_picks = t2_picks, t1_picks
            blue_bans, red_bans = t2_bans, t1_bans
            blue_global_bans, red_global_bans = t2_global_bans, t1_global_bans
            blue_win = 1 if winner == 2 else (0 if winner == 1 else -1)
        else:
            blue_team, red_team = team1, team2
            blue_picks, red_picks = t1_picks, t2_picks
            blue_bans, red_bans = t1_bans, t2_bans
            blue_global_bans, red_global_bans = t1_global_bans, t2_global_bans
            blue_win = 1 if winner == 1 else (0 if winner == 2 else -1)

        series_id = f"{league}_{year}_{stage}_S{series_idx}".replace(" ", "_")
        game_record = {
            "series_id": series_id,
            "league": league,
            "year": year,
            "stage": stage,
            "date": match_date,
            "bestof": bestof,
            "game_number": game_num,
            "is_ultimate_battle": is_ultimate_battle,
            "length": game_length,
            "blue_team": blue_team,
            "red_team": red_team,
            "blue_win": blue_win,
            "blue_bans": blue_bans,
            "red_bans": red_bans,
            "blue_picks": blue_picks,
            "red_picks": red_picks,
            "blue_global_bans": blue_global_bans,
            "red_global_bans": red_global_bans,
        }
        series_games.append(game_record)

        # Add picks from this game to each team's Global Ban pool for subsequent games in the series
        team1_used_heroes.extend(t1_picks)
        team2_used_heroes.extend(t2_picks)

    return series_games


def main():
    normalize_hero = build_hero_normalizer()
    raw_pages = fetch_liquipedia_wikitext_batches(TOURNAMENT_PAGES)

    all_games = []
    flat_rows = []
    series_counter = 0

    for page_title, wt in raw_pages.items():
        match_blocks = extract_balanced_templates(wt, "Match")
        page_game_count = 0
        for m_block in match_blocks:
            series_counter += 1
            games = parse_match_block(m_block, page_title, series_counter, normalize_hero)
            page_game_count += len(games)
            for g in games:
                all_games.append(g)
                b_bans = g["blue_bans"] + [""] * (4 - len(g["blue_bans"]))
                r_bans = g["red_bans"] + [""] * (4 - len(g["red_bans"]))
                b_picks = g["blue_picks"] + [""] * (5 - len(g["blue_picks"]))
                r_picks = g["red_picks"] + [""] * (5 - len(g["red_picks"]))

                flat_rows.append({
                    "series_id": g["series_id"],
                    "league": g["league"],
                    "year": g["year"],
                    "stage": g["stage"],
                    "date": g["date"],
                    "bestof": g["bestof"],
                    "game_number": g["game_number"],
                    "is_ultimate_battle": g["is_ultimate_battle"],
                    "length": g["length"],
                    "blue_team": g["blue_team"],
                    "red_team": g["red_team"],
                    "blue_win": g["blue_win"],
                    # Phase 1 Bans
                    "blue_ban_1": b_bans[0],
                    "red_ban_1": r_bans[0],
                    "blue_ban_2": b_bans[1],
                    "red_ban_2": r_bans[1],
                    # Phase 2 Bans
                    "red_ban_3": r_bans[2],
                    "blue_ban_3": b_bans[2],
                    "red_ban_4": r_bans[3],
                    "blue_ban_4": b_bans[3],
                    # Blue Picks (1-5)
                    "blue_pick_1": b_picks[0],
                    "blue_pick_2": b_picks[1],
                    "blue_pick_3": b_picks[2],
                    "blue_pick_4": b_picks[3],
                    "blue_pick_5": b_picks[4],
                    # Red Picks (1-5)
                    "red_pick_1": r_picks[0],
                    "red_pick_2": r_picks[1],
                    "red_pick_3": r_picks[2],
                    "red_pick_4": r_picks[3],
                    "red_pick_5": r_picks[4],
                    # Global Bans (previously used heroes in same series)
                    "blue_global_bans_count": len(g["blue_global_bans"]),
                    "red_global_bans_count": len(g["red_global_bans"]),
                    "blue_global_bans": "|".join(g["blue_global_bans"]),
                    "red_global_bans": "|".join(g["red_global_bans"]),
                })
        print(f"  {page_title}: {page_game_count} complete draft games")

    json_path = DATA_DIR / "matches_draft_full.json"
    csv_path = DATA_DIR / "matches_draft_flat.csv"

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(all_games, f, ensure_ascii=False, indent=2)

    df = pd.DataFrame(flat_rows)
    df.to_csv(csv_path, index=False, encoding="utf-8-sig")

    print(f"\nTotal complete professional draft games collected: {len(all_games)}")
    print(f"Saved JSON to: {json_path}")
    print(f"Saved CSV to:  {csv_path}")


if __name__ == "__main__":
    main()
