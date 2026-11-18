"""Automatic & curated skill/passive mechanics extractor across all 130 RoV heroes.

Reads structured scaling dictionaries and Thai/English skill descriptions from
``data/hero_skills_full.json`` so ``CombatEngine`` / ``simulate_duel`` captures shields,
heals, damage reduction, invulnerability frames, armor/magic-defense shred, cooldown
resets, multi-hit/sweet-spot multipliers, and passive procs for all 130 heroes without
duplicating per-hero boilerplate or breaking ``build_stats()`` / ``skill_damage()`` APIs.
"""

from __future__ import annotations

import re

# Heroes whose passive uses continuous state / combat loops instead of naive 5s timer
EXTENDED_STATEFUL_PASSIVES: set[str] = {
    "Omen",
    "Max",
    "Mina",
    "Errol",
    "Dextra",
    "Kil'Groth",
    "Stuart",
    "Taara",
    "Lu Bu",
    "Elsu",
    "Thorne",
    "Keera",
    "Arduin",
    "Allain",
    "Bright",
    "Qi",
    "Zanis",
    "Amily",
    "Dirak",
    "Thane",
    "Zephys",
    "Ignis",
    "Ilumia",
    "Yue",
    "Maloch",
    "Rourke",
    "Tachi",
    "Laville",
    "Celica",
    "Baldum",
    "Diao Chan",
    "Enzo",
    "Sinestrea",
    "Flowborn (Mage)",
    "Flowborn (Marksman)",
}

