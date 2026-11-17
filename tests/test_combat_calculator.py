import pytest

from src.combat_calculator import (
    CDR_CAP,
    Build,
    auto_skill_levels,
    get_engine,
    mitigation_multiplier,
    normalize_ratio,
)


@pytest.fixture(scope="module")
def engine():
    return get_engine()


def test_mitigation_formula():
    assert mitigation_multiplier(0, 0, 0) == 1.0
    assert mitigation_multiplier(600, 0, 0) == pytest.approx(0.5)
    # Flat pierce first, then percent: (400 - 100) * (1 - 0.5) = 150 -> 600 / 750
    assert mitigation_multiplier(400, 100, 50) == pytest.approx(0.8)
    # Pierce cannot push defense below zero
    assert mitigation_multiplier(100, 500, 0) == 1.0


def test_normalize_ratio():
    assert normalize_ratio(1.45) == pytest.approx(145.0)
    assert normalize_ratio(80.0) == 80.0


def test_auto_skill_levels():
    assert auto_skill_levels(1) == {**auto_skill_levels(1), "Skill 1": 1, "Skill 2": 0, "Ultimate": 0}
    lv15 = auto_skill_levels(15)
    assert lv15["Skill 1"] == 6 and lv15["Skill 2"] == 6 and lv15["Ultimate"] == 3


def test_level_stats_only(engine):
    res = engine.build_stats(Build(hero="Valhein", level=1))
    lv1 = engine.level_stats["Valhein"]["levels"]["1"]
    assert res["stats"]["max_hp"] == lv1["hp"]
    assert res["stats"]["armor"] == lv1["armor"]
    assert res["stats"]["bonus_attack_damage"] == 0


def test_items_and_pierce(engine):
    res = engine.build_stats(Build(hero="Valhein", level=15, items=["Fenrir's Tooth", "Muramasa"]))
    lv15 = engine.level_stats["Valhein"]["levels"]["15"]
    fenrir = engine.items["Fenrir's Tooth"]["stats"]["attack_damage"]
    muramasa = engine.items["Muramasa"]["stats"]["attack_damage"]
    assert res["stats"]["attack_damage"] == pytest.approx(lv15["attack_damage"] + fenrir + muramasa)
    assert res["stats"]["armor_pierce_pct"] == 40.0


def test_unique_passive_does_not_stack(engine):
    res_nuul = engine.build_stats(Build(hero="Krixi", level=15, items=["Staff of Nuul", "Staff of Nuul"]))
    assert res_nuul["stats"]["magic_pierce_pct"] == 40.0
    res_spears = engine.build_stats(Build(hero="Valhein", level=15, items=["Broken Spears", "Broken Spears"]))
    assert res_spears["stats"]["armor_pierce_flat"] == 180.0
    res = engine.build_stats(Build(hero="Valhein", level=15, items=["Muramasa", "Muramasa"]))
    assert res["stats"]["armor_pierce_pct"] == 40.0


def test_percent_pierce_not_counted_as_flat(engine):
    res = engine.build_stats(Build(hero="Valhein", level=15, items=["Muramasa"]))
    assert res["stats"]["armor_pierce_flat"] == 0


def test_item_pierce_text_variants(engine):
    # Valhein is ranged: Chaos Bow 10% and The Morning Star 20% are doubled
    res = engine.build_stats(Build(hero="Valhein", level=15, items=["Chaos Bow"]))
    assert res["stats"]["armor_pierce_pct"] == 20.0
    res = engine.build_stats(Build(hero="Toro", level=15, items=["The Morning Star"]))
    assert res["stats"]["armor_pierce_pct"] == 20.0
    res = engine.build_stats(Build(hero="Valhein", level=15, items=["Broken Spears"]))
    assert res["stats"]["armor_pierce_flat"] == 180.0
    res = engine.build_stats(Build(hero="Valhein", level=15, items=["Spooky Mask"]))
    assert res["stats"]["magic_pierce_flat"] == 75.0
    # Mage Robe: 60 at Lv15 + 3% bonus HP, capped at 150
    res = engine.build_stats(Build(hero="Toro", level=15, items=["Mage Robe"]))
    bonus_hp = res["stats"]["max_hp"] - res["sources"]["level"]["max_hp"]
    assert res["stats"]["magic_pierce_flat"] == pytest.approx(min(150, 60 + 0.03 * bonus_hp), abs=0.01)


def test_item_alias_resolves(engine):
    res = engine.build_stats(Build(hero="Valhein", level=15, items=["Rankbreaker", "Spoopy Mask"]))
    assert res["stats"]["armor_pierce_flat"] == 180.0
    assert res["stats"]["magic_pierce_flat"] == 75.0

    # Shorthand and colloquial aliases
    b_short = Build(hero="Valhein", level=15, items=["Fafnir", "Troy's Medallion", "Hyoga", "Gaia"])
    res_short = engine.build_stats(b_short)
    assert b_short.items == ["Fafnir's Talon", "Medallion of Troy", "Frost Hammer", "Gaia's Standard"]
    assert res_short["stats"]["magic_defense"] > 400.0


def test_alternate_form_skills_use_ingame_slot_level(engine):
    build = Build(hero="Yena", level=15)
    atk = engine.build_stats(build)
    rows = {r["slot"]: r for r in engine.skill_damage(atk, atk, build)}
    levels = engine.skill_levels_for(build)
    assert levels["Skill 3"] == levels["Skill 1"] == 6
    assert levels["Skill 4"] == levels["Skill 2"] == 6
    assert levels["Skill 5"] == levels["Ultimate"] == 3
    assert rows["Skill 3"]["skill_level"] == levels["Skill 1"]
    assert rows["Skill 4"]["skill_level"] == levels["Skill 2"]
    assert rows["Skill 5"]["skill_level"] == levels["Ultimate"]
    assert rows["Skill 4"]["hits"] == 4
    assert rows["Passive 2"]["skill_level"] == 1


