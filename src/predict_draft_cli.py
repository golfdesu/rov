import argparse
import re
import sys
from pathlib import Path
import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from train_sota_model import RoVDraftGNNTransformer, MAX_HISTORY_LEN

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "models"

LANE_NAMES = ["DS_Lane (ออฟเลน)", "Jungle (ป่า)", "Mid (เมจ)", "Dragon_Lane (แครี่)", "Roam (โรมมิ่ง)"]


def load_predictor():
    ckpt_path = MODEL_DIR / "sota_draft_gnn_transformer.pt"
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    hero_names = ckpt["hero_names"]
    hero_to_id = ckpt["hero_to_id"]

    model_cfg = ckpt.get("model_config", {"d_model": 64, "nhead": 4, "num_layers": 2})
    model = RoVDraftGNNTransformer(
        num_heroes=len(hero_names),
        hero_features=ckpt["hero_features"],
        lane_probs=ckpt["lane_probs"],
        graphs=ckpt["graphs"],
        priors=ckpt["priors"],
        **model_cfg,
    )
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()

    heroes_df = pd.read_csv(DATA_DIR / "heroes_130_summary.csv").set_index("name")
    stats_df = pd.read_csv(DATA_DIR / "hero_draft_stats.csv").set_index("name")
    return model, ckpt, hero_names, hero_to_id, heroes_df, stats_df


def resolve_hero_list(raw_str: str, hero_to_id: dict):
    if not raw_str:
        return []
    lookup = {k.lower(): k for k in hero_to_id}
    for k in list(hero_to_id.keys()):
        lookup[re.sub(r"[^a-z0-9]", "", k.lower())] = k
    aliases = {
        "riktor": "Richter",
        "diaochan": "Diao Chan",
        "flowborn": "Flowborn (Marksman)",
        "flowborn mm": "Flowborn (Marksman)",
        "flowborn mage": "Flowborn (Mage)",
    }
    lookup.update(aliases)

    resolved = []
    for item in raw_str.split(","):
        s = item.strip().lower()
        if not s:
            continue
        alnum = re.sub(r"[^a-z0-9]", "", s)
        if s in lookup:
            resolved.append(lookup[s])
        elif alnum in lookup:
            resolved.append(lookup[alnum])
        else:
            raise ValueError(f"ไม่พบชื่อฮีโร่: '{item.strip()}'")
    return resolved


def build_sequence_tokens(ally_picks, enemy_picks, ally_bans, enemy_bans, hero_to_id):
    """Build relative sequence tokens (1=ALLY_PICK, 2=ENEMY_PICK, 3=ALLY_BAN, 4=ENEMY_BAN) for Transformer."""
    events = []
    # Phase 1 Bans
    for h in ally_bans[:2]:
        events.append((hero_to_id[h], 3))
    for h in enemy_bans[:2]:
        events.append((hero_to_id[h], 4))
    # Phase 1 Picks
    for h in ally_picks[:3]:
        events.append((hero_to_id[h], 1))
    for h in enemy_picks[:3]:
        events.append((hero_to_id[h], 2))
    # Phase 2 Bans
    for h in ally_bans[2:]:
        events.append((hero_to_id[h], 3))
    for h in enemy_bans[2:]:
        events.append((hero_to_id[h], 4))
    # Phase 2 Picks
    for h in ally_picks[3:]:
        events.append((hero_to_id[h], 1))
    for h in enemy_picks[3:]:
        events.append((hero_to_id[h], 2))

    tok_heroes = np.zeros((1, MAX_HISTORY_LEN), dtype=np.int64)
    tok_types = np.zeros((1, MAX_HISTORY_LEN), dtype=np.int64)
    tok_steps = np.zeros((1, MAX_HISTORY_LEN), dtype=np.int64)
    tok_pad_mask = np.ones((1, MAX_HISTORY_LEN), dtype=np.bool_)

    for idx, (hid, ttype) in enumerate(events[:MAX_HISTORY_LEN]):
        tok_heroes[0, idx] = hid
        tok_types[0, idx] = ttype
        tok_steps[0, idx] = idx
        tok_pad_mask[0, idx] = False

    return tok_heroes, tok_types, tok_steps, tok_pad_mask


