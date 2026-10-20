"""Hero stat builder, skill damage calculator and 1v1 duel simulator.

Stats = level base stats + items + Tier 3 arcana + enchantments.
Mitigation: effective_def = max(0, (def - flat_pierce) * (1 - pct_pierce)); damage *= 600 / (600 + effective_def).
"""

import json
import re
from dataclasses import dataclass, field

from src.config import config

MAX_LEVEL = 15
CDR_CAP = 40.0
ATTACK_SPEED_CAP = 200.0
BASE_CRIT_DAMAGE = 200.0
# hero_level_stats has no attack-speed column; assume 1 attack per second before bonus attack speed.
BASE_ATTACKS_PER_SEC = 1.0
ARCANA_SLOTS_PER_COLOR = 10
DEFENSE_CONSTANT = 600.0
SKILL_CAST_GAP = 0.3
DUEL_DT = 0.05
DUEL_MAX_SECONDS = 60.0

ACTIVE_SLOTS = (
    "Skill 1",
    "Skill 2",
    "Ultimate",
    "Skill 3",
    "Skill 4",
    "Skill 5",
    "Skill 1 (Berserker Mode)",
    "Skill 2 (Berserker Mode)",
    "Ultimate (Berserker Mode)",
    "Skill 4 (Berserker Mode)",
)

ARCANA_KEY_MAP = {
    "attack_speed_pct": "attack_speed",
    "critical_chance_pct": "critical_chance",
    "critical_damage_pct": "critical_damage",
    "cooldown_reduction_pct": "cooldown_reduction",
    "life_steal_pct": "life_steal",
    "magic_life_steal_pct": "magic_life_steal",
    "armor_pierce": "armor_pierce_flat",
    "magic_pierce": "magic_pierce_flat",
}

STAT_KEYS = (
    "max_hp",
    "max_mana",
    "attack_damage",
    "ability_power",
    "armor",
    "magic_defense",
    "attack_speed",
    "critical_chance",
    "critical_damage",
    "cooldown_reduction",
    "movement_speed",
    "life_steal",
    "magic_life_steal",
    "hp_regen_5s",
    "mana_regen_5s",
    "armor_pierce_flat",
    "armor_pierce_pct",
    "magic_pierce_flat",
    "magic_pierce_pct",
    "damage_dealt_pct",
    "damage_taken_pct",
    "ultimate_cdr_bonus",
)

ENCHANTMENT_ALIASES = {
    "Turf Dominance": "Street Serpent",
    "Enhanced Restore": "Recovery+",
    "River Trader": "River Treader",
    "Desperate duel": "Desperate Duel",
}

FACTION_ALIASES = {
    "League of Humans": "Origin Alliance",
}

# Hero stack/proc passives that trigger bonus damage/effects on hitting enemies
HERO_STACK_PASSIVES: dict[str, dict] = {
    "Yena": {"slot": "Passive", "hits_needed": 5, "cooldown": 0.0},
    "Airi": {"slot": "Passive", "hits_needed": 4, "cooldown": 0.0},
    "Hayate": {"slot": "Passive", "hits_needed": 6, "cooldown": 0.0},
    "Lauriel": {"slot": "Passive", "hits_needed": 4, "cooldown": 0.0},
    "Aleister": {"slot": "Passive", "hits_needed": 3, "cooldown": 0.0},
    "Tulen": {"slot": "Passive", "hits_needed": 5, "cooldown": 0.0, "procs_per_trigger": 5},
}