def test_active_combo_slots_filters_burst_and_duel(engine):
    target = Build(hero="Toro", level=15)
    # Default Yena burst counts all 5 active skills across both forms
    all_forms = Build(hero="Yena", level=15)
    all_burst = engine.burst(all_forms, engine.build_stats(target))

    # Dual-blade form only: Skill 1, Skill 2, Ultimate
    dual_blades = Build(hero="Yena", level=15, active_combo_slots=["Skill 1", "Skill 2", "Ultimate"])
    dual_burst = engine.burst(dual_blades, engine.build_stats(target))
    assert 0 < dual_burst < all_burst

    # Combined-blade form only: Skill 3, Skill 4, Skill 5
    combined = Build(hero="Yena", level=15, active_combo_slots=["Skill 3", "Skill 4", "Skill 5"])
    combined_burst = engine.burst(combined, engine.build_stats(target))
    assert 0 < combined_burst < all_burst

    # Combined + Dual equals total burst
    assert dual_burst + combined_burst == pytest.approx(all_burst)

    # Duel result reflects active combo slots
    duel_res = engine.duel(dual_blades, target)
    assert duel_res["a"]["burst_combo"] == pytest.approx(dual_burst)
    assert duel_res["a"]["active_combo_slots"] == ["Skill 1", "Skill 2", "Ultimate"]


def test_cdr_cap(engine):
    cdr_items = [n for n, i in engine.items.items() if i["stats"].get("cooldown_reduction", 0) >= 10][:6]
    res = engine.build_stats(Build(hero="Valhein", level=15, items=cdr_items, arcana={"Hex": 10}))
    assert res["stats"]["cooldown_reduction"] <= CDR_CAP
    assert res["stats"]["cooldown_reduction_uncapped"] > CDR_CAP


def test_arcana_tier3_and_slot_limit(engine):
    res = engine.build_stats(Build(hero="Valhein", level=1, arcana={"Excalibur": 10}))
    assert res["sources"]["arcana"]["attack_damage"] == pytest.approx(32.0)
    with pytest.raises(ValueError, match="exceeds"):
        engine.build_stats(Build(hero="Valhein", arcana={"Excalibur": 6, "Sage": 5}))


def test_enchantment_rules(engine):
    ok = Build(
        hero="Valhein",
        level=15,
        primary_faction="Veda",
        primary_enchantments=["Axe of Sacrifice", "Holy Verdict", "Sacred Protection"],
        secondary_faction="Lokheim",
        secondary_enchantments=["Devourer", "Deadly Claw"],
    )
    res = engine.build_stats(ok)
    assert res["stats"]["armor_pierce_flat"] == pytest.approx(60)
    assert res["sources"]["enchantments"]["attack_damage"] == pytest.approx(38)
    assert "Sacred Protection" in res["enchantments_modeled"]
    assert "Devourer" in res["enchantments_unmodeled"]
    assert "Holy Verdict" in res["enchantments_modeled"]
    assert "Deadly Claw" in res["enchantments_modeled"]

    with pytest.raises(ValueError, match="must differ"):
        engine.build_stats(
            Build(
                hero="Valhein",
                primary_faction="Veda",
                primary_enchantments=["Holy Verdict"],
                secondary_faction="Veda",
                secondary_enchantments=["Blessing"],
            )
        )
    with pytest.raises(ValueError, match="cannot take tier 3"):
        engine.build_stats(
            Build(hero="Valhein", secondary_faction="Lokheim", secondary_enchantments=["Curse of Death"])
        )
    with pytest.raises(ValueError, match="Only one tier 1"):
        engine.build_stats(
            Build(hero="Valhein", primary_faction="Veda", primary_enchantments=["Axe of Sacrifice", "Sacred Bead"])
        )

    # Dual-faction secondary Tier 1 (e.g. Veda Tier 1 + Afata Tier 1 when primary is Lokheim)
    dual_ok = Build(
        hero="Valhein",
        level=15,
        primary_faction="Lokheim",
        primary_enchantments=["Devourer", "Deadly Claw", "Desperate Duel"],
        secondary_enchantments=["Axe of Sacrifice", "River Treader"],
    )
    res_dual = engine.build_stats(dual_ok)
    assert "Axe of Sacrifice" in res_dual["enchantments_modeled"]
    assert "River Treader" in res_dual["enchantments_unmodeled"]

    # Reject dual factions when one of them is tier 2
    with pytest.raises(ValueError, match="both must be tier 1"):
        engine.build_stats(
            Build(
                hero="Valhein",
                primary_faction="Lokheim",
                secondary_enchantments=["Axe of Sacrifice", "Regrowth"],
            )
        )

    # Reject same secondary faction with two tier 1s
    with pytest.raises(ValueError, match="Only one tier 1"):
        engine.build_stats(
            Build(
                hero="Valhein",
                primary_faction="Lokheim",
                secondary_enchantments=["Axe of Sacrifice", "Mana Refill"],
            )
        )


def test_skill_damage_mitigation(engine):
    atk_build = Build(hero="Valhein", level=15, items=["Fenrir's Tooth"])
    atk = engine.build_stats(atk_build)
    tgt = engine.build_stats(Build(hero="Toro", level=15, items=["Mail of Pain"]))
    rows = {r["slot"]: r for r in engine.skill_damage(atk, tgt, atk_build)}
    s1 = rows["Skill 1"]
    expected_mult = 600 / (600 + tgt["stats"]["armor"])
    assert s1["mitigation_multiplier"] == pytest.approx(expected_mult, abs=1e-4)
    assert s1["final_damage"] == pytest.approx(s1["raw_damage"] * expected_mult, rel=1e-3)
    # Bloody Hunt Lv6: 600 + 145% AD
    assert s1["raw_damage"] == pytest.approx(600 + 1.45 * atk["stats"]["attack_damage"], rel=1e-3)


def test_true_damage_ignores_defense(engine):
    atk_build = Build(hero="Florentino", level=15)
    atk = engine.build_stats(atk_build)
    tgt = engine.build_stats(Build(hero="Toro", level=15, items=["Mail of Pain"]))
    true_rows = [r for r in engine.skill_damage(atk, tgt, atk_build) if r["damage_type"] == "true"]
    assert true_rows and all(r["mitigation_multiplier"] == 1.0 for r in true_rows)