def predict_next_action(
    model,
    ckpt,
    hero_names,
    hero_to_id,
    heroes_df,
    stats_df,
    action_mode="pick",
    side="blue",
    phase=1,
    ally_picks=None,
    enemy_picks=None,
    ally_bans=None,
    enemy_bans=None,
    global_bans=None,
    top_k=5,
):
    ally_picks = ally_picks or []
    enemy_picks = enemy_picks or []
    ally_bans = ally_bans or []
    enemy_bans = enemy_bans or []
    global_bans = global_bans or []

    n = len(hero_names)
    ap_vec = np.zeros((1, n), dtype=np.float32)
    ep_vec = np.zeros((1, n), dtype=np.float32)
    ab_vec = np.zeros((1, n), dtype=np.float32)
    eb_vec = np.zeros((1, n), dtype=np.float32)
    mask = np.zeros((1, n), dtype=np.bool_)

    for h in ally_picks:
        hid = hero_to_id[h]
        ap_vec[0, hid] = 1.0
        mask[0, hid] = True
    for h in enemy_picks:
        hid = hero_to_id[h]
        ep_vec[0, hid] = 1.0
        mask[0, hid] = True
    for h in ally_bans:
        hid = hero_to_id[h]
        ab_vec[0, hid] = 1.0
        mask[0, hid] = True
    for h in enemy_bans:
        hid = hero_to_id[h]
        eb_vec[0, hid] = 1.0
        mask[0, hid] = True
    for h in global_bans:
        hid = hero_to_id[h]
        mask[0, hid] = True

    act_int = 1 if action_mode.lower() == "pick" else 0
    side_int = 1 if side.lower() == "red" else 0
    total_actions_done = len(ally_picks) + len(enemy_picks) + len(ally_bans) + len(enemy_bans)
    if phase is None:
        phase = 2 if (len(ally_picks) >= 3 or len(ally_bans) >= 2) else 1

    mctx = np.array([[
        min(17, total_actions_done) / 17.0,
        float(phase == 2),
        float(act_int == 1),
        float(side_int == 1),
        1.0,  # 2026 tournament patch meta
        len(ally_picks) / 5.0,
        len(enemy_picks) / 5.0,
    ]], dtype=np.float32)

    th, tt, ts, tpad = build_sequence_tokens(ally_picks, enemy_picks, ally_bans, enemy_bans, hero_to_id)

    with torch.no_grad():
        policy_logits, q_win_logits = model(
            torch.from_numpy(ap_vec),
            torch.from_numpy(ep_vec),
            torch.from_numpy(ab_vec),
            torch.from_numpy(eb_vec),
            torch.from_numpy(mask),
            torch.from_numpy(th),
            torch.from_numpy(tt),
            torch.from_numpy(ts),
            torch.from_numpy(tpad),
            torch.from_numpy(mctx),
            torch.tensor([act_int], dtype=torch.long),
            torch.tensor([phase], dtype=torch.long),
        )
        probs = F.softmax(policy_logits[0], dim=-1).numpy()
        win_probs = torch.sigmoid(q_win_logits[0]).numpy()

    lane_probs = ckpt["lane_probs"]
    synergy_mat = ckpt["graphs"]["synergy_mat"]
    counter_mat = ckpt["graphs"]["counter_mat"]

    ally_lane_cov = ap_vec[0] @ lane_probs
    missing_lanes = [LANE_NAMES[i] for i in range(5) if ally_lane_cov[i] < 0.45]

    top_indices = np.argsort(probs)[::-1][:top_k]
    recommendations = []

    for rank, hid in enumerate(top_indices, start=1):
        h_name = hero_names[hid]
        h_info = heroes_df.loc[h_name]
        s_info = stats_df.loc[h_name]
        main_lane_idx = int(np.argmax(lane_probs[hid]))

        syn_val = 0.0
        if ally_picks:
            syn_val = float(np.mean([synergy_mat[hid, hero_to_id[a]] * 100.0 for a in ally_picks]))
        cnt_val = 0.0
        if enemy_picks:
            cnt_val = float(np.mean([counter_mat[hid, hero_to_id[e]] * 100.0 for e in enemy_picks]))

        tags = []
        if h_info["has_hard_cc"]:
            tags.append("Hard CC")
        if h_info["has_suppress"]:
            tags.append("Suppress")
        if h_info["has_mobility"]:
            tags.append("Mobility")
        if h_info["has_true_damage"]:
            tags.append("True Dmg")
        if h_info["has_immunity"]:
            tags.append("Iron Body/Immune")
        if h_info["has_shield"] or h_info["has_heal_sustain"]:
            tags.append("Sustain/Shield")

        recommendations.append({
            "rank": rank,
            "hero": h_name,
            "prob_pct": round(float(probs[hid]) * 100.0, 2),
            "pred_win_pct": round(float(win_probs[hid]) * 100.0, 1),
            "role": h_info["primary_role"],
            "main_lane": LANE_NAMES[main_lane_idx],
            "synergy_edge_pct": round(syn_val, 2),
            "counter_edge_pct": round(cnt_val, 2),
            "pro_presence_pct": float(s_info["presence_pct"]),
            "skill_tags": ", ".join(tags[:4]),
        })

    return missing_lanes, recommendations


