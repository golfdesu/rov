"""Comprehensive 130x130 Mechanical + Skill/Passive/Item Matchup Discovery Engine.

Sweeps all 130 RoV heroes (8,385 unique pairs = 16,770 directional matchups) across:
1. Early Game (Lv.4 laning / river skirmish: Boots + starter item + T3 Arcana + Enchantments)
2. Mid Game (Lv.10 3-item spike: Boots + 2 core role/kit items)
3. Late Game (Lv.15 full 6-item build: Boots + 5 core items)
4. Full 1-Rotation Combo Burst (Skills + 2 Basic Attacks + Item/Spellblade Procs)
5. Exact Passive/Skill Text Mechanics parsed from data/hero_skills_full.json:
   - Physical Damage Immunity (Stuart S2) vs Physical Burst vs Magic Counter
   - True Suppress (Aleister, Arum, Roxie, Omen, Baldum) vs Hyper-Mobility
   - Untargetable / I-Frames & Damage Block (Riktor S2, Lauriel, Marja, Keera, Aoi, Murad, Zata, Liliana)
   - Iron Body / CC Cleanse (Rourke, Kil'Groth, Chaugnar, Yena, Florentino, Allain, Veres, Yan, Tachi)
   - Max-HP % Damage & True Damage vs High-HP / High-Armor Frontline
6. Double-Centered Relative Matchup Advantage (Residual Edge)
7. Counter-Item Adaptation Flips (swapping 1 item at Lv.15 to flip losing matchups into wins)

Outputs:
- data/mechanical_matchups_130x130.csv
- data/counter_item_flips.csv
- data/mechanical_matchup_summary.json
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.combat_calculator import (  # noqa: E402
    ACTIVE_SLOTS,
    Build,
    CombatEngine,
    compute_kite_params,
    get_engine,
    simulate_duel,
)

DATA_DIR = BASE_DIR / "data"

# True Suppress in RoV (un-cleansable by Purify / Chaugnar)
TRUE_SUPPRESS_HEROES = {"Aleister", "Arum", "Roxie", "Omen", "Baldum"}
# Pure non-duelist utility supports (evaluated via kit/teamfight counter rather than 1v1 duel victim)
PURE_UTILITY_SUPPORTS = {
    "Helen",
    "Rouie",
    "Aya",
    "Dyadia",
    "Alice",
    "Krizzix",
    "TeeMee",
    "Annette",
    "Zip",
    "Ming",
}


def extract_exact_skill_mechanics(
    skills_map: dict[str, list[dict]], features_by_hero: dict[str, dict]
) -> dict[str, dict]:
    """Parse exact Thai & English skill descriptions from data/hero_skills_full.json."""
    mech: dict[str, dict] = {}
    for h, sks in skills_map.items():
        txt = " ".join((s.get("description", "") + " " + s.get("desc_th", "")) for s in sks).lower()
        feat = features_by_hero.get(h, {})
        mech[h] = {
            "phys_immune": (
                "immunity to all physical damage" in txt or "ต้านทาน ความเสียหายกายภาพ ทั้งหมด" in txt or h == "Stuart"
            ),
            "dmg_block_iframe": (
                "blocks all incoming damage" in txt
                or "ป้องกันความเสียหายทั้งหมด" in txt
                or "untargetable" in txt
                or "cannot be targeted" in txt
                or "ไม่ตกเป็นเป้าหมาย" in txt
                or "เป็นอมตะ" in txt
            ),
            "cc_cleanse_or_iron_body": (
                bool(feat.get("has_immunity"))
                or "iron body" in txt
                or "immune to control" in txt
                or "cc immunity" in txt
                or "ป้องกันสถานะ" in txt
                or "ลบสถานะ" in txt
                or "ต้านทานสถานะ" in txt
            ),
            "true_suppress": h in TRUE_SUPPRESS_HEROES,
            "max_hp_dmg": "max hp" in txt or "สูงสุดของเป้าหมาย" in txt or "hp สูงสุด" in txt,
            "true_dmg": bool(feat.get("has_true_damage")),
            "hard_cc": bool(feat.get("has_hard_cc")),
            "mobility": bool(feat.get("has_mobility")),
            "heal_sustain": bool(feat.get("has_heal_sustain")),
            "shield": bool(feat.get("has_shield")),
        }
    return mech


def choose_archetype(hero: str, meta: dict, skills: list[dict], main_lane: str) -> str:
    role = str(meta.get("primary_role", "Fighter"))
    sec_role = str(meta.get("secondary_role", "") or "")
    dmg_type = str(meta.get("damage_type", "Physical"))
    is_ranged = bool(meta.get("ranged"))

    ap_scale = 0.0
    ad_scale = 0.0
    for sk in skills:
        sc = sk.get("scaling") or {}
        ap_scale += float(sc.get("ap_pct", 0) or 0) + float(sc.get("bonus_ap_pct", 0) or 0)
        ad_scale += float(sc.get("ad_pct", 0) or 0) + float(sc.get("bonus_ad_pct", 0) or 0)

    if hero in ("Keera", "Paine", "Zill") or (role == "Assassin" and ap_scale > ad_scale):
        return "AP_Assassin"
    if hero in ("Hayate", "Capheny", "Eland'orr", "Slimz", "Valhein", "Omen", "Kil'Groth"):
        if role == "Carry" or hero in ("Hayate", "Capheny", "Eland'orr", "Slimz", "Valhein"):
            return "ADC_OnHit"
    if role == "Carry" or (sec_role == "Carry" and is_ranged and ad_scale >= ap_scale):
        return "ADC_Crit"
    if role == "Mage" or (ap_scale > ad_scale and dmg_type == "Magic" and role not in ("Tank", "Support")):
        if hero in ("Lauriel", "Marja", "Mganga", "Ignis", "Diao Chan", "Goverra", "Heino", "Evita"):
            return "Mage_Sustain"
        return "Mage_Burst"
    if role == "Support" or main_lane == "Roam":
        if ap_scale > 120 and role == "Support" and sec_role != "Tank":
            return "Support_Enchanter"
        return "Support_Tank"
    if role == "Tank" and sec_role not in ("Fighter", "Assassin"):
        return "Tank_Frontline"
    if role == "Assassin" or (sec_role == "Assassin" and main_lane == "Jungle"):
        return "AD_Assassin"
    if hero in ("Omen", "Kil'Groth", "Allain", "Dextra", "Errol"):
        return "Bruiser_OnHit"
    if hero in (
        "Florentino",
        "Veres",
        "Yena",
        "Riktor",
        "Qi",
        "Biron",
        "Tamyn",
        "Charlotte",
        "Billow",
    ):
        return "Bruiser_Duelist"
    return "Bruiser_Fighter"


ARCHETYPE_CONFIGS: dict[str, dict] = {
    "Bruiser_OnHit": {
        "arcana": {"Awake": 10, "Spirit": 10, "Dragon's Claw": 10},
        "primary_faction": "Lokheim",
        "primary_ench": ["Shadow Blade", "Bone Cutter", "Desperate Duel"],
        "secondary_ench": ["River Treader", "Nature's Gift"],
        "items_lv4": ["War Boots", "Short Sword"],
        "items_lv10": ["War Boots", "Fafnir's Talon", "Shield of the Lost"],
        "items_lv15": [
            "War Boots",
            "Fafnir's Talon",
            "Blitz Blade",
            "Shield of the Lost",
            "Medallion of Troy",
            "Mail of Pain",
        ],
    },
    "ADC_Crit": {
        "arcana": {"Rampage": 10, "Spirit": 10, "Dragon's Claw": 10},
        "primary_faction": "Veda",
        "primary_ench": ["Axe of Sacrifice", "Blessing", "Sacred Protection"],
        "secondary_ench": ["Recovery+", "Gunslinger"],
        "items_lv4": ["War Boots", "Gloves"],
        "items_lv10": ["War Boots", "Claves Sancti", "Slikk's Sting"],
        "items_lv15": [
            "War Boots",
            "Claves Sancti",
            "Slikk's Sting",
            "Muramasa",
            "Bow of Slaughter",
            "Blade of Eternity",
        ],
    },
    "ADC_OnHit": {
        "arcana": {"Awake": 10, "Spirit": 10, "Dragon's Claw": 10},
        "primary_faction": "Veda",
        "primary_ench": ["Axe of Sacrifice", "Holy Verdict", "Holy Summoner"],
        "secondary_ench": ["Recovery+", "Gunslinger"],
        "items_lv4": ["War Boots", "Short Sword"],
        "items_lv10": ["War Boots", "Fafnir's Talon", "Blitz Blade"],
        "items_lv15": [
            "War Boots",
            "Fafnir's Talon",
            "Blitz Blade",
            "Claves Sancti",
            "Muramasa",
            "Frost Hammer",
        ],
    },
    "Mage_Burst": {
        "arcana": {"Desolate": 10, "Spirit": 10, "Flurry": 10},
        "primary_faction": "Veda",
        "primary_ench": ["Mana Refill", "Blessing", "Holy Thunder"],
        "secondary_ench": ["Raging Inferno", "Deadly Claw"],
        "items_lv4": ["Enchanted Kicks", "Spell Tome"],
        "items_lv10": ["Enchanted Kicks", "Boomstick", "Hecate's Diadem"],
        "items_lv15": [
            "Enchanted Kicks",
            "Boomstick",
            "Hecate's Diadem",
            "Evil Secrets",
            "Rhea's Blessing",
            "Arctic Orb",
        ],
    },
    "Mage_Sustain": {
        "arcana": {"Desolate": 10, "Pray": 10, "Prowess": 10},
        "primary_faction": "Veda",
        "primary_ench": ["Sacred Bead", "Blessing", "Sacred Protection"],
        "secondary_ench": ["River Treader", "Regrowth"],
        "items_lv4": ["Gilded Greaves", "Spell Tome"],
        "items_lv10": ["Gilded Greaves", "Berith's Agony", "Hecate's Diadem"],
        "items_lv15": [
            "Gilded Greaves",
            "Berith's Agony",
            "Hecate's Diadem",
            "Rhea's Blessing",
            "Evil Secrets",
            "Medallion of Troy",
        ],
    },
    "AP_Assassin": {
        "arcana": {"Desolate": 10, "Spirit": 10, "Flurry": 10},
        "primary_faction": "Lokheim",
        "primary_ench": ["Shadow Blade", "Deadly Claw", "Devil's Awakening"],
        "secondary_ench": ["Sacred Bead", "Blessing"],
        "items_lv4": ["Enchanted Kicks", "Loki's Curse"],
        "items_lv10": ["Enchanted Kicks", "Loki's Curse", "Apocalypse"],
        "items_lv15": [
            "Enchanted Kicks",
            "Loki's Curse",
            "Apocalypse",
            "Hecate's Diadem",
            "Evil Secrets",
            "Rhea's Blessing",
        ],
    },
    "AD_Assassin": {
        "arcana": {"Onslaught": 10, "Assassinate": 10, "Dragon's Claw": 10},
        "primary_faction": "Lokheim",
        "primary_ench": ["Shadow Blade", "Deadly Claw", "Curse of Death"],
        "secondary_ench": ["Axe of Sacrifice", "Holy Verdict"],
        "items_lv4": ["Gilded Greaves", "Soulreaver"],
        "items_lv10": ["Gilded Greaves", "Soulreaver", "Spear of Longinus"],
        "items_lv15": [
            "Gilded Greaves",
            "Soulreaver",
            "Spear of Longinus",
            "Omni Arms",
            "Fenrir's Tooth",
            "Blade of Eternity",
        ],
    },
    "Bruiser_Duelist": {
        "arcana": {"Onslaught": 10, "Spirit": 10, "Dragon's Claw": 10},
        "primary_faction": "Lokheim",
        "primary_ench": ["Shadow Blade", "Bone Cutter", "Desperate Duel"],
        "secondary_ench": ["River Treader", "Nature's Gift"],
        "items_lv4": ["Gilded Greaves", "Astral Spear"],
        "items_lv10": ["Gilded Greaves", "Spear of Longinus", "Omni Arms"],
        "items_lv15": [
            "Gilded Greaves",
            "Spear of Longinus",
            "Omni Arms",
            "Medallion of Troy",
            "Shield of the Lost",
            "Fenrir's Tooth",
        ],
    },
    "Bruiser_Fighter": {
        "arcana": {"Onslaught": 10, "Assassinate": 10, "Dragon's Claw": 10},
        "primary_faction": "Lokheim",
        "primary_ench": ["Shadow Blade", "Bone Cutter", "Curse of Death"],
        "secondary_ench": ["River Treader", "Nature's Gift"],
        "items_lv4": ["Sonic Boots", "Astral Spear"],
        "items_lv10": ["Sonic Boots", "Spear of Longinus", "Frost Cape"],
        "items_lv15": [
            "Sonic Boots",
            "Spear of Longinus",
            "Frost Cape",
            "Medallion of Troy",
            "Mail of Pain",
            "Blade of Eternity",
        ],
    },
    "Tank_Frontline": {
        "arcana": {"Golden Body": 10, "Colossus": 10, "Prowess": 10},
        "primary_faction": "Afata",
        "primary_ench": ["River Treader", "Nature's Gift", "Explosive Shield"],
        "secondary_ench": ["Sacred Bead", "Recovery+"],
        "items_lv4": ["Gilded Greaves", "Heart of Incubus"],
        "items_lv10": ["Gilded Greaves", "Mantle of Ra", "Shield of the Lost"],
        "items_lv15": [
            "Gilded Greaves",
            "Mantle of Ra",
            "Shield of the Lost",
            "Medallion of Troy",
            "Mail of Pain",
            "Amulet of Longevity",
        ],
    },
    "Support_Tank": {
        "arcana": {"Golden Body": 10, "Colossus": 10, "Prowess": 10},
        "primary_faction": "Afata",
        "primary_ench": ["River Treader", "Nature's Gift", "Nature's Rage"],
        "secondary_ench": ["Sacred Bead", "Recovery+"],
        "items_lv4": ["Gilded Greaves", "Earth Gem"],
        "items_lv10": ["Gilded Greaves", "Mother Earth - Barrier", "The Aegis"],
        "items_lv15": [
            "Gilded Greaves",
            "Mother Earth - Barrier",
            "The Aegis",
            "Medallion of Troy",
            "Shield of the Lost",
            "Blade of Eternity",
        ],
    },
    "Support_Enchanter": {
        "arcana": {"Desolate": 10, "Colossus": 10, "Prowess": 10},
        "primary_faction": "Afata",
        "primary_ench": ["River Treader", "Regrowth", "Explosive Shield"],
        "secondary_ench": ["Mana Refill", "Blessing"],
        "items_lv4": ["Flashy Boots", "Earth Gem"],
        "items_lv10": ["Flashy Boots", "Mother Earth - Barrier", "Frosty's Revenge"],
        "items_lv15": [
            "Flashy Boots",
            "Mother Earth - Barrier",
            "Frosty's Revenge",
            "The Aegis",
            "Medallion of Troy",
            "Berith's Agony",
        ],
    },
}


def build_for_stage(hero: str, arch: str, stage: str, custom_items: list[str] | None = None) -> Build:
    cfg = ARCHETYPE_CONFIGS[arch]
    if stage == "lv4":
        lv = 4
        items = custom_items if custom_items is not None else cfg["items_lv4"]
    elif stage == "lv10":
        lv = 10
        items = custom_items if custom_items is not None else cfg["items_lv10"]
    else:
        lv = 15
        items = custom_items if custom_items is not None else cfg["items_lv15"]
    return Build(
        hero=hero,
        level=lv,
        items=list(items),
        arcana=dict(cfg["arcana"]),
        primary_faction=cfg["primary_faction"],
        primary_enchantments=list(cfg["primary_ench"]),
        secondary_enchantments=list(cfg["secondary_ench"]),
        enable_kiting=True,
        enable_actives=True,
    )


def precompute_hero_state(eng: CombatEngine, build: Build) -> dict:
    st = eng.build_stats(build)
    meta = eng.hero_meta.get(build.hero, {})
    slots = set(build.active_combo_slots) if build.active_combo_slots is not None else set(ACTIVE_SLOTS)
    sim_meta = {
        "hero": build.hero,
        "level": build.level,
        "items": list(build.items),
        "enchantments": [
            eng.canonical_enchantment(e) for e in list(build.primary_enchantments) + list(build.secondary_enchantments)
        ],
        "enable_actives": bool(build.enable_actives),
        "has_hard_cc": bool(meta.get("has_hard_cc")),
        "has_mobility": bool(meta.get("has_mobility")),
        "dual_form": build.active_combo_slots is None,
    }
    return {
        "build": build,
        "stats": st,
        "meta": meta,
        "slots": slots,
        "sim_meta": sim_meta,
    }


def fast_duel_pair(eng: CombatEngine, ha: dict, hb: dict) -> dict:
    stats_a, stats_b = ha["stats"], hb["stats"]
    build_a, build_b = ha["build"], hb["build"]
    skills_a = eng.skill_damage(stats_a, stats_b, build_a)
    skills_b = eng.skill_damage(stats_b, stats_a, build_b)
    slots_a, slots_b = ha["slots"], hb["slots"]
    meta_a, meta_b = ha["meta"], hb["meta"]

    kite_a = compute_kite_params(stats_a, stats_b, meta_a, meta_b, True)
    kite_b = compute_kite_params(stats_b, stats_a, meta_b, meta_a, True)

    ba_a = eng.basic_attack(stats_a, stats_b)
    ba_b = eng.basic_attack(stats_b, stats_a)
    procs_a = eng._procs(stats_a, build_a, stats_b, skills_a)
    procs_b = eng._procs(stats_b, build_b, stats_a, skills_b)

    sim = simulate_duel(
        (
            stats_a,
            eng._sim_skills_for(skills_a, slots_a, build_a.hero),
            ba_a,
            procs_a,
        ),
        (
            stats_b,
            eng._sim_skills_for(skills_b, slots_b, build_b.hero),
            ba_b,
            procs_b,
        ),
        kite_a=kite_a,
        kite_b=kite_b,
        sim_meta_a=ha["sim_meta"],
        sim_meta_b=hb["sim_meta"],
    )

    proc_dmg_a = sum(float(p.get("final_damage", 0.0)) for p in procs_a)
    proc_dmg_b = sum(float(p.get("final_damage", 0.0)) for p in procs_b)
    burst_a = (
        sum(sk["final_damage"] for sk in skills_a if sk["slot"] in slots_a)
        + 2.0 * float(ba_a.get("expected", 0.0))
        + proc_dmg_a
    )
    burst_b = (
        sum(sk["final_damage"] for sk in skills_b if sk["slot"] in slots_b)
        + 2.0 * float(ba_b.get("expected", 0.0))
        + proc_dmg_b
    )
    max_hp_a = float(stats_a["stats"]["max_hp"])
    max_hp_b = float(stats_b["stats"]["max_hp"])

    hp_rem_a_pct = float(sim["a"]["remaining_hp_pct"])
    hp_rem_b_pct = float(sim["b"]["remaining_hp_pct"])
    ttk = sim.get("time_to_kill")
    speed_bonus = 0.0
    if ttk is not None:
        if sim["winner"] == "a":
            speed_bonus = max(0.0, 15.0 - float(ttk)) * 1.2
        elif sim["winner"] == "b":
            speed_bonus = -max(0.0, 15.0 - float(ttk)) * 1.2

    duel_margin_a = float(np.clip(hp_rem_a_pct - hp_rem_b_pct + speed_bonus, -100.0, 100.0))

    return {
        "winner": sim["winner"],
        "duration": float(ttk) if ttk is not None else 60.0,
        "hp_rem_a_pct": round(hp_rem_a_pct, 1),
        "hp_rem_b_pct": round(hp_rem_b_pct, 1),
        "duel_margin_a": round(duel_margin_a, 1),
        "burst_pct_a_on_b": round(100.0 * burst_a / max(1.0, max_hp_b), 1),
        "burst_pct_b_on_a": round(100.0 * burst_b / max(1.0, max_hp_a), 1),
        "ttk_a": ttk if sim["winner"] == "a" else None,
        "ttk_b": ttk if sim["winner"] == "b" else None,
    }


def compute_kit_interaction_edge(
    h_a: str,
    h_b: str,
    ma: dict,
    mb: dict,
    meta_a: dict,
    meta_b: dict,
    arch_a: str,
    arch_b: str,
    burst_pct_a_on_b_lv15: float,
    burst_pct_b_on_a_lv15: float,
) -> tuple[float, list[str]]:
    """Compute tactical skill/passive interaction score (A vs B) and human-readable Thai reasons."""
    score = 0.0
    reasons_a: list[str] = []

    role_a = str(meta_a.get("primary_role", ""))
    role_b = str(meta_b.get("primary_role", ""))
    ranged_a = bool(meta_a.get("ranged"))
    ranged_b = bool(meta_b.get("ranged"))
    is_magic_a = "Mage" in arch_a or "AP" in arch_a or h_a in ("Valhein", "Thorne", "Erin", "Keera", "Paine", "Zill")
    is_magic_b = "Mage" in arch_b or "AP" in arch_b or h_b in ("Valhein", "Thorne", "Erin", "Keera", "Paine", "Zill")

    if ma["phys_immune"] and not is_magic_b and role_b in ("Assassin", "Carry", "Fighter") and not mb["true_dmg"]:
        score += 20.0
        reasons_a.append("สกิล 2 อมตะกายภาพ 2 วิ กันดาเมจกายภาพได้เต็มๆ")
    if mb["phys_immune"] and not is_magic_a and role_a in ("Assassin", "Carry", "Fighter") and not ma["true_dmg"]:
        score -= 20.0
    if mb["phys_immune"] and is_magic_a:
        score += 16.0
        reasons_a.append("ดาเมจเวททะลุสกิลกันกายภาพของอีกฝั่ง")
    if ma["phys_immune"] and is_magic_b:
        score -= 16.0

    if ma["true_suppress"] and mb["mobility"] and role_b in ("Assassin", "Fighter", "Carry"):
        score += 22.0
        reasons_a.append("Suppress จับตายตัวพริ้ว (ล้างสถานะไม่ได้)")
    if mb["true_suppress"] and ma["mobility"] and role_a in ("Assassin", "Fighter", "Carry"):
        score -= 22.0

    if (ma["true_dmg"] or ma["max_hp_dmg"]) and (role_b in ("Tank", "Support") or mb["shield"]):
        pts = 14.0 if (ma["true_dmg"] and ma["max_hp_dmg"]) else 10.0
        score += pts
        reasons_a.append("True Damage / %Max HP ละลายเกราะและโล่")
    if (mb["true_dmg"] or mb["max_hp_dmg"]) and (role_a in ("Tank", "Support") or ma["shield"]):
        pts = 14.0 if (mb["true_dmg"] and mb["max_hp_dmg"]) else 10.0
        score -= pts

    if (ma["dmg_block_iframe"] or ma["cc_cleanse_or_iron_body"]) and mb["hard_cc"] and not mb["true_suppress"]:
        score += 10.0
        reasons_a.append("มีสถานะอมตะ/ล้างสถานะ สวนจังหวะ CC")
    if (mb["dmg_block_iframe"] or mb["cc_cleanse_or_iron_body"]) and ma["hard_cc"] and not ma["true_suppress"]:
        score -= 10.0

    if ranged_a and not ranged_b and not mb["mobility"]:
        score += 12.0
        reasons_a.append("ระยะไกล Kite ฟรีใส่ตัวประชิดไร้สกิลพุ่ง")
    if ranged_b and not ranged_a and not ma["mobility"]:
        score -= 12.0

    if (
        ma["mobility"]
        and burst_pct_a_on_b_lv15 >= 95.0
        and role_b in ("Carry", "Mage")
        and not mb["dmg_block_iframe"]
        and not mb["phys_immune"]
    ):
        score += 15.0
        reasons_a.append(f"พุ่งล้วงชุดเดียวตาย ({burst_pct_a_on_b_lv15:.0f}% HP)")
    if (
        mb["mobility"]
        and burst_pct_b_on_a_lv15 >= 95.0
        and role_a in ("Carry", "Mage")
        and not ma["dmg_block_iframe"]
        and not ma["phys_immune"]
    ):
        score -= 15.0

    return float(np.clip(score, -40.0, 40.0)), reasons_a


def select_diverse_top(
    df: pd.DataFrame, sort_col: str, limit: int = 8, max_per_hero: int = 2, max_per_opp: int = 2
) -> list[dict]:
    """Select top rows ensuring diversity across both winner (hero) and loser (opponent)."""
    out = []
    seen_h: dict[str, int] = {}
    seen_o: dict[str, int] = {}
    for r in df.sort_values(sort_col, ascending=False).to_dict("records"):
        h, o = r["hero"], r["opponent"]
        if seen_h.get(h, 0) >= max_per_hero or seen_o.get(o, 0) >= max_per_opp:
            continue
        seen_h[h] = seen_h.get(h, 0) + 1
        seen_o[o] = seen_o.get(o, 0) + 1
        out.append(r)
        if len(out) >= limit:
            break
    return out


def main() -> None:
    t0 = time.perf_counter()
    eng = get_engine()
    heroes = sorted(eng.hero_meta.keys())
    n = len(heroes)

    full_heroes_raw = json.loads((DATA_DIR / "heroes_130_full.json").read_text(encoding="utf-8"))
    full_heroes_list = full_heroes_raw if isinstance(full_heroes_raw, list) else full_heroes_raw["heroes"]
    features_by_hero = {h["name"]: h.get("features", {}) for h in full_heroes_list}
    skills_raw = json.loads((DATA_DIR / "hero_skills_full.json").read_text(encoding="utf-8"))["heroes"]
    mech_by_hero = extract_exact_skill_mechanics(skills_raw, features_by_hero)

    df_stats = pd.read_csv(DATA_DIR / "hero_draft_stats.csv").set_index("name")
    df_cnt = pd.read_csv(DATA_DIR / "counter_matrix.csv")
    pro_cnt_map: dict[tuple[str, str], dict] = {}
    for row in df_cnt.to_dict("records"):
        pro_cnt_map[(row["hero"], row["opponent_hero"])] = row

    lane_col_map = {
        "DS_Lane": "ds_lane_picks",
        "Jungle": "jungle_picks",
        "Mid": "mid_picks",
        "Dragon_Lane": "dragon_lane_picks",
        "Roam": "roam_picks",
    }
    main_lane_by_hero: dict[str, str] = {}
    viable_lanes_by_hero: dict[str, set[str]] = {}
    arch_by_hero: dict[str, str] = {}

    for h in heroes:
        if h in df_stats.index:
            srow = df_stats.loc[h]
            ml = str(srow["main_pro_lane"])
            tot_p = max(1.0, float(srow["picks"]))
            vlanes = {ml}
            for lk, col in lane_col_map.items():
                cnt = float(srow.get(col, 0.0))
                if cnt / tot_p >= 0.18 or cnt >= 25:
                    vlanes.add(lk)
        else:
            ml = "Mid"
            vlanes = {ml}
        main_lane_by_hero[h] = ml
        viable_lanes_by_hero[h] = vlanes
        arch_by_hero[h] = choose_archetype(h, eng.hero_meta[h], eng.skills[h], ml)

    states = {"lv4": {}, "lv10": {}, "lv15": {}}
    for stg in ("lv4", "lv10", "lv15"):
        for h in heroes:
            b = build_for_stage(h, arch_by_hero[h], stg)
            states[stg][h] = precompute_hero_state(eng, b)

    directional_rows: list[dict] = []
    for i in range(n):
        ha_name = heroes[i]
        for j in range(i + 1, n):
            hb_name = heroes[j]

            r4 = fast_duel_pair(eng, states["lv4"][ha_name], states["lv4"][hb_name])
            r10 = fast_duel_pair(eng, states["lv10"][ha_name], states["lv10"][hb_name])
            r15 = fast_duel_pair(eng, states["lv15"][ha_name], states["lv15"][hb_name])

            kit_ab, reasons_a = compute_kit_interaction_edge(
                ha_name,
                hb_name,
                mech_by_hero[ha_name],
                mech_by_hero[hb_name],
                eng.hero_meta[ha_name],
                eng.hero_meta[hb_name],
                arch_by_hero[ha_name],
                arch_by_hero[hb_name],
                r15["burst_pct_a_on_b"],
                r15["burst_pct_b_on_a"],
            )
            kit_ba, reasons_b = compute_kit_interaction_edge(
                hb_name,
                ha_name,
                mech_by_hero[hb_name],
                mech_by_hero[ha_name],
                eng.hero_meta[hb_name],
                eng.hero_meta[ha_name],
                arch_by_hero[hb_name],
                arch_by_hero[ha_name],
                r15["burst_pct_b_on_a"],
                r15["burst_pct_a_on_b"],
            )

            duel_composite_a = 0.25 * r4["duel_margin_a"] + 0.35 * r10["duel_margin_a"] + 0.40 * r15["duel_margin_a"]
            shared_lanes = sorted(viable_lanes_by_hero[ha_name] & viable_lanes_by_hero[hb_name])
            is_same_main_lane = main_lane_by_hero[ha_name] == main_lane_by_hero[hb_name]

            for me, opp, sgn, my_kit, my_reasons, burst_me, burst_opp, ttk_me in (
                (
                    ha_name,
                    hb_name,
                    1.0,
                    kit_ab,
                    reasons_a,
                    r15["burst_pct_a_on_b"],
                    r15["burst_pct_b_on_a"],
                    r15["ttk_a"],
                ),
                (
                    hb_name,
                    ha_name,
                    -1.0,
                    kit_ba,
                    reasons_b,
                    r15["burst_pct_b_on_a"],
                    r15["burst_pct_a_on_b"],
                    r15["ttk_b"],
                ),
            ):
                p_row = pro_cnt_map.get((me, opp), {})
                pro_games = int(p_row.get("games_against", 0) or 0)
                pro_wr = float(p_row.get("win_rate_against_pct", 50.0) or 50.0)
                pro_adv = float(p_row.get("smoothed_advantage", 0.0) or 0.0) * 100.0
                same_lane_pro_g = int(p_row.get("same_lane_games", 0) or 0)
                same_lane_pro_wr = p_row.get("same_lane_wr_pct", None)

                m4 = round(sgn * r4["duel_margin_a"], 1)
                m10 = round(sgn * r10["duel_margin_a"], 1)
                m15 = round(sgn * r15["duel_margin_a"], 1)
                comp_duel = round(sgn * duel_composite_a, 1)
                tot_edge = round(0.65 * comp_duel + my_kit, 1)

                stage_notes = []
                if m4 >= 18:
                    stage_notes.append(f"ต้นเกม Lv.4 (+{m4:.0f}% HP)")
                if m10 >= 22:
                    stage_notes.append(f"กลางเกม Lv.10 (+{m10:.0f}% HP)")
                if m15 >= 22:
                    stage_notes.append(f"เลทเกม Lv.15 (+{m15:.0f}% HP)")
                all_reasons = my_reasons + stage_notes

                directional_rows.append(
                    {
                        "hero": me,
                        "opponent": opp,
                        "hero_lane": main_lane_by_hero[me],
                        "opp_lane": main_lane_by_hero[opp],
                        "hero_role": eng.hero_meta[me].get("primary_role"),
                        "opp_role": eng.hero_meta[opp].get("primary_role"),
                        "hero_arch": arch_by_hero[me],
                        "opp_arch": arch_by_hero[opp],
                        "same_main_lane": is_same_main_lane,
                        "shared_lanes": ",".join(shared_lanes),
                        "margin_lv4": m4,
                        "margin_lv10": m10,
                        "margin_lv15": m15,
                        "duel_composite": comp_duel,
                        "kit_edge": round(my_kit, 1),
                        "total_mech_edge": tot_edge,
                        "burst_lv15_pct": burst_me,
                        "opp_burst_lv15_pct": burst_opp,
                        "ttk_lv15": ttk_me,
                        "pro_games": pro_games,
                        "pro_wr_pct": round(pro_wr, 1),
                        "pro_smoothed_adv_pct": round(pro_adv, 2),
                        "same_lane_pro_games": same_lane_pro_g,
                        "same_lane_pro_wr_pct": round(float(same_lane_pro_wr), 1)
                        if same_lane_pro_wr is not None and not pd.isna(same_lane_pro_wr)
                        else None,
                        "reasons": " | ".join(all_reasons[:4]),
                    }
                )

    df_all = pd.DataFrame(directional_rows)

    hero_mean_edge = df_all.groupby("hero")["total_mech_edge"].transform("mean")
    opp_mean_loss = df_all.groupby("opponent")["total_mech_edge"].transform("mean")
    df_all["relative_counter_score"] = (df_all["total_mech_edge"] - 0.35 * hero_mean_edge - 0.65 * opp_mean_loss).round(
        1
    )

    df_all.to_csv(DATA_DIR / "mechanical_matchups_130x130.csv", index=False, encoding="utf-8-sig")

    # Counter-Item Flip Discovery on Close/Losing Same-Lane Matchups
    close_losing = df_all[
        (df_all["shared_lanes"] != "") & (df_all["margin_lv15"] <= -8.0) & (df_all["margin_lv15"] >= -65.0)
    ].copy()

    flips: list[dict] = []
    for row in close_losing.itertuples():
        me = row.hero
        opp = row.opponent
        my_arch = row.hero_arch
        opp_arch = row.opp_arch
        opp_feat = features_by_hero.get(opp, {})
        base_items = list(ARCHETYPE_CONFIGS[my_arch]["items_lv15"])

        counter_candidates: list[tuple[str, str]] = []
        if opp_feat.get("has_heal_sustain") or opp in (
            "Taara",
            "Kil'Groth",
            "Lu Bu",
            "Veres",
            "Florentino",
            "Errol",
            "Lauriel",
            "Marja",
            "Helen",
            "Sinestrea",
        ):
            if "Mage" in my_arch or "AP" in my_arch or "Enchanter" in my_arch:
                counter_candidates.append(("Soul Scroll", "ตัดเลือดเวท 40% แก้ทางตัวฮีล/ดูดเลือดจัด"))
            else:
                counter_candidates.append(("Curse of Death", "ตัดเลือดกายภาพ 40% แก้ทางตัวฮีล/ดูดเลือดจัด"))

        if opp_arch in ("ADC_Crit", "ADC_OnHit", "AD_Assassin") and "Mail of Pain" not in base_items:
            counter_candidates.append(("Mail of Pain", "สะท้อนดาเมจกายภาพ 15% + เกราะ 360 แก้ทางกายภาพยิงรัว/เบิร์ส"))

        if opp_arch in ("Mage_Burst", "Mage_Sustain", "AP_Assassin") and "Medallion of Troy" not in base_items:
            counter_candidates.append(("Medallion of Troy", "โล่กันเวท + ต้านเวท 360 แก้ทางเมจเบิร์ส"))

        for c_item, c_reason in counter_candidates:
            if c_item in base_items or c_item not in eng.items:
                continue
            new_items = base_items[:-1] + [c_item]
            b_adapted = build_for_stage(me, my_arch, "lv15", custom_items=new_items)
            st_adapted = precompute_hero_state(eng, b_adapted)
            r_new = fast_duel_pair(eng, st_adapted, states["lv15"][opp])
            if r_new["winner"] == "a" and r_new["duel_margin_a"] >= 10.0:
                swing = round(r_new["duel_margin_a"] - row.margin_lv15, 1)
                flips.append(
                    {
                        "hero": me,
                        "opponent": opp,
                        "lanes": row.shared_lanes,
                        "counter_item": c_item,
                        "reason": c_reason,
                        "before_margin_lv15": row.margin_lv15,
                        "after_margin_lv15": r_new["duel_margin_a"],
                        "swing": swing,
                    }
                )

    df_flips = pd.DataFrame(flips).sort_values("swing", ascending=False) if flips else pd.DataFrame()
    if not df_flips.empty:
        df_flips.to_csv(DATA_DIR / "counter_item_flips.csv", index=False, encoding="utf-8-sig")

    popular_opps = set(df_stats[df_stats["picks"] >= 35].index)

    summary = {
        "total_heroes": n,
        "total_directional_matchups": len(df_all),
        "elapsed_seconds": round(time.perf_counter() - t0, 2),
        "same_lane_top": {},
        "same_lane_hidden_gems": {},
        "cross_lane_by_pair": {},
        "meta_boss_counters": {},
        "new_hero_discoveries": {},
        "top_item_flips": [],
    }

    for lane in ("DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam"):
        sub = df_all[
            (df_all["shared_lanes"].str.contains(lane, na=False))
            & (~df_all["opponent"].isin(PURE_UTILITY_SUPPORTS if lane != "Roam" else set()))
            & (df_all["margin_lv4"] >= 5.0)
            & (df_all["margin_lv10"] >= 10.0)
            & (df_all["margin_lv15"] >= 10.0)
            & (df_all["total_mech_edge"] >= 20.0)
        ]
        summary["same_lane_top"][lane] = select_diverse_top(
            sub[sub["same_main_lane"]], "relative_counter_score", limit=8, max_per_hero=2, max_per_opp=1
        )
        gems = sub[
            (sub["opponent"].isin(popular_opps))
            & (sub["same_lane_pro_games"] <= 3)
            & (sub["pro_games"] <= 5)
            & (sub["relative_counter_score"] >= 18.0)
        ]
        summary["same_lane_hidden_gems"][lane] = select_diverse_top(
            gems, "relative_counter_score", limit=6, max_per_hero=2, max_per_opp=1
        )

    cross_pairs = [
        ("Jungle -> Dragon_Lane (ตัวป่าล้วงแครี่ / แก้ทางแครี่)", "Jungle", "Dragon_Lane"),
        ("Dragon_Lane -> Jungle (แครี่สวนกลับ / ยืนสู้ตัวป่าได้)", "Dragon_Lane", "Jungle"),
        ("Jungle -> Mid (ตัวป่าล้วงเมจ)", "Jungle", "Mid"),
        ("Roam -> Jungle (โรมมิ่งจับตาย/คุมตัวป่า)", "Roam", "Jungle"),
        ("Dragon_Lane/Mid -> DS_Lane/Tank (ตัวดาเมจละลายแทงค์/ไฟต์เตอร์)", "Dragon_Lane", "DS_Lane"),
        ("DS_Lane -> Dragon_Lane/Mid (ออฟเลนล้วงแนวหลัง)", "DS_Lane", "Dragon_Lane"),
    ]
    for label, l_me, l_opp in cross_pairs:
        csub = df_all[
            (df_all["hero_lane"] == l_me)
            & (df_all["opp_lane"] == l_opp)
            & (df_all["shared_lanes"] == "")
            & (df_all["opponent"].isin(popular_opps))
            & (df_all["total_mech_edge"] >= 20.0)
        ]
        summary["cross_lane_by_pair"][label] = select_diverse_top(
            csub, "relative_counter_score", limit=6, max_per_hero=1, max_per_opp=1
        )

    top_bosses = [
        "Biron",
        "Billow",
        "Goverra",
        "Stuart",
        "Hayate",
        "Edras",
        "Keera",
        "Aoi",
        "Florentino",
        "Riktor",
        "Yena",
        "Liliana",
        "Raz",
        "Valhein",
        "Thane",
    ]
    for boss in top_bosses:
        if boss not in eng.hero_meta:
            continue
        boss_lane = main_lane_by_hero[boss]
        same_c = df_all[
            (df_all["opponent"] == boss) & (df_all["shared_lanes"].str.contains(boss_lane, na=False))
        ].sort_values("total_mech_edge", ascending=False)
        cross_c = df_all[
            (df_all["opponent"] == boss) & (~df_all["shared_lanes"].str.contains(boss_lane, na=False))
        ].sort_values("total_mech_edge", ascending=False)
        summary["meta_boss_counters"][boss] = {
            "lane": boss_lane,
            "same_lane_counters": same_c.head(4).to_dict("records"),
            "cross_lane_counters": cross_c.head(4).to_dict("records"),
        }

    for sh in (
        "Evita",
        "Tamyn",
        "Goverra",
        "Billow",
        "Bolt Baron",
        "Biron",
        "Heino",
        "Dolia",
        "Flowborn (Marksman)",
        "Flowborn (Mage)",
    ):
        if sh not in eng.hero_meta:
            continue
        wins_vs = (
            df_all[
                (df_all["hero"] == sh) & (df_all["opponent"].isin(popular_opps)) & (df_all["total_mech_edge"] > 12.0)
            ]
            .sort_values("relative_counter_score", ascending=False)
            .head(4)
            .to_dict("records")
        )
        loses_to = (
            df_all[(df_all["opponent"] == sh) & (df_all["total_mech_edge"] > 12.0)]
            .sort_values("relative_counter_score", ascending=False)
            .head(4)
            .to_dict("records")
        )
        summary["new_hero_discoveries"][sh] = {
            "lane": main_lane_by_hero[sh],
            "arch": arch_by_hero[sh],
            "beats_meta": wins_vs,
            "countered_by": loses_to,
        }

    if not df_flips.empty:
        flip_out = []
        seen_fh: dict[str, int] = {}
        for r in df_flips.sort_values("swing", ascending=False).to_dict("records"):
            if seen_fh.get(r["hero"], 0) >= 2:
                continue
            seen_fh[r["hero"]] = seen_fh.get(r["hero"], 0) + 1
            flip_out.append(r)
            if len(flip_out) >= 15:
                break
        summary["top_item_flips"] = flip_out

    (DATA_DIR / "mechanical_matchup_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Done in {time.perf_counter() - t0:.2f}s -> saved mechanical matchup files to {DATA_DIR}")


if __name__ == "__main__":
    main()
