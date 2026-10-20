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


def test_alternate_form_skills_use_ingame_slot_level(engine):
    build = Build(hero="Yena", level=15)
    atk = engine.build_stats(build)
    rows = {r["slot"]: r for r in engine.skill_damage(atk, atk, build)}
    levels = engine.skill_levels_for(build)
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
    assert "Sacred Protection" in res["enchantments_unmodeled"]
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
