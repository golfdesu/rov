"""Build ``data/hero_patch_history.json`` from Garena TW patch notes.

Garena TW (https://moba.garena.tw/news) publishes exact before -> after numbers for every
balance change, which the TH notes usually omit. This script downloads the TW version and
update notices, finds each hero block, and records every ``field: before → after`` line.

Hero names are translated with ``data/hero_names_zh_tw.json``; skill slots and common stat
terms are translated to English. Numbers and formulas are kept as written (with Chinese
scaling terms such as ``物理加成`` replaced by English). Heroes not in the name map are skipped.

Usage:
    python scripts/fetch_tw_hero_patches.py   # not needed; this script fetches by itself
    python scripts/parse_tw_hero_patches.py
"""

from __future__ import annotations

import html as htmllib
import json
import re
import time
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
NAMES_PATH = REPO_ROOT / "data" / "hero_names_zh_tw.json"
OUT_PATH = REPO_ROOT / "data" / "hero_patch_history.json"
BASE = "https://moba.garena.tw"
HEADERS = {"User-Agent": "Mozilla/5.0 RoVDraftResearch"}
NEWS_PAGES = 47

# Notices that carry balance numbers: version updates, balance posts and live updates
NOTICE_RE = re.compile(r"平衡|版本.*更新公告|伺服器不停機")
SKIP_RE = re.compile(r"停權|網路|登入|線路|特賣|限免|商店|聯名|挑戰賽|已知問題|補償|房間號碼|榮譽")

SKILL_SLOTS = {
    "被動": "Passive",
    "一技能": "Skill 1",
    "二技能": "Skill 2",
    "三技能": "Skill 3",
    "四技能": "Skill 4",
    "大招": "Ultimate",
}

# Longest terms first so compound phrases translate before their parts
TERMS = {
    "額外物理加成": "bonus AD",
    "物理加成": "AD",
    "物理攻擊": "AD",
    "魔法加成": "AP",
    "魔法攻擊": "AP",
    "目標最大生命": "target max HP",
    "目標已損生命": "target missing HP",
    "已損失生命值": "missing HP",
    "已損生命值": "missing HP",
    "已損生命": "missing HP",
    "自身最大生命": "own max HP",
    "最大生命值": "max HP",
    "最大生命": "max HP",
    "額外生命值": "bonus HP",
    "額外生命": "bonus HP",
    "每等級": "per level",
    "/每等級": "/level",
    "每級": "per level",
    "英雄等級": "hero level",
    "物理傷害": "physical damage",
    "魔法傷害": "magic damage",
    "真實傷害": "true damage",
    "基礎傷害": "base damage",
    "額外傷害": "bonus damage",
    "傷害": "damage",
    "冷卻時間": "cooldown",
    "護盾值": "shield",
    "護盾": "shield",
    "回復生命": "healing",
    "回復效果": "healing",
    "回復量": "healing",
    "回血效果": "healing",
    "回復": "healing",
    "減傷效果": "damage reduction",
    "減速": "slow",
    "加速時間": "speed-up duration",
    "加速效果": "speed-up",
    "攻速加成": "attack speed bonus",
    "物理穿透": "armor pierce",
    "持續時間": "duration",
    "魔力消耗": "mana cost",
    "秒": "s",
    "上限": "cap",
    "層": " stacks",
    "新增效果": "New effect",
    "對英雄傷害": "damage to heroes",
    "固定": "flat",
    "強化普攻": "enhanced basic attack",
    "強普": "enhanced basic attack",
    "普攻": "basic attack",
    "跑速": "movement speed",
    "攻速": "attack speed",
    "暴擊率": "crit rate",
    "物理防禦": "armor",
    "物防加成": "armor",
    "魔法防禦": "magic defense",
    "魔防": "magic defense",
    "雙防": "armor and magic defense",
    "減傷": "damage reduction",
    "吸血比例": "lifesteal",
    "吸血": "lifesteal",
    "暈眩": "stun",
    "擊飛": "knock-up",
    "擊退": "knockback",
    "時長": " duration",
    "距離": " range",
    "射程": "range",
    "範圍": "area",
    "一段": "first hit",
    "二段": "second hit",
    "第一段": "first hit",
    "第二段": "second hit",
    "爆炸": "explosion",
    "非英雄": "non-hero",
    "英雄": "hero",
    "野怪": "monster",
    "小兵": "minion",
    "金幣": "gold",
    "基礎": "base ",
    "額外": "bonus ",
    "效果": "",
    "量": "",
    "值": "",
    "點": "",
}

# Whole-sentence translations for descriptive lines the term table can't express
SENTENCES_PATH = REPO_ROOT / "data" / "hero_patch_translations.json"


def load_sentences() -> dict[str, str]:
    if SENTENCES_PATH.exists():
        return json.loads(SENTENCES_PATH.read_text(encoding="utf-8"))["sentences"]
    return {}


SENTENCES = load_sentences()
CJK_RE = re.compile(r"[一-鿿]")


def translate(text: str) -> str:
    text = text.strip()
    if text in SENTENCES:
        return SENTENCES[text]
    for zh, en in sorted(TERMS.items(), key=lambda x: -len(x[0])):
        text = text.replace(zh, en)
    text = text.replace("（", "(").replace("）", ")").replace("：", ": ").replace("，", ", ").replace("、", ", ")
    return re.sub(r"\s+", " ", text).strip()