# Numeric effects of enchantments verified against in-game screenshots.
# [lo, hi] ranges scale linearly from hero level 1 to 15.
ENCHANTMENT_EFFECTS: dict[str, dict] = {
    # Veda
    "Axe of Sacrifice": {
        "stats": {"damage_dealt_pct": 3},
        "melee_stats": {"damage_taken_pct": 1},
        "ranged_stats": {"damage_taken_pct": 2},
        "note": "ดาเมจเพิ่ม 3% โดนแรงขึ้น 2% (ฮีโร่ระยะใกล้ 1%)",
    },
    "Mana Refill": {
        "note": "ฟื้นฟู 8% ของมานาสูงสุด เมื่อใช้สกิล/โจมตีปกติ (CD: 5 วิ)",
    },
    "Sacred Bead": {
        "stats": {"ultimate_cdr_bonus": 10},
        "note": "ลดคูลดาวน์อัลติเมต 10%",
    },
    "Blessing": {
        "item_multipliers": {"critical_chance": 1.12, "ability_power": 1.08},
        "note": "คริติคอลจากไอเทม +12%, พลังเวทจากไอเทม +8%",
    },
    "Holy Verdict": {
        "stats": {"armor_pierce_flat": [18, 60], "magic_pierce_flat": [18, 60]},
        "note": "เจาะเกราะ/เจาะเวท 18-60 ตามเลเวล",
    },
    "Holy Summoner": {
        "proc": {"base": 0, "target_hp_pct": 2.0, "type": "true", "cooldown": 10, "hits_needed": 3},
        "note": "โจมตีครบ 3 ครั้ง แฟรี่ช่วยตีดาเมจจริง 2% Max HP เป้าหมาย (CD: 10 วิ)",
    },
    "Holy Thunder": {
        "proc": {"base": [80, 192], "ap": 0.3, "type": "magic", "cooldown": 12, "hits_needed": 1},
        "note": "สายฟ้าเวท 80-192 (+0.3 AP) (CD: 12 วิ)",
    },
    "Sacred Protection": {
        "note": "โดนดาเมจเกิน 30% HP ได้รับเกราะ 400-820 และเวทแวมไพร์ 20% นาน 6 วิ (CD: 30 วิ)",
    },
    # Lokheim
    "Devourer": {
        "note": "ฟื้นฟู 9% HP และ 15% MP หลัง Kill หรือ Assist",
    },
    "Shadow Blade": {
        "note": "ใช้สกิลเคลื่อนที่ โจมตีถัดไปทำโบนัสกายภาพ 30-100 ต่อสแต็ก (สูงสุด 3 สแต็ก)",
    },
    "Raging Inferno": {
        "proc": {"base": [50, 120], "ap": 0.15, "type": "magic", "cooldown": 8, "hits_needed": 1},
        "note": "ความเสียหายเวท 50-120 (+0.15 AP) (CD: 8 วิ)",
    },
    "Deadly Claw": {
        "stats": {"attack_damage": [10, 38], "ability_power": [15, 57]},
        "note": "พลังโจมตี 10-38 และพลังเวท 15-57 ตามเลเวล",
    },
    "Bone Cutter": {
        "note": "ต้านทานสถานะ +12.5%",
    },
    "Street Serpent": {
        "note": "ความเร็วเคลื่อนที่ 3% และความเสียหายแรงขึ้น 3% ในพื้นที่ฝ่ายตัวเอง",
    },
    "Desperate Duel": {
        "note": "สะสมครบ 10 ครั้ง ฟื้น 10% HP ที่เสียไป และได้เจาะเกราะ/เจาะเวท +15%",
    },
    "Curse of Death": {
        "proc": {"base": [40, 96], "bonus_ad": 0.25, "ap": 0.15, "type": "magic", "cooldown": 15, "hits_needed": 3},
        "note": "ระเบิดเวท 40-96 (+0.25 Bonus AD) (+0.15 AP) + 6% HP ที่เสียไป (CD: 15 วิ)",
    },
    "Devil's Awakening": {
        "note": "ใช้อัลติ ลดคูลดาวน์สกิลธรรมดา 30% และเร่งนับ CD 20% (แพตช์ปัจจุบันเอาลดดาเมจ 10% ออกแล้ว)",
    },
    # Afata
    "River Treader": {
        "note": "ความเร็วเคลื่อนที่ +10 ในแม่น้ำ และฟื้นฟู 20 HP / 10 MP ทุก 5 วิ",
    },
    "Backstabbing": {
        "note": "ออกจากพุ่มไม้ โจมตีถัดไปทำดาเมจจริง 4% ของ HP ที่เหลืออยู่ (CD: 20 วิ)",
    },
    "Tower Blessing": {
        "note": "ในระยะป้อม ต้านสถานะ +15% และลดดาเมจที่ได้รับ 10%",
    },
    "Regrowth": {
        "note": "ฟื้นฟูและโล่เพิ่ม 10% (HP น้อยกว่า 50% เพิ่มอีก 10%)",
    },
    "Nature's Gift": {
        "stats": {"max_hp": 800},
        "note": "คิดเต็ม 100 สแต็ก (+800 Max HP)",
    },
    "Vital Aid": {
        "note": "แพ็คฮีลฟื้นฟู 225-435 HP ทุก 15 วิ (210 + Lv*15)",
    },
    "Nature's Rage": {
        "note": "สกิล CC เผาเวท 2% Max HP ทุก 0.5 วิ นาน 3 วิ (รวม 12%) และลดเกราะเวท 30-72 (CD: 20 วิ)",
    },
    "Explosive Shield": {
        "proc": {"base": 0, "own_hp_pct": 2.0, "type": "magic", "cooldown": 10, "hits_needed": 4},
        "note": "สะสมครบ 4 ครั้ง สายฟ้าเวท 2% Max HP ตัวเอง และฟื้นฟู 5% HP (CD: 10 วิ)",
    },
    "Forest Wanderer": {
        "note": "โจมตีเปิดนอกต่อสู้ ระเบิดเวท 8% Max HP เป้าหมาย",
    },
    # Origin Alliance
    "Mark of Frost": {
        "note": "ได้รับไอเทมกดใช้ Freeze อมตะชั่วคราว (ใช้ได้ครั้งเดียว)",
    },
    "Recovery+": {
        "note": "เปลี่ยน Recovery เป็นฟื้นฟู 660 HP และ 210 MP ทันที",
    },
    "Arcane Whisper": {
        "note": "ลดคูลดาวน์สกิล Challenger 15%",
    },
    "Minion Kill": {
        "note": "สังหารครีปทันทีทุก 25 วิ สะสมครบ 10 ครั้งได้ 200 โกลด์",
    },
    "Gunslinger": {
        "stats": {"attack_damage": 8, "ability_power": 12},
        "note": "คิด 1 สแต็ก (ตอนเกิด) พลังโจมตี +8 พลังเวท +12",
    },
    "Endless Cycle": {
        "note": "เกิดที่บ่อน้ำพุได้ทันทีหลังตาย (สูงสุด 2 ครั้ง)",
    },
    "Alchemy": {
        "note": "โจมตีโดนป้อม/ฮีโร่ ได้รับโกลด์ 16 ต่อสแต็ก (สูงสุด 800 โกลด์)",
    },
}

