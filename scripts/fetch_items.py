"""Fetch RoV item data from https://rovmeta.com/items.

The page is a Next.js app; the item list is embedded in the React Server Components
payload (``self.__next_f.push([1, "..."])`` chunks). Each item's stat strings such as
``"+180 Attack Damage"`` are parsed into numeric fields; the original text is kept in
``stats_raw`` and passives stay as text.

rovmeta lags behind the live game, so ``data/items_overrides.json`` (hand-maintained from the
official Garena TH patch notes) is applied last: entries replace or add items by slug and
record the ``patch`` and ``source`` they come from.

Writes ``data/items.json``.

Usage:
    python scripts/fetch_items.py
"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import date
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data" / "items.json"
OVERRIDES_PATH = REPO_ROOT / "data" / "items_overrides.json"
SOURCE_URL = "https://rovmeta.com/items"

# Normalized stat key -> (unit, aliases as they appear in the source, lowercased)
STAT_ALIASES: dict[str, tuple[str, tuple[str, ...]]] = {
    "attack_damage": ("flat", ("attack damage", "ad")),
    "ability_power": ("flat", ("ap",)),
    "max_hp": ("flat", ("max hp", "max")),
    "max_hp_pct": ("pct", ("bonus hp",)),
    "max_mana": ("flat", ("max mana",)),
    "armor": ("flat", ("armor",)),
    "magic_defense": ("flat", ("magic armor", "magic defense", "magic")),
    "attack_speed": ("pct", ("attack speed",)),
    "critical_chance": ("pct", ("critical chance",)),
    "cooldown_reduction": ("pct", ("cd reduction", "cooldown reduction", "cooldown speed")),
    "movement_speed_pct": ("pct", ("movement speed",)),
    "movement_speed": ("flat", ()),  # boots, e.g. "Passive: +60 Movement Speed"
    "life_steal": ("pct", ("lifesteal", "life steal")),
    "magic_life_steal": ("pct", ("magic lifesteal",)),
    "hp_regen_5s": ("flat", ("hp regen / 5s",)),
    "mana_regen_5s": ("flat", ("mana regen / 5s",)),
    "ability_power_pct": ("pct", ("magic bonus",)),
}
ALIAS_TO_KEY = {alias: key for key, (_, aliases) in STAT_ALIASES.items() for alias in aliases}

STAT_RE = re.compile(r"^\s*\+\s*(?P<value>\d+(?:\.\d+)?)\s*(?P<pct>%)?\s*(?P<name>.+?)\.?\s*$")
# Boots and starter items list their stats as "Passive: +30 Movement Speed"
PASSIVE_STAT_RE = re.compile(r"^Passive:\s*(?P<stat>\+.+)$")


def extract_rsc_payload(html: str) -> str:
    chunks = re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', html)
    return "".join(json.loads(c) for c in chunks)


def extract_items_array(payload: str) -> list[dict]:
    start = payload.index('{"items":[') + len('{"items":')
    depth, in_str, escaped = 0, False, False
    for pos in range(start, len(payload)):
        ch = payload[pos]
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return json.loads(payload[start : pos + 1])
    raise ValueError("Unterminated items array in page payload")


def parse_stat(text: str) -> tuple[str, float] | None:
    m = STAT_RE.match(text)
    if not m:
        return None
    name = m.group("name").strip().lower()
    key = ALIAS_TO_KEY.get(name)
    if key is None:
        return None
    # Movement speed is a percentage on regular items but a flat value on boots
    if key == "movement_speed_pct" and not m.group("pct"):
        key = "movement_speed"
    return key, float(m.group("value"))


def is_truncated(passive: str) -> bool:
    """rovmeta drops inline-markup values, leaving passives that end mid-sentence."""
    return bool(re.search(r"(?:[:\-~]|\d|(?<![A-Za-z])Reduce \d+%|Hitting an enemy)\s*$", passive))


def normalize_item(raw: dict) -> tuple[dict, list[str]]:
    stats: dict[str, float] = {}
    unparsed: list[str] = []
    passives: list[str] = []

    for text in raw.get("stats", []):
        parsed = parse_stat(text)
        if parsed:
            stats[parsed[0]] = stats.get(parsed[0], 0.0) + parsed[1]
        else:
            unparsed.append(text)

    for text in raw.get("passives", []):
        m = PASSIVE_STAT_RE.match(text)
        parsed = parse_stat(m.group("stat")) if m else None
        if parsed:
            stats[parsed[0]] = stats.get(parsed[0], 0.0) + parsed[1]
        else:
            passives.append(re.sub(r"<[^>]+>", "", text).strip())

    item = {
        "name": raw["name"],
        "slug": raw["slug"],
        "category": raw.get("category"),
        "tier": raw.get("tier"),
        "price": raw.get("price"),
        "stats": dict(sorted(stats.items())),
        "passives": passives,
        "passives_incomplete": any(is_truncated(p) for p in passives),
        "stats_raw": raw.get("stats", []),
        "icon_url": f"https://rovmeta.com{raw['icon']}" if raw.get("icon", "").startswith("/") else raw.get("icon"),
    }
    return item, unparsed


def apply_overrides(items: list[dict]) -> list[str]:
    """Merge patch-note corrections into ``items`` in place; returns a log line per change."""
    if not OVERRIDES_PATH.exists():
        return []
    by_slug = {i["slug"]: i for i in items}
    log = []
    for patch in json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))["items"]:
        slug = patch["slug"]
        if slug in by_slug:
            item = by_slug[slug]
            item.update({k: v for k, v in patch.items() if k != "slug"})
            log.append(f"updated {item['name']} ({patch.get('patch', '?')})")
        else:
            item = {"stats_raw": [], "icon_url": None, **patch}
            items.append(item)
            by_slug[slug] = item
            log.append(f"added {item['name']} ({patch.get('patch', '?')})")
        item["stats"] = {k: float(v) for k, v in sorted(item.get("stats", {}).items())}
        item["passives_incomplete"] = any(is_truncated(p) for p in item.get("passives", []))
    return log


def main() -> None:
    html = requests.get(SOURCE_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30).text
    raw_items = extract_items_array(extract_rsc_payload(html))

    items, warnings = [], []
    for raw in raw_items:
        item, unparsed = normalize_item(raw)
        items.append(item)
        warnings += [f"{item['name']}: unparsed stat {u!r}" for u in unparsed]
        if item["passives_incomplete"]:
            warnings.append(f"{item['name']}: passive text truncated at source")

    override_log = apply_overrides(items)
    for item in items:
        if item["price"] is None:
            warnings.append(f"{item['name']}: missing price")

    items.sort(key=lambda x: (x["category"] or "", x["tier"] or 0, x["name"]))
    out = {
        "source": SOURCE_URL,
        "overrides": OVERRIDES_PATH.name,
        "fetched": date.today().isoformat(),
        "stat_units": {k: unit for k, (unit, _) in STAT_ALIASES.items()},
        "count": len(items),
        "items": items,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Items: {len(items)} | by category: {dict(Counter(i['category'] for i in items))}")
    print(f"Tier 3 (full items): {sum(1 for i in items if i['tier'] == 3)}")
    for line in override_log:
        print("PATCH", line)
    for w in warnings:
        print("WARN", w)
    print(f"Saved: {OUT_PATH}")


if __name__ == "__main__":
    main()
