"""Server-side Scrim Analytics aggregator for the RPL 2026 sample datasets.

All raw match arrays remain strictly server-side in configs/sample_scrim_rpl_2026_*.json;
only aggregated statistics and metrics are returned to clients.
"""

from __future__ import annotations

import csv
import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Literal

from src.config import config

DEFAULT_SAMPLE_DATASET = "rpl-2026-winter"
SAMPLE_DATASET_ALIASES = {"sample-league-2026": "rpl-2026-summer"}
SAMPLE_DATASETS: dict[str, dict] = {
    "rpl-2026-winter": {
        "id": "rpl-2026-winter",
        "name": "RPL 2026 Winter",
        "path": config.paths.configs_dir / "sample_scrim_rpl_2026_winter.json",
    },
    "rpl-2026-summer": {
        "id": "rpl-2026-summer",
        "name": "RPL 2026 Summer",
        "path": config.paths.configs_dir / "sample_scrim_rpl_2026_summer.json",
    },
}
SAMPLE_GAMES_PATH = SAMPLE_DATASETS[DEFAULT_SAMPLE_DATASET]["path"]
SAMPLE_TOURNAMENT = {"id": DEFAULT_SAMPLE_DATASET, "name": SAMPLE_DATASETS[DEFAULT_SAMPLE_DATASET]["name"]}
CANONICAL_LANES = ("DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam")
VALID_LANES = frozenset(CANONICAL_LANES)
SLOT_DEFS = (
    ("B1", "blue", 1),
    ("R1-2", "red", 1),
    ("B2-3", "blue", 1),
    ("R3", "red", 1),
    ("R4", "red", 2),
    ("B4-5", "blue", 2),
    ("R5", "red", 2),
)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _wilson_ci_95(wins: int, n: int) -> list[float] | None:
    if n <= 0:
        return None
    z = 1.96
    p = _clamp(wins / n, 0.0, 1.0)
    denom = 1.0 + (z * z) / n
    center = (p + (z * z) / (2.0 * n)) / denom
    margin = (z * math.sqrt((p * (1.0 - p)) / n + (z * z) / (4.0 * n * n))) / denom
    return [max(0.0, (center - margin) * 100.0), min(100.0, (center + margin) * 100.0)]


def _normal_cdf(z: float) -> float:
    return 0.5 * math.erfc(-z / math.sqrt(2.0))


def _two_prop_z_test(w1: int, n1: int, w2: int, n2: int) -> dict:
    if n1 <= 0 or n2 <= 0:
        return {
            "diffPct": 0.0,
            "zScore": 0.0,
            "pValue": 1.0,
            "significant95": False,
            "probGroup1BetterPct": 50.0,
            "probDominantPct": 50.0,
        }
    p1 = w1 / n1
    p2 = w2 / n2
    diff_pct = (p1 - p2) * 100.0
    pooled = (w1 + w2) / (n1 + n2)
    se = math.sqrt(max(1e-12, pooled * (1.0 - pooled) * (1.0 / n1 + 1.0 / n2)))
    z_score = 0.0 if (pooled <= 0.0 or pooled >= 1.0) else (p1 - p2) / se
    p_value = min(1.0, max(0.0, math.erfc(abs(z_score) / math.sqrt(2.0))))
    prob_g1 = _clamp(_normal_cdf(z_score) * 100.0, 0.0, 100.0)
    return {
        "diffPct": diff_pct,
        "zScore": z_score,
        "pValue": p_value,
        "significant95": n1 >= 5 and n2 >= 5 and p_value < 0.05,
        "probGroup1BetterPct": prob_g1,
        "probDominantPct": max(prob_g1, 100.0 - prob_g1),
    }


def _compute_series_win_prob(p_blue: float, p_red: float, best_of: int, start_blue: bool) -> float:
    target = 3 if best_of == 5 else 4
    b = _clamp(p_blue, 0.05, 0.95)
    r = _clamp(p_red, 0.05, 0.95)
    memo: dict[tuple[int, int], float] = {}

    def solve(w: int, loss: int) -> float:
        if w >= target:
            return 1.0
        if loss >= target:
            return 0.0
        key = (w, loss)
        if key in memo:
            return memo[key]
        game_idx = w + loss
        is_blue = (game_idx % 2 == 0) if start_blue else (game_idx % 2 == 1)
        p = b if is_blue else r
        res = p * solve(w + 1, loss) + (1.0 - p) * solve(w, loss + 1)
        memo[key] = res
        return res

    return solve(0, 0)


def _bradley_terry_synergy(p_a: float, p_b: float) -> float:
    a = _clamp(p_a, 0.05, 0.95)
    b = _clamp(p_b, 0.05, 0.95)
    num = a * b
    den = num + (1.0 - a) * (1.0 - b)
    return num / den if den > 0.0 else 0.5


def _bradley_terry_counter(p_a: float, p_b: float) -> float:
    a = _clamp(p_a, 0.05, 0.95)
    b = _clamp(p_b, 0.05, 0.95)
    num = a * (1.0 - b)
    den = num + (1.0 - a) * b
    return num / den if den > 0.0 else 0.5


def _compute_pool_diversity(pick_counts: dict[str, int], total_pick_slots: int) -> tuple[int, float, float]:
    shannon_h = 0.0
    if total_pick_slots > 0:
        for count in pick_counts.values():
            p = count / total_pick_slots
            if p > 0.0:
                shannon_h -= p * math.log(p)
    unique_count = len(pick_counts)
    effective = math.exp(shannon_h) if unique_count > 0 else 0.0
    evenness = _clamp((effective / unique_count) * 100.0, 0.0, 100.0) if unique_count > 0 else 0.0
    return unique_count, effective, evenness


@lru_cache(maxsize=4)
def _load_sample_games(dataset_id: str = DEFAULT_SAMPLE_DATASET) -> tuple[dict, ...]:
    meta = SAMPLE_DATASETS.get(dataset_id)
    if meta is None:
        return ()
    path: Path = meta["path"]
    if not path.is_file():
        return ()
    raw = json.loads(path.read_text(encoding="utf-8"))
    return tuple(raw)


