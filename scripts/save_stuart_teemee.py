import json
from pathlib import Path

stuart = [
    {
        "slot": "Passive",
        "name": "Drain Charge",
        "type": "Physical / Damage Up",
        "damage_type": "none",
        "cooldown": [0.0],
        "mana_cost": [0],
        "base_damage": [],
        "scaling": {},
        "icon_url": "/skills/Stuart/0_finalcurtain.png",
        "desc_th": "การโจมตีปกติ, สกิล 1 แบบปกติ และอัลติเมตของ Stuart จะทำให้ได้รับพลังงานหลังจากโจมตีฮีโร่โดนศัตรู ซึ่งพลังงานจะถูกเก็บไว้เป็นเวลา 6 วิ (สะสมได้สูงสุด 4 ครั้ง) เมื่อระดับพลังงานเต็มจะเข้าสู่ สถานะเสริมพลัง เป็นเวลา 6 วิ\nการโจมตีปกติได้รับ 1 ครั้ง\nสกิล 1 ได้รับ 2 ครั้ง\nสกิลอัลติเมตได้รับ 3 ครั้ง\nสถานะเสริมพลัง: ความเร็วโจมตีเพิ่มขึ้น 50% (สูงสุด 80% ซึ่งจะเพิ่มขึ้นตาม LV ฮีโร่) และความเร็วเคลื่อนที่เพิ่มขึ้น 20% (สูงสุด 30% ซึ่งจะเพิ่มขึ้นตาม LV ฮีโร่) รวมถึงเสริมพลังให้กับสกิล 1 ส่วนการโจมตีปกติจะลดคูลดาวน์สกิล 1 ลง 1.5 วิ (ระหว่างนี้จะไม่ได้รับพลังงานเพิ่มอีก);\nเมื่อ Stuart สังหารหรือช่วยสังหาร เขาจะเขาจะเข้าสู่สถานะเสริมพลัง หรือรีเซ็ตระยะเวลาใหม่ทันที",
        "description": "Stuart's normal attacks, normal skill 1, and ultimate grant energy stacks (up to 4) when hitting enemy heroes for 6s. At max stacks, enters Empowered State for 6s (+50-80% attack speed, +20-30% movement speed, empowers Skill 1, normal attacks reduce Skill 1 CD by 1.5s). Takedowns refresh or enter Empowered State immediately.",
    },
    {
        "slot": "Skill 1",
        "name": "Death Bloom",
        "type": "Physical",
        "damage_type": "physical",
        "cooldown": [6.0, 6.0, 6.0, 6.0, 6.0, 6.0],
        "mana_cost": [0, 0, 0, 0, 0, 0],
        "base_damage": [320, 410, 500, 590, 680, 770],
        "scaling": {"ad_pct": 120.0, "enhanced_ad_pct": 150.0},
        "icon_url": "/skills/Stuart/1_fataltrick.png",
        "desc_th": "Stuart ยิงกระสุนออกไปยังทิศที่กำหนด สร้าง ความเสียหายกายภาพ 320 (+120%AD) แก่ศัตรูทั้งหมดที่โดน\nสถานะเสริมพลัง: Stuart ยิงกระสุนออกไปยังทิศที่กำหนดอย่างรวดเร็ว สร้าง ความเสียหายกายภาพ 400 (+150%AD) แก่ศัตรูทั้งหมดที่โดน",
        "description": "Stuart fires a shot in the target direction, dealing 320-770 (+120% AD) physical damage to enemies hit. Empowered State: Fires rapidly dealing 400 (+150% AD) physical damage to enemies hit.",
    },
    {
        "slot": "Skill 2",
        "name": "Eyes of Zealot",
        "type": "Special / Speed Up",
        "damage_type": "none",
        "cooldown": [13.5, 12.8, 12.1, 11.4, 10.7, 10.0],
        "mana_cost": [0, 0, 0, 0, 0, 0],
        "base_damage": [],
        "scaling": {},
        "icon_url": "/skills/Stuart/2_deception.png",
        "desc_th": "Stuart เพิ่มความเร็วเคลื่อนที่ขึ้น 30% และต้านทาน ความเสียหายกายภาพ ทั้งหมดเป็นเวลา 2 วิ",
        "description": "Stuart increases movement speed by 30% and gains immunity to all physical damage for 2s.",
    },
    {
        "slot": "Ultimate",
        "name": "Fatal Gift",
        "type": "Physical / Stun",
        "damage_type": "physical",
        "cooldown": [25.0, 21.0, 17.0],
        "mana_cost": [0, 0, 0],
        "base_damage": [580, 715, 850],
        "scaling": {"ad_pct": 240.0},
        "icon_url": "/skills/Stuart/3_deathprank.png",
        "desc_th": "Stuart กระโดด (ระหว่างนี้จะป้องกันสถานะ) เข้าหาตัวศัตรูพร้อมกับ สตั๊น 0.8 วิ และวางระเบิด สร้าง ความเสียหายกายภาพ 580 (+240%AD) และ ลดความเร็วเคลื่อนที่ลง 50% เป็นเวลา 2 วิ",
        "description": "Stuart leaps (gaining CC immunity) onto an enemy, stunning for 0.8s, placing a bomb dealing 580-850 (+240% AD) physical damage and slowing by 50% for 2s.",
    },
]

