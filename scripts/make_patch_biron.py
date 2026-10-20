import json
from pathlib import Path

PATCH_DIR = Path("data/hero_patches")

biron = [
    {
        "name": "Energy Charge",
        "slot": "Passive",
        "type": "Physical / Heal",
        "damage_type": "physical",
        "cooldown": [0.0],
        "mana_cost": [0],
        "base_damage": [50],
        "scaling": {},
        "icon_url": "/skills/Biron/0_electrifyingchar.png",
        "desc_th": "เมื่อ Biron ทำการโจมตีปกติหรือสกิลขณะไม่ได้ชาร์จจะทำให้เขาได้รับพลังงาน เมื่อพลังงาน >= 30 หน่วย การโจมตีปกติจะสร้างความเสียหายกายภาพ 50 และฟื้นฟูพลังชีวิต 70 เมื่อใช้สกิลจะเสริมพลังการโจมตีที่ต่างกัน และจะไม่ได้รับพลังงานจากการโจมตีศัตรู การโจมตีปกติจะทำการชาร์จพลังงาน 7 หน่วยต่อศัตรูที่โดน และการใช้สกิลจะทำการชาร์จพลังงาน 10 หน่วยต่อศัตรูที่โดน สามารถชาร์จพลังงานได้สูงสุด 90 หน่วย",
        "description": "When Biron attacks or uses skills uncharged, he gains energy. At >= 30 energy, normal attacks deal 50 physical damage and restore 70 HP. Skills gain enhanced effects and consume energy instead of generating it. Normal attacks generate 7 energy per hit, and skills generate 10 energy per hit (up to 90 energy max).",
    },
    {
        "name": "Hammer Bash",
        "slot": "Skill 1",
        "type": "Physical / Mobility",
        "damage_type": "physical",
        "cooldown": [5.0, 4.8, 4.6, 4.4, 4.2, 4.0],
        "mana_cost": [0, 0, 0, 0, 0, 0],
        "base_damage": [120, 144, 168, 192, 216, 240],
        "scaling": {"bonus_ad_pct": 100.0},
        "icon_url": "/skills/Biron/1_stormstrike.png",
        "desc_th": "Biron เหวี่ยงอาวุธออกไปโจมตีด้านหน้าสองครั้ง แต่ละครั้งจะสร้าง ความเสียหายกายภาพ 120(+100% โบนัส AD) และ ฟื้นฟู HP 30(+16% โบนัส AD) และ 2% ของ HP ที่เสียไป\nชาร์จเต็มพลัง: เพิ่มความเสียหายที่สร้างขึ้นเป็น 180+150% โบนัส AD และการฟื้นฟู HP เพิ่มขึ้นเป็น 60(+32% โบนัส AD) และ 4% ของ HP ที่เสียไป\nเมื่อโจมตีใส่เป้าหมายที่ไม่ใช่ฮีโร่ ผลฟื้นฟูจะลดลงครึ่งหนึ่ง",
        "description": "Biron swings his weapon forward twice, each swing dealing 120 (+100% Bonus AD) physical damage and restoring 30 (+16% Bonus AD + 2% lost HP) HP. Charged: Increases damage to 180 (+150% Bonus AD) and HP recovery to 60 (+32% Bonus AD + 4% lost HP). Healing is halved against non-heroes.",
    },
    {
        "name": "Electro Drift",
        "slot": "Skill 2",
        "type": "Physical / Damage",
        "damage_type": "physical",
        "cooldown": [9.0, 8.6, 8.2, 7.8, 7.4, 7.0],
        "mana_cost": [0, 0, 0, 0, 0, 0],
        "base_damage": [150, 180, 210, 240, 270, 300],
        "scaling": {"bonus_ad_pct": 75.0},
        "icon_url": "/skills/Biron/2_fearlesschariot.png",
        "desc_th": "Biron พุ่งตัวไปโจมตีศัตรูด้านหน้า สร้างความเสียหายกายภาพ 150(+75%โบนัสAD) แก่ศัตรูที่เขาพุ่งผ่าน และเสริมการโจมตีปกติครั้งถัดไป สร้างความเสียหายกายภาพ 200(+100%โบนัสAD) และลดความเร็วเคลื่อนที่ศัตรู 50% นาน 2 วิ\nชาร์จเต็มพลัง: เมื่อใช้สกิลขณะที่พลังงาน > 30 จะเสริมการโจมตีปกติครั้งถัดไป สร้างความเสียหายกายภาพ 300(+150%โบนัสAD) และทำการตีลอยและสตั๊นเป้าหมาย และลดความเร็วเคลื่อนที่ศัตรู 50%\nการโจมตีเสริมพลังขณะพลังงาน >= 30 หลังใช้งานจะสูญเสียพลังงาน 30 หน่วย",
        "description": "Biron dashes forward, dealing 150 (+75% Bonus AD) physical damage to enemies in his path and enhancing his next normal attack to deal 200 (+100% Bonus AD) physical damage and slow enemies by 50% for 2s. Charged (>30 energy): Enhanced normal attack deals 300 (+150% Bonus AD) physical damage, knocks airborne, stuns, and slows by 50% (consumes 30 energy).",
    },
    {
        "name": "Magnetic Impact",
        "slot": "Ultimate",
        "type": "Physical / Control",
        "damage_type": "physical",
        "cooldown": [12.0, 12.0, 12.0],
        "mana_cost": [0, 0, 0],
        "base_damage": [200, 300, 400],
        "scaling": {"bonus_ad_pct": 100.0},
        "icon_url": "/skills/Biron/3_oppressiveaura.png",
        "desc_th": "Biron เหวี่ยงค้อนของเขาทุบกระแทกไปยังพื้นดิน สร้าง ความเสียหายกายภาพ 200(+100% โบนัส AD) และลดความเร็วเคลื่อนที่ 50% เป็นเวลา 1.5 วิ พร้อมกับสร้าง โล่ 1200 เป็นเวลา 6 วิอีกด้วย\nชาร์จเต็มพลัง: สร้าง ความเสียหายเพิ่มขึ้นเป็น 300(+150% โบนัส AD) และค่าโล่เพิ่มขึ้นเป็น 1800/2700/3600 ในขณะเดียวกันจะสร้างสนามไฟฟ้าพร้อมกับสร้างความเสียหายกายภาพ 100(+50% โบนัส AD) และขโมยความเร็วเคลื่อนที่ 30 จากฮีโร่แต่ละตัวให้ Biron เป็นเวลา 2.5 วิ ระยะสกิลของสนามไฟฟ้าจะเพิ่มขึ้นตามเลเวลสกิล",
        "description": "Biron slams his hammer into the ground, dealing 200 (+100% Bonus AD) physical damage, slowing enemies by 50% for 1.5s, and gaining a 1200 shield for 6s. Charged: Damage increases to 300 (+150% Bonus AD) and shield increases to 1800/2700/3600 while generating an electric field that deals 100 (+50% Bonus AD) physical damage and steals 30/45/60 movement speed per enemy hero for 2.5s.",
    },
]

with open(PATCH_DIR / "Biron.json", "w", encoding="utf-8") as f:
    json.dump(biron, f, indent=2, ensure_ascii=False)
print("Saved Biron.json")
