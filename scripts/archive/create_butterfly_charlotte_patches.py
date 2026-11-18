"""Extract and save Butterfly and Charlotte skills to data/hero_patches."""

import json
from pathlib import Path

butterfly_skills = [
    {
        "name": "Assassinate",
        "slot": "Passive",
        "type": "Special / Passive",
        "damage_type": "none",
        "cooldown": [0.0],
        "mana_cost": [0],
        "base_damage": [],
        "scaling": {},
        "desc_th": "หลังจากสังหารฮีโร่ศัตรูจะทำให้ Butterfly ได้รับ Assassination Mark 2 ขั้น ส่วนการสังหารหรือช่วยสังหารมอนสเตอร์ และครีปจะได้รับ 1 ขั้น และเมื่อสะสมครบ 3 ขั้น จะทำให้สกิลต่อไปที่ถูกใช้จะไม่เข้าสู่ช่วงคูลดาวน์",
        "description": "Killing an enemy hero grants Butterfly 2 stacks of Assassination Mark. Killing or assisting in killing monsters and minions grants 1 stack. Upon reaching 3 stacks, the next skill cast will not enter cooldown.",
        "icon_url": "/skills/Butterfly/0_assassin.png",
    },
    {
        "name": "Whirlwind",
        "slot": "Skill 1",
        "type": "Physical / Speed Up",
        "damage_type": "physical",
        "cooldown": [7.0, 6.8, 6.6, 6.4, 6.2, 6.0],
        "mana_cost": [0, 0, 0, 0, 0, 0],
        "base_damage": [200, 240, 280, 320, 360, 400],
        "scaling": {
            "ad_pct": 60.0,
            "shield_ad_pct": 120.0,
        },
        "desc_th": "Butterfly ทำการฟันกวาดรอบตัว สร้าง ความเสียหายกายภาพ 200 (+60%AD) (ทุก 1 ศัตรูที่โจมตีโดน จะทำให้สกิลแรงขึ้น 25%) ระหว่างนั้นเธอจะได้รับ โล่ 400 (+120%AD) หน่วย และ วิ่งเร็วขึ้น 60% (ค่อยๆ ลดลง) เป็นเวลา 2 วินาที",
        "description": "Butterfly sweeps her blade around herself, dealing 200 (+60% AD) physical damage (each enemy hit increases damage by 25%). During this time, she gains a shield of 400 (+120% AD) and 60% decaying movement speed for 2s.",
        "icon_url": "/skills/Butterfly/1_whirlwind.png",
    },
    {
        "name": "Sword Propel",
        "slot": "Skill 2",
        "type": "Physical / Slow",
        "damage_type": "physical",
        "cooldown": [7.0, 6.8, 6.6, 6.4, 6.2, 6.0],
        "mana_cost": [0, 0, 0, 0, 0, 0],
        "base_damage": [200, 240, 280, 320, 360, 400],
        "scaling": {
            "ad_pct": 60.0,
        },
        "desc_th": "Butterfly ฟาดคลื่นดาบไปข้างหน้าด้วยความเร็วสูง สร้าง ความเสียหายกายภาพ 200 (+60%AD) โดยศัตรูแรกที่โดนจะได้รับความเสียหาย 1.5 เท่า พร้อมวิ่งช้าลง 50% เป็นเวลา 1.5 วิ\nหากโจมตีศัตรูจะทำให้ Butterfly โจมตีเร็วขึ้น 30% และเพิ่มโอกาสคริ 10% เป็นเวลา 5 วิ (สะสมสูงสุด 2 ครั้ง)",
        "description": "Butterfly fires a high-speed sword wave forward, dealing 200 (+60% AD) physical damage (the first enemy hit takes 1.5x damage) and slowing them by 50% for 1.5s. Hitting an enemy grants 30% attack speed and 10% critical strike chance for 5s (stacks up to 2 times).",
        "icon_url": "/skills/Butterfly/2_swordpropel.png",
    },
    {
        "name": "Backstab",
        "slot": "Ultimate",
        "type": "Physical / Movement",
        "damage_type": "physical",
        "cooldown": [18.0, 15.0, 12.0],
        "mana_cost": [0, 0, 0],
        "base_damage": [350, 525, 700],
        "scaling": {
            "ad_pct": 115.0,
            "target_lost_hp_pct": 12.0,
        },
        "desc_th": "Butterfly หายตัวไปฟันศัตรู สร้าง ความเสียหายกายภาพ 350 (+115%AD) (หากศัตรูติดสัญลักษณ์จะสร้างโบนัสความเสียหายจริงเท่ากับ 12% HP ที่เสียไป) พร้อมติด สัญลักษณ์ ให้ศัตรูเป็นเวลา 3 วิ หลังจากสัญลักษณ์หมดลง 35% ของความเสียหายที่สร้างได้จะถูกนำมาฟื้นฟู HP ให้ตนเอง และหากเป้าหมายตายจะรีเซ็ตคูลดาวน์สกิลนี้ทันที\nหลังจากใช้สกิล เธอจะถูกโจมตีปกติเบาลง 50% เป็นเวลา 3 วิ\nหากโจมตีปกติใส่ศัตรูที่ติดสัญลักษณ์จะลดคูลดาวน์สกิล 1 และ 2 ลง 1 วิ\nการล็อคเป้าอัตโนมัติจะเลือกฮีโร่ศัตรูที่ HP น้อยสุดเสมอ",
        "description": "Butterfly teleports behind an enemy dealing 350 (+115% AD) physical damage (dealing bonus true damage equal to 12% of lost HP if the target is marked) and marking them for 3s. When mark expires, 35% of damage dealt is healed. Target death resets cooldown immediately. Reduces normal attack damage taken by 50% for 3s. Basic attacking marked targets reduces Skill 1 and Skill 2 cooldowns by 1s.",
        "icon_url": "/skills/Butterfly/3_backstab.png",
    },
]