# Additional stack/cooldown proc passives parsed across the 130-hero roster
EXTENDED_STACK_PASSIVES: dict[str, dict] = {
    "Aoi": {"slot": "Passive", "hits_needed": 2, "cooldown": 0.0, "trigger": "attack"},
    "Arum": {
        "slot": "Passive",
        "hits_needed": 1,
        "cooldown": 1.5,
        "trigger": "any",
        "heal_base": 25.0,
        "heal_ap": 0.50,
        "heal_max_hp_pct": 3.0,
    },
    "Ata": {"slot": "Passive", "hits_needed": 2, "cooldown": 0.0, "trigger": "attack", "heal_max_hp_pct": 1.0},
    "Bolt Baron": {"slot": "Passive", "hits_needed": 2, "cooldown": 0.0, "trigger": "attack"},
    "Biron": {"slot": "Passive", "hits_needed": 3, "cooldown": 0.0, "trigger": "attack", "heal_base": 70.0},
    "Dyadia": {"slot": "Passive", "hits_needed": 1, "cooldown": 6.0, "trigger": "attack"},
    "Erin": {"slot": "Passive", "hits_needed": 3, "cooldown": 0.0, "trigger": "attack"},
    "Evita": {"slot": "Passive", "hits_needed": 2, "cooldown": 0.0, "trigger": "skill"},
    "Florentino": {"slot": "Passive", "hits_needed": 1, "cooldown": 5.0, "trigger": "attack", "heal_max_hp_pct": 2.0},
    "Goverra": {"slot": "Passive", "hits_needed": 4, "cooldown": 0.0, "trigger": "skill"},
    "Grakk": {"slot": "Passive", "hits_needed": 3, "cooldown": 2.0, "trigger": "damage_taken"},
    "Heino": {"slot": "Passive", "hits_needed": 2, "cooldown": 0.0, "trigger": "attack", "heal_lost_hp_pct": 4.0},
    "Helen": {
        "slot": "Passive",
        "hits_needed": 1,
        "cooldown": 10.0,
        "trigger": "damage_taken",
        "heal_base": 200.0,
        "heal_ap": 0.50,
    },
    "Ishar": {"slot": "Passive", "hits_needed": 1, "cooldown": 1.5, "trigger": "any"},
    "Kahlii": {"slot": "Passive", "hits_needed": 1, "cooldown": 0.0, "trigger": "attack"},
    "Krizzix": {"slot": "Passive", "hits_needed": 1, "cooldown": 6.0, "trigger": "attack"},
    "Lindis": {"slot": "Passive", "hits_needed": 1, "cooldown": 4.0, "trigger": "attack"},
    "Lorion": {
        "slot": "Passive",
        "hits_needed": 2,
        "cooldown": 0.0,
        "trigger": "skill",
        "heal_ap": 0.10,
        "heal_base": 60.0,
    },
    "Marja": {
        "slot": "Passive",
        "hits_needed": 1,
        "cooldown": 2.0,
        "trigger": "any",
        "heal_base": 20.0,
        "heal_ap": 0.04,
    },
    "Mganga": {"slot": "Passive", "hits_needed": 1, "cooldown": 1.0, "trigger": "any"},
    "Ming": {"slot": "Passive", "hits_needed": 1, "cooldown": 5.0, "trigger": "attack", "heal_bonus_hp_pct": 4.0},
    "Moren": {"slot": "Passive", "hits_needed": 1, "cooldown": 0.0, "trigger": "attack"},
    "Natalya": {"slot": "Passive", "hits_needed": 1, "cooldown": 0.0, "trigger": "skill"},
    "Omega": {"slot": "Passive", "hits_needed": 1, "cooldown": 6.0, "trigger": "attack"},
    "Ormarr": {"slot": "Passive", "hits_needed": 2, "cooldown": 4.0, "trigger": "any"},
    "Preyta": {"slot": "Passive", "hits_needed": 2, "cooldown": 0.0, "trigger": "skill"},
    "Raz": {"slot": "Passive", "hits_needed": 3, "cooldown": 0.0, "trigger": "attack"},
    "Ryoma": {"slot": "Passive", "hits_needed": 1, "cooldown": 5.0, "trigger": "attack"},
    "Sephera": {
        "slot": "Passive",
        "hits_needed": 1,
        "cooldown": 0.0,
        "trigger": "skill",
        "heal_base": 50.0,
        "heal_ap": 0.10,
        "heal_bonus_hp_pct": 4.0,
    },
    "Skud": {"slot": "Passive", "hits_needed": 1, "cooldown": 0.0, "trigger": "attack"},
    "Wonder Woman": {"slot": "Passive", "hits_needed": 3, "cooldown": 0.0, "trigger": "attack", "heal_ad": 0.25},
    "Wisp": {"slot": "Passive", "hits_needed": 1, "cooldown": 0.0, "trigger": "attack"},
    "Xeniel": {"slot": "Passive", "hits_needed": 3, "cooldown": 0.0, "trigger": "attack"},
    "Yan": {"slot": "Passive", "hits_needed": 2, "cooldown": 0.0, "trigger": "skill", "heal_max_hp_pct": 6.0},
    "Yorn": {"slot": "Passive", "hits_needed": 5, "cooldown": 0.0, "trigger": "attack"},
    "Zata": {"slot": "Passive", "hits_needed": 3, "cooldown": 0.0, "trigger": "attack"},
}

# Long-range poke / artillery / mobile kiting champions vs shorter-range immobile ranged champs
LONG_RANGE_POKE_HEROES: set[str] = {
    "Yue",
    "Elsu",
    "Iggy",
    "Kahlii",
    "Natalya",
    "Liliana",
    "Flowborn (Mage)",
    "Celica",
    "Violet",
    "Tulen",
    "Dirak",
    "Tel'Annas",
}

SHORT_IMMOBILE_RANGED_HEROES: set[str] = {
    "Ilumia",
    "Veera",
    "Azzen'Ka",
    "Diao Chan",
    "Aleister",
    "Mganga",
    "Ignis",
    "Ishar",
    "Helen",
    "Alice",
    "Ming",
    "Aya",
}