def print_scenario_report(title, mode, side, phase, ally_picks, enemy_picks, ally_bans, enemy_bans, global_bans, missing_lanes, recs):
    print("=" * 98)
    print(f"SCENARIO: {title}")
    print("-" * 98)
    print(f"  Model Architecture: SOTA RoVDraftGNNTransformer (Relational Hero GNN + Sequence Transformer)")
    print(f"  Action to Predict : {mode.upper()} (Phase {phase}) | Acting Team: {side.upper()} SIDE")
    print(f"  Ally Bans         : {ally_bans if ally_bans else 'None'}")
    print(f"  Enemy Bans        : {enemy_bans if enemy_bans else 'None'}")
    print(f"  Ally Picks        : {ally_picks if ally_picks else 'None'}")
    print(f"  Enemy Picks       : {enemy_picks if enemy_picks else 'None'}")
    if global_bans:
        print(f"  Global Bans (Used): {global_bans}")
    if mode.lower() == "pick":
        print(f"  Missing Ally Lanes: {', '.join(missing_lanes)}")
    print("-" * 98)
    print(f"  {'Rank':<4} | {'Hero':<16} | {'Prob%':<7} | {'PredWin%':<8} | {'Pro Lane':<20} | {'Syn%':<6} | {'Cnt%':<6} | {'Capabilities'}")
    print("-" * 98)
    for r in recs:
        print(
            f"  #{r['rank']:<3} | {r['hero']:<16} | {r['prob_pct']:>6.2f}% | {r['pred_win_pct']:>7.1f}% | "
            f"{r['main_lane']:<20} | {r['synergy_edge_pct']:>+5.1f}% | {r['counter_edge_pct']:>+5.1f}% | {r['skill_tags']}"
        )
    print("=" * 98 + "\n")