def to_text(page: str) -> str:
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S)
    t = re.sub(r"<br\s*/?>|</p>|</li>|</div>|</td>|</tr>|</h\d>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = htmllib.unescape(t)
    t = re.sub(r"[ \t\xa0]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t)


def list_notices() -> dict[int, str]:
    found: dict[int, str] = {}
    for page in range(1, NEWS_PAGES + 1):
        html = requests.get(f"{BASE}/news?page={page}", headers=HEADERS, timeout=30).text
        for m in re.finditer(r'href="/news/show/(\d+)"[^>]*>(.*?)</a>', html, flags=re.S):
            title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2))).strip()
            if title and NOTICE_RE.search(title) and not SKIP_RE.search(title):
                found[int(m.group(1))] = title
        time.sleep(0.4)
    return found


def parse_notice(nid: int, title: str, names: dict[str, str], unmapped: set[str]) -> list[dict]:
    text = to_text(requests.get(f"{BASE}/news/show/{nid}", headers=HEADERS, timeout=30).text)
    date_m = re.search(r"(20\d\d)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", text)
    if date_m:
        date = f"{date_m.group(1)}-{int(date_m.group(2)):02d}-{int(date_m.group(3)):02d}"
    else:
        # Balance previews only show "MM/DD" under the title; year comes from the version timeline
        md = re.search(r"\n\s*(\d{2})/(\d{2})\s*\n", text)
        date = (
            f"{'2025' if md and int(md.group(1)) >= 9 and nid < 5420 else '2026'}-{md.group(1)}-{md.group(2)}"
            if md
            else None
        )
    version_m = re.search(r"「([^」]+版本)」|^(\S+版本)", title)

    records: list[dict] = []
    hero = skill = None
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        if re.match(
            r"^(裝備|系統|其他|戰場|娛樂|挑戰者技能|賽季|新英雄|玩法|魔法棋|魔紋|天賦|光暗對決|職業平衡|活動|修復|商城|推薦|模式)",
            line,
        ):
            hero = skill = None
            continue
        # Hero header: "<epithet> <name>" or a bare name
        head = re.match(r"^(?:\S{1,10}\s+)?(\S{1,8})$", line)
        if head and head.group(1) in names:
            hero, skill = names[head.group(1)], None
            continue
        if head and head.group(1) in unmapped:
            # Known TW hero without an English mapping: stop attributing lines to the previous hero
            hero = skill = None
            continue
        slot = re.match(r"^(被動|一技能|二技能|三技能|四技能|大招)\s*(.*)$", line)
        if slot and hero:
            skill = SKILL_SLOTS[slot.group(1)]
            continue
        if hero and "→" in line:
            field, _, change = line.partition("：") if "：" in line else ("", "", line)
            before, _, after = change.partition("→")
            records.append(
                {
                    "hero": hero,
                    "skill": skill,
                    "field": translate(field) or None,
                    "before": translate(before),
                    "after": translate(after),
                    "_raw": [field.strip(), before.strip(), after.strip()],
                    "date": date,
                    "version": (version_m.group(1) or version_m.group(2)) if version_m else None,
                    "source": f"{BASE}/news/show/{nid}",
                }
            )
        elif hero and line.startswith("新增效果"):
            records.append(
                {
                    "hero": hero,
                    "skill": skill,
                    "field": "New effect",
                    "before": None,
                    "after": translate(line.split("：", 1)[-1]),
                    "_raw": ["", "", line.split("：", 1)[-1].strip()],
                    "date": date,
                    "version": (version_m.group(1) or version_m.group(2)) if version_m else None,
                    "source": f"{BASE}/news/show/{nid}",
                }
            )
    return records


def main() -> None:
    name_map = json.loads(NAMES_PATH.read_text(encoding="utf-8"))
    names = name_map["names"]
    unmapped = {k for k in name_map.get("_unmapped", {}) if not k.startswith("_")}
    notices = list_notices()
    print(f"Balance-related notices: {len(notices)}")

    records: list[dict] = []
    for nid in sorted(notices):
        records += parse_notice(nid, notices[nid], names, unmapped)
        time.sleep(0.4)

    # Same change is often posted twice (balance preview + version notice); keep one
    seen, unique = set(), []
    for r in records:
        key = (r["hero"], r["skill"], r["field"], r["before"], r["after"])
        if key not in seen:
            seen.add(key)
            unique.append(r)
    unique.sort(key=lambda r: (r["date"] or "", r["hero"], r["skill"] or ""))

    leftovers = sorted(
        {
            raw
            for r in unique
            for raw, tr in zip(r["_raw"], (r["field"], r["before"], r["after"]))
            if tr and CJK_RE.search(tr)
        }
    )
    for r in unique:
        r.pop("_raw", None)
    if leftovers:
        print(f"Untranslated strings: {len(leftovers)} (add to {SENTENCES_PATH.name})")
        (SENTENCES_PATH.parent / ".untranslated.txt").write_text(chr(10).join(leftovers), encoding="utf-8")

    out = {
        "source": f"{BASE}/news (Garena TW, translated from Traditional Chinese)",
        "fetched": time.strftime("%Y-%m-%d"),
        "count": len(unique),
        "heroes": len({r["hero"] for r in unique}),
        "changes": unique,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Changes: {len(unique)} across {out['heroes']} heroes -> {OUT_PATH}")


if __name__ == "__main__":
    main()