# Curated tactical skill overrides merged cleanly with JSON auto-extraction
CURATED_SKILL_EFFECTS: dict[tuple[str, str], dict] = {
    ("Airi", "Skill 1"): {"sim_mult": 1.0},
    ("Airi", "Ultimate"): {"reset_s2": True, "shield_max_hp_pct": 10.0, "duration": 4.0},
    ("Amily", "Ultimate"): {"bonus_ad": [100.0, 150.0, 200.0], "dr_pct": [15.0, 20.0, 25.0], "duration": 8.0},
    ("Aoi", "Ultimate"): {"invuln_duration": 1.0},
    ("Astrid", "Ultimate"): {"invuln_duration": 1.0, "shield_max_hp_pct": 12.0, "duration": 3.0},
    ("Baldum", "Skill 2"): {"dr_pct": 24.0, "duration": 3.0},
    ("Baldum", "Ultimate"): {"snare_duration": 1.5},
    ("Bolt Baron", "Skill 1"): {
        "shield_base": 125.0,
        "shield_own_hp_pct": 4.0,
        "duration": 2.0,
    },
    ("Butterfly", "Skill 1"): {"shield_ad": 1.20, "duration": 3.0},
    ("Butterfly", "Ultimate"): {"dr_pct": 30.0, "duration": 2.0, "heal_lost_hp_pct": 12.0},
    ("Capheny", "Skill 2"): {"dmg_dealt_pct": 10.0, "duration": 4.0},
    ("Celica", "Skill 1"): {"bonus_ad": [70.0, 84.0, 98.0, 112.0, 126.0, 140.0], "duration": 3.0},
    ("Chaugnar", "Skill 2"): {"dr_pct": 10.0, "duration": 2.5},
    ("Chaugnar", "Ultimate"): {"shield_base": [800.0, 1200.0, 1600.0], "duration": 2.0},
    ("Cresht", "Skill 2"): {
        "shield_base": [550.0, 660.0, 770.0, 880.0, 990.0, 1100.0],
        "shield_own_hp_pct": 8.0,
        "duration": 3.0,
    },
    ("Cresht", "Ultimate"): {"invuln_duration": 0.8, "shield_own_hp_pct": 40.0, "bonus_ad": 150.0, "duration": 8.0},
    ("D'Arcy", "Skill 1"): {"dr_pct": [20.0, 24.0, 28.0, 32.0, 36.0, 40.0], "duration": 2.0},
    ("Dirak", "Ultimate"): {"dr_pct": 25.0, "duration": 4.0},
    ("Dolia", "Ultimate"): {"reset_longest_cd": True},
    ("Edras", "Skill 1"): {"dr_pct": 40.0, "duration": 1.5},
    ("Edras", "Ultimate"): {"dr_pct": 40.0, "duration": 1.5},
    ("Erin", "Skill 2"): {"as_pct": [30.0, 36.0, 42.0, 48.0, 54.0, 60.0], "duration": 4.0},
    ("Fennik", "Skill 2"): {"invuln_duration": 0.5},
    ("Goverra", "Ultimate"): {"duration": 3.0},
    ("Heino", "Ultimate"): {"dr_pct": [15.0, 22.5, 30.0], "heal_lost_hp_pct": 15.0, "duration": 4.0},
    ("Helen", "Skill 1"): {
        "hot_base_sec": [170.0, 204.0, 238.0, 272.0, 306.0, 340.0],
        "hot_ap_sec": 0.40,
        "duration": 3.0,
    },
    ("Helen", "Ultimate"): {
        "hot_base_sec": [240.0, 360.0, 480.0],
        "hot_ap_sec": 1.20,
        "bonus_def": [300.0, 450.0, 600.0],
        "duration": 5.0,
    },
    ("Ignis", "Skill 1"): {
        "shield_base": [300.0, 360.0, 420.0, 480.0, 540.0, 600.0],
        "shield_ap": 0.50,
        "duration": 3.0,
    },
    ("Ilumia", "Skill 1"): {"oracle_stack": True},
    ("Ilumia", "Skill 2"): {"oracle_stack": True},
    ("Ishar", "Skill 2"): {
        "shield_base": [300.0, 360.0, 420.0, 480.0, 540.0, 600.0],
        "shield_ap": 0.70,
        "duration": 3.0,
    },
    ("Jinnar", "Ultimate"): {"dr_pct": 15.0, "duration": 5.0},
    ("Kahlii", "Skill 2"): {
        "shield_base": [350.0, 420.0, 490.0, 560.0, 630.0, 700.0],
        "shield_ap": 0.65,
        "duration": 6.0,
    },
    ("Krizzix", "Skill 2"): {
        "shield_base": [400.0, 480.0, 560.0, 640.0, 720.0, 800.0],
        "shield_own_hp_pct": 8.0,
        "duration": 3.0,
    },
    ("Lauriel", "Ultimate"): {"lauriel_zone": True, "duration": 8.0},
    ("Laville", "Skill 2"): {
        "shield_base": [300.0, 360.0, 420.0, 480.0, 540.0, 600.0],
        "shield_ad": 1.0,
        "invuln_duration": 0.5,
        "duration": 3.0,
    },
    ("Maloch", "Skill 1"): {"maloch_cleave": True},
    ("Maloch", "Skill 2"): {
        "shield_own_hp_pct": 7.0,
        "heal_max_hp_pct": 1.75,
        "maloch_plunder": True,
        "duration": 3.0,
    },
    ("Ming", "Skill 2"): {"opp_def_shred_pct": 25.0, "duration": 5.0},
    ("Murad", "Ultimate"): {"invuln_duration": 1.2},
    ("Nakroth", "Ultimate"): {"dr_pct": 20.0, "duration": 1.5},
    ("Natalya", "Ultimate"): {
        "shield_base": [850.0, 1275.0, 1700.0],
        "shield_ap": 1.0,
        "duration": 3.5,
    },
    ("Omega", "Skill 1"): {"shield_base": 400.0, "shield_bonus_hp_pct": 10.0, "duration": 4.0},
    ("Paine", "Skill 1"): {"dr_pct": 40.0, "duration": 1.5},
    ("Qi", "Skill 2"): {"opp_armor_shred": [75.0, 100.0, 125.0, 150.0, 175.0, 200.0], "duration": 5.0},
    ("Raz", "Skill 2"): {"opp_mdef_shred": [100.0, 120.0, 140.0, 160.0, 180.0, 200.0], "duration": 2.0},
    ("Rourke", "Ultimate"): {"shield_base": [1200.0, 2000.0, 2800.0], "duration": 6.0},
    ("Roxie", "Skill 2"): {
        "shield_base": [250.0, 300.0, 350.0, 400.0, 450.0, 500.0],
        "shield_own_hp_pct": 8.0,
        "duration": 3.0,
    },
    ("Sephera", "Ultimate"): {"invuln_duration": 1.5},
    ("Sinestrea", "Ultimate"): {"lifesteal_pct": 30.0, "duration": 6.0},
    ("Tachi", "Ultimate"): {"dr_pct": 35.0, "shield_own_hp_pct": 25.0, "duration": 3.0},
    ("Toro", "Skill 2"): {"dr_pct": 30.0, "shield_base": [300.0, 360.0, 420.0, 480.0, 540.0, 600.0], "duration": 3.0},
    ("Veera", "Skill 2"): {"opp_mdef_shred": [100.0, 120.0, 140.0, 160.0, 180.0, 200.0], "duration": 3.0},
    ("Wonder Woman", "Skill 1"): {"dr_pct": 20.0, "duration": 2.0},
    ("Xeniel", "Skill 1"): {
        "shield_base": [500.0, 600.0, 700.0, 800.0, 900.0, 1000.0],
        "shield_ap": 0.50,
        "shield_own_hp_pct": [5.0, 6.0, 7.0, 8.0, 9.0, 10.0],
        "duration": 5.0,
    },
    ("Y'bneth", "Ultimate"): {"shield_base": [1000.0, 1500.0, 2000.0], "heal_max_hp_pct": 10.0, "duration": 4.0},
    ("Yan", "Ultimate"): {"dr_pct": 50.0, "duration": 2.0},
    ("Yue", "Skill 1"): {"sim_mult": 2.0, "yue_stack": True},
    ("Yue", "Skill 2"): {"sim_mult": 2.0, "yue_stack": True},
    ("Zata", "Ultimate"): {"invuln_duration": 1.5, "sim_mult": 3.5},
    ("Zip", "Skill 2"): {
        "shield_own_hp_pct": 10.0,
        "heal_base": [200.0, 240.0, 280.0, 320.0, 360.0, 400.0],
        "heal_ap": 0.40,
        "duration": 3.0,
    },
    ("Zuka", "Skill 2"): {"shield_base": [350.0, 420.0, 490.0, 560.0, 630.0, 700.0], "shield_ad": 2.0, "duration": 2.5},
}