def run_demos():
    model, ckpt, hero_names, hero_to_id, heroes_df, stats_df = load_predictor()

    scenarios = [
        {
            "title": "1) First Pick (Blue Pick 1) หลังจบ Ban Phase 1",
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_bans": ["Rouie", "Eland'orr"],
            "enemy_bans": ["Valhein", "Sinestrea"],
            "ally_picks": [],
            "enemy_picks": [],
            "global_bans": [],
        },
        {
            "title": "2) คอมโบ Rouie: เมื่อทีมเราหยิบ Rouie + Billow แล้ว ต้องการตัวเติมไฟต์/ออฟเลน/แครี่",
            "mode": "pick",
            "side": "blue",
            "phase": 1,
            "ally_bans": ["Eland'orr", "Sinestrea"],
            "enemy_bans": ["Valhein", "Florentino"],
            "ally_picks": ["Rouie", "Billow"],
            "enemy_picks": ["TeeMee", "Hayate"],
            "global_bans": [],
        },
        {
            "title": "3) Pick Phase 2 (Last Pick): ทีมเราขาดแค่ Roam (ซัพพอร์ต) และมี Global Ban จากเกมก่อน",
            "mode": "pick",
            "side": "red",
            "phase": 2,
            "ally_bans": ["Rouie", "Marja", "Elsu", "Capheny"],
            "enemy_bans": ["Eland'orr", "Florentino", "Dolia", "Enzo"],
            "ally_picks": ["Skud", "Keera", "Iggy", "Stuart"],
            "enemy_picks": ["Biron", "Billow", "Liliana", "Hayate", "Grakk"],
            "global_bans": ["TeeMee", "Thane", "Toro"],
        },
        {
            "title": "4) Ban Phase 2: ศัตรูหยิบ Skud (DS) + Billow (JG) + Hayate (Carry) ไปแล้ว ควรแบนดักตำแหน่งไหน?",
            "mode": "ban",
            "side": "red",
            "phase": 2,
            "ally_bans": ["Eland'orr", "Valhein"],
            "enemy_bans": ["Sinestrea", "Florentino"],
            "ally_picks": ["Yena", "Aoi", "Liliana"],
            "enemy_picks": ["Skud", "Billow", "Hayate"],
            "global_bans": [],
        },
    ]

    for sc in scenarios:
        gb = [h for h in sc["global_bans"] if h in hero_to_id]
        missing_lanes, recs = predict_next_action(
            model,
            ckpt,
            hero_names,
            hero_to_id,
            heroes_df,
            stats_df,
            action_mode=sc["mode"],
            side=sc["side"],
            phase=sc["phase"],
            ally_picks=sc["ally_picks"],
            enemy_picks=sc["enemy_picks"],
            ally_bans=sc["ally_bans"],
            enemy_bans=sc["enemy_bans"],
            global_bans=gb,
            top_k=5,
        )
        print_scenario_report(
            sc["title"],
            sc["mode"],
            sc["side"],
            sc["phase"],
            sc["ally_picks"],
            sc["enemy_picks"],
            sc["ally_bans"],
            sc["enemy_bans"],
            gb,
            missing_lanes,
            recs,
        )


def main():
    parser = argparse.ArgumentParser(description="SOTA RoV Draft GNN-Transformer Predictor CLI")
    parser.add_argument("--demo", action="store_true", help="Run built-in pro draft prediction scenarios")
    parser.add_argument("--mode", choices=["pick", "ban"], default="pick", help="Action to predict: pick or ban")
    parser.add_argument("--side", choices=["blue", "red"], default="blue", help="Acting team side: blue or red")
    parser.add_argument("--phase", type=int, choices=[1, 2], default=None, help="Draft phase (1 or 2)")
    parser.add_argument("--ally-picks", type=str, default="", help="Comma-separated heroes already picked by acting team")
    parser.add_argument("--enemy-picks", type=str, default="", help="Comma-separated heroes already picked by enemy team")
    parser.add_argument("--ally-bans", type=str, default="", help="Comma-separated heroes banned by acting team")
    parser.add_argument("--enemy-bans", type=str, default="", help="Comma-separated heroes banned by enemy team")
    parser.add_argument("--global-bans", type=str, default="", help="Comma-separated heroes unavailable due to Global Ban")
    parser.add_argument("--top-k", type=int, default=5, help="Number of recommendations to display")
    args = parser.parse_args()

    if args.demo or not any([args.ally_picks, args.enemy_picks, args.ally_bans, args.enemy_bans]):
        run_demos()
        return

    model, ckpt, hero_names, hero_to_id, heroes_df, stats_df = load_predictor()
    ap = resolve_hero_list(args.ally_picks, hero_to_id)
    ep = resolve_hero_list(args.enemy_picks, hero_to_id)
    ab = resolve_hero_list(args.ally_bans, hero_to_id)
    eb = resolve_hero_list(args.enemy_bans, hero_to_id)
    gb = resolve_hero_list(args.global_bans, hero_to_id)

    missing_lanes, recs = predict_next_action(
        model,
        ckpt,
        hero_names,
        hero_to_id,
        heroes_df,
        stats_df,
        action_mode=args.mode,
        side=args.side,
        phase=args.phase,
        ally_picks=ap,
        enemy_picks=ep,
        ally_bans=ab,
        enemy_bans=eb,
        global_bans=gb,
        top_k=args.top_k,
    )
    print_scenario_report(
        "Custom Draft Query",
        args.mode,
        args.side,
        args.phase or 1,
        ap,
        ep,
        ab,
        eb,
        gb,
        missing_lanes,
        recs,
    )


if __name__ == "__main__":
    main()