charlotte_skills = [
    {
        "name": "Seven-Star Sword",
        "slot": "Passive",
        "type": "Physical / Passive",
        "damage_type": "physical",
        "cooldown": [0.0],
        "mana_cost": [0],
        "base_damage": [50],
        "scaling": {
            "ad_pct": 25.0,
            "target_lost_hp_pct": 15.0,
        },
        "desc_th": 'หลังจากสกิลของ Charlotte โจมตีโดนศัตรู การใช้สกิลครั้งต่อไปของเธอจะเป็นการอัปเกรดสกิล และได้รับสัญลักษณ์ 1 ครั้งที่จะอยู่นาน 4 วิ\nหลังจากสะสมสัญลักษณ์ครบ 3 ครั้ง การโจมตีปกติของเธอจะถูกอัปเกรดเป็น "Seven-Star Sword" ซึ่งจะโจมตีเป้าหมาย 7 ครั้ง แต่ละครั้งจะสร้าง ความเสียหายกายภาพ50(+25%พลังโจมตีกายภาพ)และลดความเร็วเคลื่อนที่30% การโจมตีครั้งสุดท้ายจะสร้างความเสียหายกายภาพ 15% ของพลังชีวิตที่หายไป ขณะใช้งานจะลดความเสียหายที่ได้รับ26%~40%\nสกิลอัปเกรดจะมอบสถานะปลดอาวุธ ซึ่งแต่ละขั้นจะลดความเร็วโจมตี 10% นาน 4 วิ (สะสมได้สูงสุด 2 ขั้น) สถานะปลดอาวุธแต่ละขั้นจะหายไปก็ต่อเมื่อศัตรูทำการโจมตีปกติ',
        "description": "When Charlotte's skills hit an enemy, her next skill is enhanced and she gains 1 stack lasting 4s. At 3 stacks, her next normal attack becomes 'Seven-Star Sword', striking 7 times. Each strike deals 50 (+25% AD) physical damage and slows movement by 30%. The final strike deals physical damage equal to 15% lost HP. Reduces damage taken by 26%~40% during execution. Enhanced skills inflict disarm stacks, reducing enemy attack speed by 10% for 4s (stacks up to 2 times, removed when the enemy basic attacks).",
        "icon_url": "/skills/Charlotte/0_splashgradation.png",
    },
    {
        "name": "Triangle Sword",
        "slot": "Skill 1",
        "type": "Physical / Speed Up",
        "damage_type": "physical",
        "cooldown": [8.0, 7.8, 7.6, 7.4, 7.2, 7.0],
        "mana_cost": [0, 0, 0, 0, 0, 0],
        "base_damage": [200, 230, 260, 290, 320, 350],
        "scaling": {
            "bonus_ad_pct": 100.0,
        },
        "desc_th": "สกิลเริ่มต้น: ปล่อยออร่าดาบสามเหลี่ยมไปยังทิศทางที่กำหนด สร้างความเสียหายกายภาพ 200(+100%โบนัสกายภาพ)และเพิ่มความเร็วเคลื่อนที่80% ซึ่งจะลดลงเรื่อยๆภายในเวลา 2 วิ",
        "description": "Releases a triangular sword aura in the target direction, dealing 200 (+100% bonus AD) physical damage and gaining 80% movement speed decaying over 2s.",
        "icon_url": "/skills/Charlotte/1_trislash.png",
    },
    {
        "name": "Pierce Fountain",
        "slot": "Skill 2",
        "type": "Physical / Movement",
        "damage_type": "physical",
        "cooldown": [6.0, 5.8, 5.6, 5.4, 5.2, 5.0],
        "mana_cost": [0, 0, 0, 0, 0, 0],
        "base_damage": [40, 48, 56, 64, 72, 80],
        "scaling": {
            "ad_pct": 15.0,
            "bonus_max_hp_pct": 1.0,
        },
        "desc_th": "สกิลเริ่มต้น: พุ่งโจมตีไปยังทิศทางที่กำหนด 6 ครั้ง แต่ละครั้งสร้างความเสียหายกายภาพ 40(+15%AD) หน่วย และฟื้นฟูพลังชีวิต 70(+1% โบนัสพลังชีวิตสูงสุด) หน่วย",
        "description": "Dashes in the target direction, thrusting 6 times. Each strike deals 40 (+15% AD) physical damage and recovers 70 (+1% bonus Max HP) HP.",
        "icon_url": "/skills/Charlotte/2_splashslash.png",
    },
    {
        "name": "Sky-Breaking Saber",
        "slot": "Ultimate",
        "type": "Physical / Iron Body",
        "damage_type": "physical",
        "cooldown": [18.0, 15.5, 13.0],
        "mana_cost": [0, 0, 0],
        "base_damage": [160, 270, 380],
        "scaling": {
            "bonus_ad_pct": 75.0,
        },
        "desc_th": "สกิลเริ่มต้น: วาดวงเวทดาบไว้ยังบริเวณที่กำหนด และสร้างความเสียหายกายภาพ 160(+75%โบนัสกายภาพ พร้อมทั้งลดความเร็วศัตรู 50% นาน 1 วิ เมื่อเริ่มใช้งานจากรอยดาบที่ 2 จะสร้างความเสียหายเพียง 30% ขณะใช้สกิลจะป้องกันสถานะและลดความเสียหายที่ได้รับ",
        "description": "Draws a sword rune at the target location, dealing 160 (+75% bonus AD) physical damage and slowing enemies by 50% for 1s. From the 2nd sword strike onward, deals only 30% damage. Gains CC immunity and damage reduction during cast.",
        "icon_url": "/skills/Charlotte/3_powersword.png",
    },
]

out_dir = Path("data/hero_patches")
out_dir.mkdir(parents=True, exist_ok=True)

(out_dir / "Butterfly.json").write_text(json.dumps(butterfly_skills, ensure_ascii=False, indent=2), encoding="utf-8")
(out_dir / "Charlotte.json").write_text(json.dumps(charlotte_skills, ensure_ascii=False, indent=2), encoding="utf-8")

print("Saved data/hero_patches/Butterfly.json and Charlotte.json successfully")
