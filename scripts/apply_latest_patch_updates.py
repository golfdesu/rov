# Apply latest balance adjustments from Beta 55 & 10.15 Hotfix
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS_JSON = ROOT / "data" / "hero_skills_full.json"
HEROES_JSON = ROOT / "data" / "heroes_130_full.json"


def main():
    with open(SKILLS_JSON, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    heroes = catalog["heroes"]

    # 1. Preyta Rework
    heroes["Preyta"] = [
        {
            "name": "Toxic Mutation",
            "slot": "Passive",
            "type": "Magic",
            "damage_type": "magic",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {"ap_pct": 20.0},
            "description": "Preyta's skills inflict Plague stacks on enemies on hit. Plague deals continuous magic damage and detonates upon reaching 3 stacks, dealing AoE magic damage. Preyta also gains Plague Energy when his skills hit enemy heroes or kill minions/monsters, permanently increasing his AP and evolving his skills.",
        },
        {
            "name": "Plague Enchanting",
            "slot": "Skill 1",
            "type": "Magic Area Damage",
            "damage_type": "magic",
            "cooldown": [8.0, 7.6, 7.2, 6.8, 6.4, 6.0],
            "mana_cost": [60, 65, 70, 75, 80, 85],
            "base_damage": [250, 300, 350, 400, 450, 500],
            "scaling": {"ap_pct": 50.0},
            "description": "Preyta enhances himself, gaining an enhanced normal attack state for 4s with increased attack speed, attack range, and movement speed. Every third normal attack deals area magic damage. (At 25 Plague Energy: all normal attacks during the enhanced state deal area magic damage.)",
        },
        {
            "name": "Putrid Virus",
            "slot": "Skill 2",
            "type": "Magic Control",
            "damage_type": "magic",
            "cooldown": [11.0, 10.4, 9.8, 9.2, 8.6, 8.0],
            "mana_cost": [70, 75, 80, 85, 90, 95],
            "base_damage": [250, 300, 350, 400, 450, 500],
            "scaling": {"ap_pct": 50.0},
            "description": "Preyta casts magic at the target location, dealing magic damage and slowing enemies hit. After 1s, it detonates again, dealing magic damage and knocking up enemies. (At 75 Plague Energy: skill range is increased.)",
        },
        {
            "name": "Lethal Pathogen",
            "slot": "Ultimate",
            "type": "Magic Area Damage",
            "damage_type": "magic",
            "cooldown": [35.0, 30.0, 25.0],
            "mana_cost": [100, 120, 140],
            "base_damage": [400, 600, 800],
            "scaling": {"ap_pct": 75.0},
            "description": "Preyta channels Plague Energy in the target direction, then releases 3 waves of shockwaves forward, dealing magic damage. Shockwave range increases with charge time up to 1800. Moving or recasting unleashes the shockwaves immediately. (At 145 Plague Energy: can move and cast simultaneously.)",
        },
    ]

    # 2. Dirak (Skill 4 Genesis Blast split out)
    heroes["Dirak"] = [
        {
            "name": "Magic Body",
            "slot": "Passive",
            "type": "Special",
            "damage_type": "none",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {},
            "description": "Dirak does not die when his HP reaches 0. Instead, he uses Mana to block incoming damage. Each 1.5 damage blocked consumes 1 Mana.",
        },
        {
            "name": "Astroblade",
            "slot": "Skill 1",
            "type": "Magic Area Damage",
            "damage_type": "magic",
            "cooldown": [8.0, 7.4, 6.8, 6.2, 5.6, 5.0],
            "mana_cost": [60, 65, 70, 75, 80, 85],
            "base_damage": [100],
            "scaling": {"ap_pct": 20.0},
            "description": "Dirak summons a moving orb within 0.6s that knocks back enemies, dealing 100 (+20% AP) magic damage to heroes every 0.2s. Restores 1% max mana when damaging heroes. Recastable immediately on marked targets.",
        },
        {
            "name": "Fallen Star",
            "slot": "Skill 2",
            "type": "Magic Knock Back",
            "damage_type": "magic",
            "cooldown": [12.5, 12.0, 11.5, 11.0, 10.5, 10.0],
            "mana_cost": [120],
            "base_damage": [200, 240, 280, 320, 360, 400],
            "scaling": {"ap_pct": 25.0},
            "description": "Dirak creates a circle at target area, launching 3 orbs that knock back enemies and deal magic damage. If Skill 2 lands within Skill 1 inner circle, it falls immediately. Falling orbs stun targets and place marks.",
        },
        {
            "name": "Genesis Barrier",
            "slot": "Ultimate",
            "type": "Magic Barrier",
            "damage_type": "magic",
            "cooldown": [80.0, 75.0, 70.0],
            "mana_cost": [100, 120, 140],
            "base_damage": [],
            "scaling": {"ad_pct": 50.0, "ap_pct": 25.0},
            "description": "Dirak creates a magic barrier that blocks all enemy projectiles. Increases attack speed by 25% and enhances normal attacks, dealing (+50% AD) (+25% AP) magic damage. Absorbing projectiles restores 2% max HP and mana.",
        },
        {
            "name": "Genesis Blast",
            "slot": "Skill 4",
            "type": "Magic Direct DMG",
            "damage_type": "magic",
            "cooldown": [50.0, 45.0, 40.0],
            "mana_cost": [90, 95, 100],
            "base_damage": [500, 750, 1000],
            "scaling": {"ap_pct": 80.0},
            "description": "Dirak fires a powerful beam of Genesis energy in a straight line, dealing 500/750/1000 (+80% AP) magic damage to enemies and slash damage equal to 15% of the target's lost HP.",
        },
    ]

    def get_skill(hero_name, slot):
        for s in heroes[hero_name]:
            if s["slot"] == slot:
                return s
        raise ValueError(f"{hero_name} missing {slot}")

    # 3. Wukong
    w_p = get_skill("Wukong", "Passive")
    w_p["base_damage"] = [450]
    w_p["scaling"]["ad_pct"] = 100.0
    w_p["description"] = (
        "Each ability cast grants an enhanced normal attack that leaps to target, "
        "dealing 450 (+100% AD) physical damage. Wukong also has 12% inherent critical chance."
    )

    # 4. Errol
    e_p = get_skill("Errol", "Passive")
    if "stacks fall off one by one" not in e_p["description"]:
        e_p["description"] += " Passive stacks fall off one by one, each subsequent stack lasting 1s."

    # 5. Flowborn (Marksman)
    f_u = get_skill("Flowborn (Marksman)", "Ultimate")
    f_u["base_damage"] = [64, 96, 128]
    f_u["scaling"]["ad_pct"] = 26.0
    f_u["description"] = (
        "Flowborn fires a rapid barrage of arrows in a target direction, "
        "dealing 64/96/128 (+26% AD) physical damage per arrow."
    )

    # 6. Kriknak
    k_1 = get_skill("Kriknak", "Skill 1")
    k_1["base_damage"] = [325, 390, 455, 520, 585, 650]
    k_1["scaling"]["ad_pct"] = 150.0
    k_1["scaling"]["bonus_ad_pct"] = 150.0
    k_1["description"] = (
        "Kriknak summons larvae that attack the enemy, dealing 325/390/455/520/585/650 "
        "(+150% bonus AD) physical damage and marking them with Mark of the Plague."
    )

    # 7. Gildur
    g_2 = get_skill("Gildur", "Skill 2")
    g_2["base_damage"] = [350, 420, 490, 560, 630, 700]
    g_2["scaling"]["ap_pct"] = 50.0
    g_2["description"] = (
        "Gildur hurls gold forward, detonating on hit to deal 350/420/490/560/630/700 "
        "(+50% AP) magic damage and stunning targets for 1s. Leaves golden debris dealing "
        "35/42/49/56/63/70 (+5% AP) continuous magic damage."
    )
    g_u = get_skill("Gildur", "Ultimate")
    g_u["cooldown"] = [45.0, 40.0, 35.0]

    # 8. Zanis
    z_1 = get_skill("Zanis", "Skill 1")
    if "dashes to target" not in z_1["description"]:
        z_1["description"] += " Enhanced basic attack dashes to target, or dashes forward if no target."

    # 9. Raz
    r_1 = get_skill("Raz", "Skill 1")
    r_1["cooldown"] = [8.0, 7.7, 7.4, 7.1, 6.8, 6.5]
    r_2 = get_skill("Raz", "Skill 2")
    r_2["base_damage"] = [450, 540, 630, 720, 810, 900]
    r_2["scaling"]["ap_pct"] = 90.0
    r_2["description"] = (
        "Raz punches forward, dealing 450/540/630/720/810/900 (+90% AP) magic damage "
        "and reducing enemy magic defense by 100/120/140/160/180/200."
    )

    # 10. Yorn
    y_p = get_skill("Yorn", "Passive")
    y_p["base_damage"] = [28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56]
    y_p["scaling"]["target_hp_pct"] = 1.5
    y_p["description"] = (
        "Every fifth normal attack or after using an ability, Yorn unleashes a burst of 7 rapid-fire arrows. "
        "Each arrow deals physical damage plus 28~56 (+1.5% target max HP) against heroes."
    )
    y_1 = get_skill("Yorn", "Skill 1")
    if "vision" not in y_1["description"].lower():
        y_1["description"] += " Grants vision of targets hit."
    y_2 = get_skill("Yorn", "Skill 2")
    if "vision" not in y_2["description"].lower():
        y_2["description"] += " Reveals vision along the path; striking enemies reveals target and self vision."

    # 11. Brunhilda
    b_1 = get_skill("Brunhilda", "Skill 1")
    b_1["description"] = (
        "Brunhilda immediately gains an 80% movement speed boost that decays over 3 seconds. "
        "While active, passive Attack Damage bonus is doubled."
    )
    b_u = get_skill("Brunhilda", "Ultimate")
    b_u["cooldown"] = [20.0, 18.0, 16.0]

    # 12. Eland'orr
    el_p = get_skill("Eland'orr", "Passive")
    el_p["scaling"]["ad_pct"] = 35.0
    el_p["description"] = (
        "After casting a skill or recalling the Soul Lamp, normal attack bonus damage deals "
        "16~30 (+35% AD) magic damage and can critically strike."
    )

    # 13. Natalya
    n_2 = get_skill("Natalya", "Skill 2")
    n_2["base_damage"] = [100, 120, 140, 160, 180, 200]
    n_2["scaling"]["ap_pct"] = 15.0
    n_u = get_skill("Natalya", "Ultimate")
    n_u["base_damage"] = [100, 150, 200]
    n_u["scaling"]["ap_pct"] = 15.0

    # 14. Lauriel
    l_p = get_skill("Lauriel", "Passive")
    l_p["base_damage"] = [140]
    l_p["description"] = (
        "When Lauriel hits enemies with abilities, she applies marks that trigger an explosion dealing "
        "true damage, slowing enemies, and recovering 140 (+10/level) (+1% bonus HP) for Lauriel."
    )

    # 15. Aleister
    al_p = get_skill("Aleister", "Passive")
    al_p["base_damage"] = [84]
    al_p["scaling"]["ap_pct"] = 30.0
    al_p["description"] = (
        "Aleister's skills and basic attacks apply a curse mark. At 3 marks, it detonates dealing "
        "84 (+6*level) (+30% AP) true damage."
    )
    al_2 = get_skill("Aleister", "Skill 2")
    al_2["base_damage"] = [115, 138, 161, 184, 207, 230]
    al_2["scaling"]["ap_pct"] = 30.0

    # 16. Toro
    t_2 = get_skill("Toro", "Skill 2")
    t_2["base_damage"] = [180, 216, 252, 288, 324, 360]
    t_2["scaling"]["own_hp_pct"] = 3.5

    # 17. Baldum
    ba_2 = get_skill("Baldum", "Skill 2")
    ba_2["description"] = (
        "Baldum stomps the ground dealing physical damage and slowing enemies. "
        "Gains 2 stacks of damage reduction immediately upon activation: "
        "4/4.8/5.6/6.4/7.2/8 % damage reduction per stack, up to 5 stacks."
    )

    # 18. Krizzix
    kr_p = get_skill("Krizzix", "Passive")
    kr_p["base_damage"] = [235]
    kr_p["scaling"]["ap_pct"] = 55.0

    # 19. Ryoma
    ry_1 = get_skill("Ryoma", "Skill 1")
    ry_1["cooldown"] = [10.0, 9.6, 9.2, 8.8, 8.4, 8.0]
    ry_u = get_skill("Ryoma", "Ultimate")
    ry_u["cooldown"] = [12.5, 11.25, 10.0]
    ry_u["base_damage"] = [110, 165, 220]
    ry_u["scaling"]["ad_pct"] = 70.0

    # 20. Ata
    ata_p = get_skill("Ata", "Passive")
    ata_p["base_damage"] = [28]
    ata_p["scaling"]["own_hp_pct"] = 1.0
    ata_1 = get_skill("Ata", "Skill 1")
    ata_1["cooldown"] = [7.5, 7.2, 6.9, 6.6, 6.3, 6.0]
    ata_2 = get_skill("Ata", "Skill 2")
    ata_2["base_damage"] = [150, 180, 210, 240, 270, 300]
    ata_2["scaling"]["own_hp_pct"] = 6.0

    # 21. Amily
    am_2 = get_skill("Amily", "Skill 2")
    if "without a target" not in am_2["description"]:
        am_2["description"] += " Enhanced basic attack dashes forward even when cast without a target."

    # 22. Roxie
    rox_2 = get_skill("Roxie", "Skill 2")
    rox_2["base_damage"] = [180, 216, 252, 288, 324, 360]
    rox_2["scaling"]["ap_pct"] = 50.0
    rox_2["description"] = (
        "Roxie gains 20% movement speed and a shield of 250/300/350/400/450/500 (+8% max HP) for 3s, "
        "leaving a trail of flame that deals 180/216/252/288/324/360 (+50% AP) magic damage and slows enemies."
    )

    # 23. D'Arcy
    dar_2 = get_skill("D'Arcy", "Skill 2")
    if "Portal" not in dar_2["description"]:
        dar_2["description"] += (
            " If the center area is within Dimensional Portal, detonation time syncs with the Portal pull."
        )

    # 24. Astrid (In-game Rework)
    heroes["Astrid"] = [
        {
            "name": "Martial Soul",
            "slot": "Passive",
            "type": "Special",
            "damage_type": "none",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {},
            "desc_th": "Astrid โจมตีปกติ (ยกเว้นการโจมตีปกติพิเศษ) โดนศัตรูจะลดคูลดาวน์ของสกิล 1 และสกิล 2 (หากโดนมอนสเตอร์ป่า เอฟเฟกต์ลดคูลดาวน์จะลดลง 50%)",
            "description": "Astrid's normal attacks (except enhanced attacks) hitting enemies reduce the cooldown of Skill 1 and Skill 2 (50% reduction against jungle monsters).",
            "icon_url": "/skills/Astrid/0_bladedguardian.png",
        },
        {
            "name": "Spin Slash",
            "slot": "Skill 1",
            "type": "Physical Area Damage",
            "damage_type": "physical",
            "cooldown": [8.0, 8.0, 8.0, 8.0, 8.0, 8.0],
            "mana_cost": [25, 25, 25, 25, 25, 25],
            "base_damage": [300, 360, 420, 480, 540, 600],
            "scaling": {"ad_pct": 110.0},
            "desc_th": "Astrid สร้างความเสียหายกายภาพ 300 (+110%AD) หน่วยแก่ศัตรูรอบๆ หากโจมตีโดนเป้าหมายที่ติดวงแหวนเพลิง Astrid จะวิ่งเร็วขึ้น 20% ทันที และจะค่อยๆ เพิ่มเป็น 60% เป็นเวลา 2.5 วิ ทุกครั้งที่โดนศัตรู เธอจะได้รับโบนัสความเร็วโจมตี 20% และเจาะเกราะ 50 หน่วย (สูงสุด 3 ครั้ง) เป็นเวลา 5 วิ (เลเวล 1-6: วิ่งเร็ว 20~40%, เจาะเกราะ 50~100 หน่วย)",
            "description": "Astrid deals 300/360/420/480/540/600 (+110% AD) physical damage to surrounding enemies. If hitting targets marked with Flame Ring, immediately gains 20% movement speed increasing up to 60% over 2.5s. Hitting enemies grants 20% attack speed bonus and 50-100 armor penetration (stacks up to 3 times) for 5s.",
            "icon_url": "/skills/Astrid/1_spinslash.png",
        },
        {
            "name": "Fearless Charge",
            "slot": "Skill 2",
            "type": "Physical Dash",
            "damage_type": "physical",
            "cooldown": [8.5, 8.2, 7.9, 7.6, 7.3, 7.0],
            "mana_cost": [25, 25, 25, 25, 25, 25],
            "base_damage": [230, 276, 322, 368, 414, 460],
            "scaling": {"ad_pct": 35.0},
            "desc_th": "Astrid พุ่งไปยังทิศทางที่กำหนด และได้รับวงแหวนเพลิง (สะสมได้สูงสุด 2 ขั้น) เป็นเวลา 5 วิ เมื่อได้รับวงแหวนเพลิง จะเสริมพลังให้การโจมตีปกติครั้งถัดไปเป็นการโจมตีพิเศษ หากเป้าหมายติดวงแหวนเพลิงจะถูกลดความเร็วลง 15% (มอนสเตอร์ป่าลดเพิ่ม 50%) วงแหวนเพลิงขั้นที่ 1: พุ่งโจมตีเป้าหมาย ติดวงแหวนเพลิง สร้างโบนัสดาเมจ 230(+35%AD) สัมผัสขอบวงที่ส่องแสงจะเรียกวงแหวนเพลิงคืนและสร้างดาเมจ 25% วงแหวนเพลิงขั้นที่ 2: ชาร์จสั้นๆ พุ่งโจมตีผลักถอยหลัง 0.75 วิ โบนัสดาเมจ 345(+52.5%AD) ฟื้นฟู HP 350 หน่วย (+20% HP ที่หายไปเมื่อโดนฮีโร่)",
            "description": "Astrid dashes in target direction gaining Flame Ring for 5s. Tier 1: Deals 230-460 (+35% AD) bonus physical damage and attaches Flame Ring. Tier 2: Knocks back 0.75s, deals 345-690 (+52.5% AD) damage and restores 350-700 HP (+20% lost HP against heroes).",
            "icon_url": "/skills/Astrid/2_fearlesscharge.png",
        },
        {
            "name": "Dire Blow",
            "slot": "Ultimate",
            "type": "True Damage Area",
            "damage_type": "true",
            "cooldown": [50.0, 45.0, 40.0],
            "mana_cost": [80, 80, 80],
            "base_damage": [200, 250, 300],
            "scaling": {"target_hp_pct": 8.0, "ad_pct": 1.0},
            "desc_th": "Astrid ชาร์จพลัง 1 วิ ระหว่างนี้เธอจะเป็นอมตะและป้องกันสถานะ จากนั้นเธอจะสร้างความเสียหายจริง 200/250/300 (+8/10/12% ของพลังชีวิตสูงสุดของเป้าหมาย) (+1% ทุก 100 พลังโจมตีกายภาพ) (ความเสียหายตาม HP สูงสุดต่อมอนสเตอร์ป่าสูงสุด 1000 หน่วย) พร้อมกับสตั๊น 1 วิ (ระหว่างนี้ Astrid จะป้องกันสถานะ) ความเสียหายจริงที่โดนฮีโร่จะมีเอฟเฟกต์ดูดเลือด 50%",
            "description": "Astrid channels for 1s, becoming completely invincible and immune to crowd control. She then unleashes a slash dealing 200/250/300 true damage (+8/10/12% of target's max HP, +1% per 100 AD, max 1000 vs jungle monsters) and stunning enemies for 1s. Astrid retains CC immunity throughout. True damage dealt to heroes has 50% lifesteal effect.",
            "icon_url": "/skills/Astrid/3_direblow.png",
        },
    ]

    tot_skills = sum(len(skills) for skills in heroes.values())
    catalog["total_skills"] = tot_skills

    with open(SKILLS_JSON, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    print(f"Updated {SKILLS_JSON}. Total skills: {tot_skills}")

    with open(HEROES_JSON, "r", encoding="utf-8") as f:
        h130 = json.load(f)
    for h in h130:
        h["skills"] = heroes[h["name"]]
    with open(HEROES_JSON, "w", encoding="utf-8") as f:
        json.dump(h130, f, indent=2, ensure_ascii=False)
    print(f"Synced skills to {HEROES_JSON}")


if __name__ == "__main__":
    main()
