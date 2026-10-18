import html
import json
import re
from pathlib import Path

import requests

ARCANA_URL = "https://moba.garena.tw/game/katha"
FANDOM_API_URL = "https://arenaofvalor.fandom.com/api.php"

# Standard name mappings for Level 3 Arcana (TW Chinese -> Canonical English & Thai)
ARCANA_NAMES_MAP = {
    "賢者": {"en": "Sage", "th": "Sage (เวท)", "color": "Red"},
    "神劍": {"en": "Excalibur", "th": "Excalibur (กายภาพ)", "color": "Red"},
    "猛攻": {"en": "Onslaught", "th": "Onslaught (เจาะเกราะ)", "color": "Red"},
    "嗜血": {"en": "Bloodlust", "th": "Bloodlust (ดูดเลือดกายภาพ)", "color": "Red"},
    "暴走": {"en": "Rampage", "th": "Rampage (คริแรง)", "color": "Red"},
    "金身": {"en": "Golden Body", "th": "Golden Body (ทอง)", "color": "Red"},
    "荒蕪": {"en": "Violate", "th": "Violate (เจาะเกราะเวท)", "color": "Red"},
    "權杖": {"en": "Scepter", "th": "Scepter (คทาเวท)", "color": "Red"},
    "暴怒": {"en": "Atrocity", "th": "Atrocity (อัตราคริ)", "color": "Red"},
    "覺醒": {"en": "Awake", "th": "Awake (ตีเร็ว)", "color": "Red"},
    "巨人": {"en": "Colossus", "th": "Colossus (ยักษ์เลือด)", "color": "Purple"},
    "禱告": {"en": "Bloodlust (Magic)", "th": "Pray (ดูดเลือดเวท)", "color": "Purple"},
    "奪萃": {"en": "Reave", "th": "Reave (ดูดเลือด)", "color": "Purple"},
    "王座": {"en": "Throne", "th": "Throne (บัลลังก์)", "color": "Purple"},
    "不朽": {"en": "Undying", "th": "Undying (อมตะฟื้นฟู)", "color": "Purple"},
    "繁榮": {"en": "Prosperity", "th": "Prosperity (รุ่งเรือง)", "color": "Purple"},
    "血魔": {"en": "Blood Fiend", "th": "Blood Fiend (ปีศาจเลือด)", "color": "Purple"},
    "庇佑": {"en": "Benevolence", "th": "Benevolence (พิทักษ์)", "color": "Purple"},
    "刺殺": {"en": "Assassinate", "th": "Assassinate (ลอบสังหาร)", "color": "Purple"},
    "精靈": {"en": "Spirit", "th": "Spirit / Guerilla (วิ่งตีเร็ว)", "color": "Purple"},
    "長城": {"en": "Bastion", "th": "Bastion (เกราะกำแพง)", "color": "Green"},
    "金剛": {"en": "Hercules", "th": "Diamond (เกราะสองด้าน)", "color": "Green"},
    "英勇": {"en": "Valiance", "th": "Valiance (ผู้กล้า)", "color": "Green"},
    "權柄": {"en": "Authority", "th": "Mythril (ต้านเวท)", "color": "Green"},
    "秘咒": {"en": "Focus", "th": "Focus (ลดคูลดาวน์เวท)", "color": "Green"},
    "龍爪": {"en": "Dragon's Claw", "th": "Dragon's Claw / Skewer (กรงเล็บ)", "color": "Green"},
    "玷污": {"en": "Flurry", "th": "Flurry (มลทิน)", "color": "Green"},
    "純潔": {"en": "Hex", "th": "Hex / Purity (ลดคูลดาวน์)", "color": "Green"},
    "魔心": {"en": "Magic Heart", "th": "Magic Heart (หัวใจเวท)", "color": "Green"},
    "聖光": {"en": "Crusader", "th": "Crusader (แสงศักดิ์สิทธิ์)", "color": "Green"},
}

STAT_KEY_MAP = {
    "物理攻擊力": "attack_damage",
    "物理攻擊": "attack_damage",
    "魔法攻擊力": "ability_power",
    "魔法攻擊": "ability_power",
    "最大生命": "max_hp",
    "物理防禦力": "armor",
    "物理防禦": "armor",
    "魔法防禦力": "magic_defense",
    "魔法防禦": "magic_defense",
    "物理穿透": "armor_pierce",
    "魔法穿透": "magic_pierce",
    "暴擊率": "critical_chance_pct",
    "暴擊效果": "critical_damage_pct",
    "攻速加成": "attack_speed_pct",
    "攻擊速度": "attack_speed_pct",
    "跑速": "movement_speed_pct",
    "移速": "movement_speed_pct",
    "物理吸血": "life_steal_pct",
    "魔法吸血": "magic_life_steal_pct",
    "冷卻縮減": "cooldown_reduction_pct",
    "生命回復": "hp_regen_5s",
    "每5秒回血": "hp_regen_5s",
}


def parse_arcana_stats(desc_text: str) -> dict[str, float]:
    stats = {}
    tokens = desc_text.split()
    for tok in tokens:
        m = re.search(r"([^+\-]+)([+\-])([\d.]+)(%?)", tok)
        if m:
            raw_stat, sign, val, pct = m.groups()
            raw_stat = raw_stat.strip()
            num = float(val)
            if sign == "-":
                num = -num
            matched_key = None
            for k, mapped in STAT_KEY_MAP.items():
                if k in raw_stat:
                    matched_key = mapped
                    break
            if not matched_key:
                matched_key = raw_stat
            stats[matched_key] = num
    return stats


