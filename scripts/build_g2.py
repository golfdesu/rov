import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_FILE = ROOT / "scripts" / "extracted_items_g2.json"

items_g2 = [
    {
        "name": "Frost Hammer",
        "slug": "frost-hammer",
        "category": "attack",
        "tier": 3,
        "price": 2060,
        "stats": {
            "attack_damage": 60.0,
            "attack_speed": 30.0,
            "max_hp": 900.0,
        },
        "stats_raw": [
            "+60 พลังโจมตี",
            "+30% ความเร็วโจมตี",
            "+900 พลังชีวิต",
        ],
        "passives": [
            "Passive - Frostbite: Normal attacks and skills reduce movement speed by 5%-10% for 1.5s (stacks up to 2 times).",
            "Passive - Scar: Normal attacks and skills deal an additional 140-280 (+45% bonus AD) physical damage to the target. CD 3s.",
        ],
        "desc_th": [
            "สกิลติดตัว - Frostbite:\nการโจมตีปกติและสกิลจะลดความเร็วเคลื่อนที่ 5%-10% เป็นเวลา 1.5 วิ (สะสมสูงสุด 2 ชั้น)",
            "สกิลติดตัว - Scar:\nการโจมตีปกติและสกิลจะสร้างโบนัสความเสียหายกายภาพ 140 - 280 (+45% โบนัส AD) แก่เป้าหมาย CD 3 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/frost-hammer.png",
    },
    {
        "name": "Frostguard",
        "slug": "frostguard",
        "category": "magic",
        "tier": 3,
        "price": 2100,
        "stats": {
            "ability_power": 140.0,
            "cooldown_reduction": 5.0,
            "max_hp": 600.0,
        },
        "stats_raw": [
            "+140 พลังเวท",
            "+5% ลดคูลดาวน์",
            "+600 พลังชีวิต",
        ],
        "passives": [
            "Passive - Ice Armor: Gain armor and magic defense equal to (+50% bonus AP) (up to 230).",
        ],
        "desc_th": [
            "สกิลติดตัว - Ice Armor: ได้รับเกราะ และเกราะเวท (+50% โบนัสพลังเวท) (สูงสุดไม่เกิน 230)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/frostguard.png",
    },
    {
        "name": "Frosty's Revenge",
        "slug": "frostys-revenge",
        "category": "magic",
        "tier": 3,
        "price": 2020,
        "stats": {
            "ability_power": 140.0,
            "max_hp": 850.0,
            "movement_speed_pct": 5.0,
        },
        "stats_raw": [
            "+140 พลังเวท",
            "+850 พลังชีวิต",
            "+5% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Passive - Frost: Abilities that deal damage will reduce enemy movement speed by 20% for 2s.",
        ],
        "desc_th": [
            "สกิลติดตัว - Frost: สกิลที่สร้างความเสียหายจะลดความเร็วเคลื่อนที่ 20% เป็นเวลา 2 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/frostys-revenge.png",
    },
    {
        "name": "Gaia's Standard",
        "slug": "gaias-standard",
        "category": "defense",
        "tier": 3,
        "price": 2180,
        "stats": {
            "magic_defense": 200.0,
            "max_hp": 1200.0,
        },
        "stats_raw": [
            "+200 ต้านทานเวท",
            "+1200 พลังชีวิต",
        ],
        "passives": [
            "Passive - Recover: When taking damage, restores 4% of max HP over 2s (CD 10s).",
            "Passive - Bloodline: For every 10% lost HP, increases healing effect by 5%.",
        ],
        "desc_th": [
            "สกิลติดตัว - Recover: เมื่อได้รับความเสียหาย จะฟื้นฟู 4% ของ HP สูงสุดภายใน 2 วิ (CD 10 วิ)",
            "สกิลติดตัว - Bloodline: ทุก 10% ของพลังชีวิตที่เสียไป จะเพิ่มผลฟื้นฟู +5%",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/gaias-standard.png",
    },
    {
        "name": "Gilded Greaves",
        "slug": "gilded-greaves",
        "category": "movement",
        "tier": 2,
        "price": 700,
        "stats": {
            "magic_defense": 90.0,
            "movement_speed": 60.0,
        },
        "stats_raw": [
            "+90 ต้านทานเวท",
        ],
        "passives": [
            "Passive: Movement Speed +60",
            "Passive: Resistance +35% (reduces the duration of debuffs such as slows, silences, roots, knockups, knockbacks, stuns, taunts, petrifies, and freezes).",
            "Can switch to another LV2 boots for free with a 3-minute cooldown.",
        ],
        "desc_th": [
            "สกิลติดตัว: ความเร็วเคลื่อนที่ +60",
            "สกิลติดตัว: ต้านทานสถานะ+35% (ต้านทานสถานะ: ลดเวลาดีบัฟ เช่น เคลื่อนที่ช้าลง ใบ้ ล็อกตัว ลอยขึ้น ผลักถอยหลัง สตั๊น ยั่วยุ กลายเป็นหิน และแช่แข็ง)",
            "สามารถสลับไปใช้รองเท้า LV2 อื่นได้ฟรี CD 3 นาที",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/gilded-greaves.png",
    },
    {
        "name": "Gladiator's Gauntlets",
        "slug": "gladiators-gauntlets",
        "category": "defense",
        "tier": 1,
        "price": 220,
        "stats": {
            "magic_defense": 90.0,
        },
        "stats_raw": [
            "+90 ต้านทานเวท",
        ],
        "passives": [],
        "desc_th": [
            "+90 ต้านทานเวท",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/gladiators-gauntlets.png",
    },
    {
        "name": "Gloves",
        "slug": "gloves",
        "category": "attack",
        "tier": 1,
        "price": 300,
        "stats": {
            "critical_chance": 8.0,
        },
        "stats_raw": [
            "+8% อัตราคริติคอล",
        ],
        "passives": [],
        "desc_th": [
            "+8% อัตราคริติคอล",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/gloves.png",
    },
    {
        "name": "Gnoll Cleaver",
        "slug": "gnoll-cleaver",
        "category": "jungle",
        "tier": 2,
        "price": 700,
        "stats": {
            "max_hp": 400.0,
        },
        "stats_raw": [
            "+400 พลังชีวิต",
        ],
        "passives": [
            "Acquire Frostbite: Upgrades talent to Frostbite.",
            "Passive - Incantation: Deals 50~78 magic damage to nearby enemies every 1s (deals 100% more damage to minions and monsters).",
            "Passive - Hunting: Gain 35% more XP from killing monsters. Normal attacks/skills hitting monsters deal 60~172 additional true damage every 0.5s for 2s.",
            "Passive - Hunt: Killing or assisting in killing monsters increases max HP by 25 and cooldown reduction by 0.2% (stacks up to 15 times).",
            "Passive - Modest: When nearby allied heroes are present, they receive all gold and XP from minions while you receive 50% (expires at 4 min). Damage to minions is reduced by 25% (expires at 4 min).",
        ],
        "desc_th": [
            "Acquire Frostbite",
            "สกิลติดตัว - Incantation: สร้าง ความเสียหายเวท 50~78 หน่วย แก่ศัตรูรอบๆ ทุก 1 วิ (ครีปและมอนสเตอร์ป่าโดนแรงขึ้น 100%)",
            "สกิลติดตัว - Hunting : ได้รับ XP เมื่อฆ่ามอนสเตอร์ป่าเพิ่มขึ้น 35% และเมื่อโจมตีปกติ/ใช้สกิลโดนมอนสเตอร์ป่าจะสร้างความเสียหายจริง 60~172 แก่เป้าหมายดังกล่าวทุก 0.5 วิ เป็นเวลา 2 วิ",
            "สกิลติดตัว - Hunt: หากตัวเองหรือฮีโร่พันธมิตรรอบๆ สังหารมอนสเตอร์ป่า จะได้รับพลังชีวิตสูงสุดเพิ่มขึ้น 25 หน่วยและลดคูลดาวน์ 0.2% สะสมได้สูงสุด 15 ครั้ง",
            "สกิลติดตัว - Modest: เมื่อมีฮีโร่พันธมิตรอยู่ใกล้ๆ ฮีโร่พันธมิตรจะได้รับเหรียญทองและ XP ทั้งหมดจากครีป ส่วนตนเองจะได้รับเพียง 50% เอฟเฟกต์จะหายไปในนาทีที่ 4 ความเสียหายต่อครีปลดลง 25% และเอฟเฟกต์นี้จะหายไปในนาทีที่ 4",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/gnoll-cleaver.png",
    },
    {
        "name": "Greaves of Protection",
        "slug": "greaves-of-protection",
        "category": "defense",
        "tier": 2,
        "price": 900,
        "stats": {
            "max_hp": 1000.0,
        },
        "stats_raw": [
            "+1000 พลังชีวิต",
        ],
        "passives": [],
        "desc_th": [
            "+1000 พลังชีวิต",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/greaves-of-protection.png",
    },
    {
        "name": "Heart of Incubus",
        "slug": "heart-of-incubus",
        "category": "defense",
        "tier": 2,
        "price": 720,
        "stats": {
            "armor": 150.0,
        },
        "stats_raw": [
            "+150 เกราะ",
        ],
        "passives": [
            "Passive - Incantation: Deals 50~78 magic damage to nearby enemies every 1s (deals 50% more damage to minions and monsters).",
        ],
        "desc_th": [
            "สกิลติดตัว - Incantation: สร้าง ความเสียหายเวท 50~78 หน่วย แก่ศัตรูรอบๆ ทุก 1 วิ (ครีปและมอนสเตอร์ป่าโดนแรงขึ้น 50%)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/heart-of-incubus.png",
    },
    {
        "name": "Hecate's Diadem",
        "slug": "hecates-diadem",
        "category": "magic",
        "tier": 3,
        "price": 2400,
        "stats": {
            "ability_power": 240.0,
        },
        "stats_raw": [
            "+240 พลังเวท",
        ],
        "passives": [
            "Passive - Kich: Increases Ability Power by 35%.",
        ],
        "desc_th": [
            "สกิลติดตัว - Kich : พลังเวทเพิ่มขึ้น 35%",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/hecates-diadem.png",
    },
    {
        "name": "Hercules's Madness",
        "slug": "hercules-madness",
        "category": "defense",
        "tier": 3,
        "price": 2000,
        "stats": {
            "attack_damage": 80.0,
            "armor": 240.0,
        },
        "stats_raw": [
            "+80 พลังโจมตี",
            "+240 เกราะ",
        ],
        "passives": [
            "Passive - Berserk: When HP drops below 40%, gain 20% Life Steal and a shield of (800 + Hero LV x 80) for 8s (CD 60s).",
        ],
        "desc_th": [
            "สกิลติดตัว - Berserk: เมื่อ HP ต่ำกว่า 40% จะเพิ่มการดูดเลือด 20% และได้รับโล่ (800+LV ฮีโร่x80) 8 วิ (CD 60 วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/hercules-madness.png",
    },
    {
        "name": "Hermes' Select",
        "slug": "hermes-select",
        "category": "movement",
        "tier": 2,
        "price": 700,
        "stats": {
            "max_hp": 300.0,
            "movement_speed": 70.0,
        },
        "stats_raw": [
            "+300 พลังชีวิต",
        ],
        "passives": [
            "Passive - Swift: Movement speed increases by 60 when out of combat.",
            "Passive: Movement Speed +70",
            "Can switch to another LV2 boots for free with a 3-minute cooldown.",
        ],
        "desc_th": [
            "สกิลติดตัว - Swift: ความเร็วเคลื่อนที่เพิ่มขึ้น 60 หน่วย เมื่อไม่ได้ต่อสู้",
            "สกิลติดตัว: ความเร็วเคลื่อนที่ +70",
            "สามารถสลับไปใช้รองเท้า LV2 อื่นได้ฟรี CD 3 นาที",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/hermes-select.png",
    },
    {
        "name": "Holy of Holies",
        "slug": "holy-of-holies",
        "category": "magic",
        "tier": 3,
        "price": 2610,
        "stats": {
            "ability_power": 350.0,
            "cooldown_reduction": 10.0,
        },
        "stats_raw": [
            "+350 พลังเวท",
            "+10% ลดคูลดาวน์",
        ],
        "passives": [
            "Passive - Enlightenment: Every 100 AP increases damage dealt by 0.5% and reduces damage taken by 0.5%.",
        ],
        "desc_th": [
            "สกิลติดตัว - Enlightenment: พลังเวททุก 100 หน่วยจะเพิ่มสัดส่วนความเสียหายที่สร้าง 0.5% และลดสัดส่วนความเสียหายที่ได้รับ 0.5%",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/holy-of-holies.png",
    },
    {
        "name": "Hunter's Knife",
        "slug": "hunters-knife",
        "category": "jungle",
        "tier": 1,
        "price": 250,
        "stats": {},
        "stats_raw": [],
        "passives": [
            "When upgraded, Hunter's Knife inflicts Frostbite, dealing damage and slowing enemies.",
            "Passive - Hunt: Gain 20% more XP from killing monsters. Normal attacks or skills hitting monsters deal 50~120 true damage every 0.5s for 2s.",
            "Passive - Modest: When nearby allied heroes are present, they receive all gold and XP from minions while you receive 50% (expires at 4 min). Damage to minions is reduced by 25% (expires at 4 min).",
        ],
        "desc_th": [
            "(Hunter's Knife เมื่ออัพเกรดสามารถสร้างสถานะ Frostbite ทำให้ศัตรูได้รับความเสียหายและเคลื่อนที่ช้าลง)",
            "สกิลติดตัว - Hunt: สังหารมอนสเตอร์ป่า จะได้รับ XP เพิ่มขึ้น 20% หากการโจมตีปกติหรือสกิลโจมตีโดนมอนสเตอร์ป่า ทุก 0.5 วิจะสร้างความเสียหายจริง 50~120 หน่วย เป็นเวลา 2 วิ",
            "สกิลติดตัว - Modest: เมื่อมีฮีโร่พันธมิตรอยู่ใกล้ๆ ฮีโร่พันธมิตรจะได้รับเหรียญทองและ XP ทั้งหมดจากครีป ส่วนตนเองจะได้รับเพียง 50% เอฟเฟกต์จะหายไปในนาทีที่ 4 ความเสียหายต่อครีปลดลง 25% และเอฟเฟกต์นี้จะหายไปในนาทีที่ 4",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/hunters-knife.png",
    },
    {
        "name": "Ifrit's Claw",
        "slug": "ifrits-claw",
        "category": "attack",
        "tier": 3,
        "price": 1960,
        "stats": {
            "attack_speed": 30.0,
            "critical_chance": 20.0,
            "movement_speed_pct": 5.0,
        },
        "stats_raw": [
            "+30% ความเร็วโจมตี",
            "+20% อัตราคริติคอล",
            "+5% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Passive - Flame's Wrath: Normal attacks hitting targets increase attack speed by 10% for 2s (stacks up to 5 times).",
        ],
        "desc_th": [
            "สกิลติดตัว - Flame’s Wrath:\nเมื่อโจมตีปกติโดนเป้าหมาย จะโจมตีเร็วขึ้น 10% เป็นเวลา 2 วิ (5 ครั้ง)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/ifrits-claw.png",
    },
    {
        "name": "Knight's Plate",
        "slug": "knights-plate",
        "category": "defense",
        "tier": 2,
        "price": 730,
        "stats": {
            "armor": 210.0,
        },
        "stats_raw": [
            "+210 เกราะ",
        ],
        "passives": [
            "Passive - Spirit Bond: When taking damage, reduces attacker's attack speed by 15%.",
        ],
        "desc_th": [
            "สกิลติดตัว - Spirit Bond: หากฮีโร่ได้รับความเสียหาย จะลดความเร็วโจมตีของผู้ทำการโจมตีลง 15%",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/knights-plate.png",
    },
    {
        "name": "Lapis Ring",
        "slug": "lapis-ring",
        "category": "magic",
        "tier": 1,
        "price": 220,
        "stats": {
            "max_mana": 300.0,
        },
        "stats_raw": [
            "+300 มานาสูงสุด",
        ],
        "passives": [],
        "desc_th": [
            "+300 มานาสูงสุด",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/lapis-ring.png",
    },
    {
        "name": "Leviathan",
        "slug": "leviathan",
        "category": "jungle",
        "tier": 3,
        "price": 2000,
        "stats": {
            "cooldown_reduction": 5.0,
            "max_hp": 1200.0,
            "movement_speed_pct": 6.0,
        },
        "stats_raw": [
            "+5% ลดคูลดาวน์",
            "+1200 พลังชีวิต",
            "+6% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Acquire Frostbite: Upgrades talent to Frostbite.",
            "Passive - Incantation: Deals magic damage equal to 2% max HP to nearby enemies every 1s (deals 100% more damage to minions and monsters).",
            "Passive - Hunting: Gain 35% more XP from killing monsters. Normal attacks/skills hitting monsters deal 60~172 additional true damage every 0.5s for 2s.",
            "Passive - Hunt: Killing or assisting in killing monsters increases max HP by 25 and cooldown reduction by 0.2% (stacks up to 25 times).",
            "Passive - Modest: When nearby allied heroes are present, they receive all gold and XP from minions while you receive 50% (expires at 4 min). Damage to minions is reduced by 25% (expires at 4 min).",
        ],
        "desc_th": [
            "Acquire Frostbite",
            "สกิลติดตัว - Incantation: สร้างความเสียหายเวทเท่ากับ 2% HP สูงสุดแก่ศัตรูรอบๆ ทุก 1 วิ (ครีปและมอนสเตอร์ป่าโดนแรงขึ้น 100%)",
            "สกิลติดตัว - Hunting : ได้รับ XP เมื่อฆ่ามอนสเตอร์ป่าเพิ่มขึ้น 35% และเมื่อโจมตีปกติ/ใช้สกิลโดนมอนสเตอร์ป่าจะสร้างความเสียหายจริง 60~172 แก่เป้าหมายดังกล่าวทุก 0.5 วิ เป็นเวลา 2 วิ",
            "สกิลติดตัว - Hunt: หากตัวเองหรือฮีโร่พันธมิตรรอบๆ สังหารมอนสเตอร์ป่า จะได้รับพลังชีวิตสูงสุดเพิ่มขึ้น 25 หน่วยและลดคูลดาวน์ 0.2% สะสมได้สูงสุด 25 ครั้ง",
            "สกิลติดตัว - Modest: เมื่อมีฮีโร่พันธมิตรอยู่ใกล้ๆ ฮีโร่พันธมิตรจะได้รับเหรียญทองและ XP ทั้งหมดจากครีป ส่วนตนเองจะได้รับเพียง 50% เอฟเฟกต์จะหายไปในนาทีที่ 4 ความเสียหายต่อครีปลดลง 25% และเอฟเฟกต์นี้จะหายไปในนาทีที่ 4",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/leviathan.png",
    },
]

if __name__ == "__main__":
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(items_g2, f, indent=2, ensure_ascii=False)
    print(f"Successfully generated {len(items_g2)} items to {OUTPUT_FILE}")