def test_duel_outcome(engine):
    strong = Build(hero="Valhein", level=15, items=["Fenrir's Tooth", "Muramasa"], arcana={"Excalibur": 10})
    weak = Build(hero="Valhein", level=1)
    res = engine.duel(strong, weak)
    assert res["simulation"]["winner"] == "a"
    assert res["simulation"]["time_to_kill"] > 0
    assert res["a"]["effective_hp_physical"] > res["a"]["build"]["stats"]["max_hp"]
    assert len(res["a"]["level_sweep"]) == 15


def test_legacy_hero_alias_resolution(engine):
    for legacy, canonical in (("Arthur", "Mortos"), ("Brunhilda", "Celica"), ("Richter", "Riktor")):
        res = engine.build_stats(Build(hero=legacy, level=15))
        assert res["hero"] == canonical


def test_enchantment_procs(engine):
    b_atk = Build(hero="Valhein", level=15, primary_faction="Veda", primary_enchantments=["Holy Thunder"])
    b_def = Build(hero="Toro", level=15)
    s_atk = engine.build_stats(b_atk)
    s_def = engine.build_stats(b_def)
    procs = engine._procs(s_atk, b_atk, s_def)
    assert len(procs) == 1
    assert procs[0]["name"] == "Holy Thunder"
    assert procs[0]["damage"] > 0


def test_skill_charging_interpolation(engine):
    b_min = Build(hero="Yena", level=15, skill_charges={"Skill 3": 0.0})
    b_mid = Build(hero="Yena", level=15, skill_charges={"Skill 3": 0.5})
    b_max = Build(hero="Yena", level=15, skill_charges={"Skill 3": 1.0})
    target = Build(hero="Toro", level=15)
    s_target = engine.build_stats(target)

    dmg_min = next(s for s in engine.skill_damage(engine.build_stats(b_min), s_target, b_min) if s["slot"] == "Skill 3")
    dmg_mid = next(s for s in engine.skill_damage(engine.build_stats(b_mid), s_target, b_mid) if s["slot"] == "Skill 3")
    dmg_max = next(s for s in engine.skill_damage(engine.build_stats(b_max), s_target, b_max) if s["slot"] == "Skill 3")

    assert dmg_min["has_charge"] is True
    assert dmg_min["charge_ratio"] == 0.0
    assert dmg_mid["charge_ratio"] == 0.5
    assert dmg_max["charge_ratio"] == 1.0
    assert dmg_min["final_damage"] < dmg_mid["final_damage"] < dmg_max["final_damage"]
    # Check linear midpoint
    expected_mid = (dmg_min["final_damage"] + dmg_max["final_damage"]) / 2
    assert abs(dmg_mid["final_damage"] - expected_mid) <= 1.0


def test_hero_stack_passive_proc(engine):
    b_yena = Build(hero="Yena", level=15)
    b_toro = Build(hero="Toro", level=15)
    s_yena = engine.build_stats(b_yena)
    s_toro = engine.build_stats(b_toro)
    skills_yena = engine.skill_damage(s_yena, s_toro, b_yena)

    procs = engine._procs(s_yena, b_yena, s_toro, skills_yena)
    passive_proc = next((p for p in procs if "Lunar Phase" in p["name"]), None)
    assert passive_proc is not None
    assert passive_proc["hits_needed"] == 5
    assert passive_proc["damage"] > 0

    # In a full duel, Yena should accumulate hits and proc her passive
    duel_res = engine.duel(b_yena, b_toro)
    bd = duel_res["simulation"]["a"]["damage_breakdown"]
    assert "Lunar Phase (Passive)" in bd
    assert bd["Lunar Phase (Passive)"] > 0


def test_burst_with_passive(engine):
    target = engine.build_stats(Build(hero="Yena", level=15))
    b_no_passive = Build(hero="Yena", level=15, active_combo_slots=["Skill 1", "Skill 2", "Ultimate"])
    b_with_passive = Build(hero="Yena", level=15, active_combo_slots=["Skill 1", "Skill 2", "Ultimate", "Passive"])
    burst_no = engine.burst(b_no_passive, target)
    burst_pass = engine.burst(b_with_passive, target)
    assert burst_pass > burst_no
    # Check difference is exactly the passive damage
    skills = engine.skill_damage(engine.build_stats(b_no_passive), target, b_no_passive)
    passive_dmg = next(s["final_damage"] for s in skills if s["slot"] == "Passive")
    assert abs((burst_pass - burst_no) - passive_dmg) < 0.01


def test_liliana_and_edras_alternate_form_levels(engine):
    b_lil = Build(hero="Liliana", level=15)
    s_lil = engine.build_stats(b_lil)
    rows_lil = {r["slot"]: r for r in engine.skill_damage(s_lil, s_lil, b_lil)}
    assert rows_lil["Skill 3"]["skill_level"] == 3
    assert rows_lil["Skill 4"]["skill_level"] == 6
    assert rows_lil["Skill 5"]["skill_level"] == 6
    assert rows_lil["Skill 4"]["raw_damage"] == pytest.approx(450.0)
    assert rows_lil["Skill 5"]["raw_damage"] == pytest.approx(700.0)

    b_edras = Build(hero="Edras", level=15)
    s_edras = engine.build_stats(b_edras)
    rows_edras = {r["slot"]: r for r in engine.skill_damage(s_edras, s_edras, b_edras)}
    assert rows_edras["Skill 2 (Berserker Mode)"]["skill_level"] == 6
    assert rows_edras["Skill 2 (Berserker Mode)"]["final_damage"] > 0
    assert rows_edras["Ultimate (Berserker Mode)"]["skill_level"] == 3
    assert rows_edras["Ultimate (Berserker Mode)"]["final_damage"] > 0
    assert rows_edras["Skill 1"]["has_charge"] is True
    assert rows_edras["Ultimate"]["has_charge"] is True