teemee = [
    {
        "slot": "Passive",
        "name": "Scavenge",
        "type": "Special / Passive",
        "damage_type": "none",
        "cooldown": [0.0],
        "mana_cost": [0],
        "base_damage": [],
        "scaling": {},
        "icon_url": "/skills/TeeMee/0_scavenge.png",
        "desc_th": "เมื่อมีศัตรูที่ไม่ใช่ฮีโร่ตายในบริเวณใกล้เคียง TeeMee จะทำให้พวกเขาได้รับโบนัสโกลด์เพิ่มขึ้น 20% และยังแบ่งให้กับพันธมิตรรอบๆ อีกด้วย",
        "description": "When non-hero units die nearby, TeeMee gains 20% bonus gold and shares it with nearby allies.",
    },
    {
        "slot": "Skill 1",
        "name": "Pooty Poots",
        "type": "Magic / Stun",
        "damage_type": "magic",
        "cooldown": [5.0, 5.0, 5.0, 5.0, 5.0, 5.0],
        "mana_cost": [60, 60, 60, 60, 60, 60],
        "base_damage": [400, 480, 560, 640, 720, 800],
        "scaling": {"ap_pct": 90.0, "max_ap_pct": 180.0},
        "icon_url": "/skills/TeeMee/1_pootypootscore.png",
        "desc_th": "TeeMee จะสร้างก๊าซระเบิด เพิ่มความเร็วเคลื่อนที่ ขึ้น 6% ทุก 0.5 วิ เป็นเวลา 5 วิ จากนั้นเขาจะพยายามควบคุมมันก่อนที่จะระเบิด โดยจะสร้าง ความเสียหายเวท น้อยสุด 400 (+90%AP) พร้อม สตั๊น 0.25 วิ และจะสร้าง ความเสียหายเวท สูงสุด 800 (+180%AP) พร้อม สตั๊น 1 วิ หากสกิลนี้ชาร์จเต็มและโจมตีโดนฮีโร่ จะรีเซ็ตคูลดาวน์สกิลนี้ทันที (ขณะชาร์จสกิลจะได้รับเกราะและเกราะเวทเพิ่มขึ้น 60 หน่วย)\n(จำนวนความเสียหาย และระยะเวลาสตั๊นจะขึ้นอยู่กับระยะเวลาที่เขาชาร์จ)",
        "description": "TeeMee channels gas gaining 6% speed every 0.5s for 5s (+60 armor/magic def). Explodes dealing 400-800 (+90% AP, up to +180% AP) magic damage and stuns for 0.25-1.0s. Max charge hitting an enemy hero resets cooldown immediately.",
    },
    {
        "slot": "Skill 2",
        "name": "Chain Lance",
        "type": "Magic / Movement",
        "damage_type": "magic",
        "cooldown": [10.0, 9.2, 8.4, 7.6, 6.8, 6.0],
        "mana_cost": [65, 65, 65, 65, 65, 65],
        "base_damage": [450, 510, 570, 630, 690, 750],
        "scaling": {"ap_pct": 60.0},
        "icon_url": "/skills/TeeMee/2_chainlance.png",
        "desc_th": "TeeMee ยิงตะขอออกไปในทิศทางที่เลือก พร้อมกับดึงตัวเองเข้าหาเป้าหมายที่โดน หากเป้าหมายเป็นฮีโร่ หรือครีปฝ่ายศัตรู จะสร้าง ความเสียหายเวท 450 (+60%AP) และสตั๊นเป็นเวลา 1 วิ",
        "description": "TeeMee fires a hook pulling himself to the target. Hitting enemy heroes or creeps deals 450-750 (+60% AP) magic damage and stuns for 1s.",
    },
    {
        "slot": "Ultimate",
        "name": "Being a Bro",
        "type": "Magic / Resurrect",
        "damage_type": "magic",
        "cooldown": [70.0, 65.0, 60.0],
        "mana_cost": [150, 150, 150],
        "base_damage": [600, 750, 900],
        "scaling": {"ap_pct": 80.0, "revive_ap_pct": 250.0},
        "icon_url": "/skills/TeeMee/3_beingabro.png",
        "desc_th": "TeeMee ใช้พลังสร้างเกราะปกป้องตัวเองและพันธมิตรที่ HP น้อยที่สุดเป็นเวลา 3 วิ (สามารถใช้ในขณะที่โดนสถานะผิดปกติได้)\nระหว่างสกิลทำงาน หาก TeeMee หรือฮีโร่พันธมิตรที่ได้รับผลของสกิลตาย พวกเขาจะถูกชุบชีวิตใน 2 วิ ด้วยพลังชีวิต 2000 (+250%AP) และมานาเต็ม 100%\nจากนั้นสกิลนี้จะสร้าง ความเสียหายเวท 600 (+80%AP) และลดความเร็วเคลื่อนที่ของศัตรูลง 50% เป็นเวลา 2 วิ",
        "description": "TeeMee protects himself and lowest HP ally for 3s (usable while controlled). If either dies during this effect, resurrects them after 2s with 2000 (+250% AP) HP and 100% mana, then deals 600-900 (+80% AP) magic damage and slows enemies by 50% for 2s.",
    },
]

out_dir = Path("data/hero_patches")
with open(out_dir / "Stuart.json", "w", encoding="utf-8") as f:
    json.dump(stuart, f, indent=2, ensure_ascii=False)
with open(out_dir / "TeeMee.json", "w", encoding="utf-8") as f:
    json.dump(teemee, f, indent=2, ensure_ascii=False)
print("Saved Stuart and TeeMee")
