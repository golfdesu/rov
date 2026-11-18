import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_FILE = ROOT / "scripts" / "extracted_items_g5.json"

items_g5 = [
    {
        "name": "Staff of Nuul",
        "slug": "staff-of-nuul",
        "category": "magic",
        "tier": 3,
        "price": 2050,
        "stats": {
            "ability_power": 180.0,
            "cooldown_reduction": 10.0,
        },
        "stats_raw": [
            "+180 พลังเวท",
            "+10% ลดคูลดาวน์",
        ],
        "passives": [
            "Passive: Magic Pierce +40%",
        ],
        "desc_th": [
            "สกิลติดตัว: เจาะเกราะเวท +40%",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/staff-of-nuul.png",
    },
    {
        "name": "Stealth Bracer",
        "slug": "stealth-bracer",
        "category": "attack",
        "tier": 3,
        "price": 2040,
        "stats": {
            "attack_damage": 40.0,
            "attack_speed": 20.0,
            "critical_chance": 20.0,
            "max_hp": 650.0,
        },
        "stats_raw": [
            "+40 พลังโจมตี",
            "+20% ความเร็วโจมตี",
            "+20% อัตราคริติคอล",
            "+650 พลังชีวิต",
        ],
        "passives": [
            "Active - Untrackable: Instantly enter stealth (for 2.5s, melee heroes for 1s): gain 30% movement speed and recover 130~260 HP every 0.5s (using skills or normal attacks immediately ends stealth). Cooldown 75s.",
        ],
        "desc_th": [
            "สกิลกดใช้ - Untrackable\nเข้าสู่สถานะล่องหนทันที (เป็นเวลา 2.5 วิ ฮีโร่ระยะประชิดเป็นเวลา 1 วิ): ได้รับความเร็วเคลื่อนที่ 30% และทุกๆ 0.5 วิฟื้นฟู 130~260 (การใช้สกิลหรือโจมตีปกติจะออกจากสถานะล่องหนทันที) (คูลดาวน์ 75 วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/stealth-bracer.png",
    },
    {
        "name": "Stormy Bow",
        "slug": "stormy-bow",
        "category": "jungle",
        "tier": 2,
        "price": 700,
        "stats": {
            "attack_speed": 12.0,
        },
        "stats_raw": [
            "+12% ความเร็วโจมตี",
            "(ได้รับสกิล Frostbite)",
        ],
        "passives": [
            "Passive - Hunting: Increases EXP gained from killing jungle monsters by 35%. Normal attacks and skills dealing damage to jungle monsters deal 60~172 true damage every 0.5s for 2s.",
            "Passive - Hunt: Whenever self or nearby allied heroes kill a jungle monster, grants +0.8% attack speed and +0.2% life steal (stacks up to 15 times).",
            "Passive - Modest: When nearby allied heroes are present, allies receive 100% of gold and EXP from lane creeps while self receives only 50% (effect expires at 4 min). Damage dealt to lane creeps is reduced by 25% (effect expires at 4 min).",
        ],
        "desc_th": [
            "สกิลติดตัว - Hunting :\nได้รับ XP เมื่อฆ่ามอนสเตอร์ป่าเพิ่มขึ้น 35% และเมื่อโจมตีปกติ/ใช้สกิลโดนมอนสเตอร์ป่าจะสร้างความเสียหายจริง 60~172 แก่เป้าหมายดังกล่าวทุก 0.5 วิ เป็นเวลา 2 วิ",
            "สกิลติดตัว - Hunt:\nหากตัวเองหรือฮีโร่พันธมิตรรอบๆ สังหารมอนสเตอร์ป่า จะได้รับความเร็วโจมตี 0.8% และดูดเลือด 0.2% สะสมได้สูงสุด 15 ครั้ง",
            "สกิลติดตัว - Modest:\nเมื่อมีฮีโร่พันธมิตรอยู่ใกล้ๆ ฮีโร่พันธมิตรจะได้รับเหรียญทองและ XP ทั้งหมดจากครีป ส่วนตนเองจะได้รับเพียง 50% เอฟเฟกต์จะหายไปในนาทีที่ 4 ความเสียหายต่อครีปลดลง 25% และเอฟเฟกต์นี้จะหายไปในนาทีที่ 4",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/stormy-bow.png",
    },
    {
        "name": "Talisman of Strength",
        "slug": "talisman-of-strength",
        "category": "defense",
        "tier": 1,
        "price": 140,
        "stats": {
            "hp_regen_5s": 30.0,
        },
        "stats_raw": [
            "+30 ฟื้นฟูพลังชีวิต/5 วิ",
        ],
        "passives": [],
        "desc_th": [
            "+30 ฟื้นฟูพลังชีวิต/5 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/talisman-of-strength.png",
    },
    {
        "name": "Tempest Blades",
        "slug": "tempest-blades",
        "category": "attack",
        "tier": 2,
        "price": 780,
        "stats": {
            "attack_speed": 25.0,
            "movement_speed_pct": 5.0,
        },
        "stats_raw": [
            "+25% ความเร็วโจมตี",
            "+5% ความเร็วเคลื่อนที่",
        ],
        "passives": [],
        "desc_th": [
            "+25% ความเร็วโจมตี",
            "+5% ความเร็วเคลื่อนที่",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/tempest-blades.png",
    },
    {
        "name": "The Aegis",
        "slug": "the-aegis",
        "category": "defense",
        "tier": 3,
        "price": 2180,
        "stats": {
            "cooldown_reduction": 20.0,
            "max_mana": 400.0,
            "armor": 360.0,
        },
        "stats_raw": [
            "+20% ลดคูลดาวน์",
            "+400 มานาสูงสุด",
            "+360 เกราะ",
        ],
        "passives": [
            "Passive - Sentinel: Reduces the attack speed of enemies within 5m by 30%.",
        ],
        "desc_th": [
            "สกิลติดตัว - Sentinel:\nลดความเร็วโจมตีของศัตรูในระยะ 5m ลง 30%",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/the-aegis.png",
    },
    {
        "name": "The Beast",
        "slug": "the-beast",
        "category": "attack",
        "tier": 3,
        "price": 1800,
        "stats": {
            "attack_damage": 100.0,
            "life_steal": 25.0,
            "max_hp": 600.0,
        },
        "stats_raw": [
            "+100 พลังโจมตี",
            "+25% ดูดเลือด",
            "+600 พลังชีวิต",
        ],
        "passives": [
            "Passive - Blood Feast: When HP drops below 30%, restores 400 - 610 HP over 5s. Cooldown: 20s.",
        ],
        "desc_th": [
            "สกิลติดตัว - Blood Feast:\nเมื่อพลังชีวิตต่ำกว่า 30% จะฟื้นฟู พลังชีวิต 400 - 610 หน่วยของพลังชีวิตสูงสุด ภายใน 5 วินาที CD 20 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/the-beast.png",
    },
    {
        "name": "The Diminisher",
        "slug": "the-diminisher",
        "category": "attack",
        "tier": 3,
        "price": 2120,
        "stats": {
            "attack_damage": 100.0,
            "cooldown_reduction": 10.0,
            "max_hp": 500.0,
        },
        "stats_raw": [
            "+100 พลังโจมตี",
            "+10% ลดคูลดาวน์",
            "+500 พลังชีวิต",
        ],
        "passives": [
            "Active - Sturdy: Reduces damage taken by 40% for 2s (usable while controlled). Cooldown: 90s.",
            "Passive - Cripple: After using a skill, the first enemy hero hit is slowed by 30% and has damage reduced by 20% for 3s (Cooldown: 8s).",
        ],
        "desc_th": [
            "สกิลกดใช้ - [Sturdy]:\nลดความเสียหายที่ได้รับลง 40% เป็นเวลา 2 วิ (สามารถใช้ได้ขณะถูกสถานะควบคุม) CD 90 วิ",
            "สกิลติด - Cripple:\nหากใช้สกิล ฮีโร่ศัตรูตัวแรกที่โดนจะวิ่งช้าลง 30% และความเสียหายลดลง 20% เป็นเวลา 3 วิ (CD: 8 วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/the-diminisher.png",
    },
    {
        "name": "The Morning Star",
        "slug": "the-morning-star",
        "category": "attack",
        "tier": 3,
        "price": 2980,
        "stats": {
            "attack_damage": 50.0,
            "attack_speed": 30.0,
            "critical_chance": 10.0,
        },
        "stats_raw": [
            "+50 พลังโจมตี",
            "+30% ความเร็วโจมตี",
            "+10% อัตราคริติคอล",
        ],
        "passives": [
            "Passive - Dawning Star: Normal attacks deal an additional 50 physical damage (doubled for ranged heroes).",
            "Passive - Stab: Increases Armor Pierce by 20% (doubled for ranged heroes).",
        ],
        "desc_th": [
            "สกิลติดตัว - Dawning Star:\nการโจมตีปกติจะสร้างโบนัสความเสียหายกายภาพ 50 (2 เท่าหากเป็นฮีโร่โจมตีไกล)",
            "สกิลติดตัว - Stab:\nเพิ่มเจาะเกราะ 20% (2 เท่าหากเป็นฮีโร่โจมตีไกล)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/the-morning-star.png",
    },
    {
        "name": "Trick Blade",
        "slug": "trick-blade",
        "category": "magic",
        "tier": 2,
        "price": 820,
        "stats": {
            "ability_power": 40.0,
            "cooldown_reduction": 10.0,
        },
        "stats_raw": [
            "+40 พลังเวท",
            "+10% ลดคูลดาวน์",
        ],
        "passives": [
            "Passive - Elemental Edge: After using a skill, the next normal attack deals bonus magic damage equal to (30% AD + 18% AP). Cooldown: 3s.",
        ],
        "desc_th": [
            "สกิลติดตัว - Elemental Edge:\nเมื่อใช้สกิล การโจมตีปกติครั้งถัดไปจะสร้างโบนัส ความเสียหายเวท (30% AD+18% AP) (CD 3 วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/trick-blade.png",
    },
    {
        "name": "Uriel's Brand",
        "slug": "uriels-brand",
        "category": "attack",
        "tier": 3,
        "price": 2000,
        "stats": {
            "attack_damage": 80.0,
            "attack_speed": 25.0,
            "magic_defense": 200.0,
        },
        "stats_raw": [
            "+80 พลังโจมตี",
            "+25% ความเร็วโจมตี",
            "+200 ต้านทานเวท",
        ],
        "passives": [
            "Passive - Savior's Edge: When HP falls below 40%, gains a magic shield (600-2000) for 5s, +25% resistance, and +30% movement speed for 2s. Cooldown: 75s.",
            "Passive - Speed Up: Normal attacks increase movement speed by 10%.",
        ],
        "desc_th": [
            "สกิลติดตัว - Savior's Edge:\nเมื่อ HP ต่ำกว่า 40% จะสร้างโล่เวท (600-2000) เป็นเวลา 5 วิ รวมถึงได้รับต้านสถานะ 25% และวิ่งเร็วขึ้น 30% เป็นเวลา 2 วิ (CD 75 วิ)",
            "สกิลติดตัว - Speed Up:\nเมื่อทำการโจมตีปกติจะวิ่งเร็วขึ้น 10%",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/uriels-brand.png",
    },
    {
        "name": "Virtue's Bracelet",
        "slug": "virtues-bracelet",
        "category": "magic",
        "tier": 2,
        "price": 720,
        "stats": {
            "ability_power": 60.0,
            "cooldown_reduction": 5.0,
            "mana_regen_5s": 20.0,
        },
        "stats_raw": [
            "+60 พลังเวท",
            "+5% ลดคูลดาวน์",
            "+20 ฟื้นฟูมานา/5 วิ",
        ],
        "passives": [],
        "desc_th": [
            "+60 พลังเวท",
            "+5% ลดคูลดาวน์",
            "+20 ฟื้นฟูมานา/5 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/virtues-bracelet.png",
    },
    {
        "name": "Virtue's Necklace",
        "slug": "virtues-necklace",
        "category": "magic",
        "tier": 3,
        "price": 1800,
        "stats": {
            "ability_power": 160.0,
            "cooldown_reduction": 15.0,
            "mana_regen_5s": 25.0,
        },
        "stats_raw": [
            "+160 พลังเวท",
            "+15% ลดคูลดาวน์",
            "+25 ฟื้นฟูมานา/5 วิ",
        ],
        "passives": [
            "Passive - Enlightened: Regenerates 1% of maximum mana per second.",
        ],
        "desc_th": [
            "สกิลติดตัว - Enlightened:\nฟื้นฟูมานา 1% ต่อวิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/virtues-necklace.png",
    },
    {
        "name": "Vlad's Impaler",
        "slug": "vlads-impaler",
        "category": "magic",
        "tier": 2,
        "price": 800,
        "stats": {
            "ability_power": 80.0,
            "magic_life_steal": 12.0,
        },
        "stats_raw": [
            "+80 พลังเวท",
            "+12% เวทแวมไพร์",
        ],
        "passives": [],
        "desc_th": [
            "+80 พลังเวท",
            "+12% เวทแวมไพร์",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/vlads-impaler.png",
    },
    {
        "name": "War Boots",
        "slug": "war-boots",
        "category": "movement",
        "tier": 2,
        "price": 700,
        "stats": {
            "attack_speed": 20.0,
            "movement_speed": 60.0,
        },
        "stats_raw": [
            "+20% ความเร็วโจมตี",
        ],
        "passives": [
            "Passive: Movement Speed +60",
            "Passive: Normal attacks restore 20 HP (CD: 0.3s) (half effect if target is non-hero).",
            "Can freely switch to other Tier 2 boots for free (Cooldown: 3 min).",
        ],
        "desc_th": [
            "สกิลติดตัว: ความเร็วเคลื่อนที่ +60",
            "สกิลติดตัว:\nการโจมตีปกติจะฟื้นฟูพลังชีวิต 20 หน่วย (CD: 0.3 วิ) (มีผลแค่ครึ่งเดียวหากเป้าหมายไม่ใช่ฮีโร่)",
            "สามารถสลับไปใช้รองเท้า LV2 อื่นได้ฟรี CD 3 นาที",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/war-boots.png",
    },
    {
        "name": "Wildfire - Barrier",
        "slug": "wildfire-barrier",
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
            "Active - Barrier: Generates a shield that absorbs 680~1800 damage for self and nearby allies for 3s. Cooldown: 60s.",
            "Passive - Reward: Increases primary attack stat by 32~60 (1 primary stat = 1 AD or 2 AP), and increases max HP by 400~820.",
            "Passive - Up-and-Coming: Every 3s, gain 8 EXP and grant 8 gold to the lowest-gold ally. Minions dying without an ally nearby drop 50% gold on the ground (up to 600 gold), and pulls 1 gold from the map every 10s. Collecting 600 gold unlocks Resonance (active): grants large amount of gold and EXP to self and 1 ally (once per match).",
            "Passive - Modest: Nearby allies gain full gold and EXP from minions and monsters, while the user gains only 25%~50% (scales with time, max at 15 min).",
            "Passive - Magical Shadow: Grants +5% Cooldown Reduction and +5% Attack Speed to self and nearby allies.",
        ],
        "desc_th": [
            "สกิลกดใช้ Barrier:\nสร้างโล่ที่จะดูดซับความเสียหาย 680~1800 ให้ตัวเองและพันธมิตรในระยะเป็นเวลา 3 วิ (CD: 60 วิ)",
            "สกิลติดตัว - Reward:\nเพิ่มสเตตัสโจมตีหลัก 32~60 หน่วย (1 สเตตัสโจมตีหลัก = AD 1 หรือ AP 2) เพิ่มพลังชีวิตสูงสุด 400~820 หน่วย",
            "สกิลติดตัว - Up-and-Coming:\nทุกๆ 3 วิ ได้รับ 8 XP และฮีโร่ที่มีการเงินน้อยที่สุดในทีมจะได้รับ 8 เหรียญทอง ครีปเลนที่ไม่มีผู้เล่นฟาร์ม จะดรอปเหรียญทอง 50% ลงพื้น ซึ่งสามารถเก็บเหรียญทองได้มากสุด 600 เหรียญ และสามารถดูดเหรียญทอง 1 เหรียญจากแผนที่ CD 10 วิ เมื่อเก็บเหรียญทองครบ 600 เหรียญจะปลดล็อคสกิล Resonance กดใช้งานเพื่อมอบเหรียญทองและ XP จำนวนมากให้กับตัวเองและฮีโร่ฝ่ายเรา 1 ตัว (ใช้ได้ 1 ครั้ง/เกม)",
            "สกิลติดตัว - Modest:\nฮีโร่พันธมิตรที่อยู่รอบๆ จะได้รับโกลด์ และ XP จากการสังหารครีป และมอนสเตอร์เต็มจำนวน ส่วนเจ้าของไอเทมนี้จะได้รับเพียง 25%~50%(ค่อยเพิ่มขึ้นตามเวลา สูงสุดนาทีที่ 15)",
            "สกิลติดตัว-Magical Shadow:\nเพิ่มลดคูลดาวน์ 5% และความเร็วโจมตี 5% ให้แก่ตัวเองและพันธมิตรรอบๆ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/wildfire-barrier.png",
    },
    {
        "name": "Wildfire - Cleansing",
        "slug": "wildfire-cleansing",
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
            "Active - Cleansing: Immediately removes all crowd control effects from nearby allies and grants immunity to control effects for 0.5s. Cooldown: 90s.",
            "Passive - Reward: Increases primary attack stat by 32~60 (1 primary stat = 1 AD or 2 AP), and increases max HP by 400~820.",
            "Passive - Up-and-Coming: Every 3s, gain 8 EXP and grant 8 gold to the lowest-gold ally. Minions dying without an ally nearby drop 50% gold on the ground (up to 600 gold), and pulls 1 gold from the map every 10s. Collecting 600 gold unlocks Resonance (active): grants large amount of gold and EXP to self and 1 ally (once per match).",
            "Passive - Modest: Nearby allies gain full gold and EXP from minions and monsters, while the user gains only 25%~50% (scales with time, max at 15 min).",
            "Passive - Magical Shadow: Grants +5% Cooldown Reduction and +5% Attack Speed to self and nearby allies.",
        ],
        "desc_th": [
            "สกิลกดใช้ Cleansing:\nลบสถานะผิดปกติทั้งหมดออกจากพันธมิตรรอบตัว พร้อมใส่เอฟเฟกต์ป้องกันสถานะ 0.5 วิ คูลดาวน์ 90 วิ",
            "สกิลติดตัว - Reward:\nเพิ่มสเตตัสโจมตีหลัก 32~60 หน่วย (1 สเตตัสโจมตีหลัก = AD 1 หรือ AP 2) เพิ่มพลังชีวิตสูงสุด 400~820 หน่วย",
            "สกิลติดตัว - Up-and-Coming:\nทุกๆ 3 วิ ได้รับ 8 XP และฮีโร่ที่มีการเงินน้อยที่สุดในทีมจะได้รับ 8 เหรียญทอง ครีปเลนที่ไม่มีผู้เล่นฟาร์ม จะดรอปเหรียญทอง 50% ลงพื้น ซึ่งสามารถเก็บเหรียญทองได้มากสุด 600 เหรียญ และสามารถดูดเหรียญทอง 1 เหรียญจากแผนที่ CD 10 วิ เมื่อเก็บเหรียญทองครบ 600 เหรียญจะปลดล็อคสกิล Resonance กดใช้งานเพื่อมอบเหรียญทองและ XP จำนวนมากให้กับตัวเองและฮีโร่ฝ่ายเรา 1 ตัว (ใช้ได้ 1 ครั้ง/เกม)",
            "สกิลติดตัว - Modest:\nฮีโร่พันธมิตรที่อยู่รอบๆ จะได้รับโกลด์ และ XP จากการสังหารครีป และมอนสเตอร์เต็มจำนวน ส่วนเจ้าของไอเทมนี้จะได้รับเพียง 25%~50%(ค่อยเพิ่มขึ้นตามเวลา สูงสุดนาทีที่ 15)",
            "สกิลติดตัว-Magical Shadow:\nเพิ่มลดคูลดาวน์ 5% และความเร็วโจมตี 5% ให้แก่ตัวเองและพันธมิตรรอบๆ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/wildfire-cleansing.png",
    },
    {
        "name": "Wildfire - Magic Eye",
        "slug": "wildfire-magic-eye",
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
            "Active - Mesmerize: Reveals surrounding area for 4s, attacking surrounding enemies dealing magic damage 2 times over 2s (each hit deals magic damage equal to 8% current HP) and slows them by 50%. Cooldown: 45s.",
            "Passive - Reward: Increases primary attack stat by 32~60 (1 primary stat = 1 AD or 2 AP), and increases max HP by 400~820.",
            "Passive - Up-and-Coming: Every 3s, gain 8 EXP and grant 8 gold to the lowest-gold ally. Minions dying without an ally nearby drop 50% gold on the ground (up to 600 gold), and pulls 1 gold from the map every 10s. Collecting 600 gold unlocks Resonance (active): grants large amount of gold and EXP to self and 1 ally (once per match).",
            "Passive - Modest: Nearby allies gain full gold and EXP from minions and monsters, while the user gains only 25%~50% (scales with time, max at 15 min).",
            "Passive - Magical Shadow: Grants +5% Cooldown Reduction and +5% Attack Speed to self and nearby allies.",
        ],
        "desc_th": [
            "สกิลกดใช้ - Mesmerize:\nเปิดวิสัยทัศน์รอบตัวเป็นเวลา 4 วิ ระหว่างนั้นจะโจมตีศัตรูที่อยู่รอบๆ สร้างความเสียหายเวท 2 ครั้ง ใน 2 วิ แต่ละครั้งจะสร้างความเสียหายเวทเท่ากับ 8% ของพลังชีวิตปัจจุบันของเป้าหมาย พร้อมกับลดความเร็วเคลื่อนที่ 50% คูลดาวน์ 45 วิ",
            "สกิลติดตัว - Reward:\nเพิ่มสเตตัสโจมตีหลัก 32~60 หน่วย (1 สเตตัสโจมตีหลัก = AD 1 หรือ AP 2) เพิ่มพลังชีวิตสูงสุด 400~820 หน่วย",
            "สกิลติดตัว - Up-and-Coming:\nทุกๆ 3 วิ ได้รับ 8 XP และฮีโร่ที่มีการเงินน้อยที่สุดในทีมจะได้รับ 8 เหรียญทอง ครีปเลนที่ไม่มีผู้เล่นฟาร์ม จะดรอปเหรียญทอง 50% ลงพื้น ซึ่งสามารถเก็บเหรียญทองได้มากสุด 600 เหรียญ และสามารถดูดเหรียญทอง 1 เหรียญจากแผนที่ CD 10 วิ เมื่อเก็บเหรียญทองครบ 600 เหรียญจะปลดล็อคสกิล Resonance กดใช้งานเพื่อมอบเหรียญทองและ XP จำนวนมากให้กับตัวเองและฮีโร่ฝ่ายเรา 1 ตัว (ใช้ได้ 1 ครั้ง/เกม)",
            "สกิลติดตัว - Modest:\nฮีโร่พันธมิตรที่อยู่รอบๆ จะได้รับโกลด์ และ XP จากการสังหารครีป และมอนสเตอร์เต็มจำนวน ส่วนเจ้าของไอเทมนี้จะได้รับเพียง 25%~50%(ค่อยเพิ่มขึ้นตามเวลา สูงสุดนาทีที่ 15)",
            "สกิลติดตัว-Magical Shadow:\nเพิ่มลดคูลดาวน์ 5% และความเร็วโจมตี 5% ให้แก่ตัวเองและพันธมิตรรอบๆ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/wildfire-magic-eye.png",
    },
    {
        "name": "Zweihander",
        "slug": "zweihander",
        "category": "magic",
        "tier": 3,
        "price": 1900,
        "stats": {
            "attack_speed": 20.0,
            "ability_power": 180.0,
            "movement_speed_pct": 5.0,
        },
        "stats_raw": [
            "+20% ความเร็วโจมตี",
            "+180 พลังเวท",
            "+5% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Passive - Sudden Strike: Normal attacks increase attack speed by 15% for 4s (stacks up to 2 times). Cooldown: 10s.",
            "Passive - Scorching: Normal attacks deal bonus magic damage equal to 40 (+20% AP). Cooldown: 0.35s.",
        ],
        "desc_th": [
            "สกิลติดตัว - Sudden Strike:\nเมื่อโจมตีปกติ จะ+ตีเร็ว15% เป็นเวลา 4 วิ (สูงสุด 2 ครั้ง) CD 10 วิ",
            "สกิลติดตัว - Scorching :\nการโจมตีปกติสร้างโบนัสความเสียหายเวท 40 (20% โบนัสเวท) CD 0.35 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/zweihander.png",
    },
]


def main():
    print(f"Building {len(items_g5)} items for Group 5...")
    assert len(items_g5) == 19, f"Expected 19 items, got {len(items_g5)}"

    # Check required fields
    required_fields = [
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
    for idx, item in enumerate(items_g5):
        for field in required_fields:
            assert field in item, f"Item {idx} ({item.get('name')}) missing field '{field}'"
        assert item["price"] is not None and isinstance(item["price"], int), f"Item {item['name']} invalid price"
        assert len(item["desc_th"]) > 0, f"Item {item['name']} has empty desc_th"
        assert item["tier"] in [1, 2, 3], f"Item {item['name']} invalid tier"
        assert item["category"] in [
            "attack",
            "magic",
            "defense",
            "movement",
            "jungle",
            "support",
        ], f"Item {item['name']} invalid category"

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(items_g5, f, indent=2, ensure_ascii=False)

    print(f"Successfully saved {len(items_g5)} items to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
