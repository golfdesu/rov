import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_FILE = ROOT / "scripts" / "extracted_items_g0.json"

items_g0 = [
    {
        "name": "Amulet of Longevity",
        "slug": "amulet-of-longevity",
        "category": "defense",
        "tier": 3,
        "price": 2190,
        "stats": {
            "armor": 150.0,
            "magic_defense": 100.0,
            "max_hp": 1500.0,
        },
        "stats_raw": [
            "+150 เกราะ",
            "+100 ต้านทานเวท",
            "+1500 พลังชีวิต",
        ],
        "passives": [
            "Passive - Longevity: When out of combat, restores 4% HP per second.",
        ],
        "desc_th": [
            "สกิลติดตัว - Longevity:\nเมื่อไม่ได้ต่อสู้จะฟื้นฟูพลังชีวิต 4% ต่อวินาที",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/amulet-of-longevity.png",
    },
    {
        "name": "Ancient Scriptures",
        "slug": "ancient-scriptures",
        "category": "magic",
        "tier": 2,
        "price": 540,
        "stats": {
            "ability_power": 80.0,
        },
        "stats_raw": [
            "+80 พลังเวท",
        ],
        "passives": [],
        "desc_th": [
            "+80 พลังเวท",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/ancient-scriptures.png",
    },
    {
        "name": "Apocalypse",
        "slug": "apocalypse",
        "category": "magic",
        "tier": 3,
        "price": 1800,
        "stats": {
            "ability_power": 180.0,
            "cooldown_reduction": 10.0,
            "movement_speed_pct": 5.0,
        },
        "stats_raw": [
            "+180 พลังเวท",
            "+10% ลดคูลดาวน์",
            "+5% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Passive - Elemental Edge: After using a skill, the next normal attack deals additional magic damage equal to (30% AD + 80% AP). Cooldown: 2s.",
        ],
        "desc_th": [
            "Elemental Edge:\nหลังใช้สกิล\nการโจมตีถัดไปจะสร้าง\nความเสียหายเวท (30% โบนัสกายภาพ + 80% โบนัสเวท) CD 2 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/apocalypse.png",
    },
    {
        "name": "Aquaflame - Accelerate",
        "slug": "aquaflame-accelerate",
        "category": "support",
        "tier": 3,
        "price": 1900,
        "stats": {
            "max_hp": 1200.0,
            "movement_speed_pct": 8.0,
        },
        "stats_raw": [
            "+1200 พลังชีวิต",
            "+8% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Active - Accelerate: Grants nearby allied heroes gradually increasing movement speed over 5s, up to 20%~100% for 4s. Moving through allies without speed boost grants them the current effect. When dealing or taking damage from enemy heroes, the speed boost is reduced to 20%. Cooldown: 75s.",
            "Passive - Reward: Increases primary attack stat by 32~60 (1 primary attack stat = 1 AD or 2 AP), and increases max HP by 400~820.",
            "Passive - Up-and-Coming: Every 3s, gain 8 EXP and grant 8 gold to the lowest-gold ally. Minions dying without an ally nearby drop 50% gold on the ground (up to 600 gold), and pulls 1 gold from the map every 10s. Collecting 600 gold unlocks Resonance (active): grants large amount of gold and EXP to self and 1 ally (once per match).",
            "Passive - Modest: Nearby allies gain full gold and EXP from minions and monsters, while the user gains only 25%~50% (scales with time, max at 15 min).",
            "Passive - Magical Shadow: Grants +5% Cooldown Reduction and +5% Attack Speed to self and nearby allies.",
        ],
        "desc_th": [
            "สกิลกดใช้ - Accerelate:\nฮีโร่พันธมิตรที่อยู่ในระยะจะค่อยๆ เพิ่มความเร็วเคลื่อนที่ภายใน 5 วินาที สูงสุดเพิ่มขึ้น 20%~100% เป็นเวลา 4 วินาที\nเมื่อวิ่งผ่านฮีโร่พันธมิตรที่ไม่ได้เร่งความเร็ว จะมอบเอฟเฟกต์ปัจจุบันให้กับฮีโร่พันธมิตร\nเมื่อโจมตีหรือถูกโจมตีโดยฮีโร่ศัตรู ผลเร่งความเร็วจะส่งผลเพียง 20% โดยมีคูลดาวน์ 75 วินาที",
            "สกิลติดตัว - Reward:\nเพิ่มสเตตัสโจมตีหลัก 32~60 (1 สเตตัสโจมตีหลัก = AD 1 หรือ AP 2) เพิ่ม HP สูงสุด 400~820",
            "สกิลติดตัว - Up-and-Coming:\nทุกๆ 3 วิ ได้รับ 8 XP และฮีโร่ที่มีการเงินน้อยที่สุดในทีมจะได้รับ 8 เหรียญทอง ครีปเลนที่ไม่มีผู้เล่นฟาร์ม จะดรอปเหรียญทอง 50% ลงพื้น ซึ่งสามารถเก็บเหรียญทองได้มากสุด 600 เหรียญ และสามารถดูดเหรียญทอง 1 เหรียญจากแผนที่ CD 10 วิ เมื่อเก็บเหรียญทองครบ 600 เหรียญจะปลดล็อคสกิล Resonance กดใช้งานเพื่อมอบเหรียญทองและ XP จำนวนมากให้กับตัวเองและฮีโร่ฝ่ายเรา 1 ตัว (ใช้ได้ 1 ครั้ง/เกม)",
            "สกิลติดตัว - Modest:\nฮีโร่พันธมิตรที่อยู่รอบๆ จะได้รับโกลด์ และ XP จากการสังหารครีป และมอนสเตอร์เต็มจำนวน ส่วนเจ้าของไอเทมนี้จะได้รับเพียง 25%~50%(ค่อยเพิ่มขึ้นตามเวลา สูงสุดนาทีที่ 15)",
            "สกิลติดตัว-Magical Shadow:\nเพิ่มลดคูลดาวน์ 5% และความเร็วโจมตี 5% ให้แก่ตัวเองและพันธมิตรรอบๆ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/aquaflame-accelerate.png",
    },
    {
        "name": "Aquaflame - Rejuvenate",
        "slug": "aquaflame-rejuvenate",
        "category": "support",
        "tier": 3,
        "price": 1900,
        "stats": {
            "max_hp": 1200.0,
            "movement_speed_pct": 8.0,
        },
        "stats_raw": [
            "+1200 พลังชีวิต",
            "+8% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Active - Rejuvenate: Tethers to a nearby ally (defaults to lowest HP) for 5s, restoring 500~1000 + 20% max HP and 25% max MP to both. Tether breaks if distance is exceeded. When dealing or taking damage from enemy heroes, healing effect is reduced to 20%. Recharges every 50s, up to 2 charges.",
            "Passive - Reward: Increases primary attack stat by 32~60 units (1 primary stat = 1 AD or 2 AP), and increases max HP by 400~820 units.",
            "Passive - Up-and-Coming: Every 3s, gain 8 EXP and grant 8 gold to the lowest-gold ally. Minions dying without an ally nearby drop 50% gold on the ground (up to 600 gold), and pulls 1 gold from the map every 10s. Collecting 600 gold unlocks Resonance (active): grants large amount of gold and EXP to self and 1 ally (once per match).",
            "Passive - Modest: Nearby allies gain full gold and EXP from minions and monsters, while the user gains only 25%~50% (scales with time, max at 15 min).",
            "Passive - Magical Shadow: Grants +5% Cooldown Reduction and +5% Attack Speed to self and nearby allies.",
        ],
        "desc_th": [
            "สกิลกดใช้ - Rejuvenate:\nเชื่อมต่อฮีโร่พันธมิตรในระยะ (ค่าเริ่มต้น: ฮีโร่ที่มี HP ต่ำที่สุด) ภายใน 5 วิ โดยจะฟื้นฟูพลังชีวิตทั้งสอง 500~1000 +20% HP สูงสุด และ 25% MP สูงสุด เมื่อการเชื่อมต่อเกินระยะที่กำหนดจะถูกตัด หากโจมตีหรือโดนฮีโร่ศัตรูโจมตี เอฟเฟกต์ฟื้นฟูมีผลเพียง 20% เท่านั้น เอฟเฟกต์นี้จะเริ่มทำงานทุก 50 วิ และสามารถสะสมได้สูงสุด 2 ครั้ง",
            "สกิลติดตัว - Reward:\nเพิ่มสเตตัสโจมตีหลัก 32~60 หน่วย (1 สเตตัสโจมตีหลัก = AD 1 หรือ AP 2) เพิ่มพลังชีวิตสูงสุด 400~820 หน่วย",
            "สกิลติดตัว - Up-and-Coming:\nทุกๆ 3 วิ ได้รับ 8 XP และฮีโร่ที่มีการเงินน้อยที่สุดในทีมจะได้รับ 8 เหรียญทอง ครีปเลนที่ไม่มีผู้เล่นฟาร์ม จะดรอปเหรียญทอง 50% ลงพื้น ซึ่งสามารถเก็บเหรียญทองได้มากสุด 600 เหรียญ และสามารถดูดเหรียญทอง 1 เหรียญจากแผนที่ CD 10 วิ เมื่อเก็บเหรียญทองครบ 600 เหรียญจะปลดล็อคสกิล Resonance กดใช้งานเพื่อมอบเหรียญทองและ XP จำนวนมากให้กับตัวเองและฮีโร่ฝ่ายเรา 1 ตัว (ใช้ได้ 1 ครั้ง/เกม)",
            "สกิลติดตัว - Modest:\nฮีโร่พันธมิตรที่อยู่รอบๆ จะได้รับโกลด์ และ XP จากการสังหารครีป และมอนสเตอร์เต็มจำนวน ส่วนเจ้าของไอเทมนี้จะได้รับเพียง 25%~50%(ค่อยเพิ่มขึ้นตามเวลา สูงสุดนาทีที่ 15)",
            "สกิลติดตัว-Magical Shadow:\nเพิ่มลดคูลดาวน์ 5% และความเร็วโจมตี 5% ให้แก่ตัวเองและพันธมิตรรอบๆ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/aquaflame-rejuvenate.png",
    },
    {
        "name": "Arcane Hammer",
        "slug": "arcane-hammer",
        "category": "attack",
        "tier": 2,
        "price": 740,
        "stats": {
            "attack_damage": 25.0,
            "attack_speed": 15.0,
        },
        "stats_raw": [
            "+25 พลังโจมตี",
            "+15% ความเร็วโจมตี",
        ],
        "passives": [
            "Unique Passive - Speed Up: Normal attacks increase movement speed by 10%.",
        ],
        "desc_th": [
            "สกิลติดตัว - Speed Up:\nเมื่อทำการโจมตีปกติ รับความเร็วเคลื่อนที่ +10%",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/arcane-hammer.png",
    },
    {
        "name": "Arctic Orb",
        "slug": "arctic-orb",
        "category": "magic",
        "tier": 3,
        "price": 2200,
        "stats": {
            "ability_power": 200.0,
            "magic_life_steal": 12.0,
        },
        "stats_raw": [
            "+200 พลังเวท",
            "+12% เวทแวมไพร์",
        ],
        "passives": [
            "Active - Solidify: Gain invulnerability for 2s, during which movement, attacks, and skills are disabled. Afterward, gain a 500 (+40 per hero level) (+0.5 AP) shield for 1s (cooldown 75s).",
        ],
        "desc_th": [
            "สกิลพิเศษ - [Solidify]:\nเป็นอมตะ 2 วิ ระหว่างนั้นจะไม่สามารถเคลื่อนที่, โจมตี หรือใช้สกิลได้ เมื่อสิ้นสุดจะได้โล่ 500 (Lv อัพ+40) (+0.5 AP) 1 วิ (คูลดาวน์ 75 วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/arctic-orb.png",
    },
    {
        "name": "Astral Spear",
        "slug": "astral-spear",
        "category": "attack",
        "tier": 2,
        "price": 830,
        "stats": {
            "attack_damage": 50.0,
        },
        "stats_raw": [
            "+50 พลังโจมตี",
        ],
        "passives": [
            "Unique Passive: Armor Pierce +60",
        ],
        "desc_th": [
            "สกิลติดตัว: เจาะเกราะ+60",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/astral-spear.png",
    },
    {
        "name": "Belt of Clarity",
        "slug": "belt-of-clarity",
        "category": "defense",
        "tier": 2,
        "price": 1100,
        "stats": {
            "magic_defense": 110.0,
            "max_hp": 700.0,
        },
        "stats_raw": [
            "+110 ต้านทานเวท",
            "+700 พลังชีวิต",
        ],
        "passives": [
            "Passive - Regenerate: When taking damage, restores 4% HP over 2s (CD 15s).",
        ],
        "desc_th": [
            "สกิลติดตัว - Regenerate:\nเมื่อโดนโจมตีจะฟื้นฟู HP 4% ภายใน 2 วิ (CD 15 วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/belt-of-clarity.png",
    },
    {
        "name": "Berith's Agony",
        "slug": "beriths-agony",
        "category": "magic",
        "tier": 3,
        "price": 1800,
        "stats": {
            "ability_power": 140.0,
            "cooldown_reduction": 10.0,
            "max_hp": 600.0,
        },
        "stats_raw": [
            "+140 พลังเวท",
            "+10% ลดคูลดาวน์",
            "+600 พลังชีวิต",
        ],
        "passives": [
            "Passive - Torture: Dealing ability damage deals 80 (+2% target's max HP) magic damage every second for 3s (capped at 200 vs jungle monsters).",
        ],
        "desc_th": [
            "สกิลติดตัว - Torture:\nเมื่อใช้สกิลถูกเป้าหมายจะสร้างความเสียหายเวท80(+2%พลังชีวิตสูงสุดเป้าหมาย)ทุกวินาที นาน 3 วิ (หากโจมตีมอนสเตอร์ป่าจะจำกัดที่ 200 หน่วย)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/beriths-agony.png",
    },
    {
        "name": "Blade of Eternity",
        "slug": "blade-of-eternity",
        "category": "defense",
        "tier": 3,
        "price": 2400,
        "stats": {
            "armor": 120.0,
        },
        "stats_raw": [
            "+120 เกราะ",
        ],
        "passives": [
            "Passive - Resurrect: Resurrects 2s after death with 2000 + (hero level x 100) HP. CD: 150s (can only be triggered twice per match).",
            "Passive - War Rage: Increases damage dealt by 10%.",
        ],
        "desc_th": [
            "สกิลติดตัว - Resurrect:\nหลังจากตายลง 2 วิ ฮีโร่จะคืนชีพด้วย HP 2000 + (LV ฮีโร่ x100) CD 150 วิ (เอฟเฟกต์จะมีผลแค่ 2 ครั้งต่อ 1 เกม)",
            "สกิลติดตัว - War Rage:\nสร้างความเสียหายเพิ่มขึ้น 10%",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/blade-of-eternity.png",
    },
    {
        "name": "Blitz Blade",
        "slug": "blitz-blade",
        "category": "attack",
        "tier": 3,
        "price": 1840,
        "stats": {
            "attack_speed": 35.0,
            "movement_speed_pct": 8.0,
        },
        "stats_raw": [
            "+35% ความเร็วโจมตี",
            "+8% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Unique Passive - Chain Lightning: Normal attacks deal 45~87 bonus magic damage. Every 3 normal attacks releases a chain lightning dealing 150~430 magic damage (0.3s CD).",
        ],
        "desc_th": [
            "สกิลติดตัว - Chain Lightning:\nการโจมตีปกติสร้างโบนัสความเสียหายเวท 45~87 หน่วย การโจมตีปกติทุก 3 ครั้งจะปล่อย Chain Lightning 1 ครั้งและสร้างความเสียหายเวท 150~430 หน่วย (CD: 0.3 วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/blitz-blade.png",
    },
    {
        "name": "Bloodied Club",
        "slug": "bloodied-club",
        "category": "attack",
        "tier": 1,
        "price": 410,
        "stats": {
            "attack_damage": 10.0,
            "life_steal": 8.0,
        },
        "stats_raw": [
            "+10 พลังโจมตี",
            "+8% ดูดเลือด",
        ],
        "passives": [],
        "desc_th": [
            "+10 พลังโจมตี\n+8% ดูดเลือด",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/bloodied-club.png",
    },
    {
        "name": "Bloodthirsty Blade",
        "slug": "bloodthirsty-blade",
        "category": "attack",
        "tier": 2,
        "price": 830,
        "stats": {
            "attack_damage": 30.0,
            "life_steal": 10.0,
        },
        "stats_raw": [
            "+30 พลังโจมตี",
            "+10% ดูดเลือด",
        ],
        "passives": [
            "Passive - Blood Feast: When HP falls below 30%, recovers 400-610 HP over 5s (20s CD).",
        ],
        "desc_th": [
            "สกิลติดตัว - Blood Feast:\nเมื่อพลังชีวิตต่ำกว่า 30% จะฟื้นฟู พลังชีวิต 400 - 610 หน่วยของพลังชีวิตสูงสุด ภายใน 5 วินาที CD 20 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/bloodthirsty-blade.png",
    },
    {
        "name": "Boomstick",
        "slug": "boomstick",
        "category": "magic",
        "tier": 3,
        "price": 1800,
        "stats": {
            "ability_power": 200.0,
            "movement_speed_pct": 5.0,
        },
        "stats_raw": [
            "+200 พลังเวท",
            "+5% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Passive - Echo: Dealing ability damage triggers an explosion dealing 120 (+40% AP) magic damage (CD 5s).",
        ],
        "desc_th": [
            "สกิลติดตัว - Echo:\nเมื่อใช้สกิล จะระเบิดสร้างความเสียหายเวท 120 (+40% โบนัสพลังเวท) (CD 5 วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/boomstick.png",
    },
    {
        "name": "Boots of Speed",
        "slug": "boots-of-speed",
        "category": "movement",
        "tier": 1,
        "price": 250,
        "stats": {
            "movement_speed": 30.0,
        },
        "stats_raw": [
            "สกิลติดตัว: ความเร็วเคลื่อนที่ +30",
        ],
        "passives": [
            "Unique Passive: Movement Speed +30",
        ],
        "desc_th": [
            "สกิลติดตัว: ความเร็วเคลื่อนที่ +30",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/boots-of-speed.png",
    },
    {
        "name": "Bow of Slaughter",
        "slug": "bow-of-slaughter",
        "category": "attack",
        "tier": 3,
        "price": 2250,
        "stats": {
            "attack_damage": 90.0,
            "critical_chance": 10.0,
            "life_steal": 10.0,
        },
        "stats_raw": [
            "+90 พลังโจมตี",
            "+10% อัตราคริติคอล",
            "+10% ดูดเลือด",
        ],
        "passives": [
            "Active - Bloodthirst: Increases Life Steal by 60% for 3s (ranged only). Cooldown: 60s.",
        ],
        "desc_th": [
            "สกิลพิเศษ - [Bloodthirst]:\nดูดเลือดเพิ่มขึ้น 60% เป็นเวลา 3 วิ (ระยะไกลเท่านั้น) CD 60 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/bow-of-slaughter.png",
    },
    {
        "name": "Broken Spears",
        "slug": "broken-spears",
        "category": "attack",
        "tier": 3,
        "price": 1900,
        "stats": {
            "attack_damage": 110.0,
        },
        "stats_raw": [
            "+110 พลังโจมตี",
        ],
        "passives": [
            "Passive - Wind Walk: Increases movement speed by 10% when out of combat.",
            "Passive - Destroyer: Increases Armor Pierce by 40-180 (+10 per hero level).",
        ],
        "desc_th": [
            "สกิลติดตัว - Wind Walk:\nความเร็วเคลื่อนที่เพิ่มขึ้น 10% เมื่อไม่ได้ต่อสู้",
            "สกิลติดตัว - Destroyer:\nเพิ่มเจาะเกราะ 40-180 (LV อัพ+10)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/broken-spears.png",
    },
    {
        "name": "Carano's Pledge",
        "slug": "caranos-pledge",
        "category": "magic",
        "tier": 3,
        "price": 2050,
        "stats": {
            "ability_power": 180.0,
            "magic_life_steal": 12.0,
            "movement_speed_pct": 5.0,
        },
        "stats_raw": [
            "+180 พลังเวท",
            "+12% เวทแวมไพร์",
            "+5% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Passive - Spare Life: When HP falls below 30%, immediately removes all crowd control effects, gains a 510-1000 (+100% AP +8% bonus HP) shield, and increases movement speed by 30% for 4s (75s CD).",
        ],
        "desc_th": [
            "สกิลติดตัว - Spare Life:\nเมื่อพลังชีวิตต่ำกว่า 30% จะยกเลิกสถานะควบคุมที่ตัวเองได้รับทันที และได้รับ โล่ 510 - 1000 (+100% โบนัส AP +8% โบนัสพลังชีวิต) พร้อมเพิ่มความเร็วในการเคลื่อนที่ 30% เป็นเวลา 4 วิ CD 75 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/caranos-pledge.png",
    },
]


def main():
    print(f"Total items to write: {len(items_g0)}")
    assert len(items_g0) == 19, f"Expected 19 items, got {len(items_g0)}"

    REQUIRED_FIELDS = [
        "name",
        "slug",
        "category",
        "tier",
        "price",
        "stats",
        "stats_raw",
        "passives",
        "desc_th",
        "passives_incomplete",
        "icon_url",
    ]

    names = set()
    slugs = set()
    for item in items_g0:
        for f in REQUIRED_FIELDS:
            assert f in item, f"Item {item.get('name')} missing field {f}"
        assert item["name"] not in names, f"Duplicate name {item['name']}"
        assert item["slug"] not in slugs, f"Duplicate slug {item['slug']}"
        names.add(item["name"])
        slugs.add(item["slug"])
        assert isinstance(item["desc_th"], list), f"{item['name']} desc_th is not list"
        assert len(item["desc_th"]) > 0, f"{item['name']} desc_th is empty"
        assert item["price"] is not None and isinstance(item["price"], int), f"{item['name']} invalid price"
        assert item["tier"] in [1, 2, 3], f"{item['name']} invalid tier"
        assert item["category"] in [
            "attack",
            "magic",
            "defense",
            "movement",
            "jungle",
            "support",
        ], f"{item['name']} invalid category"
        assert item["passives_incomplete"] is False

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(items_g0, f, indent=2, ensure_ascii=False)

    print(f"Successfully wrote {len(items_g0)} items to {OUTPUT_FILE}")

    # Re-read and verify
    with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
        loaded = json.load(f)
    print(f"Verified loaded items count: {len(loaded)}")
    assert len(loaded) == 19


if __name__ == "__main__":
    main()