def test_small_pct_and_extended_scalings(engine):
    b_nat = Build(hero="Natalya", level=15, items=["Rhea's Blessing"])
    s_nat = engine.build_stats(b_nat)
    rows_nat = {r["slot"]: r for r in engine.skill_damage(s_nat, s_nat, b_nat)}
    ap = s_nat["stats"]["ability_power"]
    assert rows_nat["Passive"]["raw_damage"] == pytest.approx(11.0 + 0.02 * ap, abs=0.2)

    b_ata = Build(hero="Ata", level=15)
    s_ata = engine.build_stats(b_ata)
    rows_ata = {r["slot"]: r for r in engine.skill_damage(s_ata, s_ata, b_ata)}
    assert rows_ata["Skill 1"]["components"]["own_hp"] == pytest.approx(0.10 * s_ata["stats"]["max_hp"], abs=0.2)

    b_bal = Build(hero="Baldum", level=15, items=["Mail of Pain"])
    s_bal = engine.build_stats(b_bal)
    rows_bal = {r["slot"]: r for r in engine.skill_damage(s_bal, s_bal, b_bal)}
    assert rows_bal["Skill 1"]["components"]["armor"] == pytest.approx(0.30 * 300.0, abs=0.2)

    b_rourke = Build(hero="Rourke", level=15)
    s_rourke = engine.build_stats(b_rourke)
    rows_rourke = {r["slot"]: r for r in engine.skill_damage(s_rourke, s_rourke, b_rourke)}
    assert rows_rourke["Ultimate"]["warnings"] == []


def test_procs_include_defender_damage_taken_pct(engine):
    b_atk = Build(hero="Valhein", level=15, primary_faction="Veda", primary_enchantments=["Holy Thunder"])
    b_def_normal = Build(hero="Toro", level=15)
    b_def_axe = Build(hero="Toro", level=15, primary_faction="Veda", primary_enchantments=["Axe of Sacrifice"])
    s_atk = engine.build_stats(b_atk)
    p_norm = engine._procs(s_atk, b_atk, engine.build_stats(b_def_normal))[0]["damage"]
    p_axe = engine._procs(s_atk, b_atk, engine.build_stats(b_def_axe))[0]["damage"]
    assert p_axe == pytest.approx(p_norm * 1.01, rel=1e-4)


def test_all_130_heroes_have_zero_skill_warnings(engine):
    target = engine.build_stats(Build(hero="Toro", level=15))
    for hero_name in engine.level_stats:
        build = Build(hero=hero_name, level=15)
        stats = engine.build_stats(build)
        skills = engine.skill_damage(stats, target, build)
        assert len(skills) >= 4
        for sk in skills:
            assert sk["warnings"] == [], f"{hero_name} {sk['slot']} has warnings: {sk['warnings']}"

    # Specifically verify Tamyn's Passive does not add own_hp as physical damage
    b_tamyn = Build(hero="Tamyn", level=15)
    s_tamyn = engine.build_stats(b_tamyn)
    tamyn_passive = next(s for s in engine.skill_damage(s_tamyn, target, b_tamyn) if s["slot"] == "Passive")
    assert "own_hp" not in tamyn_passive["components"]


def test_duel_respects_active_combo_slots_for_passives(engine):
    target = Build(hero="Toro", level=15)
    # 1. Yena in Combined-Blade preset (no 'Passive' in active_combo_slots) should not proc Lunar Phase
    yena_combined = Build(hero="Yena", level=15, active_combo_slots=["Skill 3", "Skill 4", "Skill 5"])
    res_yena = engine.duel(yena_combined, target)
    assert "Lunar Phase (Passive)" not in res_yena["simulation"]["a"]["damage_breakdown"]

    # 2. Edras in Berserker preset (with 'Passive (Berserker Mode)' in active_combo_slots) casts it in duel
    edras_berserker = Build(
        hero="Edras",
        level=15,
        active_combo_slots=["Skill 2 (Berserker Mode)", "Ultimate (Berserker Mode)", "Passive (Berserker Mode)"],
    )
    res_edras = engine.duel(edras_berserker, target)
    edras_passive_name = next(s["name"] for s in res_edras["a"]["skills"] if s["slot"] == "Passive (Berserker Mode)")
    assert edras_passive_name in res_edras["simulation"]["a"]["damage_breakdown"]
    assert res_edras["simulation"]["a"]["damage_breakdown"][edras_passive_name] > 0


def test_arcana_aliases_resolution(engine):
    build = Build(hero="Valhein", level=1, arcana={"Guerrilla": 5, "Spirit": 5, "Skewer": 10})
    res = engine.build_stats(build)
    assert "Spirit" in build.arcana
    assert build.arcana["Spirit"] == 10
    assert "Dragon's Claw" in build.arcana
    assert build.arcana["Dragon's Claw"] == 10
    assert res["sources"]["arcana"]["armor_pierce_flat"] == pytest.approx(64.0)
    assert res["sources"]["arcana"]["movement_speed_pct"] == pytest.approx(10.0)


def test_claves_sancti_stats(engine):
    build1 = Build(hero="Valhein", level=15, items=["Claves Sancti"])
    res1 = engine.build_stats(build1)
    assert res1["stats"]["critical_chance"] >= 25.0
    assert res1["stats"]["critical_damage"] >= 240.0  # Base 200 + 40

    # Duplicate Claves Sancti should stack AD, but NOT unique crit chance/damage passives
    build2 = Build(hero="Valhein", level=15, items=["Claves Sancti", "Claves Sancti"])
    res2 = engine.build_stats(build2)
    assert res2["stats"]["attack_damage"] == res1["stats"]["attack_damage"] + 100.0
    assert res2["stats"]["critical_chance"] == res1["stats"]["critical_chance"]
    assert res2["stats"]["critical_damage"] == res1["stats"]["critical_damage"]