def _num_val(val) -> float | list[float]:
    if isinstance(val, list):
        return [float(x) for x in val]
    return float(val)


def extract_all_hero_skill_mechanics(skills_by_hero: dict[str, list[dict]]) -> dict[tuple[str, str], dict]:
    """Build complete per-(hero, slot) combat mechanics from ``hero_skills_full.json`` + curated rules."""
    effects: dict[tuple[str, str], dict] = {}

    for hero, sk_list in skills_by_hero.items():
        for sk in sk_list:
            slot = sk.get("slot", "")
            if not slot or slot.startswith("Passive"):
                continue
            sc = sk.get("scaling") or {}
            dl = f"{sk.get('description') or ''} {sk.get('desc_th') or ''}".lower()
            entry: dict = {}

            # 1. Auto-map structured heal scalings from JSON
            for src_k, dst_k in (
                ("heal_base", "heal_base"),
                ("heal_max_hp_pct", "heal_max_hp_pct"),
                ("heal_own_max_hp_pct", "heal_max_hp_pct"),
                ("heal_bonus_hp_pct", "heal_bonus_hp_pct"),
                ("heal_lost_hp_pct", "heal_lost_hp_pct"),
                ("heal_ad_pct", "heal_ad"),
                ("heal_bonus_ad_pct", "heal_bonus_ad"),
                ("heal_ap_pct", "heal_ap"),
                ("heal_bonus_ap_pct", "heal_ap"),
            ):
                if src_k in sc:
                    v = _num_val(sc[src_k])
                    if src_k == "heal_bonus_ad_pct" and ("per 100 bonus ad" in dl or "ทุกๆ 100" in dl):
                        entry["heal_max_hp_per_100_bad"] = v
                        continue
                    if dst_k in ("heal_ad", "heal_bonus_ad", "heal_ap"):
                        v = [x / 100.0 for x in v] if isinstance(v, list) else v / 100.0
                    entry[dst_k] = v

            # Note: zero-dmg skills (Alice S2, Aya S2, Dolia S2, Helen S1) store shield/heal values in base_damage
            if sk.get("damage_type") == "none" and sk.get("base_damage"):
                if ("shield" in dl or "โล่" in dl) and "shield_base" not in entry:
                    entry["shield_base"] = _num_val(sk["base_damage"])
                    if "ap_pct" in sc and "shield_ap" not in entry:
                        v = _num_val(sc["ap_pct"])
                        entry["shield_ap"] = [x / 100.0 for x in v] if isinstance(v, list) else v / 100.0
                    if "bonus_hp_pct" in sc and "shield_bonus_hp_pct" not in entry:
                        entry["shield_bonus_hp_pct"] = _num_val(sc["bonus_hp_pct"])
                    entry.setdefault("duration", 3.0)
                elif ("restore" in dl or "recover" in dl or "ฟื้นฟู" in dl) and "heal_base" not in entry:
                    entry["heal_base"] = _num_val(sk["base_damage"])

            # 2. Auto-map structured shield scalings from JSON
            for src_k, dst_k in (
                ("shield_base", "shield_base"),
                ("shield_ad_pct", "shield_ad"),
                ("shield_ap_pct", "shield_ap"),
                ("shield_own_hp_pct", "shield_own_hp_pct"),
                ("bonus_shield_hp_pct", "shield_own_hp_pct"),
            ):
                if src_k in sc:
                    v = _num_val(sc[src_k])
                    if dst_k in ("shield_ad", "shield_ap"):
                        v = [x / 100.0 for x in v] if isinstance(v, list) else v / 100.0
                    entry[dst_k] = v
                    entry.setdefault("duration", 3.0)

            # 3. Auto-map attack speed / DR / armor shred / pierce / lifesteal buffs in JSON
            if "atk_speed_pct" in sc:
                entry["as_pct"] = _num_val(sc["atk_speed_pct"])
                entry.setdefault("duration", 4.0)
            if "damage_reduction_pct" in sc:
                entry["dr_pct"] = _num_val(sc["damage_reduction_pct"])
                entry.setdefault("duration", 3.0)
            if "lifesteal_pct" in sc:
                entry["lifesteal_pct"] = _num_val(sc["lifesteal_pct"])
                entry.setdefault("duration", 5.0)
            if "ad_buff" in sc:
                entry["bonus_ad"] = _num_val(sc["ad_buff"])
                entry.setdefault("duration", 5.0)
            if "penetrate_base" in sc:
                entry["as_pct"] = 30.0
                entry["bonus_pierce_flat"] = _num_val(sc["penetrate_base"])
                entry.setdefault("duration", 4.0)
            if "hp_regen_pct" in sc or "hero_hp_regen_pct" in sc:
                entry["heal_max_hp_pct"] = float(sc.get("hero_hp_regen_pct") or sc.get("hp_regen_pct") or 2.0)

            # 4. Auto-map secondary damage components stored in JSON scaling for simulate_duel
            extra_raw: dict = {}
            for base_k, ap_k, ad_k, mult_c in (
                ("blast_damage", "blast_ap_pct", None, 1.0),
                ("burst_damage", "burst_ap_pct", None, 1.0),
                (None, "tick_ap_pct", "tick_ad_pct", 3.0),
                (None, None, "slash_ad_pct", 1.0),
                (None, None, "enhanced_ad_pct", 0.5),
                (None, "claw_ap_pct", None, 1.0),
                (None, "linked_ap_pct", None, 1.0),
                (None, None, "curse_ad_pct", 2.0),
                (None, None, "shadow_ad_pct", 1.0),
                (None, None, "clash_ad_pct", 1.0),
            ):
                if base_k and base_k in sc:
                    extra_raw["base"] = _num_val(sc[base_k])
                if ap_k and ap_k in sc:
                    v_ap = _num_val(sc[ap_k])
                    extra_raw["ap"] = (
                        [x * mult_c / 100.0 for x in v_ap] if isinstance(v_ap, list) else v_ap * mult_c / 100.0
                    )
                if ad_k and ad_k in sc:
                    v_ad = _num_val(sc[ad_k])
                    extra_raw["ad"] = (
                        [x * mult_c / 100.0 for x in v_ad] if isinstance(v_ad, list) else v_ad * mult_c / 100.0
                    )
            if "bonus_true_dmg" in sc and ("true" in dl or "จริง" in dl):
                extra_raw["true_base"] = float(sc["bonus_true_dmg"])
            if extra_raw:
                entry["extra_sim"] = extra_raw

            # 5. Text-based fallback for invuln if neither JSON scaling nor curated rule sets it
            if (
                "untargetable" in dl or "invulnerable" in dl or "ไม่ตกเป็นเป้าหมาย" in dl
            ) and "not untargetable" not in dl:
                m_dur = re.search(r"for (\d+(?:\.\d+)?)s", dl)
                entry.setdefault("invuln_duration", min(2.5, float(m_dur.group(1))) if m_dur else 0.75)

            if entry:
                effects[(hero, slot)] = entry

    # Overlay curated overrides cleanly on top (preserving curated authoritative values while keeping auto keys)
    for k, cur in CURATED_SKILL_EFFECTS.items():
        if k in effects:
            merged = {**effects[k], **cur}
            effects[k] = merged
        else:
            effects[k] = dict(cur)

    return effects