# Pierce is only described in item passives; parse it from text.
# Flat patterns use (?![\d%]|\.\d) so "+40%" is never also read as 40 flat pierce.
_NUM = r"(\d+(?:\.\d+)?)"
_FLAT = r"(\d+(?:\.\d+)?)(?![\d%]|\.\d)"
_ARMOR = r"(?:Armor Pierce|armor penetration)"
PIERCE_PATTERNS = (
    (re.compile(rf"{_ARMOR} \+{_NUM}%", re.I), "armor_pierce_pct"),
    (re.compile(rf"\+{_NUM}% {_ARMOR}", re.I), "armor_pierce_pct"),
    (re.compile(rf"{_ARMOR} by {_NUM}%", re.I), "armor_pierce_pct"),
    (re.compile(rf"{_ARMOR} by (\d+)\s*-\s*(\d+)", re.I), "armor_pierce_flat_range"),
    (re.compile(rf"Gains? (\d+)\s*-\s*(\d+) {_ARMOR}", re.I), "armor_pierce_flat_range"),
    (re.compile(rf"{_ARMOR} \+{_FLAT}", re.I), "armor_pierce_flat"),
    (re.compile(rf"\+{_FLAT} {_ARMOR}", re.I), "armor_pierce_flat"),
    (re.compile(rf"\+{_NUM}% Magic Pierce"), "magic_pierce_pct"),
    (re.compile(rf"Magic Pierce \+{_NUM}%"), "magic_pierce_pct"),
    (re.compile(rf"Magic Pierce \+{_FLAT}"), "magic_pierce_flat"),
    (re.compile(rf"\+{_FLAT} Magic Pierce"), "magic_pierce_flat"),
    (
        re.compile(r"Gain (\d+)\s*-\s*(\d+) (?:\(\+(\d+)% bonus HP\) )?Magic Pierce(?:, up to a maximum of (\d+))?"),
        "magic_pierce_flat_range",
    ),
)
RANGED_DOUBLED = re.compile(r"doubled for ranged heroes", re.I)


def is_enchantment_modeled(effect: dict | None) -> bool:
    if not effect:
        return False
    return any(k in effect for k in ("stats", "ranged_stats", "melee_stats", "item_multipliers", "proc"))


def lerp_by_level(value, level: int) -> float:
    if isinstance(value, list):
        lo, hi = value
        return lo + (hi - lo) * (level - 1) / (MAX_LEVEL - 1)
    return float(value)


def mitigation_multiplier(defense: float, flat_pierce: float, pct_pierce: float) -> float:
    effective = max(0.0, (defense - flat_pierce) * (1 - pct_pierce / 100.0))
    return DEFENSE_CONSTANT / (DEFENSE_CONSTANT + effective)


def normalize_ratio(value: float) -> float:
    """Skill catalog mixes ratios (1.45) and percents (145.0); return percent."""
    return value * 100.0 if 0 < value < 2.0 else value


def parse_item_pierce(
    passives: list[str], level: int, is_ranged: bool = False, bonus_hp: float = 0.0
) -> list[tuple[str, float]]:
    found = []
    for text in passives:
        mult = 2.0 if is_ranged and RANGED_DOUBLED.search(text) else 1.0
        for pattern, key in PIERCE_PATTERNS:
            m = pattern.search(text)
            if not m:
                continue
            if key.endswith("_range"):
                lo, hi = float(m.group(1)), float(m.group(2))
                value = lo + (hi - lo) * (level - 1) / (MAX_LEVEL - 1)
                groups = m.groups()
                if len(groups) == 4:
                    if groups[2]:
                        value += bonus_hp * float(groups[2]) / 100
                    if groups[3]:
                        value = min(value, float(groups[3]))
                found.append((key.removesuffix("_range"), value * mult))
            else:
                found.append((key, float(m.group(1)) * mult))
    return found


def auto_skill_levels(level: int) -> dict[str, int]:
    """Auto skill-point allocation: Ultimate at 4/8/12, alternating S1 and S2."""
    s1, s2, ult = 0, 0, 0
    for lv in range(1, level + 1):
        if lv in (4, 8, 12) and ult < 3:
            ult += 1
        elif (s1 <= s2 and s1 < 6) or s2 >= 6:
            s1 = min(6, s1 + 1)
        elif s2 < 6:
            s2 = min(6, s2 + 1)
    return {
        "Skill 1": s1,
        "Skill 2": s2,
        "Ultimate": ult,
        "Skill 3": s1,
        "Skill 4": ult,
        "Skill 5": ult,
        "Skill 1 (Berserker Mode)": s1,
        "Skill 2 (Berserker Mode)": s2,
        "Ultimate (Berserker Mode)": ult,
        "Skill 4 (Berserker Mode)": ult,
    }


@dataclass
class Build:
    hero: str
    level: int = 12
    items: list[str] = field(default_factory=list)
    arcana: dict[str, int] = field(default_factory=dict)
    primary_faction: str | None = None
    primary_enchantments: list[str] = field(default_factory=list)
    secondary_faction: str | None = None
    secondary_enchantments: list[str] = field(default_factory=list)
    skill_levels: dict[str, int] = field(default_factory=dict)
    skill_hits: dict[str, int] = field(default_factory=dict)
    skill_charges: dict[str, float] = field(default_factory=dict)
    active_combo_slots: list[str] | None = None