def fetch_arcana() -> list[dict]:
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    r = requests.get(ARCANA_URL, headers=headers, timeout=15)
    r.raise_for_status()

    boxes = re.findall(
        r'<div class="k_box" data-tags="([^"]*)" data-filter="([^"]*)">.*?'
        r'<div class="tooltip-name">([^<]+)</div><div class="tooltip-desc">([^<]+)</div>.*?'
        r"<img src=[\"\x27]([^\"\x27]+)[\"\x27]",
        r.text,
        re.DOTALL,
    )

    arcana_list = []
    for tags_str, filter_str, raw_name, desc_html, img_url in boxes:
        desc_clean = html.unescape(desc_html).replace("&lt;br&gt;", " ").replace("<br>", " ").strip()
        name_clean = raw_name.replace("：", ":").strip()

        tier = 1
        if "3級" in name_clean:
            tier = 3
        elif "2級" in name_clean:
            tier = 2

        base_zh = name_clean.split(":")[-1].strip()
        mapping = ARCANA_NAMES_MAP.get(base_zh, {})
        color = mapping.get("color")
        if not color:
            if any(t in tags_str for t in ["攻擊", "暴擊", "穿透"]) and "攻速" not in tags_str:
                color = "Red"
            elif any(t in tags_str for t in ["生命", "吸血", "移速", "跑速"]):
                color = "Purple"
            else:
                color = "Green"

        name_en = mapping.get("en", f"{base_zh} {tier}")
        name_th = mapping.get("th", f"{base_zh} {tier}")
        if tier != 3:
            name_en = f"{name_en} {tier}"
            name_th = f"{name_th} {tier}"

        stats = parse_arcana_stats(desc_clean)
        full_img = f"https:{img_url}" if img_url.startswith("//") else img_url

        arcana_list.append(
            {
                "name": name_en,
                "name_th": name_th,
                "name_zh": base_zh,
                "tier": tier,
                "color": color,
                "tags": [t.strip() for t in tags_str.split(",") if t.strip()],
                "stats": stats,
                "raw_desc": desc_clean,
                "icon": full_img,
            }
        )

    return arcana_list


def fetch_enchantments() -> list[dict]:
    headers = {"User-Agent": "ROVResearch/1.0"}
    params = {
        "action": "query",
        "prop": "revisions",
        "rvprop": "content",
        "titles": "Enchantments",
        "format": "json",
    }
    r = requests.get(FANDOM_API_URL, params=params, headers=headers, timeout=15).json()
    content = list(r.get("query", {}).get("pages", {}).values())[0].get("revisions", [{}])[0].get("*", "")

    pos = content.find("==Enchantment list==")
    table_str = content[pos:]
    rows = table_str.split("|-")

    current_faction = None
    enchantments = []

    for row in rows[1:]:
        cells = [c.strip() for c in row.split("\n|") if c.strip()]
        if not cells:
            continue
        if len(cells) >= 4 and "rowspan" in cells[1]:
            m_match = re.search(r"rowspan=[\"\x27]?\d+[\"\x27]?\s*\|(.*)", cells[1])
            if m_match:
                current_faction = m_match.group(1).strip()
            name = cells[0].lstrip("|").strip()
            icon_cell = cells[2]
            desc_cell = cells[3]
        elif len(cells) >= 3:
            name = cells[0].lstrip("|").strip()
            icon_cell = cells[1]
            desc_cell = cells[2]
        else:
            continue

        name = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", name).strip()
        clean_desc = re.sub(r"<[^>]+>", "", desc_cell)
        clean_desc = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", clean_desc).strip()
        icon_m = re.search(r"\[\[File:([^|\]]+)", icon_cell)
        icon_file = icon_m.group(1) if icon_m else ""

        tier = 1
        if any(
            w in name.lower()
            for w in [
                "desperate duel",
                "holy summoner",
                "devil's awakening",
                "alchemy",
                "curse of death",
                "sacred protection",
                "forest wanderer",
            ]
        ):
            tier = 3
        elif any(
            w in name.lower()
            for w in [
                "blessing",
                "nature's gift",
                "bone cutter",
                "deadly claw",
                "gunslinger",
                "endless cycle",
                "minion kill",
            ]
        ):
            tier = 2

        enchantments.append(
            {
                "name": name,
                "faction": current_faction,
                "tier": tier,
                "description": clean_desc,
                "icon_file": icon_file,
            }
        )

    return enchantments


def main():
    root = Path(__file__).resolve().parent.parent
    arcana_path = root / "data" / "arcana.json"
    enchantments_path = root / "data" / "enchantments.json"

    print("Fetching Arcana from Garena...")
    arcana = fetch_arcana()
    print(f"Parsed {len(arcana)} Arcana runes.")

    print("Fetching Enchantments from Fandom...")
    enchantments = fetch_enchantments()
    print(f"Parsed {len(enchantments)} Enchantments.")

    arcana_payload = {
        "count": len(arcana),
        "tiers": {"I": 30, "II": 30, "III": 30},
        "colors": ["Red", "Purple", "Green"],
        "arcana": arcana,
    }

    enchantments_payload = {
        "count": len(enchantments),
        "factions": ["Veda", "Lokheim", "Afata", "League of Humans"],
        "enchantments": enchantments,
    }

    with open(arcana_path, "w", encoding="utf-8") as f:
        json.dump(arcana_payload, f, ensure_ascii=False, indent=2)
    print(f"Saved {arcana_path}")

    with open(enchantments_path, "w", encoding="utf-8") as f:
        json.dump(enchantments_payload, f, ensure_ascii=False, indent=2)
    print(f"Saved {enchantments_path}")


if __name__ == "__main__":
    main()