def test_recommend_matchup_runes_all_lanes(engine):
    # DSL Matchup: Omen vs Biron (flips from draw/loss to win)
    r_dsl = engine.recommend_matchup_runes(my_hero="Omen", enemy_hero="Biron", lane="DS_Lane", level=2)
    assert r_dsl["my_hero"] == "Omen"
    assert r_dsl["enemy_hero"] == "Biron"
    assert r_dsl["hp_advantage"] > 0
    assert r_dsl["recommended_preset"]["winner"] == "a"
    assert len(r_dsl["detailed_runes"]) >= 3

    # DSL Matchup vs True Damage: Skud vs Florentino
    r_flo = engine.recommend_matchup_runes(my_hero="Skud", enemy_hero="Florentino", lane="DS_Lane", level=2)
    assert "Anti-True Damage" in r_flo["recommended_preset"]["name"] or "Bulk" in r_flo["recommended_preset"]["name"]
    assert r_flo["hp_advantage"] >= 500

    # ADL Matchup: Violet vs Hayate
    r_adl = engine.recommend_matchup_runes(my_hero="Violet", enemy_hero="Hayate", lane="Dragon_Lane", level=2)
    assert r_adl["my_hero"] == "Violet"
    assert r_adl["recommended_preset"]["winner"] == "a"

    # MID Matchup: Tulen vs Liliana
    r_mid = engine.recommend_matchup_runes(my_hero="Tulen", enemy_hero="Liliana", lane="Mid", level=2)
    assert r_mid["my_hero"] == "Tulen"
    assert "Magic" in r_mid["standard_preset"]["name"]


def test_thai_canonical_arcana_names(engine):
    assert "Desolate" in engine.arcana
    assert "Sword" in engine.arcana
    assert "Rage" in engine.arcana
    assert "Purity" in engine.arcana
    assert "Mythril" in engine.arcana
    assert "Prowess" in engine.arcana
    assert "Dragon's Claw" in engine.arcana
    assert "Golden Body" in engine.arcana

    # Aliases resolve to canonical
    build = Build(hero="Valhein", level=1, arcana={"Violate": 5, "Desolate": 5, "Hex": 10})
    res = engine.build_stats(build)
    assert build.arcana["Desolate"] == 10
    assert build.arcana["Purity"] == 10
    assert res["sources"]["arcana"]["magic_pierce_flat"] == pytest.approx(24.0)
    assert res["sources"]["arcana"]["cooldown_reduction"] == pytest.approx(10.0)


def test_ranged_carry_kites_melee_tank(engine):
    # Ranged Carry (Hayate) kites Melee Tank (Toro) when kiting is enabled
    for level in (4, 15):
        res = engine.duel(Build(hero="Toro", level=level), Build(hero="Hayate", level=level))
        sim = res["simulation"]
        assert sim["winner"] == "b"
        assert sim["a"]["kiting"]["initial_delay"] > 0.0
        assert sim["a"]["kiting"]["interval_multiplier"] > 1.0
        assert sim["b"]["kiting"] == {"initial_delay": 0.0, "interval_multiplier": 1.0}

    # Disabling kiting turns off kiting penalties for both sides
    no_kite = engine.duel(
        Build(hero="Toro", level=15, enable_kiting=False),
        Build(hero="Hayate", level=15, enable_kiting=False),
    )["simulation"]
    assert no_kite["a"]["kiting"] == {"initial_delay": 0.0, "interval_multiplier": 1.0}
    assert no_kite["b"]["kiting"] == {"initial_delay": 0.0, "interval_multiplier": 1.0}

    # Hayate multi-hit skill defaults scale automatically across 0% / 75% / 150% AS thresholds
    toro_lv15 = engine.build_stats(Build(hero="Toro", level=15))
    b_low = Build(hero="Hayate", level=15)
    b_mid = Build(hero="Hayate", level=15, items=["War Boots", "Blitz Blade", "Slikk's Sting"])
    b_high = Build(
        hero="Hayate",
        level=15,
        items=["War Boots", "Fafnir's Talon", "Blitz Blade", "Claves Sancti", "Slikk's Sting", "Hyoga's Edge"],
        arcana={"Awake": 10, "Spirit": 10, "Dragon's Claw": 10},
    )

    for build, expected_s1, expected_ult in ((b_low, 5, 10), (b_mid, 7, 13), (b_high, 9, 16)):
        att = engine.build_stats(build)
        slots = {s["slot"]: s["hits"] for s in engine.skill_damage(att, toro_lv15, build)}
        assert slots["Skill 1"] == expected_s1
        assert slots["Ultimate"] == expected_ult

    # Explicit skill_hits overrides remain respected
    b_override = Build(hero="Hayate", level=15, skill_hits={"Skill 1": 3})
    override_slots = {
        s["slot"]: s["hits"] for s in engine.skill_damage(engine.build_stats(b_override), toro_lv15, b_override)
    }
    assert override_slots["Skill 1"] == 3


def test_phase1_verified_hero_stats(engine):
    wukong = engine.build_stats(Build(hero="Wukong", level=15))["stats"]
    assert wukong["critical_chance"] == pytest.approx(22.0)
    assert wukong["critical_damage"] == pytest.approx(175.0)

    quillen = engine.build_stats(Build(hero="Quillen", level=15))["stats"]
    assert quillen["critical_damage"] == pytest.approx(125.0)

    for non_mana_hero in ("Florentino", "Allain", "Charlotte"):
        st = engine.build_stats(Build(hero=non_mana_hero, level=15))["stats"]
        assert st["max_mana"] == 0.0
        assert st["mana_regen_5s"] == 0.0
    assert engine.build_stats(Build(hero="Keera", level=15))["stats"]["max_mana"] == pytest.approx(2060.0)

    hayate = engine.build_stats(Build(hero="Hayate", level=15))["stats"]
    assert hayate["attack_speed"] == pytest.approx(49.0)
    toro = engine.build_stats(Build(hero="Toro", level=15))["stats"]
    assert toro["hp_regen_5s"] > 0.0