class CombatEngine:
    def __init__(self, paths=config.paths):
        self.level_stats = json.loads(paths.hero_level_stats_json_path.read_text(encoding="utf-8"))["heroes"]
        self.skills = json.loads(paths.hero_skills_json_path.read_text(encoding="utf-8"))["heroes"]
        items = json.loads(paths.items_json_path.read_text(encoding="utf-8"))["items"]
        self.items = {i["name"]: i for i in items}
        self.item_aliases = {old: i["name"] for i in items for old in i.get("alias") or []}
        arcana = json.loads(paths.arcana_json_path.read_text(encoding="utf-8"))["arcana"]
        self.arcana = {a["name"]: a for a in arcana if a["tier"] == 3}
        ench = json.loads(paths.enchantments_json_path.read_text(encoding="utf-8"))
        self.factions = [f for f in ench["factions"] if f != "League of Humans"]
        self.enchantments = {e["name"]: e for e in ench["enchantments"]}
        self.enchantment_aliases = dict(ENCHANTMENT_ALIASES)
        for e in ench["enchantments"]:
            if "alias" in e:
                self.enchantment_aliases[e["alias"]] = e["name"]
        heroes = json.loads(paths.heroes_json_path.read_text(encoding="utf-8"))
        self.hero_meta = {
            h["name"]: {"role": h.get("primary_role"), "ranged": "rang" in (h.get("attack_range") or "").lower()}
            for h in heroes
        }

    def canonical_enchantment(self, name: str) -> str:
        return self.enchantment_aliases.get(name, name)

    @staticmethod
    def normalize_faction(faction: str | None) -> str | None:
        if not faction:
            return None
        return FACTION_ALIASES.get(faction, faction)

    # ---------- catalog ----------
    def catalog(self) -> dict:
        return {
            "heroes": [
                {"name": name, **self.hero_meta.get(name, {"role": None, "ranged": False})}
                for name in sorted(self.level_stats)
            ],
            "max_level": MAX_LEVEL,
            "skills": self.skills,
            "items": [
                {k: i.get(k) for k in ("name", "category", "tier", "price", "stats", "passives", "icon_url")}
                | {"pierce": dict(parse_item_pierce(i.get("passives") or [], MAX_LEVEL))}
                for i in self.items.values()
            ],
            "arcana": [
                {k: a.get(k) for k in ("name", "name_th", "color", "stats", "icon")} for a in self.arcana.values()
            ],
            "arcana_slots_per_color": ARCANA_SLOTS_PER_COLOR,
            "factions": self.factions,
            "enchantments": [
                {
                    "name": e["name"],
                    "alias": e.get("alias"),
                    "faction": e["faction"],
                    "tier": e["tier"],
                    "category": e.get("category_th"),
                    "description": e["description"],
                    "icon_url": e.get("icon_url"),
                    "modeled": is_enchantment_modeled(ENCHANTMENT_EFFECTS.get(self.canonical_enchantment(e["name"]))),
                    "note": ENCHANTMENT_EFFECTS.get(self.canonical_enchantment(e["name"]), {}).get("note"),
                }
                for e in self.enchantments.values()
            ],
        }

    # ---------- validation ----------
    def validate(self, build: Build) -> None:
        if build.hero not in self.level_stats:
            raise ValueError(f"Unknown hero: {build.hero}")
        if not 1 <= build.level <= MAX_LEVEL:
            raise ValueError(f"Level must be 1-{MAX_LEVEL}")
        if len(build.items) > 6:
            raise ValueError("At most 6 items")
        build.items = [self.item_aliases.get(name, name) for name in build.items]
        for name in build.items:
            if name not in self.items:
                raise ValueError(f"Unknown item: {name}")
        per_color: dict[str, int] = {}
        for name, count in build.arcana.items():
            if name not in self.arcana:
                raise ValueError(f"Unknown Tier 3 arcana: {name}")
            if count < 0:
                raise ValueError(f"Negative arcana count: {name}")
            color = self.arcana[name]["color"]
            per_color[color] = per_color.get(color, 0) + count
        for color, total in per_color.items():
            if total > ARCANA_SLOTS_PER_COLOR:
                raise ValueError(f"{color} arcana exceeds {ARCANA_SLOTS_PER_COLOR} slots ({total})")
        self._validate_enchantments(build)

    def _validate_enchantments(self, build: Build) -> None:
        prim_f = self.normalize_faction(build.primary_faction)
        valid_factions = set(self.factions) | set(FACTION_ALIASES.keys())

        # 1. Primary Faction validation
        if build.primary_enchantments:
            if prim_f not in valid_factions and prim_f not in self.factions:
                raise ValueError(f"primary faction required (one of {self.factions})")
            seen_tiers = set()
            for raw_name in build.primary_enchantments:
                name = self.canonical_enchantment(raw_name)
                ench = self.enchantments.get(name)
                if ench is None:
                    raise ValueError(f"Unknown enchantment: {raw_name}")
                ench_f = self.normalize_faction(ench["faction"])
                if ench_f != prim_f:
                    raise ValueError(f"{raw_name} is not a {prim_f} enchantment")
                if ench["tier"] not in (1, 2, 3):
                    raise ValueError(f"primary faction cannot take tier {ench['tier']} enchantment {raw_name}")
                if ench["tier"] in seen_tiers:
                    raise ValueError(f"Only one tier {ench['tier']} enchantment allowed in primary faction")
                seen_tiers.add(ench["tier"])

        # 2. Secondary Faction validation (supports 1+2 of same faction OR two Tier 1s of different factions)
        if build.secondary_enchantments:
            if len(build.secondary_enchantments) > 2:
                raise ValueError("secondary faction cannot have more than 2 enchantments")
            sec_items = []
            for raw_name in build.secondary_enchantments:
                name = self.canonical_enchantment(raw_name)
                ench = self.enchantments.get(name)
                if ench is None:
                    raise ValueError(f"Unknown enchantment: {raw_name}")
                ench_f = self.normalize_faction(ench["faction"])
                if ench["tier"] not in (1, 2):
                    raise ValueError(f"secondary faction cannot take tier {ench['tier']} enchantment {raw_name}")
                if prim_f and ench_f == prim_f:
                    raise ValueError("Primary and secondary factions must differ")
                sec_items.append((ench_f, ench["tier"], raw_name))

            if len(sec_items) == 2:
                (f1, t1, _n1), (f2, t2, _n2) = sec_items
                if f1 == f2:
                    if t1 == t2:
                        raise ValueError(f"Only one tier {t1} enchantment allowed in secondary faction")
                else:
                    if t1 != 1 or t2 != 1:
                        raise ValueError(
                            "When choosing secondary enchantments from different factions, both must be tier 1"
                        )

        if build.secondary_faction:
            for sf in build.secondary_faction.split(","):
                norm_sf = self.normalize_faction(sf.strip())
                if prim_f and norm_sf == prim_f:
                    raise ValueError("Primary and secondary factions must differ")

    # ---------- stats ----------
    def build_stats(self, build: Build) -> dict:
        self.validate(build)
        lv = self.level_stats[build.hero]["levels"][str(build.level)]
        base = {
            "max_hp": lv["hp"],
            "armor": lv["armor"],
            "magic_defense": lv["magic_defense"],
            "attack_damage": lv["attack_damage"],
            "movement_speed": lv["movement_speed"],
        }

        item_stats: dict[str, float] = {}
        seen_unique: set[str] = set()
        pierce_texts: list[str] = []
        for name in build.items:
            item = self.items[name]
            for k, v in item["stats"].items():
                item_stats[k] = item_stats.get(k, 0.0) + v
            for text in item.get("passives") or []:
                # Unique passives (same text) do not stack across duplicate items.
                if (text.startswith("Unique") or text.startswith("Passive")) and text in seen_unique:
                    continue
                seen_unique.add(text)
                pierce_texts.append(text)

        is_ranged = self.hero_meta.get(build.hero, {}).get("ranged", False)
        arcana_stats: dict[str, float] = {}
        for name, count in build.arcana.items():
            for k, v in self.arcana[name]["stats"].items():
                key = ARCANA_KEY_MAP.get(k, k)
                arcana_stats[key] = arcana_stats.get(key, 0.0) + v * count

        ench_stats: dict[str, float] = {}
        modeled, unmodeled = [], []
        for raw_name in list(build.primary_enchantments) + list(build.secondary_enchantments):
            name = self.canonical_enchantment(raw_name)
            effect = ENCHANTMENT_EFFECTS.get(name)
            if not is_enchantment_modeled(effect):
                unmodeled.append(raw_name)
                continue
            modeled.append(raw_name)
            for group in (effect.get("stats", {}), effect.get("ranged_stats" if is_ranged else "melee_stats", {})):
                for k, v in group.items():
                    ench_stats[k] = ench_stats.get(k, 0.0) + lerp_by_level(v, build.level)
            for k, mult in effect.get("item_multipliers", {}).items():
                ench_stats[k] = ench_stats.get(k, 0.0) + item_stats.get(k, 0.0) * (mult - 1)

        def total(key: str) -> float:
            return base.get(key, 0.0) + item_stats.get(key, 0.0) + arcana_stats.get(key, 0.0) + ench_stats.get(key, 0.0)

        stats = {k: total(k) for k in STAT_KEYS}
        stats["max_hp"] *= 1 + item_stats.get("max_hp_pct", 0.0) / 100
        # Pierce is parsed after HP is final: some items scale pierce with bonus HP.
        bonus_hp = stats["max_hp"] - base["max_hp"]
        for key, val in parse_item_pierce(pierce_texts, build.level, is_ranged, bonus_hp):
            item_stats[key] = item_stats.get(key, 0.0) + val
            stats[key] += val
        stats["ability_power"] *= 1 + item_stats.get("ability_power_pct", 0.0) / 100
        stats["movement_speed"] *= 1 + total("movement_speed_pct") / 100
        stats["base_attack_damage"] = float(base["attack_damage"])
        stats["bonus_attack_damage"] = stats["attack_damage"] - base["attack_damage"]
        stats["critical_damage"] += BASE_CRIT_DAMAGE
        stats["critical_chance"] = min(100.0, stats["critical_chance"])
        stats["attack_speed"] = min(ATTACK_SPEED_CAP, stats["attack_speed"])
        stats["cooldown_reduction_uncapped"] = stats["cooldown_reduction"]
        stats["cooldown_reduction"] = min(CDR_CAP, stats["cooldown_reduction"])
        stats["armor_pierce_pct"] = min(100.0, stats["armor_pierce_pct"])
        stats["magic_pierce_pct"] = min(100.0, stats["magic_pierce_pct"])
        stats["attacks_per_sec"] = BASE_ATTACKS_PER_SEC * (1 + stats["attack_speed"] / 100)
        stats = {k: round(v, 2) for k, v in stats.items()}

        prices = [self.items[n].get("price") for n in build.items]
        return {
            "hero": build.hero,
            "level": build.level,
            "is_ranged": is_ranged,
            "stats": stats,
            "sources": {
                "level": base,
                "items": {k: round(v, 2) for k, v in item_stats.items()},
                "arcana": {k: round(v, 2) for k, v in arcana_stats.items()},
                "enchantments": {k: round(v, 2) for k, v in ench_stats.items()},
            },
            "build_cost": sum(p for p in prices if p),
            "items_missing_price": [n for n, p in zip(build.items, prices, strict=True) if not p],
            "enchantments_modeled": modeled,
            "enchantments_unmodeled": unmodeled,
        }

    # ---------- skills ----------
    def skill_levels_for(self, build: Build) -> dict[str, int]:
        levels = auto_skill_levels(build.level)
        skill_by_slot = {s["slot"]: s for s in self.skills.get(build.hero, [])}
        for slot, val in build.skill_levels.items():
            sk = skill_by_slot.get(slot, {})
            lv_slot = sk.get("level_slot", slot)
            bd_len = len(sk.get("base_damage") or [])
            cap = 3 if (lv_slot == "Ultimate" or bd_len == 3) else 6
            levels[slot] = max(0, min(cap, int(val)))
        return levels

    @staticmethod
    def _pick(values: list, skill_level: int, hero_level: int):
        if not values:
            return 0
        if len(values) == MAX_LEVEL:
            return values[hero_level - 1]
        return values[max(0, min(len(values) - 1, skill_level - 1))]

    def skill_damage(self, attacker: dict, defender: dict, build: Build) -> list[dict]:
        a, d = attacker["stats"], defender["stats"]
        base_lv = attacker["sources"]["level"]
        bonus_hp = max(0.0, a["max_hp"] - base_lv.get("max_hp", 0.0))
        bonus_armor = max(0.0, a["armor"] - base_lv.get("armor", 0.0))
        levels = self.skill_levels_for(build)
        dealt_mult = (1 + a["damage_dealt_pct"] / 100) * (1 + d["damage_taken_pct"] / 100)
        type_mult = {
            "physical": mitigation_multiplier(d["armor"], a["armor_pierce_flat"], a["armor_pierce_pct"]),
            "magic": mitigation_multiplier(d["magic_defense"], a["magic_pierce_flat"], a["magic_pierce_pct"]),
            "true": 1.0,
        }
        rows = []
        for skill in self.skills[build.hero]:
            slot = skill["slot"]
            dtype = skill["damage_type"]
            # Alternate-form skills (e.g. Yena combined blade, Liliana fox, Edras berserker) level with their in-game slot
            level_slot = slot if slot in build.skill_levels else skill.get("level_slot", slot)
            sl = 1 if slot.startswith("Passive") else levels.get(level_slot, 0)
            warnings = []

            # Charging / distance scaling
            has_charge = ("max_damage" in skill) or ("max_scaling" in skill)
            charge_ratio = min(1.0, max(0.0, float(build.skill_charges.get(slot, 0.0)))) if has_charge else 0.0

            bd = skill["base_damage"]
            if dtype != "none" and bd and (len(bd) not in (1, 3, 6, MAX_LEVEL) or max(bd) > 2000):
                warnings.append("ข้อมูล base damage ผิดปกติ ควรตรวจกับในเกม")

            min_base = float(self._pick(bd, sl, build.level))
            if "max_damage" in skill:
                max_base = float(self._pick(skill["max_damage"], sl, build.level))
                effective_base = (1.0 - charge_ratio) * min_base + charge_ratio * max_base
            else:
                effective_base = min_base

            sc = dict(skill["scaling"])
            if "max_scaling" in skill and charge_ratio > 0.0:
                for k, max_v in skill["max_scaling"].items():
                    min_v = sc.get(k, 0.0)
                    sc[k] = (1.0 - charge_ratio) * min_v + charge_ratio * max_v

            parts = {"base": effective_base}
            if "level_scaling" in sc:
                parts["base"] += sc["level_scaling"] * build.level
            if "ad_pct" in sc:
                parts["ad"] = normalize_ratio(sc["ad_pct"]) / 100 * a["attack_damage"]
            if "bonus_ad_pct" in sc:
                parts["bonus_ad"] = normalize_ratio(sc["bonus_ad_pct"]) / 100 * a["bonus_attack_damage"]
            ap_pct_total = normalize_ratio(sc.get("ap_pct", 0.0)) + normalize_ratio(sc.get("bonus_ap_pct", 0.0))
            if ap_pct_total:
                parts["ap"] = ap_pct_total / 100 * a["ability_power"]
            own_hp = sc.get("own_hp_pct", 0.0) + sc.get("hp_pct", 0.0) + sc.get("max_hp_pct", 0.0)
            bonus_hp_pct = sc.get("bonus_hp_pct", 0.0) + sc.get("bonus_max_hp_pct", 0.0)
            if own_hp or bonus_hp_pct:
                parts["own_hp"] = (own_hp / 100 * a["max_hp"]) + (bonus_hp_pct / 100 * bonus_hp)
                if "hp_pct" in sc:
                    warnings.append("hp_pct ตีความเป็น % HP สูงสุดของตัวเอง")
            if "bonus_armor_pct" in sc:
                parts["armor"] = sc["bonus_armor_pct"] / 100 * bonus_armor
            target_hp_pct = (
                sc.get("target_hp_pct", 0.0)
                + sc.get("target_max_hp_pct", 0.0)
                + sc.get("target_current_hp_pct", 0.0)
                + sc.get("target_hp_per_100_ad_pct", 0.0) * (a["attack_damage"] / 100.0)
                + sc.get("target_hp_per_100_bonus_ad_pct", 0.0) * (a["bonus_attack_damage"] / 100.0)
                + sc.get("target_hp_per_100_ap_pct", 0.0) * (a["ability_power"] / 100.0)
            )
            if target_hp_pct:
                parts["target_hp"] = target_hp_pct / 100 * d["max_hp"]
            if sl == 0 or dtype == "none":
                parts = {k: 0.0 for k in parts}
            raw = sum(parts.values())
            mult = type_mult.get(dtype, 0.0)
            hits = max(1, int(build.skill_hits.get(slot, skill.get("hits", 1))))
            final = raw * mult * dealt_mult * hits
            cd = float(self._pick(skill["cooldown"], max(sl, 1), build.level) or 0)
            cdr = a["cooldown_reduction"]
            if skill.get("level_slot", slot) == "Ultimate":
                cdr = min(CDR_CAP, cdr + a["ultimate_cdr_bonus"])
            rows.append(
                {
                    "name": skill["name"],
                    "slot": slot,
                    "damage_type": dtype,
                    "skill_level": sl,
                    "hits": hits,
                    "has_charge": has_charge,
                    "charge_ratio": round(charge_ratio, 2) if has_charge else None,
                    "max_damage": skill.get("max_damage"),
                    "max_scaling": skill.get("max_scaling"),
                    "components": {k: round(v, 1) for k, v in parts.items()},
                    "raw_damage": round(raw * hits, 1),
                    "mitigation_multiplier": round(mult, 4),
                    "final_damage": round(final, 1),
                    "pct_target_hp": round(100 * final / d["max_hp"], 1) if d["max_hp"] else 0.0,
                    "cooldown": round(cd * (1 - cdr / 100), 2),
                    "mana_cost": self._pick(skill["mana_cost"], max(sl, 1), build.level),
                    "description": skill["description"],
                    "desc_th": skill.get("desc_th"),
                    "icon_url": skill.get("icon_url"),
                    "base_damage": skill.get("base_damage"),
                    "scaling": skill.get("scaling"),
                    "base_cooldown": round(cd, 2),
                    "warnings": warnings,
                }
            )
        return rows

    @staticmethod
    def basic_attack(attacker: dict, defender: dict) -> dict:
        a, d = attacker["stats"], defender["stats"]
        crit = a["critical_chance"] / 100
        expected = a["attack_damage"] * (1 + crit * (a["critical_damage"] / 100 - 1))
        mult = mitigation_multiplier(d["armor"], a["armor_pierce_flat"], a["armor_pierce_pct"])
        mult *= (1 + a["damage_dealt_pct"] / 100) * (1 + d["damage_taken_pct"] / 100)
        per_hit = expected * mult
        return {
            "raw_per_hit": round(expected, 1),
            "final_per_hit": round(per_hit, 1),
            "attacks_per_sec": a["attacks_per_sec"],
            "dps": round(per_hit * a["attacks_per_sec"], 1),
        }

    def _procs(self, attacker: dict, build: Build, defender: dict, skills: list[dict] | None = None) -> list[dict]:
        a, d = attacker["stats"], defender["stats"]
        dealt_mult = (1 + a["damage_dealt_pct"] / 100.0) * (1 + d["damage_taken_pct"] / 100.0)
        out = []
        for raw_name in list(build.primary_enchantments) + list(build.secondary_enchantments):
            name = self.canonical_enchantment(raw_name)
            proc = ENCHANTMENT_EFFECTS.get(name, {}).get("proc")
            if not proc:
                continue
            raw = lerp_by_level(proc["base"], build.level) if proc.get("base") else 0.0
            raw += proc.get("ap", 0) * a["ability_power"] + proc.get("bonus_ad", 0) * a["bonus_attack_damage"]
            if proc.get("target_hp_pct"):
                raw += proc["target_hp_pct"] * d["max_hp"] / 100.0
            if proc.get("own_hp_pct"):
                raw += proc["own_hp_pct"] * a["max_hp"] / 100.0
            dtype = proc.get("type", "magic")
            if dtype == "magic":
                mult = mitigation_multiplier(d["magic_defense"], a["magic_pierce_flat"], a["magic_pierce_pct"])
            elif dtype == "physical":
                mult = mitigation_multiplier(d["armor"], a["armor_pierce_flat"], a["armor_pierce_pct"])
            else:
                mult = 1.0
            out.append(
                {
                    "name": raw_name,
                    "damage": raw * mult * dealt_mult,
                    "damage_type": dtype,
                    "cooldown": proc["cooldown"],
                    "hits_needed": proc.get("hits_needed", 1),
                }
            )

        # Hero-specific stack passives that trigger bonus damage/effects on hitting enemies
        if skills and build.hero in HERO_STACK_PASSIVES:
            p_info = HERO_STACK_PASSIVES[build.hero]
            for sk in skills:
                if sk["slot"] == p_info["slot"] and sk["final_damage"] > 0:
                    mult_trigger = p_info.get("procs_per_trigger", 1)
                    dmg = (sk["final_damage"] / max(1, sk["hits"])) * mult_trigger
                    out.append(
                        {
                            "name": f"{sk['name']} (Passive)",
                            "damage": dmg,
                            "damage_type": sk["damage_type"],
                            "cooldown": p_info.get("cooldown", 0.0),
                            "hits_needed": p_info["hits_needed"],
                        }
                    )
                    break
        return out

    # ---------- duel ----------
    def burst(self, build: Build, enemy: dict) -> float:
        stats = self.build_stats(build)
        combo_slots = set(build.active_combo_slots) if build.active_combo_slots is not None else set(ACTIVE_SLOTS)
        return sum(s["final_damage"] for s in self.skill_damage(stats, enemy, build) if s["slot"] in combo_slots)

    def duel(self, build_a: Build, build_b: Build) -> dict:
        stats_a, stats_b = self.build_stats(build_a), self.build_stats(build_b)
        skills_a = self.skill_damage(stats_a, stats_b, build_a)
        skills_b = self.skill_damage(stats_b, stats_a, build_b)
        slots_a = set(build_a.active_combo_slots) if build_a.active_combo_slots is not None else set(ACTIVE_SLOTS)
        slots_b = set(build_b.active_combo_slots) if build_b.active_combo_slots is not None else set(ACTIVE_SLOTS)
        sim = simulate_duel(
            (
                stats_a,
                [sk for sk in skills_a if sk["slot"] in slots_a],
                self.basic_attack(stats_a, stats_b),
                self._procs(stats_a, build_a, stats_b, skills_a),
            ),
            (
                stats_b,
                [sk for sk in skills_b if sk["slot"] in slots_b],
                self.basic_attack(stats_b, stats_a),
                self._procs(stats_b, build_b, stats_a, skills_b),
            ),
        )

        def summary(stats, skills, enemy, build):
            s, e = stats["stats"], enemy["stats"]
            active_slots_list = (
                list(build.active_combo_slots) if build.active_combo_slots is not None else list(ACTIVE_SLOTS)
            )
            combo_slots = set(active_slots_list)
            burst = sum(sk["final_damage"] for sk in skills if sk["slot"] in combo_slots)
            phys = mitigation_multiplier(s["armor"], e["armor_pierce_flat"], e["armor_pierce_pct"])
            mag = mitigation_multiplier(s["magic_defense"], e["magic_pierce_flat"], e["magic_pierce_pct"])
            sweep = []
            for lv in range(1, MAX_LEVEL + 1):
                b = Build(**{**build.__dict__, "level": lv, "skill_levels": {}})
                dmg = self.burst(b, enemy)
                sweep.append({"level": lv, "burst": round(dmg, 1), "pct_enemy_hp": round(100 * dmg / e["max_hp"], 1)})
            return {
                "build": stats,
                "skills": skills,
                "basic_attack": self.basic_attack(stats, enemy),
                "burst_combo": round(burst, 1),
                "burst_pct_enemy_hp": round(100 * burst / e["max_hp"], 1),
                "combo_kills": burst >= e["max_hp"],
                "active_combo_slots": active_slots_list,
                "effective_hp_physical": round(s["max_hp"] / phys, 1),
                "effective_hp_magic": round(s["max_hp"] / mag, 1),
                "burst_per_1000_gold": round(1000 * burst / stats["build_cost"], 1) if stats["build_cost"] else None,
                "level_sweep": sweep,
            }

        return {
            "a": summary(stats_a, skills_a, stats_b, build_a),
            "b": summary(stats_b, skills_b, stats_a, build_b),
            "simulation": sim,
            "assumptions": [
                "ยืนตีกันตรงๆ ไม่คิดระยะ การหลบ คอนโทรล มานา และพาสซีฟของไอเทม",
                f"ความเร็วโจมตีพื้นฐาน {BASE_ATTACKS_PER_SEC:g} ครั้ง/วินาที (ข้อมูลเลเวลไม่มีค่านี้)",
                f"ใช้สกิลทันทีที่คูลดาวน์หมด (เว้น {SKILL_CAST_GAP:g} วินาทีระหว่างสกิล) และตีปกติไปพร้อมกัน",
                "คริติคอลคิดเป็นค่าเฉลี่ย, สกิล Passive ไม่ถูกนับในคอมโบ",
            ],
        }


