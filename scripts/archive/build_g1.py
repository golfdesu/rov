import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_FILE = ROOT / "scripts" / "extracted_items_g1.json"

items_g1 = [
    {
        "name": "Chain Hammer",
        "slug": "chain-hammer",
        "category": "attack",
        "tier": 1,
        "price": 450,
        "stats": {
            "attack_damage": 40.0,
        },
        "stats_raw": [
            "+40 พลังโจมตี",
        ],
        "passives": [],
        "desc_th": [
            "+40 พลังโจมตี",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/chain-hammer.png",
    },
    {
        "name": "Chaos Bow",
        "slug": "chaos-bow",
        "category": "attack",
        "tier": 2,
        "price": 1100,
        "stats": {
            "attack_damage": 40.0,
            "attack_speed": 10.0,
        },
        "stats_raw": [
            "+40 พลังโจมตี",
            "+10% ความเร็วโจมตี",
        ],
        "passives": [
            "Unique Passive - Stab: Increases armor penetration by 10% (doubled for ranged heroes).",
        ],
        "desc_th": [
            "สกิลติดตัว - Stab:\nเพิ่มเจาะเกราะ 10%\n(ฮีโร่โจมตีไกลได้รับผล 2 เท่า)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/chaos-bow.png",
    },
    {
        "name": "Claves Sancti",
        "slug": "claves-sancti",
        "category": "attack",
        "tier": 3,
        "price": 2120,
        "stats": {
            "attack_damage": 100.0,
        },
        "stats_raw": [
            "+100 พลังโจมตี",
        ],
        "passives": [
            "Unique Passive - Gift of the Swift: Increases movement speed by (3-45) for 1.5s after landing a critical hit (only effective on ranged heroes).",
            "Unique Passive: +25% Critical Chance.",
            "Unique Passive: +40% Critical Damage.",
        ],
        "desc_th": [
            "สกิลติดตัว - Gift of the Swift:\nความเร็วเคลื่อนที่เพิ่มขึ้น (3-45) เป็นเวลา 1.5 วิ (มีผลเฉพาะฮีโร่ระยะไกล)",
            "สกิลติดตัว: โอกาสคริติคอล +25%",
            "สกิลติดตัว: ความแรงคริเพิ่มขึ้น 40%",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/claves-sancti.png",
    },
    {
        "name": "Cleaving Claymore",
        "slug": "cleaving-claymore",
        "category": "attack",
        "tier": 2,
        "price": 910,
        "stats": {
            "attack_damage": 80.0,
        },
        "stats_raw": [
            "+80 พลังโจมตี",
        ],
        "passives": [],
        "desc_th": [
            "+80 พลังโจมตี",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/cleaving-claymore.png",
    },
    {
        "name": "Curse of Death",
        "slug": "curse-of-death",
        "category": "attack",
        "tier": 3,
        "price": 1900,
        "stats": {
            "attack_damage": 80.0,
            "cooldown_reduction": 10.0,
            "max_hp": 800.0,
        },
        "stats_raw": [
            "+80 พลังโจมตี",
            "+10% ลดคูลดาวน์",
            "+800 พลังชีวิต",
        ],
        "passives": [
            "Passive - Soul Prison: Dealing damage with normal attacks or skills reduces the target's HP recovery by 40% for 3 seconds.",
        ],
        "desc_th": [
            "สกิลติดตัว - Soul Prison:\nหากการโจมตีปกติหรือใช้สกิลสร้างความเสียหาย การฟื้นฟูพลังชีวิตของเป้าหมายจะลดลง 40% เป็นเวลา 3 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/curse-of-death.png",
    },
    {
        "name": "Dagger",
        "slug": "dagger",
        "category": "attack",
        "tier": 1,
        "price": 290,
        "stats": {
            "attack_speed": 10.0,
        },
        "stats_raw": [
            "+10% ความเร็วโจมตี",
        ],
        "passives": [],
        "desc_th": [
            "+10% ความเร็วโจมตี",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/dagger.png",
    },
    {
        "name": "Death Sickle",
        "slug": "death-sickle",
        "category": "attack",
        "tier": 3,
        "price": 2000,
        "stats": {
            "attack_damage": 75.0,
            "attack_speed": 15.0,
            "max_hp": 500.0,
        },
        "stats_raw": [
            "+75 พลังโจมตี",
            "+15% ความเร็วโจมตี",
            "+500 พลังชีวิต",
        ],
        "passives": [
            "Unique Passive - The Insatiable: Gains invincibility and temporary damage immunity when HP is low, and increases attack and movement speed by 25% for 0.75 seconds. After accumulating for 4 minutes, the effect increases to 1.25 seconds (Cooldown: 120 seconds).",
        ],
        "desc_th": [
            "สกิลติดตัว - The Insatiable:\nเป็นอมตะเมื่อพลังชีวิตต่ำ สามารถป้องกันความเสียหายในเวลาสั้นๆ ทำให้วิ่งเร็วและโจมตีเร็วขึ้น 25% เป็นเวลา 0.75 วิ หากสะสมครบ 4 นาทีจะเพิ่มเอฟเฟกต์เป็น 1.25 วิ CD 120 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/death-sickle.png",
    },
    {
        "name": "Earth Gem",
        "slug": "earth-gem",
        "category": "support",
        "tier": 2,
        "price": 900,
        "stats": {
            "max_hp": 600.0,
            "movement_speed_pct": 5.0,
        },
        "stats_raw": [
            "+600 พลังชีวิต",
            "+5% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Passive - Reward: Increases primary attack stat by 16~30 (1 primary stat = 1 AD or 2 AP), and increases max HP by 200~410.",
            "Passive - Up-and-Coming: Every 3s, gain 6 EXP and give 6 gold to the teammate with the lowest gold. Unfarmed lane minions drop 50% gold on the ground, which can be collected up to 450 gold, and can absorb 1 coin from the map (Cooldown: 15s).",
            "Passive - Modest: Nearby allied heroes gain full gold and EXP from killing minions and monsters, while the bearer of this item only receives 25%~50% (scales over time, reaching maximum at minute 15).",
            "Passive - Genesis: Increases physical defense and magic defense by 32~60 for self and nearby allies.",
        ],
        "desc_th": [
            "สกิลติดตัว - Reward:\nเพิ่มสเตตัสโจมตีหลัก 16~30 หน่วย (1 สเตตัสโจมตีหลัก = AD 1 หรือ AP 2) เพิ่มพลังชีวิตสูงสุด 200~410 หน่วย",
            "สกิลติดตัว - Up-and-Coming:\nทุกๆ 3 วิ ได้รับ 6 XP และฮีโร่ที่มีการเงินน้อยที่สุดในทีมจะได้รับ 6 เหรียญทอง ครีปเลนที่ไม่มีผู้เล่นฟาร์ม จะดรอปเหรียญทอง 50% ลงพื้น ซึ่งสามารถเก็บเหรียญทองได้มากสุด 450 เหรียญ และสามารถดูดเหรียญทอง 1 เหรียญจากแผนที่ CD 15 วิ",
            "สกิลติดตัว - Modest:\nฮีโร่พันธมิตรที่อยู่รอบๆ จะได้รับโกลด์ และ XP จากการสังหารครีป และมอนสเตอร์เต็มจำนวน ส่วนเจ้าของไอเทมนี้จะได้รับเพียง 25%~50%(ค่อยเพิ่มขึ้นตามเวลา สูงสุดนาทีที่ 15)",
            "สกิลติดตัว Genesis:\nเพิ่มพลังป้องกันกายภาพและพลังป้องกันเวท 32~60 ให้ตัวเองและพันธมิตรรอบๆ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/earth-gem.png",
    },
    {
        "name": "Eclipsing Bow",
        "slug": "eclipsing-bow",
        "category": "attack",
        "tier": 3,
        "price": 2000,
        "stats": {
            "attack_speed": 30.0,
            "critical_chance": 10.0,
            "movement_speed_pct": 5.0,
        },
        "stats_raw": [
            "+30% ความเร็วโจมตี",
            "+10% อัตราคริติคอล",
            "+5% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Active - [Reach]: Increases normal attack range by 150 and movement speed by 20% for 5s (range increase only applies to ranged heroes). Cooldown: 60s.",
            "Passive - Wound: Normal attacks deal an additional 50 physical damage (doubled for ranged heroes). Cooldown: 0.35s.",
        ],
        "desc_th": [
            "สกิลกดใช้ - [Reach]:\nเพิ่มระยะโจมตีปกติ 150 และความเร็วเคลื่อนที่ 20% เป็นเวลา 5 วิ (เอฟเฟกต์เพิ่มระยะจะมีผลแค่กับฮีโร่ระยะไกลเท่านั้น) CD 60 วิ",
            "สกิลติดตัว - Wound:\nการโจมตีปกติจะสร้างโบนัสความเสียหายกายภาพ 50 (ฮีโร่ระยะไกลจะเพิ่มสองเท่า) CD: 0.35 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/eclipsing-bow.png",
    },
    {
        "name": "Elemental Stone",
        "slug": "elemental-stone",
        "category": "support",
        "tier": 1,
        "price": 300,
        "stats": {
            "movement_speed_pct": 5.0,
        },
        "stats_raw": [
            "+5% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Passive - Up-and-Coming: Gain 6 EXP every 3s and give 6 gold to the teammate with the lowest gold.",
            "Passive - Modest: Nearby allied heroes gain full gold and EXP from killing minions and monsters, while the bearer of this item only receives 25%~50% (scales over time, reaching maximum at minute 15).",
        ],
        "desc_th": [
            "สกิลติดตัว - Up-and-Coming:\nได้รับ 6 XP ทุก 3 วิ และมอบ 6 เหรียญทองให้แก่ฮีโร่ที่ได้รับเหรียญทองน้อยที่สุดในทีม",
            "สกิลติดตัว - Modest:\nฮีโร่พันธมิตรที่อยู่รอบๆ จะได้รับโกลด์ และ XP จากการสังหารครีป และมอนสเตอร์เต็มจำนวน ส่วนเจ้าของไอเทมนี้จะได้รับเพียง 25%~50%(ค่อยเพิ่มขึ้นตามเวลา สูงสุดนาทีที่ 15)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/elemental-stone.png",
    },
    {
        "name": "Enchanted Kicks",
        "slug": "enchanted-kicks",
        "category": "movement",
        "tier": 2,
        "price": 700,
        "stats": {
            "movement_speed": 60.0,
        },
        "stats_raw": [],
        "passives": [
            "Passive: +60 Movement Speed.",
            "Passive: +100 Magic Pierce.",
            "Can switch to other LV2 boots for free (Cooldown: 3 minutes).",
        ],
        "desc_th": [
            "สกิลติดตัว: ความเร็วเคลื่อนที่ +60",
            "สกิลติดตัว: เจาะเกราะเวท +100",
            "สามารถสลับไปใช้รองเท้า LV2 อื่นได้ฟรี CD 3 นาที",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/enchanted-kicks.png",
    },
    {
        "name": "Enchanted Scroll",
        "slug": "enchanted-scroll",
        "category": "magic",
        "tier": 2,
        "price": 820,
        "stats": {
            "ability_power": 120.0,
        },
        "stats_raw": [
            "+120 พลังเวท",
        ],
        "passives": [],
        "desc_th": [
            "+120 พลังเวท",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/enchanted-scroll.png",
    },
    {
        "name": "Evil Secrets",
        "slug": "evil-secrets",
        "category": "magic",
        "tier": 3,
        "price": 1980,
        "stats": {
            "ability_power": 140.0,
            "max_hp": 500.0,
        },
        "stats_raw": [
            "+140 พลังเวท",
            "+500 พลังชีวิต",
        ],
        "passives": [
            "Passive - Curse: Hitting a target with a skill reduces their AP by 10% and magic defense by 100 for 3 seconds.",
        ],
        "desc_th": [
            "สกิลติดตัว - Curse:\nเมื่อใช้สกิลโจมตีโดนเป้าหมายจะลดพลังเวท 10% และเกราะเวท 100 หน่วยของเป้าหมาย เป็นเวลา 3 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/evil-secrets.png",
    },
    {
        "name": "Fafnir's Talon",
        "slug": "fafnirs-talon",
        "category": "attack",
        "tier": 3,
        "price": 2040,
        "stats": {
            "attack_damage": 60.0,
            "attack_speed": 30.0,
            "life_steal": 10.0,
        },
        "stats_raw": [
            "+60 พลังโจมตี",
            "+30% ความเร็วโจมตี",
            "+10% ดูดเลือด",
        ],
        "passives": [
            "Unique Passive - Dragon's Breath: Normal attacks deal additional physical damage equal to 8% of target's current HP (Cooldown: 0.35s).",
        ],
        "desc_th": [
            "สกิลติดตัว - Dragon's Breath:\nการโจมตีปกติจะสร้างความเสียหายกายภาพ เท่ากับ 8% ของ HP ศัตรู (CD 0.35วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/fafnirs-talon.png",
    },
    {
        "name": "Fenrir's Tooth",
        "slug": "fenrirs-tooth",
        "category": "attack",
        "tier": 3,
        "price": 2800,
        "stats": {
            "attack_damage": 180.0,
            "cooldown_reduction": 5.0,
        },
        "stats_raw": [
            "+180 พลังโจมตี",
            "+5% ลดคูลดาวน์",
        ],
        "passives": [
            "Unique Passive - Fenrir's Tooth: Deals an additional 30% damage when the target's HP is below 50%.",
        ],
        "desc_th": [
            "สกิลติดตัว - Fenrir's Tooth:\nเมื่อ HP ของเป้าหมายต่ำกว่า 50% จะได้รับความเสียหาย +30%",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/fenrirs-tooth.png",
    },
    {
        "name": "Fire Gem",
        "slug": "fire-gem",
        "category": "support",
        "tier": 2,
        "price": 900,
        "stats": {
            "max_hp": 600.0,
            "movement_speed_pct": 5.0,
        },
        "stats_raw": [
            "+600 พลังชีวิต",
            "+5% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Passive - Reward: Increases primary attack stat by 16~30 (1 primary stat = 1 AD or 2 AP), and increases max HP by 200~410.",
            "Passive - Up-and-Coming: Every 3s, gain 6 EXP and give 6 gold to the teammate with the lowest gold. Unfarmed lane minions drop 50% gold on the ground, which can be collected up to 450 gold, and can absorb 1 coin from the map (Cooldown: 15s).",
            "Passive - Modest: Nearby allied heroes gain full gold and EXP from killing minions and monsters, while the bearer of this item only receives 25%~50% (scales over time, reaching maximum at minute 15).",
            "Passive - Magical Shadow: Increases cooldown reduction by 5% and attack speed by 5% for self and nearby allies.",
        ],
        "desc_th": [
            "สกิลติดตัว - Reward:\nเพิ่มสเตตัสโจมตีหลัก 16~30 หน่วย (1 สเตตัสโจมตีหลัก = AD 1 หรือ AP 2) เพิ่มพลังชีวิตสูงสุด 200~410 หน่วย",
            "สกิลติดตัว - Up-and-Coming:\nทุกๆ 3 วิ ได้รับ 6 XP และฮีโร่ที่มีการเงินน้อยที่สุดในทีมจะได้รับ 6 เหรียญทอง ครีปเลนที่ไม่มีผู้เล่นฟาร์ม จะดรอปเหรียญทอง 50% ลงพื้น ซึ่งสามารถเก็บเหรียญทองได้มากสุด 450 เหรียญ และสามารถดูดเหรียญทอง 1 เหรียญจากแผนที่ CD 15 วิ",
            "สกิลติดตัว - Modest:\nฮีโร่พันธมิตรที่อยู่รอบๆ จะได้รับโกลด์ และ XP จากการสังหารครีป และมอนสเตอร์เต็มจำนวน ส่วนเจ้าของไอเทมนี้จะได้รับเพียง 25%~50%(ค่อยเพิ่มขึ้นตามเวลา สูงสุดนาทีที่ 15)",
            "สกิลติดตัว-Magical Shadow:\nเพิ่มลดคูลดาวน์ 5% และความเร็วโจมตี 5% ให้แก่ตัวเองและพันธมิตรรอบๆ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/fire-gem.png",
    },
    {
        "name": "Firestorm Bow",
        "slug": "firestorm-bow",
        "category": "jungle",
        "tier": 3,
        "price": 2000,
        "stats": {
            "attack_speed": 30.0,
            "life_steal": 15.0,
            "movement_speed_pct": 7.0,
        },
        "stats_raw": [
            "+30% ความเร็วโจมตี",
            "+15% ดูดเลือด",
            "+7% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "(Obtains talent Frostbite)",
            "Passive - Firestorm: Normal attacks apply a mark to the target, each mark dealing 15 (+1 every 3 levels) magic damage, stacking up to 6 times (Cooldown: 0.3s).",
            "Passive - Hunting: Increases EXP gained from killing jungle monsters by 35%. Normal attacks and skills dealing damage to jungle monsters deal 60~172 true damage every 0.5s for 2s.",
            "Passive - Hunt: When self or nearby allied heroes kill a jungle monster, gain 0.8% attack speed and 0.2% life steal, stacking up to 25 times.",
            "Passive - Modest: When nearby allied heroes are present, they receive all gold and EXP from minions while self receives only 50% (effect expires at minute 4). Damage to minions reduced by 25% (effect expires at minute 4).",
        ],
        "desc_th": [
            "(ได้รับสกิล Frostbite)",
            "สกิลติดตัว - Firestorm:\nการโจมตีปกติจะทำให้เป้าหมายติดขั้นสัญลักษณ์ โดยแต่ละขั้นจะสร้างความเสียหายเวท 15 (เพิ่มขึ้น 1 ทุกๆ 3 LV) หน่วย สูงสุด 6 ขั้น (CD 0.3 วิ)",
            "สกิลติดตัว - Hunting :\nได้รับ XP เมื่อฆ่ามอนสเตอร์ป่าเพิ่มขึ้น 35% และเมื่อโจมตีปกติ/ใช้สกิลโดนมอนสเตอร์ป่าจะสร้างความเสียหายจริง 60~172 แก่เป้าหมายดังกล่าวทุก 0.5 วิ เป็นเวลา 2 วิ",
            "สกิลติดตัว - Hunt:\nหากตัวเองหรือฮีโร่พันธมิตรรอบๆ สังหารมอนสเตอร์ป่า จะได้รับความเร็วโจมตี 0.8% และดูดเลือด 0.2% สะสมได้สูงสุด 25 ครั้ง",
            "สกิลติดตัว - Modest:\nเมื่อมีฮีโร่พันธมิตรอยู่ใกล้ๆ ฮีโร่พันธมิตรจะได้รับเหรียญทองและ XP ทั้งหมดจากครีป ส่วนตนเองจะได้รับเพียง 50% เอฟเฟกต์จะหายไปในนาทีที่ 4 ความเสียหายต่อครีปลดลง 25% และเอฟเฟกต์นี้จะหายไปในนาทีที่ 4",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/firestorm-bow.png",
    },
    {
        "name": "Flashy Boots",
        "slug": "flashy-boots",
        "category": "movement",
        "tier": 2,
        "price": 700,
        "stats": {
            "cooldown_reduction": 15.0,
            "movement_speed": 60.0,
        },
        "stats_raw": [
            "+15% ลดคูลดาวน์",
        ],
        "passives": [
            "Passive: +60 Movement Speed.",
            "Passive: Reduces Challenger Talent cooldown by 15%.",
            "Can switch to other LV2 boots for free (Cooldown: 3 minutes).",
        ],
        "desc_th": [
            "สกิลติดตัว: ความเร็วเคลื่อนที่ +60",
            "สกิลติดตัว: ลดเวลาคูลดาวน์สูงสุดของสกิลชาเลนเจอร์ลง 15%",
            "สามารถสลับไปใช้รองเท้า LV2 อื่นได้ฟรี CD 3 นาที",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/flashy-boots.png",
    },
    {
        "name": "Frost Cape",
        "slug": "frost-cape",
        "category": "defense",
        "tier": 3,
        "price": 1970,
        "stats": {
            "cooldown_reduction": 10.0,
            "armor": 200.0,
            "max_hp": 800.0,
        },
        "stats_raw": [
            "+10% ลดคูลดาวน์",
            "+200 เกราะ",
            "+800 พลังชีวิต",
        ],
        "passives": [
            "Passive - Frost Power: After using a skill, the next normal attack within 5s deals 100 (+30% bonus AD) area physical damage and reduces movement speed by 30% (20% for ranged heroes) for 0.5s (Cooldown: 0.65s).",
        ],
        "desc_th": [
            "สกิลติดตัว - Frost Power:\nหลังใช้สกิล การโจมตีปกติภายใน 5 วิ จะสร้างความเสียหายกายภาพ 100 (+30% โบนัส AD) เป็นวงกว้างพร้อมลดความเร็ว 30% (ฮีโร่โจมตีไกล 20%) เป็นเวลา 0.5 วิ (CD 0.65 วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/frost-cape.png",
    },
]

if __name__ == "__main__":
    assert len(items_g1) == 19
    for item in items_g1:
        assert item["name"]
        assert item["slug"]
        assert item["category"] in ["attack", "magic", "defense", "movement", "jungle", "support"]
        assert item["tier"] in [1, 2, 3]
        assert isinstance(item["price"], int)
        assert isinstance(item["stats"], dict)
        assert isinstance(item["stats_raw"], list)
        assert isinstance(item["passives"], list)
        assert isinstance(item["desc_th"], list) and len(item["desc_th"]) > 0
        assert item["passives_incomplete"] is False
        assert item["icon_url"]

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(items_g1, f, indent=2, ensure_ascii=False)

    print(f"Successfully generated {OUTPUT_FILE} with {len(items_g1)} items!")