def test_phase2_item_passives_dedup_and_omni_warning(engine):
    # Duplicate boots warn and MS only counts once; Magic Ring CDR deduplicates
    dup_boots = engine.build_stats(
        Build(hero="Toro", level=15, items=["Hermes' Select", "Hermes' Select", "Magic Ring", "Magic Ring"])
    )
    assert any("รองเท้า" in w for w in dup_boots["item_warnings"])
    assert dup_boots["sources"]["items"]["cooldown_reduction"] == pytest.approx(5.0)

    # Sonic Boots physical damage reduction (-10%)
    sonic = engine.build_stats(Build(hero="Toro", level=15, items=["Sonic Boots"]))["stats"]
    assert sonic["physical_damage_taken_pct"] == pytest.approx(-10.0)

    # AP scaling items: Holy of Holies, Hecate's Diadem, Frostguard, Mage Robe, Rhea's Blessing
    ap_combo = engine.build_stats(
        Build(
            hero="Tulen",
            level=15,
            items=[
                "Orb of the Magi",
                "Hecate's Diadem",
                "Holy of Holies",
                "Frostguard",
                "Mage Robe",
                "Rhea's Blessing",
            ],
        )
    )
    assert ap_combo["stats"]["ability_power"] > 1200.0
    assert ap_combo["stats"]["magic_life_steal"] == pytest.approx(25.0)
    assert ap_combo["sources"]["items"]["cooldown_reduction"] >= 12.5
    assert ap_combo["stats"]["damage_dealt_pct"] > 5.0
    assert ap_combo["sources"]["items"]["armor"] >= 200.0

    # Omni Arms reports unverified Five Forces AD bonus honestly
    omni = engine.build_stats(Build(hero="Violet", level=15, items=["Omni Arms"]))
    assert any("Omni Arms" in w for w in omni["item_warnings"])


def test_phase2_duel_passives_actives_and_enchantments(engine):
    # Medallion of Troy + Blade of Eternity + Rock Shield vs high AD attacker; enable_actives=False toggles Rock Shield/Mail of Pain active
    defender_on = Build(
        hero="Toro",
        level=15,
        items=["Medallion of Troy", "Mail of Pain", "Rock Shield", "Blade of Eternity", "Shield of the Lost"],
        primary_faction="Veda",
        primary_enchantments=["Sacred Bead", "Holy Verdict", "Sacred Protection"],
        secondary_faction="Afata",
        secondary_enchantments=["River Treader", "Vital Aid"],
        enable_actives=True,
    )
    defender_off = Build(
        hero="Toro",
        level=15,
        items=list(defender_on.items),
        primary_faction="Veda",
        primary_enchantments=list(defender_on.primary_enchantments),
        secondary_faction="Afata",
        secondary_enchantments=list(defender_on.secondary_enchantments),
        enable_actives=False,
    )
    attacker = Build(
        hero="Allain",
        level=15,
        items=["Fafnir's Talon", "Blitz Blade", "Death Sickle", "Fenrir's Tooth"],
        primary_faction="Lokheim",
        primary_enchantments=["Shadow Blade", "Deadly Claw", "Desperate Duel"],
        secondary_faction="Afata",
        secondary_enchantments=["River Treader", "Vital Aid"],
    )

    st_def = engine.build_stats(defender_on)
    for ename in ("Sacred Protection", "Vital Aid"):
        assert ename in st_def["enchantments_modeled"]

    res_on = engine.duel(defender_on, attacker)
    res_off = engine.duel(defender_off, attacker)
    assert "Mail of Pain (Reflect)" in res_on["simulation"]["a"]["damage_breakdown"]
    assert res_on["simulation"]["a"]["damage_dealt"] > res_off["simulation"]["a"]["damage_dealt"]
    assert "Fafnir's Talon" in res_on["simulation"]["b"]["damage_breakdown"]

    # Afata Regrowth + Nature's Rage + Lokheim Bone Cutter
    mage = Build(
        hero="Krixi",
        level=15,
        items=["Apocalypse"],
        primary_faction="Afata",
        primary_enchantments=["River Treader", "Regrowth", "Nature's Rage"],
        secondary_faction="Lokheim",
        secondary_enchantments=["Bone Cutter"],
    )
    st_mage = engine.build_stats(mage)
    assert st_mage["sources"]["enchantments"]["resistance"] == pytest.approx(12.5)
    assert "Regrowth" in st_mage["enchantments_modeled"]
    assert "Nature's Rage" in st_mage["enchantments_modeled"]
    d_mage = engine.duel(mage, defender_off)
    assert (
        "Nature's Rage Burn" in d_mage["simulation"]["a"]["damage_breakdown"]
        or "Apocalypse (Spellblade)" in d_mage["simulation"]["a"]["damage_breakdown"]
    )


def test_phase3_skills_charges_cdr_cap_and_lane_validation(engine):
    # Bonnie S1 has recharge_cooldown and multi-charge support
    bonnie = Build(hero="Bonnie", level=15, items=["Orb of the Magi"])
    bonnie_skills = {
        s["slot"]: s
        for s in engine.skill_damage(
            engine.build_stats(bonnie), engine.build_stats(Build(hero="Toro", level=15)), bonnie
        )
    }
    assert bonnie_skills["Skill 1"]["recharge_cooldown"] is not None
    assert bonnie_skills["Skill 1"]["recharge_cooldown"] > 0

    # Ultimate CDR stays strictly capped at 40% even with Sacred Bead + 40% CDR items
    sacred_max = Build(
        hero="Tulen",
        level=15,
        items=["Flashy Boots", "Boomstick", "Berith's Agony", "Hecate's Diadem"],
        primary_faction="Veda",
        primary_enchantments=["Sacred Bead"],
        arcana={"Purity": 10},
    )
    st = engine.build_stats(sacred_max)
    ult = [
        s
        for s in engine.skill_damage(st, engine.build_stats(Build(hero="Toro", level=15)), sacred_max)
        if s["slot"] == "Ultimate"
    ][0]
    assert ult["cooldown"] == pytest.approx(round(ult["base_cooldown"] * 0.60, 2), abs=0.05)

    # Lane validation on recommend_matchup_runes
    with pytest.raises(ValueError, match="Unknown lane"):
        engine.recommend_matchup_runes("Omen", "Biron", lane="InvalidLane", level=2)