@lru_cache(maxsize=1)
def _load_hero_roles() -> dict[str, str]:
    aliases = {"Warrior": "Fighter", "Marksman": "Carry"}
    roles: dict[str, str] = {}
    csv_path = config.paths.heroes_csv_path
    if csv_path.is_file():
        with csv_path.open(encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                name = (row.get("name") or "").strip()
                role = (row.get("primary_role") or "").strip()
                role = aliases.get(role, role)
                if name and role:
                    roles[name] = role
    return roles


def _empty_pick_counts() -> dict[str, int]:
    return {"games": 0, "wins": 0, "losses": 0, "phase1Count": 0, "phase2Count": 0, "b1Count": 0, "r5Count": 0}


def _record_pick(counts: dict[str, int], idx: int, is_blue: bool, decided: bool, did_win: bool) -> None:
    counts["games"] += 1
    if idx < 3:
        counts["phase1Count"] += 1
    else:
        counts["phase2Count"] += 1
    if is_blue and idx == 0:
        counts["b1Count"] += 1
    if (not is_blue) and idx == 4:
        counts["r5Count"] += 1
    if decided:
        if did_win:
            counts["wins"] += 1
        else:
            counts["losses"] += 1


def _summarize_picks(counts: dict[str, int], team_prior: float, prior_k: int) -> dict:
    decided = counts["wins"] + counts["losses"]
    bayesian_wr = (counts["wins"] + prior_k * team_prior) / (decided + prior_k)
    return {
        **counts,
        "decided": decided,
        "bayesianWr": bayesian_wr,
        "deltaVsTeamPct": ((counts["wins"] / decided - team_prior) * 100.0) if decided > 0 else 0.0,
        "bayesianDeltaPct": (bayesian_wr - team_prior) * 100.0,
    }


def _summarize_hero_map(raw_heroes: dict[str, dict], prior: float, prior_k: int) -> list[dict]:
    out = []
    for h in raw_heroes.values():
        lanes = {lane: _summarize_picks(c, prior, prior_k) for lane, c in h["lanes"].items()}
        total_hero_games = h["counts"]["games"]
        flex_count = sum(
            1
            for c in h["lanes"].values()
            if c["games"] >= 2 or (total_hero_games > 0 and c["games"] / total_hero_games >= 0.2)
        )
        out.append(
            {
                **_summarize_picks(h["counts"], prior, prior_k),
                "hero": h["hero"],
                "lanes": lanes,
                "flexLaneCount": flex_count,
            }
        )
    return out


def _compute_duos_from_raw(
    raw_duos: dict[tuple[str, str], dict],
    wr_lookup: dict[str, float],
    pick_games_lookup: dict[str, int],
    total_compositions: int,
    fallback_prior: float,
    min_games: int,
) -> list[dict]:
    out = []
    for d in raw_duos.values():
        d_decided = d["wins"] + d["losses"]
        if d["games"] < min_games or d_decided <= 0:
            continue
        p_a = wr_lookup.get(d["a"], fallback_prior)
        p_b = wr_lookup.get(d["b"], fallback_prior)
        expected_bt = _bradley_terry_synergy(p_a, p_b)
        posterior_eb = (d["wins"] + 10.0 * expected_bt) / (d_decided + 10.0)
        synergy_lift = (posterior_eb - expected_bt) * 100.0
        z_score = (d["wins"] - d_decided * expected_bt) / math.sqrt(d_decided * expected_bt * (1.0 - expected_bt) + 1.0)
        games_a = pick_games_lookup.get(d["a"], d["games"])
        games_b = pick_games_lookup.get(d["b"], d["games"])
        co_pick_lift = (d["games"] * total_compositions) / max(1, games_a * games_b) if total_compositions > 0 else 1.0
        out.append(
            {
                "a": d["a"],
                "b": d["b"],
                "games": d["games"],
                "wins": d["wins"],
                "losses": d["losses"],
                "decided": d_decided,
                "expectedBtWr": expected_bt,
                "posteriorEbWr": posterior_eb,
                "synergyLiftPct": synergy_lift,
                "zScore": z_score,
                "probSynergyPct": _clamp(_normal_cdf(z_score) * 100.0, 0.0, 100.0),
                "coPickLift": co_pick_lift,
            }
        )
    out.sort(key=lambda x: (-x["synergyLiftPct"], -x["zScore"], -x["games"]))
    return out


def _compute_lane_matchups(
    raw_lane: dict[tuple[str, str, str], dict],
    ally_wr_lookup: dict[str, float],
    enemy_wr_lookup: dict[str, float],
    fallback_ally: float,
    fallback_enemy: float,
    prior_k: int,
) -> list[dict]:
    out = []
    for m in raw_lane.values():
        m_decided = m["wins"] + m["losses"]
        if m_decided < 2:
            continue
        p_a = ally_wr_lookup.get(m["allyHero"], fallback_ally)
        p_e = enemy_wr_lookup.get(m["enemyHero"], fallback_enemy)
        expected_bt = _bradley_terry_counter(p_a, p_e)
        posterior = (m["wins"] + prior_k * expected_bt) / (m_decided + prior_k)
        lift = (posterior - expected_bt) * 100.0
        z_score = (m["wins"] - m_decided * expected_bt) / math.sqrt(m_decided * expected_bt * (1.0 - expected_bt) + 1.0)
        out.append(
            {
                "lane": m["lane"],
                "allyHero": m["allyHero"],
                "enemyHero": m["enemyHero"],
                "games": m["games"],
                "wins": m["wins"],
                "losses": m["losses"],
                "decided": m_decided,
                "expectedBtWr": expected_bt,
                "posteriorWr": posterior,
                "counterLiftPct": lift,
                "zScore": z_score,
                "probAdvantagePct": _clamp(_normal_cdf(z_score) * 100.0, 0.0, 100.0),
            }
        )
    return out


def _series_key(game: dict) -> str:
    return (game.get("seriesName") or "").strip().lower() or game["id"]


def _compute_scrim_analytics(games: list[dict], focus_team: str, opponent_filter: str) -> dict:
    focus_lower = focus_team.strip().lower()
    opp_lower = None if opponent_filter == "ALL" else opponent_filter.strip().lower()

    total = wins = losses = blue_wins = blue_decided = red_wins = red_decided = total_pick_slots = 0
    series_set: set[str] = set()
    ally_pick_counts: dict[str, int] = {}
    raw_by_game_num: dict[int, dict[str, int]] = {}
    raw_ally: dict[str, dict] = {}
    raw_enemy: dict[str, dict] = {}
    bans_against: dict[str, dict] = {}
    bans_by_us: dict[str, dict] = {}
    raw_duos: dict[tuple[str, str], dict] = {}
    raw_lane: dict[tuple[str, str, str], dict] = {}
    p1_pick_totals: dict[str, int] = {}
    enemy_p2_ban_totals: dict[str, int] = {}
    reactive_pairs: dict[tuple[str, str], dict] = {}
    h2h: dict[str, dict] = {}
    timeline: list[dict] = []

    for orig_idx, g in enumerate(games):
        b_name = (g.get("blueTeamName") or "").strip()
        r_name = (g.get("redTeamName") or "").strip()
        is_blue = bool(focus_lower) and b_name.lower() == focus_lower
        is_red = bool(focus_lower) and r_name.lower() == focus_lower
        if (not is_blue and not is_red) or (is_blue and is_red):
            continue

        opp_name = (r_name if is_blue else b_name) or "Opponent"
        opp_key = opp_name.lower()
        s_key = _series_key(g)
        team_id = g["blueSideTeam"] if is_blue else ("B" if g["blueSideTeam"] == "A" else "A")
        decided = g.get("winner") in ("A", "B")
        did_win = decided and g.get("winner") == team_id

        h2h_entry = h2h.setdefault(
            opp_key,
            {"opponent": opp_name, "series": set(), "games": 0, "wins": 0, "losses": 0, "enemyCounts": {}},
        )
        h2h_entry["games"] += 1
        h2h_entry["series"].add(s_key)
        if decided:
            if did_win:
                h2h_entry["wins"] += 1
            else:
                h2h_entry["losses"] += 1
        for eh in g["redPicks"] if is_blue else g["bluePicks"]:
            h2h_entry["enemyCounts"][eh] = h2h_entry["enemyCounts"].get(eh, 0) + 1

        if opp_lower and opp_key != opp_lower:
            continue

        total += 1
        series_set.add(s_key)
        if decided:
            if did_win:
                wins += 1
            else:
                losses += 1
            if is_blue:
                blue_decided += 1
                if did_win:
                    blue_wins += 1
            else:
                red_decided += 1
                if did_win:
                    red_wins += 1
            timeline.append(
                {
                    "daysAgo": g["daysAgo"],
                    "origIndex": orig_idx,
                    "didWin": did_win,
                    "label": f"G{g['gameNumber']} vs {opp_name}",
                }
            )

        gnum = int(g["gameNumber"])
        gn = raw_by_game_num.setdefault(gnum, {"total": 0, "wins": 0, "decided": 0})
        gn["total"] += 1
        if decided:
            gn["decided"] += 1
            if did_win:
                gn["wins"] += 1

        our_picks = g["bluePicks"] if is_blue else g["redPicks"]
        their_picks = g["redPicks"] if is_blue else g["bluePicks"]
        our_bans = g["blueBans"] if is_blue else g["redBans"]
        their_bans = g["redBans"] if is_blue else g["blueBans"]
        pick_lanes = g.get("pickLanes") or {}

        p1_picked: list[str] = []
        for idx, hero in enumerate(our_picks):
            total_pick_slots += 1
            ally_pick_counts[hero] = ally_pick_counts.get(hero, 0) + 1
            cur = raw_ally.setdefault(hero, {"hero": hero, "counts": _empty_pick_counts(), "lanes": {}})
            _record_pick(cur["counts"], idx, is_blue, decided, did_win)
            if idx < 3:
                p1_picked.append(hero)
            lane = pick_lanes.get(hero)
            if lane:
                l_counts = cur["lanes"].setdefault(lane, _empty_pick_counts())
                _record_pick(l_counts, idx, is_blue, decided, did_win)

        for h in p1_picked:
            p1_pick_totals[h] = p1_pick_totals.get(h, 0) + 1

        for i in range(len(our_picks)):
            for j in range(i + 1, len(our_picks)):
                a, b = (our_picks[i], our_picks[j]) if our_picks[i] < our_picks[j] else (our_picks[j], our_picks[i])
                d = raw_duos.setdefault((a, b), {"a": a, "b": b, "games": 0, "wins": 0, "losses": 0})
                d["games"] += 1
                if decided:
                    if did_win:
                        d["wins"] += 1
                    else:
                        d["losses"] += 1

        for hero in their_picks:
            cur = raw_enemy.setdefault(hero, {"hero": hero, "games": 0, "wins": 0, "losses": 0})
            cur["games"] += 1
            if decided:
                if did_win:
                    cur["wins"] += 1
                else:
                    cur["losses"] += 1

        if pick_lanes:
            enemy_by_lane: dict[str, list[str]] = {}
            for eh in their_picks:
                lane = pick_lanes.get(eh)
                if lane:
                    enemy_by_lane.setdefault(lane, []).append(eh)
            for ah in our_picks:
                lane = pick_lanes.get(ah)
                if not lane:
                    continue
                for eh in enemy_by_lane.get(lane, ()):
                    m = raw_lane.setdefault(
                        (lane, ah, eh),
                        {"lane": lane, "allyHero": ah, "enemyHero": eh, "games": 0, "wins": 0, "losses": 0},
                    )
                    m["games"] += 1
                    if decided:
                        if did_win:
                            m["wins"] += 1
                        else:
                            m["losses"] += 1

        enemy_p2_bans: list[str] = []
        for idx, hero in enumerate(their_bans):
            cur = bans_against.setdefault(hero, {"hero": hero, "total": 0, "p1": 0, "p2": 0})
            cur["total"] += 1
            if idx < 2:
                cur["p1"] += 1
            else:
                cur["p2"] += 1
                enemy_p2_bans.append(hero)

        for banned in enemy_p2_bans:
            enemy_p2_ban_totals[banned] = enemy_p2_ban_totals.get(banned, 0) + 1
            for picked in p1_picked:
                if picked == banned:
                    continue
                pair = reactive_pairs.setdefault(
                    (picked, banned), {"pickedHero": picked, "bannedHero": banned, "count": 0}
                )
                pair["count"] += 1

        for idx, hero in enumerate(our_bans):
            cur = bans_by_us.setdefault(hero, {"hero": hero, "total": 0, "p1": 0, "p2": 0})
            cur["total"] += 1
            if idx < 2:
                cur["p1"] += 1
            else:
                cur["p2"] += 1

    decided = wins + losses
    team_prior = _clamp(wins / decided, 0.15, 0.85) if decided > 0 else 0.5
    prior_k = 8

    ally_list = _summarize_hero_map(raw_ally, team_prior, prior_k)
    ally_wr_lookup = {h["hero"]: h["bayesianWr"] for h in ally_list}
    ally_games_lookup = {h["hero"]: h["games"] for h in ally_list}
    unique_count, eff_pool, pool_evenness = _compute_pool_diversity(ally_pick_counts, total_pick_slots)

    by_game_num: dict[str, dict] = {}
    g13_wins = g13_decided = g47_wins = g47_decided = 0
    sum_w = sum_wx = sum_wy = sum_wxx = sum_wxy = 0.0
    for g_num in range(1, 8):
        r = raw_by_game_num.get(g_num)
        if not r:
            continue
        by_game_num[str(g_num)] = {**r, "ci": _wilson_ci_95(r["wins"], r["decided"])}
        if g_num <= 3:
            g13_wins += r["wins"]
            g13_decided += r["decided"]
        else:
            g47_wins += r["wins"]
            g47_decided += r["decided"]
        if r["decided"] > 0:
            w = float(r["decided"])
            y = (r["wins"] / r["decided"]) * 100.0
            sum_w += w
            sum_wx += w * g_num
            sum_wy += w * y
            sum_wxx += w * g_num * g_num
            sum_wxy += w * g_num * y

    early_vs_late = _two_prop_z_test(g13_wins, g13_decided, g47_wins, g47_decided)
    slope_denom = sum_w * sum_wxx - sum_wx * sum_wx
    fatigue_slope = (
        (sum_w * sum_wxy - sum_wx * sum_wy) / slope_denom
        if len(by_game_num) >= 3 and sum_w >= 6 and abs(slope_denom) > 1e-9
        else None
    )

    chronological = sorted(timeline, key=lambda item: (-item["daysAgo"], -item["origIndex"]))
    alpha = 0.15
    ewma = team_prior
    full_ewma = []
    for idx, item in enumerate(chronological, start=1):
        ewma = alpha * (1.0 if item["didWin"] else 0.0) + (1.0 - alpha) * ewma
        full_ewma.append({"idx": idx, "label": item["label"], "ewmaPct": ewma * 100.0, "win": item["didWin"]})
    ewma_series = full_ewma[-30:]
    ewma_current = ewma_series[-1]["ewmaPct"] if ewma_series else None
    ewma_delta = (ewma_current - (wins / decided) * 100.0) if (ewma_current is not None and decided > 0) else None

    min_duo_games = 3 if total >= 20 else 2
    top_duos = _compute_duos_from_raw(raw_duos, ally_wr_lookup, ally_games_lookup, total, team_prior, min_duo_games)

    min_enemy_games = 3 if total >= 20 else 2
    enemy_wr_lookup = {}
    for e in raw_enemy.values():
        e_decided = e["wins"] + e["losses"]
        enemy_wr_lookup[e["hero"]] = (e["losses"] + prior_k * (1.0 - team_prior)) / (e_decided + prior_k)

    enemy_matchups = []
    for e in raw_enemy.values():
        e_decided = e["wins"] + e["losses"]
        if e_decided < min_enemy_games:
            continue
        post_our_wr = (e["wins"] + prior_k * team_prior) / (e_decided + prior_k)
        threat_delta = (post_our_wr - team_prior) * 100.0
        z_score = (e["wins"] - e_decided * team_prior) / math.sqrt(e_decided * team_prior * (1.0 - team_prior) + 1.0)
        enemy_matchups.append(
            {
                "hero": e["hero"],
                "games": e["games"],
                "ourWins": e["wins"],
                "ourLosses": e["losses"],
                "decided": e_decided,
                "posteriorOurWr": post_our_wr,
                "threatDeltaPct": threat_delta,
                "zScore": z_score,
                "probThreatPct": _clamp(_normal_cdf(-z_score) * 100.0, 0.0, 100.0),
            }
        )

    toughest_enemies = sorted(
        [e for e in enemy_matchups if e["threatDeltaPct"] < 0],
        key=lambda e: (e["threatDeltaPct"], e["zScore"], -e["games"]),
    )
    favorable_enemies = sorted(
        [e for e in enemy_matchups if e["threatDeltaPct"] > 0],
        key=lambda e: (-e["threatDeltaPct"], -e["zScore"], -e["games"]),
    )

    lane_matchups = _compute_lane_matchups(
        raw_lane, ally_wr_lookup, enemy_wr_lookup, team_prior, 1.0 - team_prior, prior_k
    )
    lane_strengths = sorted(
        [m for m in lane_matchups if m["counterLiftPct"] > 0.5],
        key=lambda m: (-m["counterLiftPct"], -m["zScore"]),
    )
    lane_weaknesses = sorted(
        [m for m in lane_matchups if m["counterLiftPct"] < -0.5],
        key=lambda m: (m["counterLiftPct"], m["zScore"]),
    )

    protective_bans = []
    for p in reactive_pairs.values():
        if p["count"] < 2:
            continue
        p1_a = p1_pick_totals.get(p["pickedHero"], p["count"])
        p2_b = enemy_p2_ban_totals.get(p["bannedHero"], p["count"])
        ban_lift = (p["count"] * total) / max(1, p1_a * p2_b) if total > 0 else 1.0
        if ban_lift >= 1.05:
            protective_bans.append({**p, "banLift": ban_lift})
    protective_bans.sort(key=lambda p: (-p["count"], -p["banLift"]))
    protective_bans = [
        {"pickedHero": p["pickedHero"], "bannedHero": p["bannedHero"], "coCount": p["count"], "banLift": p["banLift"]}
        for p in protective_bans
    ]

    all_h2h_wins = sum(v["wins"] for v in h2h.values())
    all_h2h_decided = sum(v["wins"] + v["losses"] for v in h2h.values())
    opp_rows = []
    for val in h2h.values():
        o_decided = val["wins"] + val["losses"]
        top_enemies = sorted(val["enemyCounts"].items(), key=lambda kv: -kv[1])[:2]
        opp_rows.append(
            {
                "opponent": val["opponent"],
                "games": val["games"],
                "seriesCount": len(val["series"]),
                "wins": val["wins"],
                "losses": val["losses"],
                "ci": _wilson_ci_95(val["wins"], o_decided),
                "vsTeamTest": _two_prop_z_test(
                    val["wins"], o_decided, all_h2h_wins - val["wins"], all_h2h_decided - o_decided
                ),
                "topEnemies": [[h, c] for h, c in top_enemies],
            }
        )
    opp_rows.sort(key=lambda r: -r["games"])

    side_k = 6
    bayesian_blue = (blue_wins + side_k * team_prior) / (blue_decided + side_k)
    bayesian_red = (red_wins + side_k * team_prior) / (red_decided + side_k)
    series_win_prob = None
    if decided >= 3:
        bo5_b = _compute_series_win_prob(bayesian_blue, bayesian_red, 5, True) * 100.0
        bo5_r = _compute_series_win_prob(bayesian_blue, bayesian_red, 5, False) * 100.0
        bo7_b = _compute_series_win_prob(bayesian_blue, bayesian_red, 7, True) * 100.0
        bo7_r = _compute_series_win_prob(bayesian_blue, bayesian_red, 7, False) * 100.0
        series_win_prob = {
            "bo5Pct": (bo5_b + bo5_r) / 2.0,
            "bo7Pct": (bo7_b + bo7_r) / 2.0,
            "bo5StartBluePct": bo5_b,
            "bo5StartRedPct": bo5_r,
        }

    return {
        "total": total,
        "seriesCount": len(series_set),
        "wins": wins,
        "losses": losses,
        "decided": decided,
        "teamPrior": team_prior,
        "overallCi": _wilson_ci_95(wins, decided),
        "blueWins": blue_wins,
        "blueDecided": blue_decided,
        "blueCi": _wilson_ci_95(blue_wins, blue_decided),
        "redWins": red_wins,
        "redDecided": red_decided,
        "redCi": _wilson_ci_95(red_wins, red_decided),
        "sideTest": _two_prop_z_test(blue_wins, blue_decided, red_wins, red_decided),
        "uniqueHeroCount": unique_count,
        "effectiveHeroPool": eff_pool,
        "poolEvennessPct": pool_evenness,
        "byGameNum": by_game_num,
        "earlyVsLateTest": early_vs_late,
        "fatigueSlopePctPerGame": fatigue_slope,
        "ewmaSeries": ewma_series,
        "ewmaCurrentPct": ewma_current,
        "ewmaDeltaPct": ewma_delta,
        "seriesWinProb": series_win_prob,
        "draftEdge": None,
        "allyList": ally_list,
        "phase1Top": sorted(
            [h for h in ally_list if h["phase1Count"] > 0], key=lambda h: (-h["phase1Count"], -h["bayesianWr"])
        ),
        "phase2Top": sorted(
            [h for h in ally_list if h["phase2Count"] > 0], key=lambda h: (-h["phase2Count"], -h["bayesianWr"])
        ),
        "bansAgainstUs": sorted(bans_against.values(), key=lambda b: -b["total"]),
        "bansByUs": sorted(bans_by_us.values(), key=lambda b: -b["total"]),
        "protectiveBans": protective_bans,
        "topDuos": top_duos,
        "toughestEnemies": toughest_enemies,
        "favorableEnemies": favorable_enemies,
        "laneStrengths": lane_strengths,
        "laneWeaknesses": lane_weaknesses,
        "opponentRows": opp_rows,
    }


def _compute_all_teams_analytics(games: list[dict]) -> dict:
    blue_wins = red_wins = total_pick_slots = 0
    series_set: set[str] = set()
    pick_counts: dict[str, int] = {}
    contest_counts: dict[str, int] = {}
    raw_by_game_num: dict[int, dict[str, int]] = {}
    raw_heroes: dict[str, dict] = {}
    raw_bans: dict[str, dict] = {}
    raw_duos: dict[tuple[str, str], dict] = {}
    raw_lane: dict[tuple[str, str, str], dict] = {}
    raw_teams: dict[str, dict] = {}

    for g in games:
        s_key = _series_key(g)
        series_set.add(s_key)
        decided = g.get("winner") in ("A", "B")
        blue_won = decided and g.get("winner") == g.get("blueSideTeam")
        if decided:
            if blue_won:
                blue_wins += 1
            else:
                red_wins += 1

        gnum = int(g["gameNumber"])
        gn = raw_by_game_num.setdefault(gnum, {"total": 0, "decided": 0, "blueWins": 0, "redWins": 0})
        gn["total"] += 1
        if decided:
            gn["decided"] += 1
            if blue_won:
                gn["blueWins"] += 1
            else:
                gn["redWins"] += 1

        for raw_name, is_blue in ((g.get("blueTeamName"), True), (g.get("redTeamName"), False)):
            name = (raw_name or "").strip()
            if not name:
                continue
            key = name.lower()
            entry = raw_teams.setdefault(
                key,
                {
                    "team": name,
                    "series": set(),
                    "games": 0,
                    "wins": 0,
                    "losses": 0,
                    "blueWins": 0,
                    "blueDecided": 0,
                    "redWins": 0,
                    "redDecided": 0,
                },
            )
            entry["games"] += 1
            entry["series"].add(s_key)
            if decided:
                won = blue_won if is_blue else (not blue_won)
                if won:
                    entry["wins"] += 1
                else:
                    entry["losses"] += 1
                if is_blue:
                    entry["blueDecided"] += 1
                    if won:
                        entry["blueWins"] += 1
                else:
                    entry["redDecided"] += 1
                    if won:
                        entry["redWins"] += 1

        pick_lanes = g.get("pickLanes") or {}
        for picks, bans, is_blue in (
            (g["bluePicks"], g["blueBans"], True),
            (g["redPicks"], g["redBans"], False),
        ):
            side_won = blue_won if is_blue else (not blue_won)
            for idx, hero in enumerate(picks):
                total_pick_slots += 1
                pick_counts[hero] = pick_counts.get(hero, 0) + 1
                cur = raw_heroes.setdefault(hero, {"hero": hero, "counts": _empty_pick_counts(), "lanes": {}})
                _record_pick(cur["counts"], idx, is_blue, decided, side_won)
                lane = pick_lanes.get(hero)
                if lane:
                    _record_pick(cur["lanes"].setdefault(lane, _empty_pick_counts()), idx, is_blue, decided, side_won)

            for i in range(len(picks)):
                for j in range(i + 1, len(picks)):
                    a, b = (picks[i], picks[j]) if picks[i] < picks[j] else (picks[j], picks[i])
                    d = raw_duos.setdefault((a, b), {"a": a, "b": b, "games": 0, "wins": 0, "losses": 0})
                    d["games"] += 1
                    if decided:
                        if side_won:
                            d["wins"] += 1
                        else:
                            d["losses"] += 1

            for idx, hero in enumerate(bans):
                cur = raw_bans.setdefault(hero, {"hero": hero, "total": 0, "p1": 0, "p2": 0})
                cur["total"] += 1
                if idx < 2:
                    cur["p1"] += 1
                else:
                    cur["p2"] += 1

        for hero in set(g["bluePicks"]) | set(g["redPicks"]) | set(g["blueBans"]) | set(g["redBans"]):
            contest_counts[hero] = contest_counts.get(hero, 0) + 1

        if pick_lanes:
            for our_picks, their_picks, our_win in (
                (g["bluePicks"], g["redPicks"], blue_won),
                (g["redPicks"], g["bluePicks"], not blue_won),
            ):
                enemy_by_lane: dict[str, list[str]] = {}
                for eh in their_picks:
                    lane = pick_lanes.get(eh)
                    if lane:
                        enemy_by_lane.setdefault(lane, []).append(eh)
                for ah in our_picks:
                    lane = pick_lanes.get(ah)
                    if not lane:
                        continue
                    for eh in enemy_by_lane.get(lane, ()):
                        m = raw_lane.setdefault(
                            (lane, ah, eh),
                            {"lane": lane, "allyHero": ah, "enemyHero": eh, "games": 0, "wins": 0, "losses": 0},
                        )
                        m["games"] += 1
                        if decided:
                            if our_win:
                                m["wins"] += 1
                            else:
                                m["losses"] += 1

    total = len(games)
    decided = blue_wins + red_wins
    prior = 0.5
    prior_k = 8

    base_hero_list = _summarize_hero_map(raw_heroes, prior, prior_k)
    hero_map_by_name = {h["hero"]: h for h in base_hero_list}
    all_hero_names = set(hero_map_by_name.keys()) | set(raw_bans.keys())
    hero_list = []
    for hero in all_hero_names:
        perf = hero_map_by_name.get(hero) or {
            **_summarize_picks(_empty_pick_counts(), prior, prior_k),
            "hero": hero,
            "lanes": {},
            "flexLaneCount": 0,
        }
        ban = raw_bans.get(hero)
        c_count = contest_counts.get(hero, 0)
        hero_list.append(
            {
                **perf,
                "bans": ban["total"] if ban else 0,
                "banP1": ban["p1"] if ban else 0,
                "banP2": ban["p2"] if ban else 0,
                "contestCount": c_count,
                "contestPct": (c_count / total) * 100.0 if total > 0 else 0.0,
            }
        )

    wr_lookup = {h["hero"]: h["bayesianWr"] for h in hero_list}
    games_lookup = {h["hero"]: h["games"] for h in hero_list}
    unique_count, eff_pool, pool_evenness = _compute_pool_diversity(pick_counts, total_pick_slots)

    team_rows = []
    for t_entry in raw_teams.values():
        t_decided = t_entry["wins"] + t_entry["losses"]
        team_rows.append(
            {
                "team": t_entry["team"],
                "games": t_entry["games"],
                "seriesCount": len(t_entry["series"]),
                "wins": t_entry["wins"],
                "losses": t_entry["losses"],
                "decided": t_decided,
                "blueWins": t_entry["blueWins"],
                "blueDecided": t_entry["blueDecided"],
                "redWins": t_entry["redWins"],
                "redDecided": t_entry["redDecided"],
                "ci": _wilson_ci_95(t_entry["wins"], t_decided),
            }
        )
    team_rows.sort(
        key=lambda r: (-(r["wins"] / r["decided"]) if r["decided"] > 0 else 1.0, -r["wins"], -r["games"], r["team"])
    )

    min_duo_games = 3 if total >= 20 else 2
    top_duos = _compute_duos_from_raw(raw_duos, wr_lookup, games_lookup, total * 2, prior, min_duo_games)
    lane_strengths = sorted(
        [
            m
            for m in _compute_lane_matchups(raw_lane, wr_lookup, wr_lookup, prior, prior, prior_k)
            if m["counterLiftPct"] > 0.5 and m["wins"] > m["losses"]
        ],
        key=lambda m: (-m["counterLiftPct"], -m["zScore"]),
    )

    z_score = ((blue_wins - 0.5 * decided) / math.sqrt(0.25 * decided)) if decided > 0 else 0.0
    p_value = min(1.0, max(0.0, math.erfc(abs(z_score) / math.sqrt(2.0)))) if decided > 0 else 1.0
    prob_blue = _clamp(_normal_cdf(z_score) * 100.0, 0.0, 100.0)

    return {
        "total": total,
        "seriesCount": len(series_set),
        "decided": decided,
        "blueWins": blue_wins,
        "redWins": red_wins,
        "blueCi": _wilson_ci_95(blue_wins, decided),
        "redCi": _wilson_ci_95(red_wins, decided),
        "sideTest": {
            "diffPct": ((blue_wins - red_wins) / decided) * 100.0 if decided > 0 else 0.0,
            "zScore": z_score,
            "pValue": p_value,
            "significant95": decided >= 10 and p_value < 0.05,
            "probGroup1BetterPct": prob_blue,
            "probDominantPct": max(prob_blue, 100.0 - prob_blue),
        },
        "uniqueHeroCount": unique_count,
        "effectiveHeroPool": eff_pool,
        "poolEvennessPct": pool_evenness,
        "byGameNum": {str(k): v for k, v in raw_by_game_num.items()},
        "teamRows": team_rows,
        "heroList": hero_list,
        "phase1Top": sorted(
            [h for h in hero_list if h["phase1Count"] > 0], key=lambda h: (-h["phase1Count"], -h["bayesianWr"])
        ),
        "phase2Top": sorted(
            [h for h in hero_list if h["phase2Count"] > 0], key=lambda h: (-h["phase2Count"], -h["bayesianWr"])
        ),
        "topBans": sorted(raw_bans.values(), key=lambda b: -b["total"]),
        "topContested": sorted(
            [h for h in hero_list if h["contestCount"] > 0], key=lambda h: (-h["contestCount"], -h["games"])
        ),
        "topDuos": top_duos,
        "laneStrengths": lane_strengths,
    }


def _classify_comp_archetype(picks: list[str], hero_roles: dict[str, str]) -> str:
    counts = {"Tank": 0, "Fighter": 0, "Assassin": 0, "Mage": 0, "Carry": 0, "Support": 0}
    for name in picks:
        role = hero_roles.get(name)
        if role in counts:
            counts[role] += 1
    if counts["Assassin"] >= 2 or (counts["Assassin"] >= 1 and counts["Fighter"] >= 2 and counts["Tank"] == 0):
        return "dive_pick"
    if counts["Support"] >= 2 or (counts["Support"] >= 1 and counts["Tank"] >= 2):
        return "protect_utility"
    if counts["Carry"] >= 2 or (counts["Mage"] >= 2 and counts["Tank"] == 0):
        return "double_carry_poke"
    if counts["Tank"] + counts["Fighter"] >= 2 and counts["Carry"] >= 1 and counts["Mage"] >= 1:
        return "frontline_teamfight"
    return "balanced"


def _extract_perspectives(games: list[dict], focus_team: str, opponent_filter: str) -> list[dict]:
    focus_lower = focus_team.strip().lower()
    opp_lower = None if opponent_filter == "ALL" else opponent_filter.strip().lower()
    out = []
    for g in games:
        decided = g.get("winner") in ("A", "B")
        blue_won = decided and g.get("winner") == g.get("blueSideTeam")
        if not focus_lower:
            out.append(
                {
                    "game": g,
                    "isBlue": True,
                    "decided": decided,
                    "didWin": blue_won,
                    "ourPicks": g["bluePicks"],
                    "theirPicks": g["redPicks"],
                }
            )
            out.append(
                {
                    "game": g,
                    "isBlue": False,
                    "decided": decided,
                    "didWin": decided and not blue_won,
                    "ourPicks": g["redPicks"],
                    "theirPicks": g["bluePicks"],
                }
            )
            continue
        b_name = (g.get("blueTeamName") or "").strip()
        r_name = (g.get("redTeamName") or "").strip()
        is_blue = b_name.lower() == focus_lower
        is_red = r_name.lower() == focus_lower
        if is_blue == is_red:
            continue
        opp_key = (r_name if is_blue else b_name).lower()
        if opp_lower and opp_key != opp_lower:
            continue
        team_id = g["blueSideTeam"] if is_blue else ("B" if g["blueSideTeam"] == "A" else "A")
        out.append(
            {
                "game": g,
                "isBlue": is_blue,
                "decided": decided,
                "didWin": decided and g.get("winner") == team_id,
                "ourPicks": g["bluePicks"] if is_blue else g["redPicks"],
                "theirPicks": g["redPicks"] if is_blue else g["bluePicks"],
            }
        )
    return out


def _slot_for_pick(is_blue: bool, idx: int) -> str:
    if is_blue:
        if idx == 0:
            return "B1"
        return "B2-3" if idx <= 2 else "B4-5"
    if idx <= 1:
        return "R1-2"
    if idx == 2:
        return "R3"
    return "R4" if idx == 3 else "R5"


def _compute_advanced_stats(
    games: list[dict], hero_roles: dict[str, str], focus_team: str, opponent_filter: str
) -> dict:
    perspectives = _extract_perspectives(games, focus_team, opponent_filter)
    total_persp = len(perspectives)
    total_wins = sum(1 for p in perspectives if p["decided"] and p["didWin"])
    total_decided = sum(1 for p in perspectives if p["decided"])
    team_prior = _clamp(total_wins / total_decided, 0.15, 0.85) if total_decided > 0 else 0.5

    lane_hero_map: dict[str, dict[str, dict]] = {lane: {} for lane in CANONICAL_LANES}
    hero_lane_breakdown: dict[str, dict] = {}
    hero_blind_map: dict[str, dict] = {}
    slot_acc_map: dict[str, dict] = {
        slot: {"games": 0, "wins": 0, "losses": 0, "heroes": {}} for slot, _, _ in SLOT_DEFS
    }
    raw_core_trios: dict[tuple[str, str, str], dict] = {}
    raw_all_trios: dict[tuple[str, str, str], dict] = {}
    comp_count_map: dict[str, dict] = {}
    comp_matchup_map: dict[tuple[str, str], dict] = {}
    opening_pair_map: dict[tuple[str, str], dict] = {}
    p1_hero_counts: dict[str, int] = {}
    total_p1_slots = 0

    for p in perspectives:
        g = p["game"]
        pick_lanes = g.get("pickLanes") or {}
        resolved_by_lane: dict[str, str] = {}
        seen_slots: set[str] = set()

        for idx, hero in enumerate(p["ourPicks"]):
            bc = hero_blind_map.setdefault(
                hero,
                {
                    "hero": hero,
                    "games": 0,
                    "wins": 0,
                    "losses": 0,
                    "p1Games": 0,
                    "p1Wins": 0,
                    "p1Decided": 0,
                    "p2Games": 0,
                    "p2Wins": 0,
                    "p2Decided": 0,
                },
            )
            bc["games"] += 1
            if p["decided"]:
                if p["didWin"]:
                    bc["wins"] += 1
                else:
                    bc["losses"] += 1
            if idx < 3:
                bc["p1Games"] += 1
                if p["decided"]:
                    bc["p1Decided"] += 1
                    if p["didWin"]:
                        bc["p1Wins"] += 1
                p1_hero_counts[hero] = p1_hero_counts.get(hero, 0) + 1
                total_p1_slots += 1
            else:
                bc["p2Games"] += 1
                if p["decided"]:
                    bc["p2Decided"] += 1
                    if p["didWin"]:
                        bc["p2Wins"] += 1

            slot = _slot_for_pick(p["isBlue"], idx)
            s_acc = slot_acc_map[slot]
            if slot not in seen_slots:
                seen_slots.add(slot)
                s_acc["games"] += 1
                if p["decided"]:
                    if p["didWin"]:
                        s_acc["wins"] += 1
                    else:
                        s_acc["losses"] += 1
            sh = s_acc["heroes"].setdefault(hero, {"hero": hero, "count": 0, "wins": 0, "decided": 0})
            sh["count"] += 1
            if p["decided"]:
                sh["decided"] += 1
                if p["didWin"]:
                    sh["wins"] += 1

            lane = pick_lanes.get(hero)
            if lane in VALID_LANES:
                if lane not in resolved_by_lane:
                    resolved_by_lane[lane] = hero
                l_entry = lane_hero_map[lane].setdefault(
                    hero, {"hero": hero, "games": 0, "wins": 0, "losses": 0, "decided": 0}
                )
                l_entry["games"] += 1
                if p["decided"]:
                    l_entry["decided"] += 1
                    if p["didWin"]:
                        l_entry["wins"] += 1
                    else:
                        l_entry["losses"] += 1

                hb = hero_lane_breakdown.setdefault(hero, {"games": 0, "wins": 0, "losses": 0, "lanes": {}})
                hb["games"] += 1
                if p["decided"]:
                    if p["didWin"]:
                        hb["wins"] += 1
                    else:
                        hb["losses"] += 1
                hl = hb["lanes"].setdefault(lane, {"games": 0, "wins": 0, "losses": 0})
                hl["games"] += 1
                if p["decided"]:
                    if p["didWin"]:
                        hl["wins"] += 1
                    else:
                        hl["losses"] += 1

        jgl = resolved_by_lane.get("Jungle")
        mid = resolved_by_lane.get("Mid")
        sup = resolved_by_lane.get("Roam")
        if jgl and mid and sup:
            t_key = tuple(sorted((jgl, mid, sup)))
            entry = raw_core_trios.setdefault(t_key, {"heroes": list(t_key), "games": 0, "wins": 0, "losses": 0})
            entry["games"] += 1
            if p["decided"]:
                if p["didWin"]:
                    entry["wins"] += 1
                else:
                    entry["losses"] += 1

        uniq = list(dict.fromkeys(p["ourPicks"]))
        if len(uniq) >= 3:
            for i in range(len(uniq)):
                for j in range(i + 1, len(uniq)):
                    for k in range(j + 1, len(uniq)):
                        t_key = tuple(sorted((uniq[i], uniq[j], uniq[k])))
                        entry = raw_all_trios.setdefault(
                            t_key, {"heroes": list(t_key), "games": 0, "wins": 0, "losses": 0}
                        )
                        entry["games"] += 1
                        if p["decided"]:
                            if p["didWin"]:
                                entry["wins"] += 1
                            else:
                                entry["losses"] += 1

        if len(p["ourPicks"]) >= 5:
            our_arch = _classify_comp_archetype(p["ourPicks"], hero_roles)
            c_entry = comp_count_map.setdefault(our_arch, {"games": 0, "wins": 0, "losses": 0})
            c_entry["games"] += 1
            if p["decided"]:
                if p["didWin"]:
                    c_entry["wins"] += 1
                else:
                    c_entry["losses"] += 1
            if len(p["theirPicks"]) >= 5:
                enemy_arch = _classify_comp_archetype(p["theirPicks"], hero_roles)
                m_entry = comp_matchup_map.setdefault(
                    (our_arch, enemy_arch),
                    {"ourArchetype": our_arch, "enemyArchetype": enemy_arch, "games": 0, "wins": 0, "losses": 0},
                )
                m_entry["games"] += 1
                if p["decided"]:
                    if p["didWin"]:
                        m_entry["wins"] += 1
                    else:
                        m_entry["losses"] += 1

        if len(p["ourPicks"]) >= 2:
            a, b = (
                (p["ourPicks"][0], p["ourPicks"][1])
                if p["ourPicks"][0] < p["ourPicks"][1]
                else (p["ourPicks"][1], p["ourPicks"][0])
            )
            op = opening_pair_map.setdefault((a, b), {"a": a, "b": b, "games": 0, "wins": 0, "losses": 0})
            op["games"] += 1
            if p["decided"]:
                if p["didWin"]:
                    op["wins"] += 1
                else:
                    op["losses"] += 1

    positional_pools = []
    for lane in CANONICAL_LANES:
        entries = sorted(lane_hero_map[lane].values(), key=lambda x: (-x["games"], -x["wins"], x["hero"]))
        total_picks = sum(h["games"] for h in entries)
        unique_heroes = len(entries)
        h_ent = 0.0
        if total_picks > 0:
            for h in entries:
                prob = h["games"] / total_picks
                if prob > 0.0:
                    h_ent -= prob * math.log(prob)
        eff_pool = math.exp(h_ent) if unique_heroes > 0 else 0.0
        evenness = _clamp((eff_pool / unique_heroes) * 100.0, 0.0, 100.0) if unique_heroes > 0 else 0.0
        top_share = (entries[0]["games"] / total_picks) * 100.0 if (total_picks > 0 and entries) else 0.0
        risk = "insufficient"
        if total_picks >= 4:
            if eff_pool < 3.2 or (total_picks >= 6 and top_share >= 45.0):
                risk = "high"
            elif eff_pool < 5.0 or top_share >= 32.0:
                risk = "medium"
            else:
                risk = "low"
        positional_pools.append(
            {
                "lane": lane,
                "totalPicks": total_picks,
                "uniqueHeroes": unique_heroes,
                "effectivePool": eff_pool,
                "evennessPct": evenness,
                "topHeroSharePct": top_share,
                "squeezeRisk": risk,
                "topHeroes": entries[:4],
            }
        )

    blind_counter = []
    for h in hero_blind_map.values():
        if h["games"] < 2:
            continue
        decided = h["wins"] + h["losses"]
        p1_wr = (h["p1Wins"] / h["p1Decided"]) * 100.0 if h["p1Decided"] > 0 else None
        p2_wr = (h["p2Wins"] / h["p2Decided"]) * 100.0 if h["p2Decided"] > 0 else None
        diff = (p2_wr - p1_wr) if (p1_wr is not None and p2_wr is not None) else None
        classification = "balanced"
        if p2_wr is not None and h["p2Decided"] >= 2 and p2_wr >= 55.0 and (p1_wr is None or p2_wr - p1_wr >= 12.0):
            classification = "counter_specialist"
        elif p1_wr is not None and h["p1Decided"] >= 2 and p1_wr >= 55.0 and (p2_wr is None or p1_wr - p2_wr >= -8.0):
            classification = "blind_safe"
        elif p1_wr is not None and h["p1Decided"] >= 2 and p1_wr < 45.0:
            classification = "blind_risk"
        blind_counter.append(
            {
                **h,
                "decided": decided,
                "p1WrPct": p1_wr,
                "p2WrPct": p2_wr,
                "wrDiffP2MinusP1Pct": diff,
                "classification": classification,
            }
        )
    blind_counter.sort(key=lambda x: (-x["games"], -x["wins"]))

    draft_slots = []
    for slot, side, phase in SLOT_DEFS:
        acc = slot_acc_map[slot]
        decided = acc["wins"] + acc["losses"]
        tops = sorted(acc["heroes"].values(), key=lambda x: (-x["count"], -x["wins"], x["hero"]))[:3]
        draft_slots.append(
            {
                "slot": slot,
                "side": side,
                "phase": phase,
                "games": acc["games"],
                "wins": acc["wins"],
                "losses": acc["losses"],
                "decided": decided,
                "wrPct": (acc["wins"] / decided) * 100.0 if decided > 0 else None,
                "topHeroes": tops,
            }
        )

    flex_heroes = []
    flex_hero_set: set[str] = set()
    for hero, hb in hero_lane_breakdown.items():
        lane_list = []
        for lane, c in hb["lanes"].items():
            ld = c["wins"] + c["losses"]
            lane_list.append(
                {
                    "lane": lane,
                    "games": c["games"],
                    "wins": c["wins"],
                    "losses": c["losses"],
                    "decided": ld,
                    "wrPct": (c["wins"] / ld) * 100.0 if ld > 0 else None,
                }
            )
        lane_list.sort(key=lambda x: (-x["games"], -x["wins"]))
        sig_lanes = [
            lane_item
            for lane_item in lane_list
            if lane_item["games"] >= 2 or (hb["games"] >= 3 and lane_item["games"] / hb["games"] >= 0.15)
        ]
        if len(sig_lanes) >= 2:
            flex_hero_set.add(hero)
            d = hb["wins"] + hb["losses"]
            flex_heroes.append(
                {
                    "hero": hero,
                    "games": hb["games"],
                    "wins": hb["wins"],
                    "losses": hb["losses"],
                    "decided": d,
                    "wrPct": (hb["wins"] / d) * 100.0 if d > 0 else None,
                    "laneBreakdown": lane_list,
                }
            )
    flex_heroes.sort(key=lambda x: (-x["games"], -(x["wrPct"] if x["wrPct"] is not None else -1.0)))

    wf_g = wf_w = wf_d = wof_g = wof_w = wof_d = 0
    for p in perspectives:
        has_flex = any(h in flex_hero_set for h in p["ourPicks"])
        if has_flex:
            wf_g += 1
            if p["decided"]:
                wf_d += 1
                if p["didWin"]:
                    wf_w += 1
        else:
            wof_g += 1
            if p["decided"]:
                wof_d += 1
                if p["didWin"]:
                    wof_w += 1

    def summarize_trios(raw: dict[tuple[str, str, str], dict], min_g: int) -> list[dict]:
        res = []
        for t in raw.values():
            td = t["wins"] + t["losses"]
            if t["games"] < min_g or td <= 0:
                continue
            bay_wr = (t["wins"] + 6.0 * team_prior) / (td + 6.0)
            res.append({**t, "decided": td, "bayesianWr": bay_wr, "deltaVsTeamPct": (bay_wr - team_prior) * 100.0})
        res.sort(key=lambda x: (-x["bayesianWr"], -x["games"]))
        return res

    core_trios = summarize_trios(raw_core_trios, 2)[:24]
    min_all_trio = 3 if total_persp >= 45 else 2
    all_trios = summarize_trios(raw_all_trios, min_all_trio)
    if len(all_trios) < 4 and min_all_trio > 2:
        all_trios = summarize_trios(raw_all_trios, 2)
    all_trios = all_trios[:24]

    total_comp_g = sum(v["games"] for v in comp_count_map.values())
    arch_stats = []
    for k, c in comp_count_map.items():
        d = c["wins"] + c["losses"]
        arch_stats.append(
            {
                "key": k,
                **c,
                "decided": d,
                "sharePct": (c["games"] / total_comp_g) * 100.0 if total_comp_g > 0 else 0.0,
                "wrPct": (c["wins"] / d) * 100.0 if d > 0 else None,
            }
        )
    arch_stats.sort(key=lambda x: (-x["games"], -(x["wrPct"] if x["wrPct"] is not None else -1.0)))

    arch_matchups = []
    for m in comp_matchup_map.values():
        d = m["wins"] + m["losses"]
        if d < 2:
            continue
        arch_matchups.append({**m, "decided": d, "wrPct": (m["wins"] / d) * 100.0 if d > 0 else None})
    arch_matchups.sort(key=lambda x: (-x["games"], -(x["wrPct"] or 0.0)))

    p1_ent = 0.0
    if total_p1_slots > 0:
        for cnt in p1_hero_counts.values():
            prob = cnt / total_p1_slots
            if prob > 0.0:
                p1_ent -= prob * math.log(prob)
    uniq_open = len(p1_hero_counts)
    eff_p1 = math.exp(p1_ent) if uniq_open > 0 else 0.0
    open_div = _clamp((eff_p1 / uniq_open) * 100.0, 0.0, 100.0) if uniq_open > 1 else 0.0
    ent_label = (
        "insufficient"
        if total_persp < 4
        else "unpredictable"
        if open_div >= 72.0
        else "moderate"
        if open_div >= 52.0
        else "predictable"
    )
    top_openings = []
    for op in opening_pair_map.values():
        if op["games"] < 2:
            continue
        d = op["wins"] + op["losses"]
        top_openings.append({**op, "decided": d, "wrPct": (op["wins"] / d) * 100.0 if d > 0 else None})
    top_openings.sort(key=lambda x: (-x["games"], -(x["wrPct"] or 0.0)))

    return {
        "totalPerspectives": total_persp,
        "positionalPools": positional_pools,
        "blindCounterHeroes": blind_counter,
        "draftSlots": draft_slots,
        "flexSummary": {
            "flexHeroes": flex_heroes,
            "withFlexGames": wf_g,
            "withFlexWins": wf_w,
            "withFlexDecided": wf_d,
            "withoutFlexGames": wof_g,
            "withoutFlexWins": wof_w,
            "withoutFlexDecided": wof_d,
        },
        "trioSummary": {"coreAxisTrios": core_trios, "allTrios": all_trios},
        "compSummary": {
            "archetypeStats": arch_stats,
            "archetypeMatchups": arch_matchups[:12],
            "openingDiversityPct": open_div,
            "openingEntropyLabel": ent_label,
            "uniqueOpeningCount": uniq_open,
            "topOpenings": top_openings[:16],
        },
    }


def _summarize_period(games: list[dict], focus_team: str, opponent_filter: str, label: str) -> tuple[dict, dict, int]:
    perspectives = _extract_perspectives(games, focus_team, opponent_filter)
    focus_lower = focus_team.strip().lower()
    opp_lower = None if opponent_filter == "ALL" else opponent_filter.strip().lower()
    wins = decided = b_wins = b_decided = r_wins = r_decided = game_count = 0
    hero_counts: dict[str, dict[str, int]] = {}

    for g in games:
        b_name = (g.get("blueTeamName") or "").strip().lower()
        r_name = (g.get("redTeamName") or "").strip().lower()
        if focus_lower:
            is_b = b_name == focus_lower
            is_r = r_name == focus_lower
            if is_b == is_r:
                continue
            if opp_lower and (r_name if is_b else b_name) != opp_lower:
                continue
        game_count += 1
        for bh in set(g["blueBans"]) | set(g["redBans"]):
            cur = hero_counts.setdefault(bh, {"picks": 0, "bans": 0, "wins": 0, "decided": 0})
            cur["bans"] += 1

    for p in perspectives:
        if p["decided"]:
            decided += 1
            if p["didWin"]:
                wins += 1
            if p["isBlue"]:
                b_decided += 1
                if p["didWin"]:
                    b_wins += 1
            else:
                r_decided += 1
                if p["didWin"]:
                    r_wins += 1
        for hero in p["ourPicks"]:
            cur = hero_counts.setdefault(hero, {"picks": 0, "bans": 0, "wins": 0, "decided": 0})
            cur["picks"] += 1
            if p["decided"]:
                cur["decided"] += 1
                if p["didWin"]:
                    cur["wins"] += 1

    metrics = {
        "label": label,
        "games": game_count,
        "decided": decided,
        "wins": wins,
        "wrPct": (wins / decided) * 100.0 if decided > 0 else None,
        "blueWins": b_wins,
        "blueDecided": b_decided,
        "blueWrPct": (b_wins / b_decided) * 100.0 if b_decided > 0 else None,
        "redWins": r_wins,
        "redDecided": r_decided,
        "redWrPct": (r_wins / r_decided) * 100.0 if r_decided > 0 else None,
    }
    return metrics, hero_counts, max(1, game_count)


def _compute_period_diff(
    games: list[dict],
    focus_team: str,
    opponent_filter: str,
    period_mode: Literal["split_half", "last7_vs_prev"],
) -> dict:
    # Chronological oldest -> newest
    ordered = sorted(games, key=lambda g: (-int(g["daysAgo"]), int(g["gameNumber"]), g["id"]))
    label_a, label_b = "ช่วงแรก", "ช่วงหลัง"
    if period_mode == "last7_vs_prev":
        max_days_back = max((int(g["daysAgo"]) for g in ordered), default=0)
        if max_days_back > 7:
            period_a = [g for g in ordered if int(g["daysAgo"]) > 7]
            period_b = [g for g in ordered if int(g["daysAgo"]) <= 7]
            if period_a and period_b:
                label_a, label_b = "ก่อน 7 วันล่าสุด", "7 วันล่าสุด"
            else:
                mid = len(ordered) // 2
                period_a, period_b = ordered[:mid], ordered[mid:]
        else:
            mid = len(ordered) // 2
            period_a, period_b = ordered[:mid], ordered[mid:]
    else:
        mid = len(ordered) // 2
        period_a, period_b = ordered[:mid], ordered[mid:]

    m_a, hc_a, den_a = _summarize_period(period_a, focus_team, opponent_filter, label_a)
    m_b, hc_b, den_b = _summarize_period(period_b, focus_team, opponent_filter, label_b)
    team_view = bool(focus_team.strip())

    deltas = []
    for hero in set(hc_a.keys()) | set(hc_b.keys()):
        a = hc_a.get(hero, {"picks": 0, "bans": 0, "wins": 0, "decided": 0})
        b = hc_b.get(hero, {"picks": 0, "bans": 0, "wins": 0, "decided": 0})
        if a["picks"] + a["bans"] + b["picks"] + b["bans"] < 2:
            continue
        pr_a = (a["picks"] / den_a) * 100.0
        pr_b = (b["picks"] / den_b) * 100.0
        cr_a = min(100.0, ((a["picks"] + a["bans"]) / den_a) * 100.0)
        cr_b = min(100.0, ((b["picks"] + b["bans"]) / den_b) * 100.0)
        delta_pct = (pr_b - pr_a) if team_view else (cr_b - cr_a)
        wr_a = (a["wins"] / a["decided"]) * 100.0 if a["decided"] > 0 else None
        wr_b = (b["wins"] / b["decided"]) * 100.0 if b["decided"] > 0 else None
        deltas.append(
            {
                "hero": hero,
                "gamesA": a["picks"],
                "gamesB": b["picks"],
                "bansA": a["bans"],
                "bansB": b["bans"],
                "pickRateAPct": pr_a,
                "pickRateBPct": pr_b,
                "contestRateAPct": cr_a,
                "contestRateBPct": cr_b,
                "deltaPct": delta_pct,
                "wrAPct": wr_a,
                "wrBPct": wr_b,
                "wrDeltaPct": (wr_b - wr_a) if (wr_a is not None and wr_b is not None) else None,
            }
        )

    rising = sorted([d for d in deltas if d["deltaPct"] >= 4.0], key=lambda d: (-d["deltaPct"], -d["gamesB"]))[:12]
    falling = sorted([d for d in deltas if d["deltaPct"] <= -4.0], key=lambda d: (d["deltaPct"], -d["gamesA"]))[:12]

    return {
        "periodA": m_a,
        "periodB": m_b,
        "wrShiftPct": (m_b["wrPct"] - m_a["wrPct"])
        if (m_a["wrPct"] is not None and m_b["wrPct"] is not None)
        else None,
        "risingHeroes": rising,
        "fallingHeroes": falling,
    }


@lru_cache(maxsize=512)
def get_sample_analytics(
    team: str = "",
    opponent: str = "ALL",
    date_preset: Literal["all", "last7", "last30"] = "all",
    period_mode: Literal["split_half", "last7_vs_prev"] = "split_half",
    dataset: str = DEFAULT_SAMPLE_DATASET,
) -> dict:
    """Return aggregated analytics for the server-side sample dataset with zero raw game leakage."""
    canonical_dataset = SAMPLE_DATASET_ALIASES.get(dataset, dataset)
    dataset_meta = SAMPLE_DATASETS.get(canonical_dataset)
    if dataset_meta is None:
        raise ValueError(f"Unknown sample dataset: {dataset}")
    all_games = list(_load_sample_games(canonical_dataset))
    hero_roles = _load_hero_roles()

    # Date preset filter (strictly coarse ranges only to prevent single-game extraction)
    if date_preset == "last7":
        scoped = [g for g in all_games if int(g["daysAgo"]) <= 7]
    elif date_preset == "last30":
        scoped = [g for g in all_games if int(g["daysAgo"]) <= 30]
    else:
        scoped = all_games

    # Known team names across the full sample dataset (stable selector dropdown)
    team_counts: dict[str, int] = {}
    for g in all_games:
        for t_name in (g.get("blueTeamName"), g.get("redTeamName")):
            if t_name:
                team_counts[t_name] = team_counts.get(t_name, 0) + 1
    known_teams = sorted(team_counts.keys(), key=lambda k: (-team_counts[k], k))
    known_lookup = {t.lower(): t for t in known_teams}

    req_team = team.strip()
    if req_team:
        canonical_team = known_lookup.get(req_team.lower())
        if canonical_team is None:
            raise ValueError(f"Unknown sample team: {team}")
    else:
        canonical_team = ""

    req_opp = opponent.strip() or "ALL"
    if req_opp.upper() == "ALL":
        canonical_opp = "ALL"
    else:
        canonical_opp_val = known_lookup.get(req_opp.lower())
        if canonical_opp_val is None:
            raise ValueError(f"Unknown sample opponent: {opponent}")
        canonical_opp = canonical_opp_val

    opponents: list[str] = []
    if canonical_team:
        t_low = canonical_team.lower()
        opp_set: set[str] = set()
        for g in all_games:
            b = (g.get("blueTeamName") or "").strip()
            r = (g.get("redTeamName") or "").strip()
            if b.lower() == t_low and r and r.lower() != t_low:
                opp_set.add(r)
            elif r.lower() == t_low and b and b.lower() != t_low:
                opp_set.add(b)
        opponents = sorted(opp_set)

    stats = _compute_scrim_analytics(scoped, canonical_team, canonical_opp) if canonical_team else None
    all_stats = _compute_all_teams_analytics(scoped) if not canonical_team else None
    advanced = _compute_advanced_stats(scoped, hero_roles, canonical_team, canonical_opp)
    period_diff = _compute_period_diff(scoped, canonical_team, canonical_opp, period_mode)

    scoped_count = stats["total"] if stats is not None else len(scoped)

    available_tournaments = [
        {"id": meta["id"], "name": meta["name"], "totalGames": len(_load_sample_games(meta["id"]))}
        for meta in SAMPLE_DATASETS.values()
    ]

    return {
        "totalGames": len(all_games),
        "scopedGameCount": scoped_count,
        "tournament": {"id": dataset_meta["id"], "name": dataset_meta["name"]},
        "availableTournaments": available_tournaments,
        "teamNames": known_teams,
        "opponents": opponents,
        "focusTeam": canonical_team,
        "opponent": canonical_opp,
        "datePreset": date_preset,
        "periodMode": period_mode,
        "stats": stats,
        "allStats": all_stats,
        "advanced": advanced,
        "periodDiff": period_diff,
    }
