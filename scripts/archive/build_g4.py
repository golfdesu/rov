import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_FILE = ROOT / "scripts" / "extracted_items_g4.json"

items_g4 = [
    {
        "name": "Orb of the Magi",
        "slug": "orb-of-the-magi",
        "category": "magic",
        "tier": 3,
        "price": 1800,
        "stats": {
            "ability_power": 140.0,
            "cooldown_reduction": 10.0,
        },
        "stats_raw": [
            "+140 พลังเวท",
            "+10% ลดคูลดาวน์",
        ],
        "passives": [
            "Passive - Bide: Every 30s gains 12 AP and 120 max HP (up to 10 stacks).",
            "Passive - From the Ashes: When leveling up, restores 10% mana and 20% HP over 3s.",
        ],
        "desc_th": [
            "สกิลติดตัว - Bide: ทุก 30 วิรับพลังเวท 12 หน่วย พลังชีวิตสูงสุด 120 หน่วย (สูงสุด 10 ครั้ง)",
            "สกิลติดตัว - From the Ashes: เมื่อฮีโร่เลเวลอัพจะฟื้นฟูมานา 10% และ HP 20% ใน 3 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/orb-of-the-magi.png",
    },
    {
        "name": "Orrery",
        "slug": "orrery",
        "category": "magic",
        "tier": 2,
        "price": 800,
        "stats": {
            "ability_power": 80.0,
        },
        "stats_raw": [
            "+80 พลังเวท",
        ],
        "passives": [
            "Passive - Echo: Dealing skill damage triggers an explosion dealing 180 magic damage (CD: 5s).",
        ],
        "desc_th": [
            "สกิลติดตัว - Echo: เมื่อใช้สกิลโจมตีโดนจะเกิดการระเบิดสร้าง ความเสียหายเวท 180 (CD: 5 วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/orrery.png",
    },
    {
        "name": "Pendant of Faith",
        "slug": "pendant-of-faith",
        "category": "magic",
        "tier": 1,
        "price": 120,
        "stats": {
            "mana_regen_5s": 10.0,
        },
        "stats_raw": [
            "+10 ฟื้นฟูมานา/5 วิ",
        ],
        "passives": [],
        "desc_th": [
            "+10 ฟื้นฟูมานา/5 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/pendant-of-faith.png",
    },
    {
        "name": "Phoenix Tear",
        "slug": "phoenix-tear",
        "category": "magic",
        "tier": 2,
        "price": 500,
        "stats": {
            "ability_power": 50.0,
        },
        "stats_raw": [
            "+50 พลังเวท",
        ],
        "passives": [
            "Passive - From the Ashes: When leveling up, restores 10% mana and 20% HP over 3s.",
        ],
        "desc_th": [
            "สกิลติดตัว - From the Ashes: เมื่อฮีโร่เลเวลอัพจะฟื้นฟูมานา 10% และ HP 20% ใน 3 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/phoenix-tear.png",
    },
    {
        "name": "Platinum Gauntlets",
        "slug": "platinum-gauntlets",
        "category": "defense",
        "tier": 2,
        "price": 660,
        "stats": {
            "cooldown_reduction": 10.0,
            "armor": 110.0,
        },
        "stats_raw": [
            "+10% ลดคูลดาวน์",
            "+110 เกราะ",
        ],
        "passives": [],
        "desc_th": [
            "+10% ลดคูลดาวน์\n+110 เกราะ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/platinum-gauntlets.png",
    },
    {
        "name": "Rhea's Blessing",
        "slug": "rheas-blessing",
        "category": "magic",
        "tier": 3,
        "price": 2050,
        "stats": {
            "ability_power": 160.0,
            "magic_life_steal": 25.0,
            "max_hp": 800.0,
        },
        "stats_raw": [
            "+160 พลังเวท",
            "+25% เวทแวมไพร์",
            "+800 พลังชีวิต",
        ],
        "passives": [
            "Passive - Magic Pierce: Every 2% Magic Life Steal reduces Cooldown by 1%.",
        ],
        "desc_th": [
            "สกิลติดตัว - Magic Pierce: เวทแวมไพร์ทุก 2 % ลดคูลดาวน์ลง 1%",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/rheas-blessing.png",
    },
    {
        "name": "Ring of Vitality",
        "slug": "ring-of-vitality",
        "category": "defense",
        "tier": 1,
        "price": 300,
        "stats": {
            "max_hp": 300.0,
        },
        "stats_raw": [
            "+300 พลังชีวิต",
        ],
        "passives": [],
        "desc_th": [
            "+300 พลังชีวิต",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/ring-of-vitality.png",
    },
    {
        "name": "Rock Shield",
        "slug": "rock-shield",
        "category": "defense",
        "tier": 3,
        "price": 1980,
        "stats": {
            "armor": 240.0,
            "max_hp": 1200.0,
        },
        "stats_raw": [
            "+240 เกราะ",
            "+1200 พลังชีวิต",
        ],
        "passives": [
            "Active - Pain Absorb: Gains a shield equal to (30% Max HP + 10% lost HP) for 3s (usable while controlled). After using this skill, own attack damage is reduced by 70% for 3s (CD 60s).",
        ],
        "desc_th": [
            "สกิลพิเศษ - [Pain Absorb]: ได้รับโล่ (HP สูงสุดx30%+HP ที่เสียไปx10%) เป็นเวลา 3 วิ (สามารถใช้ขณะติดสถานะควบคุมได้) หลังจากใช้สกิลนี้ พลังโจมตีตัวเองจะลดลง 70% เป็นเวลา 3 วิ (CD60 วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/rock-shield.png",
    },
    {
        "name": "Shield of the Lost",
        "slug": "shield-of-the-lost",
        "category": "defense",
        "tier": 3,
        "price": 2100,
        "stats": {
            "armor": 275.0,
            "max_hp": 1200.0,
        },
        "stats_raw": [
            "+275 เกราะ",
            "+1200 พลังชีวิต",
        ],
        "passives": [
            "Passive - Sentinel: Reduces attacker's attack speed by 30% and movement speed by 15% for 2s.",
        ],
        "desc_th": [
            "สกิลติดตัว - Sentinel: ลดความเร็วโจมตีของผู้ทำการโจมตี 30% และความเร็วเคลื่อนที่ 15% เป็นเวลา 2 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/shield-of-the-lost.png",
    },
    {
        "name": "Short Sword",
        "slug": "short-sword",
        "category": "attack",
        "tier": 1,
        "price": 250,
        "stats": {
            "attack_damage": 20.0,
        },
        "stats_raw": [
            "+20 พลังโจมตี",
        ],
        "passives": [],
        "desc_th": [
            "+20 พลังโจมตี",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/short-sword.png",
    },
    {
        "name": "Shuriken",
        "slug": "shuriken",
        "category": "attack",
        "tier": 2,
        "price": 750,
        "stats": {
            "attack_speed": 20.0,
        },
        "stats_raw": [
            "+20% ความเร็วโจมตี",
        ],
        "passives": [
            "Passive - Heel: Normal attacks deal an additional 21-35 (melee) / 42-70 (ranged) physical damage (CD 0.3s).",
        ],
        "desc_th": [
            "สกิลติดตัว - Heel: การโจมตีปกติสร้างความเสียหายกายภาพเพิ่มขึ้น 21-35 (ระยะใกล้)/ 42-70 (ระยะไกล) CD 0.3 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/shuriken.png",
    },
    {
        "name": "Slikk's Sting",
        "slug": "slikks-sting",
        "category": "attack",
        "tier": 3,
        "price": 2150,
        "stats": {
            "attack_speed": 35.0,
            "critical_chance": 25.0,
            "movement_speed_pct": 7.0,
        },
        "stats_raw": [
            "+35% ความเร็วโจมตี",
            "+25% อัตราคริติคอล",
            "+7% ความเร็วเคลื่อนที่",
        ],
        "passives": [
            "Unique Passive - Wind Bless: Increases resistance by 35% for 2s after landing a critical hit.",
        ],
        "desc_th": [
            "สกิลติดตัว - Wind Bless: หลังจากติดคริ จะต้านทานสถานะเพิ่มขึ้น 35% เป็นเวลา 2 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/slikks-sting.png",
    },
    {
        "name": "Soaring Aura",
        "slug": "soaring-aura",
        "category": "magic",
        "tier": 3,
        "price": 2100,
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
            "Passive - Enchantment: Dealing normal attack or skill damage to enemy heroes increases Magic Pierce by 10-24 (up to 10 stacks) for 3s.",
        ],
        "desc_th": [
            "สกิลติดตัว - Enchantment : เมื่อโจมตีปกติหรือใช้สกิลโดนฮีโร่ศัตรูจะเพิ่มเจาะเกราะเวท 10~24 แต้ม (สูงสุด 10 ครั้ง) เป็นเวลา 3 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/soaring-aura.png",
    },
    {
        "name": "Sonic Boots",
        "slug": "sonic-boots",
        "category": "movement",
        "tier": 2,
        "price": 700,
        "stats": {
            "armor": 110.0,
            "movement_speed": 60.0,
        },
        "stats_raw": [
            "+110 เกราะ",
            "สกิลติดตัว: ความเร็วเคลื่อนที่ +60",
            "สกิลติดตัว: ลดความเสียหายกายภาพที่ได้รับ 10%",
            "สามารถสลับไปใช้รองเท้า LV2 อื่นได้ฟรี CD 3 นาที",
        ],
        "passives": [
            "Unique Passive: Movement Speed +60",
            "Unique Passive: Reduces physical damage taken by 10%.",
            "Passive: Can switch to other Tier 2 boots for free (Cooldown: 3 min).",
        ],
        "desc_th": [
            "สกิลติดตัว: ความเร็วเคลื่อนที่ +60",
            "สกิลติดตัว: ลดความเสียหายกายภาพที่ได้รับ 10%",
            "สามารถสลับไปใช้รองเท้า LV2 อื่นได้ฟรี CD 3 นาที",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/sonic-boots.png",
    },
    {
        "name": "Soul Scroll",
        "slug": "soul-scroll",
        "category": "magic",
        "tier": 3,
        "price": 1900,
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
            "Passive - Soul Prison: Normal attacks or abilities dealing damage reduce target HP recovery by 40% for 3s.",
        ],
        "desc_th": [
            "สกิลติดตัว - Soul Prison: หากการโจมตีปกติหรือใช้สกิลสร้างความเสียหาย การฟื้นฟูพลังชีวิตของเป้าหมายจะลดลง 40% เป็นเวลา 3 วิ",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/soul-scroll.png",
    },
    {
        "name": "Soulreaver",
        "slug": "soulreaver",
        "category": "jungle",
        "tier": 3,
        "price": 2000,
        "stats": {
            "attack_damage": 90.0,
            "cooldown_reduction": 5.0,
            "movement_speed_pct": 8.0,
        },
        "stats_raw": [
            "+90 พลังโจมตี",
            "+5% ลดคูลดาวน์",
            "+8% ความเร็วเคลื่อนที่",
            "Acquire Frostbite",
            "สกิลติดตัว - Hunting : ได้รับ XP เมื่อฆ่ามอนสเตอร์ป่าเพิ่มขึ้น 35% และเมื่อโจมตีปกติ/ใช้สกิลโดนมอนสเตอร์ป่าจะสร้างความเสียหายจริง 60~172 แก่เป้าหมายดังกล่าวทุก 0.5 วิ เป็นเวลา 2 วิ",
            "สกิลติดตัว : เจาะเกราะ+60",
            "สกิลติดตัว - Hunt: หากตัวเองหรือฮีโร่พันธมิตรรอบๆ สังหารมอนสเตอร์ป่า จะได้รับพลังโจมตีเพิ่มขึ้น 2 หน่วยและลดคูลดาวน์ 0.2% สะสมได้สูงสุด 25 ครั้ง",
            "สกิลติดตัว - Modest: เมื่อมีฮีโร่พันธมิตรอยู่ใกล้ๆ ฮีโร่พันธมิตรจะได้รับเหรียญทองและ XP ทั้งหมดจากครีป ส่วนตนเองจะได้รับเพียง 50% เอฟเฟกต์จะหายไปในนาทีที่ 4 ความเสียหายต่อครีปลดลง 25% และเอฟเฟกต์นี้จะหายไปในนาทีที่ 4",
        ],
        "passives": [
            "Acquire Frostbite (Upgrades Punish).",
            "Passive - Hunting: Gain 35% extra EXP from jungle monsters. Dealing normal attack or skill damage to jungle monsters deals 60~172 true damage every 0.5s for 2s.",
            "Unique Passive: Armor Pierce +60.",
            "Passive - Hunt: When self or nearby allies kill jungle monsters, gain 2 Attack Damage and 0.2% Cooldown Reduction (stacks up to 25 times).",
            "Passive - Modest: When nearby allies are present, allies gain full gold and EXP from minions while self receives only 50% (effect expires at 4 min). Damage to minions reduced by 25% (expires at 4 min).",
        ],
        "desc_th": [
            "Acquire Frostbite",
            "สกิลติดตัว - Hunting : ได้รับ XP เมื่อฆ่ามอนสเตอร์ป่าเพิ่มขึ้น 35% และเมื่อโจมตีปกติ/ใช้สกิลโดนมอนสเตอร์ป่าจะสร้างความเสียหายจริง 60~172 แก่เป้าหมายดังกล่าวทุก 0.5 วิ เป็นเวลา 2 วิ",
            "สกิลติดตัว : เจาะเกราะ+60",
            "สกิลติดตัว - Hunt: หากตัวเองหรือฮีโร่พันธมิตรรอบๆ สังหารมอนสเตอร์ป่า จะได้รับพลังโจมตีเพิ่มขึ้น 2 หน่วยและลดคูลดาวน์ 0.2% สะสมได้สูงสุด 25 ครั้ง",
            "สกิลติดตัว - Modest: เมื่อมีฮีโร่พันธมิตรอยู่ใกล้ๆ ฮีโร่พันธมิตรจะได้รับเหรียญทองและ XP ทั้งหมดจากครีป ส่วนตนเองจะได้รับเพียง 50% เอฟเฟกต์จะหายไปในนาทีที่ 4 ความเสียหายต่อครีปลดลง 25% และเอฟเฟกต์นี้จะหายไปในนาทีที่ 4",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/soulreaver.png",
    },
    {
        "name": "Spear of Longinus",
        "slug": "spear-of-longinus",
        "category": "attack",
        "tier": 3,
        "price": 2030,
        "stats": {
            "attack_damage": 80.0,
            "cooldown_reduction": 15.0,
            "max_hp": 500.0,
        },
        "stats_raw": [
            "+80 พลังโจมตี",
            "+15% ลดคูลดาวน์",
            "+500 พลังชีวิต",
        ],
        "passives": [
            "Passive - Armor Break: Armor Pierce +60.",
            "Passive - Shatter: Attacks reduce enemy armor by 6% (up to 4 stacks) for 5s (CD 0.3s).",
        ],
        "desc_th": [
            "สกิลติดตัว - Armor Break: เจาะเกราะ+60",
            "สกิลติดตัว - Shatter: การโจมตีจะลดเกราะศัตรูลง 6% (สูงสุด 4 ครั้ง) เป็นเวลา 5 วิ (CD 0.3 วิ)",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/spear-of-longinus.png",
    },
    {
        "name": "Spell Tome",
        "slug": "spell-tome",
        "category": "magic",
        "tier": 1,
        "price": 300,
        "stats": {
            "ability_power": 40.0,
        },
        "stats_raw": [
            "+40 พลังเวท",
        ],
        "passives": [],
        "desc_th": [
            "+40 พลังเวท",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/spell-tome.png",
    },
    {
        "name": "Spooky Mask",
        "slug": "spooky-mask",
        "category": "magic",
        "tier": 2,
        "price": 960,
        "stats": {
            "ability_power": 100.0,
        },
        "stats_raw": [
            "+100 พลังเวท",
        ],
        "passives": [
            "Unique Passive: Magic Pierce +75",
        ],
        "desc_th": [
            "สกิลติดตัว: เจาะเกราะเวท+75",
        ],
        "passives_incomplete": False,
        "icon_url": "https://rovmeta.com/items/spooky-mask.png",
    },
]


def main():
    print(f"Total items to write: {len(items_g4)}")
    assert len(items_g4) == 19, f"Expected 19 items, got {len(items_g4)}"

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
    for item in items_g4:
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
        json.dump(items_g4, f, indent=2, ensure_ascii=False)

    print(f"Successfully wrote {len(items_g4)} items to {OUTPUT_FILE}")

    # Re-read and verify
    with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
        loaded = json.load(f)
    print(f"Verified loaded items count: {len(loaded)}")
    assert len(loaded) == 19


if __name__ == "__main__":
    main()