def test_soaring_aura_no_static_pierce_and_dynamic_cap(engine):
    # Soaring Aura grants 10-24 flat pierce per stack dynamically (never statically at 0 stacks)
    res_aura = engine.build_stats(Build(hero="Krixi", level=15, items=["Soaring Aura"]))
    assert res_aura["stats"]["magic_pierce_flat"] == 0.0

    res_evil = engine.build_stats(Build(hero="Krixi", level=15, items=["Spooky Mask"]))
    assert res_evil["stats"]["magic_pierce_flat"] == 75.0

    # Static pierce comes only from Spooky Mask (no double-counting Soaring Aura stacks)
    res_both = engine.build_stats(Build(hero="Krixi", level=15, items=["Spooky Mask", "Soaring Aura"]))
    assert res_both["stats"]["magic_pierce_flat"] == 75.0


def test_unlearned_skill_zeroes_hp_pct_scaling(engine):
    target = engine.build_stats(Build(hero="Toro", level=15))

    allain_lv1 = Build(hero="Allain", level=1, skill_levels={"Skill 1": 1, "Skill 2": 0, "Ultimate": 0})
    allain_skills = {s["slot"]: s for s in engine.skill_damage(engine.build_stats(allain_lv1), target, allain_lv1)}
    assert allain_skills["Ultimate"]["skill_level"] == 0
    assert allain_skills["Ultimate"]["target_current_hp_pct"] == 0.0
    assert allain_skills["Ultimate"]["target_lost_hp_pct"] == 0.0

    bf_lv1 = Build(hero="Butterfly", level=1, skill_levels={"Skill 1": 1, "Skill 2": 0, "Ultimate": 0})
    bf_skills = {s["slot"]: s for s in engine.skill_damage(engine.build_stats(bf_lv1), target, bf_lv1)}
    assert bf_skills["Ultimate"]["skill_level"] == 0
    assert bf_skills["Ultimate"]["target_lost_hp_pct"] == 0.0


def test_stasis_invuln_revive_pending_and_death_sickle_duel(engine):
    from src.combat_calculator import _emit_damage, _init_sim_side

    def _side(build: Build, opp_build: Build) -> dict:
        st = engine.build_stats(build)
        opp_st = engine.build_stats(opp_build)
        return _init_sim_side(
            st,
            [],
            engine.basic_attack(st, opp_st),
            [],
            (0.0, 1.0),
            {"items": list(build.items), "level": build.level, "enable_actives": True},
        )

    t = 1.0
    target_b = Build(hero="Toro", level=15, items=[])

    # 1. Death Sickle sets invuln_until without stasis_until -> holder can still normal-attack
    ds_b = Build(hero="Hayate", level=15, items=["Death Sickle"])
    ds_holder = _side(ds_b, target_b)
    target = _side(target_b, ds_b)
    ds_holder["opp_items"] = target["items"]
    target["opp_items"] = ds_holder["items"]
    target["hp"] = 5000.0
    ds_holder["hp"] = 100.0
    assert _emit_damage(target, ds_holder, "Skill 1", 5000.0, "physical", t, is_skill=True) is True
    assert ds_holder["hp"] == pytest.approx(1.0)
    assert ds_holder["invuln_until"] > t
    assert ds_holder["stasis_until"] <= t
    assert _emit_damage(ds_holder, target, "Basic Attack", 300.0, "physical", t + 0.2, is_attack=True) is True

    # 2. Arctic Orb triggers stasis_until + invuln_until -> blocks both incoming & outgoing active hits
    ao_b = Build(hero="Tulen", level=15, items=["Arctic Orb"])
    ao_holder = _side(ao_b, target_b)
    ao_target = _side(target_b, ao_b)
    ao_holder["opp_items"] = ao_target["items"]
    ao_target["opp_items"] = ao_holder["items"]
    ao_holder["hp"] = ao_holder["max_hp"] * 0.20
    assert _emit_damage(ao_target, ao_holder, "Basic Attack", 50.0, "physical", t, is_attack=True) is True
    assert ao_holder["stasis_until"] > t
    assert _emit_damage(ao_holder, ao_target, "Skill 1", 500.0, "magic", t + 0.5, is_skill=True) is False
    dealt_before = ao_target["dealt"]
    assert _emit_damage(ao_target, ao_holder, "Basic Attack", 500.0, "physical", t + 0.5, is_attack=True) is False
    assert ao_target["dealt"] == dealt_before

    # 3. Blade of Eternity pending corpse blocks dealing/recording damage in both directions
    boe_b = Build(hero="Valhein", level=15, items=["Blade of Eternity"])
    boe_holder = _side(boe_b, target_b)
    boe_target = _side(target_b, boe_b)
    boe_holder["opp_items"] = boe_target["items"]
    boe_target["opp_items"] = boe_holder["items"]
    boe_holder["hp"] = 50.0
    assert _emit_damage(boe_target, boe_holder, "Basic Attack", 5000.0, "physical", t, is_attack=True) is True
    assert boe_holder["revive_pending_until"] is not None
    assert _emit_damage(boe_holder, boe_target, "Basic Attack", 500.0, "physical", t + 0.5, is_attack=True) is False
    assert _emit_damage(boe_target, boe_holder, "Skill 1", 500.0, "magic", t + 0.5, is_skill=True) is False


def test_charlotte_passive_final_hit_lost_hp_not_multiplied_by_7(engine):
    b_att = Build(hero="Charlotte", level=15)
    b_def = Build(hero="Thane", level=15)
    st_att = engine.build_stats(b_att)
    st_def = engine.build_stats(b_def)
    row_full = engine.skill_damage(st_att, st_def, b_att, target_hp_ratio=1.0)[0]
    row_half = engine.skill_damage(st_att, st_def, b_att, target_hp_ratio=0.5)[0]
    assert row_half["hits"] == 7
    expected_execute = 0.15 * st_def["stats"]["max_hp"] * 0.5
    assert row_half["components"]["target_lost_hp"] == pytest.approx(expected_execute, abs=0.2)
    assert (row_half["raw_damage"] - row_full["raw_damage"]) == pytest.approx(expected_execute, abs=0.5)