def simulate_duel(side_a, side_b) -> dict:
    """Fixed-step simulation: each side casts ready skills, auto-attacks, and lifesteals until one dies."""
    sides = []
    for stats, skills, ba, procs in (side_a, side_b):
        s = stats["stats"]
        sides.append(
            {
                "hp": s["max_hp"],
                "max_hp": s["max_hp"],
                "steal": {"physical": s["life_steal"] / 100, "magic": s["magic_life_steal"] / 100},
                "skills": [
                    {**sk, "ready": 0.0} for sk in skills if sk["slot"] in ACTIVE_SLOTS and sk["final_damage"] > 0
                ],
                "attack_interval": 1 / ba["attacks_per_sec"],
                "attack_damage": ba["final_per_hit"],
                "next_attack": 0.0,
                "next_cast": 0.0,
                "procs": [{**p, "ready": 0.0, "hits": 0} for p in procs],
                "dealt": 0.0,
                "breakdown": {},
            }
        )
    timeline = []
    t = 0.0
    winner = None
    step = 0
    while t <= DUEL_MAX_SECONDS:
        incoming = [0.0, 0.0]
        for i, me in enumerate(sides):
            events = []
            if t >= me["next_cast"]:
                for sk in me["skills"]:
                    if t >= sk["ready"]:
                        events.append((sk["name"], sk["final_damage"], sk["damage_type"]))
                        sk["ready"] = t + max(sk["cooldown"], 0.5)
                        me["next_cast"] = t + SKILL_CAST_GAP
                        break
            if t >= me["next_attack"]:
                events.append(("Normal Attack", me["attack_damage"], "physical"))
                me["next_attack"] = t + me["attack_interval"]
            if events:
                for p in me["procs"]:
                    p["hits"] += len(events)
                    if t >= p["ready"] and p["hits"] >= p["hits_needed"]:
                        events.append((p["name"], p["damage"], p["damage_type"]))
                        p["ready"] = t + p["cooldown"]
                        p["hits"] -= p["hits_needed"]
            for name, dmg, dtype in events:
                incoming[1 - i] += dmg
                me["dealt"] += dmg
                me["breakdown"][name] = me["breakdown"].get(name, 0.0) + dmg
                me["hp"] = min(me["max_hp"], me["hp"] + dmg * me["steal"].get(dtype, 0.0))
        for i in (0, 1):
            sides[i]["hp"] -= incoming[i]
        dead = [s["hp"] <= 0 for s in sides]
        if step % 5 == 0 or any(dead):
            timeline.append(
                {"t": round(t, 2), "hp_a": round(max(0, sides[0]["hp"]), 1), "hp_b": round(max(0, sides[1]["hp"]), 1)}
            )
        if any(dead):
            winner = "draw" if all(dead) else ("b" if dead[0] else "a")
            break
        step += 1
        t = round(step * DUEL_DT, 4)

    def side_out(s):
        return {
            "remaining_hp": round(max(0.0, s["hp"]), 1),
            "remaining_hp_pct": round(100 * max(0.0, s["hp"]) / s["max_hp"], 1),
            "damage_dealt": round(s["dealt"], 1),
            "damage_breakdown": {k: round(v, 1) for k, v in sorted(s["breakdown"].items(), key=lambda kv: -kv[1])},
        }

    return {
        "winner": winner or "timeout",
        "time_to_kill": round(t, 2) if winner else None,
        "a": side_out(sides[0]),
        "b": side_out(sides[1]),
        "timeline": timeline,
    }


_engine: CombatEngine | None = None


def get_engine() -> CombatEngine:
    global _engine
    if _engine is None:
        _engine = CombatEngine()
    return _engine