def test_hero_passives_and_zero_dmg_skill_mechanics(engine):
    # 1. Omen with On-Hit build + Thirst + Untouchable (60% DR) + Ult (-20% opp dmg) beats Bijan across stages
    omen_b = Build(
        hero="Omen",
        level=15,
        items=["War Boots", "Fafnir's Talon", "Blitz Blade", "Shield of the Lost", "Medallion of Troy", "Mail of Pain"],
        arcana={"Awake": 10, "Spirit": 10, "Dragon's Claw": 10},
    )
    bijan_b = Build(
        hero="Bijan",
        level=15,
        items=[
            "Sonic Boots",
            "Spear of Longinus",
            "Frost Cape",
            "Medallion of Troy",
            "Mail of Pain",
            "Blade of Eternity",
        ],
        arcana={"Onslaught": 10, "Assassinate": 10, "Dragon's Claw": 10},
    )
    res_ob = engine.duel(omen_b, bijan_b)
    assert res_ob["simulation"]["winner"] == "a"
    assert "Thirst (Passive True)" in res_ob["simulation"]["a"]["damage_breakdown"]
    assert "Untouchable (Reflect)" in res_ob["simulation"]["a"]["damage_breakdown"]

    # 2. Stuart S2 Physical Immunity blocks physical damage while allowing magic damage
    stuart_b = Build(hero="Stuart", level=15, items=["War Boots", "Claves Sancti"])
    phys_attacker = Build(hero="Eland'orr", level=15, items=["War Boots"])
    magic_attacker = Build(hero="Tulen", level=15, items=["Boomstick", "Hecate's Diadem"])
    res_stuart_vs_phys = engine.duel(stuart_b, phys_attacker)
    res_stuart_vs_mag = engine.duel(stuart_b, magic_attacker)
    assert res_stuart_vs_phys["simulation"]["winner"] == "a"
    assert res_stuart_vs_mag["simulation"]["b"]["damage_dealt"] > 0

    # 3. Taara Ultimate HoT heals significantly and Max Static Shock applies anti-heal + True Damage DoT
    taara_b = Build(hero="Taara", level=15, items=["Mantle of Ra", "Shield of the Lost"])
    max_b = Build(hero="Max", level=15, items=["Sonic Boots", "Frost Cape"])
    res_tm = engine.duel(taara_b, max_b)
    assert "Static Shock (Passive)" in res_tm["simulation"]["b"]["damage_breakdown"]


def test_full_130_hero_skill_mechanics_coverage(engine):
    from src.combat_calculator import ACTIVE_SLOTS, HERO_SKILL_EFFECTS, _calc_live_damage, _init_sim_side, _take_damage

    def _make_side(build, opp_build):
        st = engine.build_stats(build)
        opp_st = engine.build_stats(opp_build)
        sks = engine._sim_skills_for(engine.skill_damage(st, opp_st, build), set(ACTIVE_SLOTS), build.hero)
        return _init_sim_side(
            st,
            sks,
            engine.basic_attack(st, opp_st),
            [],
            (0.0, 1.0),
            {"items": list(build.items), "level": build.level, "enable_actives": True},
        )

    # 1. Auto-extracted + curated effects cover all shields/heals/buffs/resets across 130 heroes
    assert len(HERO_SKILL_EFFECTS) >= 120
    assert len(engine.skills) == 130

    # 2. Yue > Ilumia: Borrowed Might + 2x sweet spot + poke-mage spacing beats immobile Ilumia
    res_yi = engine.duel(Build(hero="Yue", level=15), Build(hero="Ilumia", level=15))
    sim_yi = res_yi["simulation"]
    assert sim_yi["winner"] == "a"
    assert sim_yi["b"]["kiting"]["initial_delay"] > sim_yi["a"]["kiting"]["initial_delay"]

    # 3. Thane Royal Power triggers < 30% HP (40% DR + 24% Max HP HoT, 75s CD)
    thane_b = Build(hero="Thane", level=15)
    mal_b = Build(hero="Maloch", level=15)
    t_side = _make_side(thane_b, mal_b)
    m_side = _make_side(mal_b, thane_b)
    t_side["hp"] = 0.25 * t_side["max_hp"]
    _take_damage(t_side, m_side, 100.0, "physical", 1.0)
    assert t_side["hero_dr_pct"] >= 0.40
    assert t_side["hero_dr_until"] == pytest.approx(5.0)
    assert len(t_side["hots"]) >= 1

    # 4. Zephys missing-HP Damage Reduction scales down incoming damage when wounded
    zeph_b = Build(hero="Zephys", level=15)
    z_side = _make_side(zeph_b, mal_b)
    dmg_full = _calc_live_damage(m_side, z_side, 1000.0, "physical", 1.0)
    z_side["hp"] = 0.10 * z_side["max_hp"]
    dmg_low = _calc_live_damage(m_side, z_side, 1000.0, "physical", 1.0)
    assert dmg_low < dmg_full * 0.72

    # 5. Dirak Arcane Body spends Mana (1.5 dmg per 1 Mana) to survive lethal overflow
    dirak_b = Build(hero="Dirak", level=15)
    d_side = _make_side(dirak_b, mal_b)
    start_mana = d_side["dirak_mana"]
    assert start_mana > 500.0
    d_side["hp"] = 100.0
    _take_damage(d_side, m_side, 400.0, "true", 1.0)  # 300 overflow consumes 200 mana
    assert d_side["hp"] == pytest.approx(1.0)
    assert d_side["dirak_mana"] == pytest.approx(start_mana - 200.0)

    # 6. Maloch Plunder true-damage Cleave deals true damage in simulation
    res_tm = engine.duel(Build(hero="Maloch", level=15), Build(hero="Thane", level=15))
    assert res_tm["simulation"]["winner"] == "a"
    assert res_tm["simulation"]["a"]["damage_breakdown"].get("Cleave", 0.0) > 2000.0
