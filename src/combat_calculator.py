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
# Base attack rate at 0% attack speed (1.0/s) before Lv.1-15 growth & item bonuses.
BASE_ATTACKS_PER_SEC = 1.0
ARCANA_SLOTS_PER_COLOR = 10
DEFENSE_CONSTANT = 600.0
SKILL_CAST_GAP = 0.3
DUEL_DT = 0.05
DUEL_MAX_SECONDS = 60.0
VALID_LANES = ("DS_Lane", "Jungle", "Mid", "Dragon_Lane", "Roam", "Support")

HERO_ALIASES: dict[str, str] = {
    "Arthur": "Mortos",
    "Brunhilda": "Celica",
    "Richter": "Riktor",
    "Batman": "Kaine",
    "Joker": "Stuart",
    "The Joker": "Stuart",
    "Payna": "Helen",
    "Peura": "Helen",
    "Diaochan": "Diao Chan",
    "Kil'Grooth": "Kil'Groth",
    "Flowborn": "Flowborn (Marksman)",
}

DEFAULT_ITEM_ALIASES: dict[str, str] = {
    "Troy's Medallion": "Medallion of Troy",
    "Hyoga's Edge": "Frost Hammer",
    "Hyoga": "Frost Hammer",
    "Fafnir": "Fafnir's Talon",
    "Gaia": "Gaia's Standard",
    "Longinus": "Spear of Longinus",
    "Claves": "Claves Sancti",
    "Fenrir": "Fenrir's Tooth",
    "Hecate": "Hecate's Diadem",
    "Berith": "Berith's Agony",
    "Amulet": "Amulet of Longevity",
    "SoL": "Shield of the Lost",
    "MoP": "Mail of Pain",
}

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

ARCANA_ALIASES: dict[str, str] = {
    # Red aliases
    "Excalibur": "Sword",
    "Violate": "Desolate",
    "Atrocity": "Rage",
    "Indomitable": "Golden Body",
    "Obliterate": "Onslaught",
    # Purple aliases
    "Guerrilla": "Spirit",
    "Prowl": "Assassinate",
    "Devour": "Pray",
    "Sap": "Pray",
    "Bloodlust (Magic)": "Pray",
    "Undying": "Protect",
    "Greed": "Reave",
    "Essence Reaver": "Reave",
    # Green aliases
    "Skewer": "Dragon's Claw",
    "Furious": "Flurry",
    "Stain": "Flurry",
    "Valiance": "Prowess",
    "Hex": "Purity",
    "Authority": "Mythril",
    "Diamond": "Hercules",
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
    "physical_damage_taken_pct",
    "resistance",
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
    "Yena": {"slot": "Passive", "hits_needed": 5, "cooldown": 0.0, "trigger": "any"},
    "Airi": {"slot": "Passive", "hits_needed": 4, "cooldown": 0.0, "trigger": "attack"},
    "Hayate": {"slot": "Passive", "hits_needed": 6, "cooldown": 0.0, "trigger": "any"},
    "Lauriel": {"slot": "Passive", "hits_needed": 4, "cooldown": 0.0, "trigger": "skill"},
    "Aleister": {"slot": "Passive", "hits_needed": 3, "cooldown": 0.0, "trigger": "skill"},
    "Tulen": {"slot": "Passive", "hits_needed": 5, "cooldown": 0.0, "procs_per_trigger": 5, "trigger": "skill"},
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
        "note": "ลดคูลดาวน์อัลติเมต 10% (ไม่เกินขีดจำกัด CDR 40%)",
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
        "note": "โจมตีครบ 3 ครั้ง แฟรี่ช่วยตี 5 วิ (ทุก 1 วิ) ดาเมจจริง 2% Max HP เป้าหมาย (CD: 10 วิ)",
    },
    "Holy Thunder": {
        "proc": {"base": [80, 192], "ap": 0.3, "type": "magic", "cooldown": 12, "hits_needed": 1},
        "note": "สายฟ้าเวท 80-192 (+0.3 AP) ลด CD 1 วิ/การโจมตีหรือสกิล (CD: 12 วิ)",
    },
    "Sacred Protection": {
        "duel_effect": True,
        "note": "โดนดาเมจเกิน 30% HP ใน 3 วิ ได้รับเกราะ 400-820 และเวทแวมไพร์ 20% นาน 6 วิ (CD: 30 วิ)",
    },
    # Lokheim
    "Devourer": {
        "note": "ฟื้นฟู 9% HP และ 15% MP หลัง Kill หรือ Assist",
    },
    "Shadow Blade": {
        "duel_effect": True,
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
        "stats": {"resistance": 12.5},
        "note": "ต้านทานสถานะ +12.5%",
    },
    "Street Serpent": {
        "note": "ความเร็วเคลื่อนที่ 3% และความเสียหายแรงขึ้น 3% ในพื้นที่ฝ่ายตัวเอง",
    },
    "Desperate Duel": {
        "duel_effect": True,
        "note": "สะสมครบ 10 ครั้ง (ใกล้ +2/ไกล +1) ฟื้น 10% HP ที่เสียไป และเจาะเกราะ/เจาะเวท +15%",
    },
    "Curse of Death": {
        "proc": {"base": [40, 96], "bonus_ad": 0.25, "ap": 0.15, "type": "magic", "cooldown": 15, "hits_needed": 3},
        "note": "ระเบิดเวท 40-96 (+0.25 Bonus AD) (+0.15 AP) และ 1 วิถัดมา +6% (+Bonus AD/100 + AP/200)% HP ที่เสียไป (CD: 15 วิ)",
    },
    "Devil's Awakening": {
        "duel_effect": True,
        "note": "ใช้อัลติ ลดคูลดาวน์สกิลธรรมดา 30% และเร่งนับ CD 20% (CD: 30 วิ, ไม่มีลดดาเมจ 10% ในแพตช์นี้)",
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
        "duel_effect": True,
        "note": "ฟื้นฟูและโล่เพิ่ม 10% (HP น้อยกว่า 50% เพิ่มอีก 10%)",
    },
    "Nature's Gift": {
        "stats": {"max_hp": 800},
        "note": "คิดเต็ม 100 สแต็ก (+800 Max HP)",
    },
    "Vital Aid": {
        "duel_effect": True,
        "note": "แพ็คฮีลฟื้นฟู 225-435 HP ทุก 15 วิ (210 + Lv*15)",
    },
    "Nature's Rage": {
        "duel_effect": True,
        "note": "สกิล CC เผาเวท 2% Max HP ทุก 0.5 วิ นาน 3 วิ และลดเกราะเวท 30-72 (CD: 20 วิ)",
    },
    "Explosive Shield": {
        "proc": {"base": 0, "own_hp_pct": 2.0, "type": "magic", "cooldown": 10, "hits_needed": 4},
        "note": "รับดาเมจครบ 4 ครั้ง (ทุก 1 วิ) สายฟ้าเวท 2% Max HP ตัวเอง และฟื้นฟู 5% HP (+2%/ฮีโร่ที่โดน) (CD: 10 วิ)",
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
    (re.compile(r"Magic Pierce by (\d+)\s*-\s*(\d+)", re.I), "magic_pierce_flat_range"),
    (
        re.compile(r"Gain (\d+)\s*-\s*(\d+) (?:\(\+(\d+)% bonus HP\) )?Magic Pierce(?:, up to a maximum of (\d+))?"),
        "magic_pierce_flat_range",
    ),
)
RANGED_DOUBLED = re.compile(r"doubled for ranged heroes", re.I)


def is_enchantment_modeled(effect: dict | None) -> bool:
    if not effect:
        return False
    return any(k in effect for k in ("stats", "ranged_stats", "melee_stats", "item_multipliers", "proc", "duel_effect"))


def lerp_by_level(value, level: int) -> float:
    if isinstance(value, list):
        lo, hi = value
        return lo + (hi - lo) * (level - 1) / (MAX_LEVEL - 1)
    return float(value)


def mitigation_multiplier(defense: float, flat_pierce: float, pct_pierce: float) -> float:
    effective = max(0.0, max(0.0, defense - max(0.0, flat_pierce)) * max(0.0, 1.0 - pct_pierce / 100.0))
    return DEFENSE_CONSTANT / (DEFENSE_CONSTANT + effective)


def normalize_ratio(value: float) -> float:
    """Skill catalog mixes ratios (1.45) and percents (145.0); return percent."""
    return value * 100.0 if 0 < value < 2.0 else value


def parse_item_pierce(
    passives: list[str], level: int, is_ranged: bool = False, bonus_hp: float = 0.0
) -> list[tuple[str, float]]:
    found = []
    for text in passives:
        # Conditional stacking pierce passives (e.g., Soaring Aura 10-24 up to 10 stacks) are modeled dynamically in duel
        if re.search(r"\bup to\s+\d+\s+stacks?\b", text, re.I):
            continue
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


def default_skill_hits(hero: str, slot: str, skill: dict, attack_speed: float) -> int:
    """Return default hits per cast, accounting for hero-specific attack speed breakpoints."""
    if hero == "Hayate":
        if slot == "Skill 1":
            return 9 if attack_speed >= 150.0 else (7 if attack_speed >= 75.0 else 5)
        if slot == "Ultimate":
            return 16 if attack_speed >= 150.0 else (13 if attack_speed >= 75.0 else 10)
    return int(skill.get("hits", 1))


def compute_kite_params(
    me_stats: dict,
    enemy_stats: dict,
    me_meta: dict,
    enemy_meta: dict,
    enable_kiting: bool = True,
) -> tuple[float, float]:
    """Return (initial_gap_close_delay_sec, melee_attack_interval_mult) when a melee hero faces a ranged kiter."""
    if not enable_kiting:
        return 0.0, 1.0
    if me_stats.get("is_ranged", False) or not enemy_stats.get("is_ranged", False):
        return 0.0, 1.0
    me_ms = me_stats["stats"]["movement_speed"]
    en_ms = enemy_stats["stats"]["movement_speed"]
    ms_diff = en_ms - me_ms
    me_role = me_meta.get("primary_role", "Fighter")
    en_mob = bool(enemy_meta.get("has_mobility"))
    if me_role == "Assassin":
        base_delay = 0.6
        base_mult = 1.15
    elif me_role in ("Tank", "Support"):
        base_delay = 1.6
        base_mult = 1.45
    else:
        base_delay = 1.1
        base_mult = 1.28
    if en_mob:
        base_delay += 0.25
        base_mult += 0.10
    delay = max(0.3, min(2.5, base_delay + ms_diff * 0.005))
    mult = max(1.05, min(1.85, base_mult + ms_diff * 0.002))
    return round(delay, 2), round(mult, 3)


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
    enable_kiting: bool = True
    enable_actives: bool = True


class CombatEngine:
    def __init__(self, paths=config.paths):
        self.level_stats = json.loads(paths.hero_level_stats_json_path.read_text(encoding="utf-8"))["heroes"]
        self.skills = json.loads(paths.hero_skills_json_path.read_text(encoding="utf-8"))["heroes"]
        items = json.loads(paths.items_json_path.read_text(encoding="utf-8"))["items"]
        self.items = {i["name"]: i for i in items}
        self.item_aliases = dict(DEFAULT_ITEM_ALIASES)
        for i in items:
            for old in i.get("alias") or []:
                self.item_aliases[old] = i["name"]
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
        self.hero_meta = {}
        for h in heroes:
            feat = h.get("features", {})
            has_mag = bool(h.get("has_magic_damage") or feat.get("has_magic_damage"))
            has_phys = bool(h.get("has_physical_damage") or feat.get("has_physical_damage"))
            self.hero_meta[h["name"]] = {
                "role": h.get("primary_role"),
                "primary_role": h.get("primary_role"),
                "secondary_role": h.get("secondary_role"),
                "ranged": "rang" in (h.get("attack_range") or "").lower(),
                "damage_type": "Magic" if has_mag and not has_phys else "Physical",
                "has_true_damage": bool(h.get("has_true_damage") or feat.get("has_true_damage")),
                "has_hard_cc": bool(h.get("has_hard_cc") or feat.get("has_hard_cc")),
                "has_mobility": bool(h.get("has_mobility") or feat.get("has_mobility")),
                "has_heal_sustain": bool(h.get("has_heal_sustain") or feat.get("has_heal_sustain")),
                "has_shield": bool(h.get("has_shield") or feat.get("has_shield")),
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
                {
                    k: i.get(k)
                    for k in ("name", "category", "tier", "price", "stats", "passives", "icon_url", "alias", "desc_th")
                }
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
        build.hero = HERO_ALIASES.get(build.hero, build.hero)
        if build.hero not in self.level_stats:
            raise ValueError(f"Unknown hero: {build.hero}")
        if isinstance(build.level, bool) or not isinstance(build.level, int) or not 1 <= build.level <= MAX_LEVEL:
            raise ValueError(f"Level must be 1-{MAX_LEVEL}")
        if len(build.items) > 6:
            raise ValueError("At most 6 items")
        build.items = [self.item_aliases.get(name, name) for name in build.items]
        for name in build.items:
            if name not in self.items:
                raise ValueError(f"Unknown item: {name}")
        per_color: dict[str, int] = {}
        norm_arcana: dict[str, int] = {}
        for name, count in build.arcana.items():
            if isinstance(count, bool) or not isinstance(count, int):
                raise ValueError(f"Invalid arcana count for {name}: {count}")
            canonical_name = ARCANA_ALIASES.get(name, name)
            norm_arcana[canonical_name] = norm_arcana.get(canonical_name, 0) + count
        build.arcana = norm_arcana
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
        for slot, val in build.skill_levels.items():
            if isinstance(val, bool) or not isinstance(val, int) or val < 0:
                raise ValueError(f"Invalid skill level for {slot}: {val}")
        for slot, val in build.skill_hits.items():
            if isinstance(val, bool) or not isinstance(val, int) or val < 1:
                raise ValueError(f"Invalid skill hits for {slot}: {val}")
        for slot, val in build.skill_charges.items():
            if isinstance(val, bool) or not isinstance(val, (int, float)) or not 0.0 <= float(val) <= 1.0:
                raise ValueError(f"Invalid skill charge for {slot}: {val}")
        self._validate_enchantments(build)

    def _validate_enchantments(self, build: Build) -> None:
        prim_f = self.normalize_faction(build.primary_faction)
        canonical_factions = set(self.factions)

        if prim_f and prim_f not in canonical_factions:
            raise ValueError(f"Unknown primary faction: {build.primary_faction}")

        # 1. Primary Faction validation
        if build.primary_enchantments:
            if not prim_f or prim_f not in canonical_factions:
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
        sec_factions: set[str] = set()
        if build.secondary_faction:
            for sf in build.secondary_faction.split(","):
                norm_sf = self.normalize_faction(sf.strip())
                if not norm_sf:
                    continue
                if norm_sf not in canonical_factions:
                    raise ValueError(f"Unknown secondary faction: {sf.strip()}")
                if prim_f and norm_sf == prim_f:
                    raise ValueError("Primary and secondary factions must differ")
                sec_factions.add(norm_sf)

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
                if sec_factions and ench_f not in sec_factions:
                    raise ValueError(f"{raw_name} ({ench_f}) does not match secondary faction {sorted(sec_factions)}")
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

    @staticmethod
    def _passive_group_name(text: str) -> str | None:
        m = re.match(r"^(?:Unique\s+)?Passive\s*-\s*([^:]+):", text, re.I)
        if m:
            return m.group(1).strip()
        if re.match(r"^(?:Unique\s+)?Passive:\s*Armor Pierce\s*\+\s*60\b", text, re.I):
            return "Armor Break"
        return None

    # ---------- stats ----------
    def build_stats(self, build: Build) -> dict:
        self.validate(build)
        lv = self.level_stats[build.hero]["levels"][str(build.level)]
        lv15 = self.level_stats[build.hero]["levels"][str(MAX_LEVEL)]
        is_mana_hero = (lv15.get("max_resource") or 0) >= 350
        base = {
            "max_hp": lv["hp"],
            "max_mana": (lv.get("max_resource", 0) or 0) if is_mana_hero else 0,
            "armor": lv["armor"],
            "magic_defense": lv["magic_defense"],
            "attack_damage": lv["attack_damage"],
            "movement_speed": lv["movement_speed"],
            "attack_speed": lv.get("attack_speed", 0) or 0,
            "critical_chance": lv.get("critical_chance", 0) or 0,
            "critical_damage": lv.get("critical_damage", BASE_CRIT_DAMAGE) or BASE_CRIT_DAMAGE,
            "hp_regen_5s": lv.get("hp_regen_5s", 0) or 0,
            "mana_regen_5s": max(0, lv.get("resource_regen_5s", 0) or 0) if is_mana_hero else 0,
        }

        item_stats: dict[str, float] = {}
        item_warnings: list[str] = []
        seen_items: set[str] = set()
        seen_unique: set[str] = set()
        seen_passive_groups: set[str] = set()
        pierce_texts_by_group: dict[str, list[str]] = {}
        pierce_texts_ungrouped: list[str] = []
        boots_ms = 0.0
        boots_count = 0
        hero_dmg_type = self.hero_meta.get(build.hero, {}).get("damage_type", "Physical")
        is_ranged = self.hero_meta.get(build.hero, {}).get("ranged", False)

        for name in build.items:
            item = self.items[name]
            is_dup = name in seen_items
            seen_items.add(name)
            is_boots = item.get("category") == "movement"
            if is_boots:
                boots_count += 1
                boots_ms = max(boots_ms, float(item["stats"].get("movement_speed", 0.0)))
            for k, v in item["stats"].items():
                if is_boots and k == "movement_speed":
                    continue
                if is_boots and is_dup:
                    continue
                # Unique passives baked into static stats do not stack on duplicates
                if is_dup and name == "Claves Sancti" and k in ("critical_chance", "critical_damage"):
                    continue
                if is_dup and name == "Magic Ring" and k == "cooldown_reduction":
                    continue
                item_stats[k] = item_stats.get(k, 0.0) + v
            for text in item.get("passives") or []:
                group = self._passive_group_name(text)
                if group:
                    if group in ("Stab",):
                        pierce_texts_by_group.setdefault(group, []).append(text)
                    if group in seen_passive_groups:
                        continue
                    seen_passive_groups.add(group)
                    if group != "Stab":
                        pierce_texts_ungrouped.append(text)
                else:
                    if (text.startswith("Unique") or text.startswith("Passive")) and text in seen_unique:
                        continue
                    seen_unique.add(text)
                    pierce_texts_ungrouped.append(text)

            # Static stat passives from Tier 2/3 items
            if name == "Medallion of Troy" and "Harmony_applied" not in seen_passive_groups:
                seen_passive_groups.add("Harmony_applied")
                item_stats["magic_defense"] = item_stats.get("magic_defense", 0.0) + lerp_by_level(
                    [8, 112], build.level
                )
            if name == "Gilded Greaves" and "GildedRes_applied" not in seen_passive_groups:
                seen_passive_groups.add("GildedRes_applied")
                item_stats["resistance"] = item_stats.get("resistance", 0.0) + 35.0
            if name == "Sonic Boots" and "SonicDR_applied" not in seen_passive_groups:
                seen_passive_groups.add("SonicDR_applied")
                item_stats["physical_damage_taken_pct"] = item_stats.get("physical_damage_taken_pct", 0.0) - 10.0
            if name == "Blade of Eternity" and "WarRage_applied" not in seen_passive_groups:
                seen_passive_groups.add("WarRage_applied")
                item_stats["damage_dealt_pct"] = item_stats.get("damage_dealt_pct", 0.0) + 10.0
            if (
                item.get("category") == "support"
                and item.get("tier", 0) >= 2
                and "Reward_applied" not in seen_passive_groups
            ):
                seen_passive_groups.add("Reward_applied")
                if item.get("tier") == 3:
                    prim_val = lerp_by_level([32, 60], build.level)
                    hp_val = lerp_by_level([400, 820], build.level)
                else:
                    prim_val = lerp_by_level([16, 30], build.level)
                    hp_val = lerp_by_level([200, 410], build.level)
                item_stats["max_hp"] = item_stats.get("max_hp", 0.0) + hp_val
                if hero_dmg_type == "Magic":
                    item_stats["ability_power"] = item_stats.get("ability_power", 0.0) + prim_val * 2
                else:
                    item_stats["attack_damage"] = item_stats.get("attack_damage", 0.0) + prim_val
            if (
                any("Genesis:" in p for p in item.get("passives") or [])
                and "Genesis_applied" not in seen_passive_groups
            ):
                seen_passive_groups.add("Genesis_applied")
                gen_def = lerp_by_level([32, 60], build.level)
                item_stats["armor"] = item_stats.get("armor", 0.0) + gen_def
                item_stats["magic_defense"] = item_stats.get("magic_defense", 0.0) + gen_def
            if (
                any("Magical Shadow" in p for p in item.get("passives") or [])
                and "MagicalShadow_applied" not in seen_passive_groups
            ):
                seen_passive_groups.add("MagicalShadow_applied")
                item_stats["cooldown_reduction"] = item_stats.get("cooldown_reduction", 0.0) + 5.0
                item_stats["attack_speed"] = item_stats.get("attack_speed", 0.0) + 5.0
            if name == "Hecate's Diadem" and "Kich_applied" not in seen_passive_groups:
                seen_passive_groups.add("Kich_applied")
                item_stats["ability_power_pct"] = item_stats.get("ability_power_pct", 0.0) + 35.0
            if name == "Omni Arms" and "OmniArms_warned" not in seen_passive_groups:
                seen_passive_groups.add("OmniArms_warned")
                item_warnings.append(
                    "Omni Arms (Five Forces): รูป item_card.jpg ไม่ระบุตัวเลข %AD โบนัส จึงคำนวณเฉพาะค่าสถานะพื้นฐานและ Speed Up (+10% MS)"
                )

        if boots_ms > 0:
            item_stats["movement_speed"] = item_stats.get("movement_speed", 0.0) + boots_ms
        if boots_count > 1:
            item_warnings.append("รองเท้าหลายคู่: โบนัสความเร็วเคลื่อนที่ไม่ทับซ้อน (คิดเฉพาะคู่ที่เร็วที่สุด)")

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
        if item_stats.get("max_hp_pct", 0.0):
            hp_mult_gain = stats["max_hp"] * (item_stats["max_hp_pct"] / 100.0)
            stats["max_hp"] += hp_mult_gain
            item_stats["max_hp"] = item_stats.get("max_hp", 0.0) + hp_mult_gain

        # Pierce is parsed after HP is final: some items scale pierce with bonus HP.
        bonus_hp = stats["max_hp"] - base["max_hp"]
        for key, val in parse_item_pierce(pierce_texts_ungrouped, build.level, is_ranged, bonus_hp):
            item_stats[key] = item_stats.get(key, 0.0) + val
            stats[key] += val
        for _gname, gtexts in pierce_texts_by_group.items():
            best_by_key: dict[str, float] = {}
            for key, val in parse_item_pierce(gtexts, build.level, is_ranged, bonus_hp):
                best_by_key[key] = max(best_by_key.get(key, 0.0), val)
            for key, val in best_by_key.items():
                item_stats[key] = item_stats.get(key, 0.0) + val
                stats[key] += val

        # Post-HP AP passive (Mage Robe Replenishment: 26-40 + 2% bonus HP, max 100)
        if "Mage Robe" in seen_items:
            repl_ap = min(100.0, lerp_by_level([26, 40], build.level) + 0.02 * bonus_hp)
            item_stats["ability_power"] = item_stats.get("ability_power", 0.0) + repl_ap
            stats["ability_power"] += repl_ap

        # AP % multiplier (Hecate's Diadem Kich: +35%)
        if item_stats.get("ability_power_pct", 0.0):
            ap_mult_gain = stats["ability_power"] * (item_stats["ability_power_pct"] / 100.0)
            stats["ability_power"] += ap_mult_gain
            item_stats["ability_power"] = item_stats.get("ability_power", 0.0) + ap_mult_gain

        # Post-AP item passives (Frostguard Ice Armor & Holy of Holies Enlightenment)
        if "Frostguard" in seen_items:
            ice_def = min(230.0, 0.5 * stats["ability_power"])
            item_stats["armor"] = item_stats.get("armor", 0.0) + ice_def
            item_stats["magic_defense"] = item_stats.get("magic_defense", 0.0) + ice_def
            stats["armor"] += ice_def
            stats["magic_defense"] += ice_def
        if "Holy of Holies" in seen_items:
            holy_pct = 0.5 * (stats["ability_power"] / 100.0)
            item_stats["damage_dealt_pct"] = item_stats.get("damage_dealt_pct", 0.0) + holy_pct
            item_stats["damage_taken_pct"] = item_stats.get("damage_taken_pct", 0.0) - holy_pct
            stats["damage_dealt_pct"] += holy_pct
            stats["damage_taken_pct"] -= holy_pct

        # Rhea's Blessing: every 2% magic life steal reduces CD by 1%
        if "Rhea's Blessing" in seen_items and stats["magic_life_steal"] > 0:
            rhea_cdr = 0.5 * stats["magic_life_steal"]
            item_stats["cooldown_reduction"] = item_stats.get("cooldown_reduction", 0.0) + rhea_cdr
            stats["cooldown_reduction"] += rhea_cdr

        stats["movement_speed"] *= 1 + total("movement_speed_pct") / 100
        stats["base_attack_damage"] = float(base["attack_damage"])
        stats["bonus_attack_damage"] = stats["attack_damage"] - base["attack_damage"]
        stats["critical_chance"] = min(100.0, stats["critical_chance"])
        stats["attack_speed"] = min(ATTACK_SPEED_CAP, stats["attack_speed"])
        stats["cooldown_reduction_uncapped"] = stats["cooldown_reduction"]
        stats["cooldown_reduction"] = min(CDR_CAP, stats["cooldown_reduction"])
        stats["armor_pierce_pct"] = min(100.0, stats["armor_pierce_pct"])
        stats["magic_pierce_pct"] = min(100.0, stats["magic_pierce_pct"])
        stats["resistance"] = min(100.0, stats["resistance"])
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
            "item_warnings": item_warnings,
            "enchantments_modeled": modeled,
            "enchantments_unmodeled": unmodeled,
        }

    # ---------- skills ----------
    def skill_levels_for(self, build: Build) -> dict[str, int]:
        levels = auto_skill_levels(build.level)
        hero_skills = self.skills.get(build.hero, [])
        for sk in hero_skills:
            slot = sk["slot"]
            if slot.startswith("Passive"):
                levels[slot] = 1
            elif "level_slot" in sk:
                levels[slot] = levels.get(sk["level_slot"], 0)
        skill_by_slot = {s["slot"]: s for s in hero_skills}
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
            return values[max(0, min(MAX_LEVEL - 1, hero_level - 1))]
        return values[max(0, min(len(values) - 1, skill_level - 1))]

    _NON_DAMAGE_OWN_HP_SKILLS = {
        ("Charlotte", "Skill 2"),
        ("Edras", "Skill 2"),
        ("Edras", "Skill 2 (Berserker Mode)"),
        ("Ming", "Passive"),
        ("Omega", "Skill 1"),
        ("Roxie", "Skill 2"),
        ("Tachi", "Passive"),
        ("Volkath", "Passive"),
    }

    def skill_damage(self, attacker: dict, defender: dict, build: Build, target_hp_ratio: float = 1.0) -> list[dict]:
        a, d = attacker["stats"], defender["stats"]
        base_lv = attacker["sources"]["level"]
        bonus_hp = max(0.0, a["max_hp"] - base_lv.get("max_hp", 0.0))
        bonus_armor = max(0.0, a["armor"] - base_lv.get("armor", 0.0))
        levels = self.skill_levels_for(build)
        ratio = max(0.0, min(1.0, float(target_hp_ratio)))
        dealt_mult = (1 + a["damage_dealt_pct"] / 100) * (1 + d["damage_taken_pct"] / 100)
        phys_taken_mult = 1 + d.get("physical_damage_taken_pct", 0.0) / 100
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
                parts["base"] += sc["level_scaling"] * (build.level - 1)
            if "ad_pct" in sc:
                parts["ad"] = normalize_ratio(sc["ad_pct"]) / 100 * a["attack_damage"]
            if "bonus_ad_pct" in sc:
                parts["bonus_ad"] = normalize_ratio(sc["bonus_ad_pct"]) / 100 * a["bonus_attack_damage"]
            if "as_to_ad" in sc:
                bonus_as = max(0.0, a["attack_speed"] - base_lv.get("attack_speed", 0.0))
                parts["as_to_ad"] = sc["as_to_ad"] * bonus_as
            ap_pct_total = normalize_ratio(sc.get("ap_pct", 0.0)) + normalize_ratio(sc.get("bonus_ap_pct", 0.0))
            if ap_pct_total:
                parts["ap"] = ap_pct_total / 100 * a["ability_power"]

            if (build.hero, slot) not in self._NON_DAMAGE_OWN_HP_SKILLS:
                if "bonus_dmg_hp_pct" in sc:
                    own_hp = float(self._pick(sc["bonus_dmg_hp_pct"], sl, build.level))
                else:
                    own_hp = sc.get("own_hp_pct", 0.0) or sc.get("hp_pct", 0.0) or sc.get("max_hp_pct", 0.0)
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
                + sc.get("target_hp_ap_pct", 0.0) * (a["ability_power"] / 100.0)
                + sc.get("target_hp_per_100_ad_pct", 0.0) * (a["attack_damage"] / 100.0)
                + sc.get("target_hp_per_100_bonus_ad_pct", 0.0) * (a["bonus_attack_damage"] / 100.0)
                + sc.get("target_hp_per_100_ap_pct", 0.0) * (a["ability_power"] / 100.0)
            )
            if target_hp_pct:
                parts["target_hp"] = target_hp_pct / 100 * d["max_hp"]

            cur_hp_pct = sc.get("target_current_hp_pct", 0.0)
            if cur_hp_pct:
                parts["target_current_hp"] = cur_hp_pct / 100 * d["max_hp"] * ratio

            lost_hp_pct = sc.get("target_lost_hp_pct", 0.0)
            if (build.hero, slot) != ("Bijan", "Passive"):
                lost_hp_pct += sc.get("lost_hp_pct", 0.0)
            if (build.hero, slot) in (("Veres", "Ultimate"), ("Moren", "Ultimate")) and sl > 1:
                lost_hp_pct += 3.0 * (sl - 1)
            lost_hp_pct += sc.get("lost_hp_ap_pct", 0.0) * (a["ability_power"] / 100.0)
            lost_hp_pct += sc.get("lost_hp_bonus_ad_pct", 0.0) * (a["bonus_attack_damage"] / 100.0)
            if lost_hp_pct and ratio < 1.0:
                parts["target_lost_hp"] = lost_hp_pct / 100 * d["max_hp"] * (1.0 - ratio)

            # Skill-specific total cast fixes & guaranteed same-cast sub-components
            extra_cast = 0.0
            if build.hero == "Mortos" and slot == "Ultimate":
                # Landing deals 14% target Max HP once; holy swords tick 1/s for 5s
                parts["base"] *= 5.0
                if "ad" in parts:
                    parts["ad"] *= 5.0
            elif build.hero == "Riktor" and slot == "Ultimate" and sl > 0:
                # 10 ticks over 5s (50/75/100 + 20% AD each) + 5-hit detonation (300/450/600 + 120% AD)
                det_base = [300.0, 450.0, 600.0][max(0, min(2, sl - 1))]
                det_ad_pct = sc.get("bonus_ad_pct", 120.0) / 100.0
                parts["base"] = parts["base"] * 10.0 + det_base
                parts["ad"] = (sc.get("ad_pct", 20.0) / 100.0 * 10.0 + det_ad_pct) * a["attack_damage"]
                parts.pop("bonus_ad", None)

            if "explosion_damage" in sc or "explosion_ap_pct" in sc:
                extra_cast += float(self._pick(sc.get("explosion_damage") or [], sl, build.level))
                extra_cast += normalize_ratio(sc.get("explosion_ap_pct", 0.0)) / 100 * a["ability_power"]
            if "detonation_base" in sc or "detonation_ap_pct" in sc:
                extra_cast += float(self._pick(sc.get("detonation_base") or [], sl, build.level))
                extra_cast += normalize_ratio(sc.get("detonation_ap_pct", 0.0)) / 100 * a["ability_power"]
            if "touch_base" in sc or "touch_ap_pct" in sc or "touch_ad_pct" in sc:
                extra_cast += float(self._pick(sc.get("touch_base") or [], sl, build.level))
                extra_cast += normalize_ratio(sc.get("touch_ap_pct", 0.0)) / 100 * a["ability_power"]
                extra_cast += normalize_ratio(sc.get("touch_ad_pct", 0.0)) / 100 * a["attack_damage"]
            if "initial_damage_base" in sc or "initial_damage_ap_pct" in sc:
                extra_cast += float(self._pick(sc.get("initial_damage_base") or [], sl, build.level))
                extra_cast += normalize_ratio(sc.get("initial_damage_ap_pct", 0.0)) / 100 * a["ability_power"]
            if "first_beams_damage" in sc or "first_beams_ap_pct" in sc:
                beam_dmg = float(self._pick(sc.get("first_beams_damage") or [], sl, build.level))
                beam_dmg += normalize_ratio(sc.get("first_beams_ap_pct", 0.0)) / 100 * a["ability_power"]
                extra_cast += 2.0 * beam_dmg
            if build.hero == "Flowborn (Mage)" and slot == "Skill 2":
                tick_dmg = float(self._pick(sc.get("dot_base") or [], sl, build.level))
                tick_dmg += normalize_ratio(sc.get("dot_ap_pct", 0.0)) / 100 * a["ability_power"]
                extra_cast += 3.0 * tick_dmg
            if build.hero == "Keera" and slot == "Skill 2":
                clone_dmg = float(self._pick(sc.get("clone_base") or [], sl, build.level))
                clone_dmg += normalize_ratio(sc.get("clone_ap_pct", 0.0)) / 100 * a["ability_power"]
                extra_cast += 2.0 * clone_dmg
            if "sustained_damage" in sc:
                extra_cast += float(self._pick(sc.get("sustained_damage") or [], sl, build.level))
            if "burn_max_hp_pct" in sc:
                extra_cast += 5.0 * (sc["burn_max_hp_pct"] / 100 * a["max_hp"])

            if sl == 0 or dtype == "none":
                parts = {k: 0.0 for k in parts}
                extra_cast = 0.0
                cur_hp_pct = 0.0
                lost_hp_pct = 0.0
            raw = sum(parts.values())
            lost_hp_dmg = parts.get("target_lost_hp", 0.0)
            mult = type_mult.get(dtype, 0.0)
            default_hits = default_skill_hits(build.hero, slot, skill, a["attack_speed"])
            hits = max(1, min(50, int(build.skill_hits.get(slot, default_hits))))
            if extra_cast > 0:
                parts["extra"] = extra_cast
            raw_total = (raw - lost_hp_dmg) * hits + lost_hp_dmg + extra_cast
            eff_dealt_mult = dealt_mult * (phys_taken_mult if dtype == "physical" else 1.0)
            final = raw_total * mult * eff_dealt_mult
            cd = float(self._pick(skill["cooldown"], max(sl, 1), build.level) or 0)
            cdr = a["cooldown_reduction"]
            eff_level_slot = skill.get("level_slot", slot)
            if eff_level_slot == "Ultimate":
                cdr = min(CDR_CAP, a["cooldown_reduction"] + a.get("ultimate_cdr_bonus", 0.0))
            recharge_cd = (
                round(float(self._pick(sc["recharge_cooldown"], max(sl, 1), build.level)) * (1 - cdr / 100), 2)
                if "recharge_cooldown" in sc
                else None
            )
            rows.append(
                {
                    "name": skill["name"],
                    "slot": slot,
                    "level_slot": eff_level_slot,
                    "type": skill.get("type"),
                    "damage_type": dtype,
                    "skill_level": sl,
                    "hits": hits,
                    "has_charge": has_charge,
                    "charge_ratio": round(charge_ratio, 2) if has_charge else None,
                    "max_damage": skill.get("max_damage"),
                    "max_scaling": skill.get("max_scaling"),
                    "components": {k: round(v, 1) for k, v in parts.items()},
                    "raw_damage": round(raw_total, 1),
                    "mitigation_multiplier": round(mult, 4),
                    "final_damage": round(final, 1),
                    "pct_target_hp": round(100 * final / d["max_hp"], 1) if d["max_hp"] else 0.0,
                    "cooldown": round(cd * (1 - cdr / 100), 2),
                    "recharge_cooldown": recharge_cd,
                    "target_current_hp_pct": round(cur_hp_pct, 3),
                    "target_lost_hp_pct": round(lost_hp_pct, 3),
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
        mult *= 1 + d.get("physical_damage_taken_pct", 0.0) / 100
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
        phys_taken_mult = 1 + d.get("physical_damage_taken_pct", 0.0) / 100.0
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
                eff_mult = dealt_mult
            elif dtype == "physical":
                mult = mitigation_multiplier(d["armor"], a["armor_pierce_flat"], a["armor_pierce_pct"])
                eff_mult = dealt_mult * phys_taken_mult
            else:
                mult = 1.0
                eff_mult = dealt_mult
            out.append(
                {
                    "name": raw_name,
                    "canonical_name": name,
                    "damage": raw * mult * eff_mult,
                    "damage_type": dtype,
                    "cooldown": proc["cooldown"],
                    "hits_needed": proc.get("hits_needed", 1),
                    "trigger": "damage_taken" if name == "Explosive Shield" else "any",
                }
            )

        # Hero-specific stack passives that trigger bonus damage/effects on hitting enemies
        if skills and build.hero in HERO_STACK_PASSIVES:
            p_info = HERO_STACK_PASSIVES[build.hero]
            p_slot = p_info["slot"]
            if build.active_combo_slots is None or p_slot in build.active_combo_slots:
                for sk in skills:
                    if sk["slot"] == p_slot and sk["final_damage"] > 0:
                        mult_trigger = p_info.get("procs_per_trigger", 1)
                        dmg = (sk["final_damage"] / max(1, sk["hits"])) * mult_trigger
                        out.append(
                            {
                                "name": f"{sk['name']} (Passive)",
                                "damage": dmg,
                                "damage_type": sk["damage_type"],
                                "cooldown": p_info.get("cooldown", 0.0),
                                "hits_needed": p_info["hits_needed"],
                                "trigger": p_info.get("trigger", "any"),
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
        proc_slot_a = HERO_STACK_PASSIVES.get(build_a.hero, {}).get("slot")
        proc_slot_b = HERO_STACK_PASSIVES.get(build_b.hero, {}).get("slot")
        meta_a = self.hero_meta.get(build_a.hero, {})
        meta_b = self.hero_meta.get(build_b.hero, {})
        # Side A's kiting penalty applies when B is ranged and B enables kiting (and vice versa).
        kite_a = compute_kite_params(stats_a, stats_b, meta_a, meta_b, bool(build_b.enable_kiting))
        kite_b = compute_kite_params(stats_b, stats_a, meta_b, meta_a, bool(build_a.enable_kiting))
        sim_meta_a = {
            "hero": build_a.hero,
            "level": build_a.level,
            "items": list(build_a.items),
            "enchantments": [
                self.canonical_enchantment(e)
                for e in list(build_a.primary_enchantments) + list(build_a.secondary_enchantments)
            ],
            "enable_actives": bool(build_a.enable_actives),
            "has_hard_cc": bool(meta_a.get("has_hard_cc")),
            "has_mobility": bool(meta_a.get("has_mobility")),
            "dual_form": build_a.active_combo_slots is None,
        }
        sim_meta_b = {
            "hero": build_b.hero,
            "level": build_b.level,
            "items": list(build_b.items),
            "enchantments": [
                self.canonical_enchantment(e)
                for e in list(build_b.primary_enchantments) + list(build_b.secondary_enchantments)
            ],
            "enable_actives": bool(build_b.enable_actives),
            "has_hard_cc": bool(meta_b.get("has_hard_cc")),
            "has_mobility": bool(meta_b.get("has_mobility")),
            "dual_form": build_b.active_combo_slots is None,
        }
        sim = simulate_duel(
            (
                stats_a,
                [sk for sk in skills_a if sk["slot"] in slots_a and sk["slot"] != proc_slot_a],
                self.basic_attack(stats_a, stats_b),
                self._procs(stats_a, build_a, stats_b, skills_a),
            ),
            (
                stats_b,
                [sk for sk in skills_b if sk["slot"] in slots_b and sk["slot"] != proc_slot_b],
                self.basic_attack(stats_b, stats_a),
                self._procs(stats_b, build_b, stats_a, skills_b),
            ),
            kite_a=kite_a,
            kite_b=kite_b,
            sim_meta_a=sim_meta_a,
            sim_meta_b=sim_meta_b,
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

        kiting_active = kite_a != (0.0, 1.0) or kite_b != (0.0, 1.0)
        actives_note = (
            "คำนวณพาสซีฟไอเทม Tier 3 + สกิลกดใช้ + พลังแฝง + ฟื้นฟู HP/5 วิ"
            if (build_a.enable_actives or build_b.enable_actives)
            else "คำนวณพาสซีฟไอเทม Tier 3 + พลังแฝง + ฟื้นฟู HP/5 วิ (ปิดสกิลกดใช้ของไอเทม)"
        )
        return {
            "a": summary(stats_a, skills_a, stats_b, build_a),
            "b": summary(stats_b, skills_b, stats_a, build_b),
            "simulation": sim,
            "assumptions": [
                (
                    f"คำนวณระยะยิงตอดและจังหวะ Kiting ของฮีโร่ตีไกลเทียบความเร็วเคลื่อนที่/สายอาชีพกับตัวประชิด; {actives_note} (ไม่คิดการหลบสกิลและมานา)"
                    if kiting_active
                    else f"ยืนตีกันตรงๆ ไม่คิดระยะ การหลบและมานา; {actives_note}"
                ),
                f"ความเร็วโจมตีพื้นฐาน {BASE_ATTACKS_PER_SEC:g} ครั้ง/วินาที รวมค่าเติบโตตามเลเวลและไอเทม (แคป 200%)",
                f"ใช้สกิลทันทีที่คูลดาวน์หมด (เว้น {SKILL_CAST_GAP:g} วินาทีระหว่างสกิล) และตีปกติไปพร้อมกัน",
                "คริติคอลคิดเป็นค่าเฉลี่ย, สกิล Passive ไม่ถูกนับในคอมโบเว้นแต่ระบุไว้",
            ],
        }

    def recommend_matchup_runes(
        self,
        my_hero: str,
        enemy_hero: str,
        lane: str = "DS_Lane",
        level: int = 2,
    ) -> dict:
        """Recommends an optimal 30-rune Tier 3 counter setup against an enemy in lane,
        simulating early-game trades against standard cookie-cutter runes.
        """
        if lane not in VALID_LANES:
            raise ValueError(f"Unknown lane: {lane}. Expected one of {VALID_LANES}")
        my_h = HERO_ALIASES.get(my_hero, my_hero)
        enemy_h = HERO_ALIASES.get(enemy_hero, enemy_hero)

        if my_h not in self.hero_meta:
            raise ValueError(f"Unknown hero: {my_hero}")
        if enemy_h not in self.hero_meta:
            raise ValueError(f"Unknown hero: {enemy_hero}")
        if isinstance(level, bool) or not isinstance(level, int) or not 1 <= level <= MAX_LEVEL:
            raise ValueError(f"Level must be 1-{MAX_LEVEL}")

        my_meta = self.hero_meta[my_h]
        enemy_meta = self.hero_meta[enemy_h]
        my_role = my_meta.get("primary_role", "Fighter")
        enemy_role = enemy_meta.get("primary_role", "Fighter")

        def get_standard_rune(hero_name: str, meta: dict) -> tuple[str, dict[str, int]]:
            role = meta.get("primary_role", "Fighter")
            dmg_type = meta.get("damage_type", "Physical")
            if role == "Carry":
                return "Rampage Crit (มาตรฐานแครี่)", {"Rampage": 10, "Spirit": 10, "Dragon's Claw": 10}
            if role == "Mage" or dmg_type == "Magic":
                return "Magic Pierce 88 (มาตรฐานเมจ)", {"Desolate": 10, "Spirit": 10, "Flurry": 10}
            if role in ("Tank", "Support"):
                return "Bulky Frontline (มาตรฐานแทงค์/ซัพพอร์ต)", {"Golden Body": 10, "Colossus": 10, "Prowess": 10}
            return "Armor Pierce 100 (มาตรฐานไฟต์เตอร์/แอสซาซิน)", {"Onslaught": 10, "Spirit": 10, "Dragon's Claw": 10}

        std_my_name, std_my_runes = get_standard_rune(my_h, my_meta)
        std_enemy_name, std_enemy_runes = get_standard_rune(enemy_h, enemy_meta)

        candidates: list[tuple[str, dict[str, int], str]] = [
            (std_my_name, std_my_runes, "เซ็ตมาตรฐานประจำสายอาชีพ"),
        ]

        has_true = enemy_meta.get("has_true_damage") or enemy_h in (
            "Florentino",
            "Airi",
            "Riktor",
            "Hayate",
            "Maloch",
            "Lauriel",
            "Thorne",
            "Allain",
        )
        if has_true:
            if my_role in ("Fighter", "Tank", "Support"):
                candidates.append(
                    (
                        "Anti-True Damage Bulk (เลือดต้านทรูดาเมจ)",
                        {"Golden Body": 10, "Colossus": 10, "Prowess": 10},
                        "ศัตรูมีทรูดาเมจทะลุเกราะ 100% การเสริม Max HP (+1,462 HP) ช่วยให้รอดพ้นคอมโบชุดแรกแล้วเทรดสวนกลับชนะ",
                    )
                )
            elif my_role == "Carry":
                candidates.append(
                    (
                        "Sustain & Spacing (ดูดเลือดเว้นระยะ)",
                        {"Awake": 10, "Reave": 6, "Spirit": 4, "Dragon's Claw": 10},
                        "เสริมดูดเลือด 9.6% และความเร็วโจมตีเพื่อยิงตอดและรีเจนเลือด ป้องกันการโดนเข้าประชิด",
                    )
                )
            elif my_role == "Mage":
                candidates.append(
                    (
                        "Max HP Kite (เสริมเลือดเว้นระยะ)",
                        {"Desolate": 10, "Colossus": 10, "Flurry": 10},
                        "เสริมเลือด +750 HP ป้องกันการโดนล้วงเบิร์สต์ในจังหวะเดียว",
                    )
                )

        is_enemy_magic = (
            enemy_meta.get("primary_role") == "Mage"
            or enemy_meta.get("damage_type") == "Magic"
            or enemy_h
            in (
                "Marja",
                "Mganga",
                "Zata",
                "Liliana",
                "Tulen",
                "Krixi",
                "Iggy",
                "Yue",
                "Veera",
                "Diao Chan",
                "Paine",
                "Keera",
                "Sephera",
            )
        )
        if is_enemy_magic:
            if my_role in ("Fighter", "Tank", "Support"):
                candidates.append(
                    (
                        "Anti-Magic Bulwark (ต้านทานเวทยืนเลน)",
                        {"Golden Body": 10, "Benevolence": 10, "Mythril": 10},
                        "ศัตรูเน้นการตอดดาเมจเวท เสริมเกราะเวท (+90) และเลือด (+787) ลดทอนดาเมจเวทลงกว่า 25%",
                    )
                )
            elif my_role == "Mage":
                candidates.append(
                    (
                        "Magic Life Steal Sustain (ดูดเลือดเวทชิงจังหวะ)",
                        {"Desolate": 10, "Pray": 10, "Flurry": 10},
                        "เพิ่มดูดเลือดเวท 16% ทำให้ยืนเทรดแลกสกิลในเลนกลางได้ต่อเนื่องโดยไม่ต้องกลับบ้าน",
                    )
                )
            elif my_role == "Carry":
                candidates.append(
                    (
                        "Magic Guard Carry (กันเวท & ดูดเลือด)",
                        {"Rampage": 10, "Prosperity": 10, "Dragon's Claw": 10},
                        "เพิ่มเกราะเวท +41 และดูดเลือด +10% ต้านทานเวทตอดช่วงต้นเกม",
                    )
                )

        is_enemy_phys_burst = (
            enemy_role in ("Assassin", "Fighter")
            and not has_true
            or enemy_h in ("Biron", "Qi", "Kriknak", "Nakroth", "Ryoma", "Kaine", "Skud", "Wukong", "Zuka", "Aoi")
        )
        if is_enemy_phys_burst:
            if my_role in ("Fighter", "Tank"):
                candidates.append(
                    (
                        "Anti-Burst Fortification (เสริมเกราะและฟื้นฟู)",
                        {"Golden Body": 10, "Protect": 10, "Dragon's Claw": 10},
                        "ศัตรูมีเบิร์สต์กายภาพรุนแรง เสริมเกราะ +23 และเลือด +937 ฟื้นฟู +45 ช่วยทนรับสกิลชุดแรกแล้วเทรดชนะ",
                    )
                )
            elif my_role == "Carry":
                candidates.append(
                    (
                        "Early Armor Shred & Sustain (เจาะเกราะ & ดูดเลือด)",
                        {"Onslaught": 10, "Reave": 6, "Spirit": 4, "Dragon's Claw": 10},
                        "เสริมดูดเลือด 9.6% และเจาะเกราะ 100 สำหรับเทรดระยะประชิด",
                    )
                )

        if my_h in ("Omen", "Kil'Groth", "Allain", "Stuart", "Tel'Annas", "Slimz", "Hayate", "Valhein"):
            candidates.append(
                (
                    "Hyper Attack Speed (ตีเร็วเปิด Passive)",
                    {"Awake": 10, "Spirit": 10, "Dragon's Claw": 10},
                    "เร่งความเร็วโจมตี +26% ทำให้เปิดติด Passive หรือยิงสกิลได้เร็วกว่าอีกฝ่าย",
                )
            )

        if my_role in ("Fighter", "Assassin", "Carry"):
            candidates.append(
                (
                    "Max Armor Shred 100 (เจาะเกราะเต็มพิกัด)",
                    {"Onslaught": 10, "Spirit": 10, "Dragon's Claw": 10},
                    "เจาะเกราะ 100 หักล้างเกราะเลเวลต้นของศัตรูเกือบหมด",
                )
            )

        build_enemy = Build(hero=enemy_h, level=level, arcana=std_enemy_runes)
        build_my_std = Build(hero=my_h, level=level, arcana=std_my_runes)

        duel_std = self.duel(build_my_std, build_enemy)
        std_sim = duel_std["simulation"]
        std_my_rem = std_sim["a"]["remaining_hp"]
        std_my_pct = std_sim["a"]["remaining_hp_pct"]
        std_en_rem = std_sim["b"]["remaining_hp"]
        std_winner = std_sim["winner"]

        best_preset = {
            "name": std_my_name,
            "runes": std_my_runes,
            "reason": "เซ็ตมาตรฐานตามสายอาชีพ",
            "winner": std_winner,
            "my_rem_hp": std_my_rem,
            "my_rem_pct": std_my_pct,
            "enemy_rem_hp": std_en_rem,
            "score": std_my_rem - std_en_rem,
        }

        for name, runes, reason in candidates:
            b_cand = Build(hero=my_h, level=level, arcana=runes)
            d_cand = self.duel(b_cand, build_enemy)
            sim = d_cand["simulation"]
            cand_rem = sim["a"]["remaining_hp"]
            cand_pct = sim["a"]["remaining_hp_pct"]
            en_rem = sim["b"]["remaining_hp"]
            winner = sim["winner"]
            score = cand_rem - en_rem

            if (
                (winner == "a" and best_preset["winner"] != "a")
                or (winner == "a" and best_preset["winner"] == "a" and cand_rem > best_preset["my_rem_hp"])
                or (winner != "a" and best_preset["winner"] != "a" and score > best_preset["score"])
            ):
                best_preset = {
                    "name": name,
                    "runes": runes,
                    "reason": reason,
                    "winner": winner,
                    "my_rem_hp": cand_rem,
                    "my_rem_pct": cand_pct,
                    "enemy_rem_hp": en_rem,
                    "score": score,
                }

        std_score = std_my_rem - std_en_rem
        hp_advantage = round(best_preset["score"] - std_score, 1)

        detailed_runes = []
        for rname, count in best_preset["runes"].items():
            arc_info = self.arcana.get(rname, {})
            detailed_runes.append(
                {
                    "name": rname,
                    "name_th": arc_info.get("name_th", rname),
                    "color": arc_info.get("color", "Red"),
                    "count": count,
                    "stats": arc_info.get("stats", {}),
                    "icon": arc_info.get("icon", ""),
                }
            )

        if best_preset["winner"] == "a" and std_winner != "a":
            verdict = f"พลิกสถานการณ์จาก {std_winner.upper()} เป็นชนะเลน! (HP ได้เปรียบขึ้น +{hp_advantage} HP)"
        elif best_preset["winner"] == "a":
            verdict = f"ชนะเลนเด็ดขาด (เหลือเลือด {best_preset['my_rem_pct']}%, ได้เปรียบขึ้น +{hp_advantage} HP)"
        elif hp_advantage > 0:
            verdict = f"เทรดได้เปรียบเลือดขึ้น +{hp_advantage} HP (เสียเลือดน้อยลง)"
        else:
            verdict = "รักษาความได้เปรียบด้วยเซ็ตมาตรฐาน"

        return {
            "my_hero": my_h,
            "enemy_hero": enemy_h,
            "lane": lane,
            "level": level,
            "standard_preset": {
                "name": std_my_name,
                "runes": std_my_runes,
                "winner": std_winner,
                "remaining_hp": std_my_rem,
                "remaining_hp_pct": std_my_pct,
            },
            "recommended_preset": {
                "name": best_preset["name"],
                "runes": best_preset["runes"],
                "winner": best_preset["winner"],
                "remaining_hp": best_preset["my_rem_hp"],
                "remaining_hp_pct": best_preset["my_rem_pct"],
                "tactical_reason": best_preset["reason"],
            },
            "hp_advantage": hp_advantage,
            "trade_verdict": verdict,
            "detailed_runes": detailed_runes,
        }


_CC_KEYWORDS = (
    "stun",
    "knock",
    "slow",
    "root",
    "pull",
    "freeze",
    "taunt",
    "silence",
    "petrif",
    "สตั๊น",
    "ลอย",
    "ผลัก",
    "ลดความเร็ว",
    "วิ่งช้า",
    "ล็อก",
    "ดึง",
    "ยั่วยุ",
    "ใบ้",
    "หิน",
)
_MOBILITY_KEYWORDS = (
    "dash",
    "blink",
    "leap",
    "lunge",
    "teleport",
    "charge",
    "roll",
    "พุ่ง",
    "กระโดด",
    "เทเลพอร์ต",
    "กลิ้ง",
    "ถอยหลัง",
)


def _skill_has_keyword(sk: dict, keywords: tuple[str, ...]) -> bool:
    text = f"{sk.get('description') or ''} {sk.get('desc_th') or ''}".lower()
    return any(kw in text for kw in keywords)


def _calc_live_damage(attacker: dict, defender: dict, raw: float, dtype: str, t: float) -> float:
    """Compute final damage with live shreds, buffs, and mitigation."""
    if raw <= 0:
        return 0.0
    a_st, d_st = attacker["raw_stats"], defender["raw_stats"]
    dealt_pct = a_st["damage_dealt_pct"] + attacker["odin_stacks"] * 2.0
    if "Fenrir's Tooth" in attacker["items"] and defender["hp"] < 0.5 * defender["max_hp"]:
        dealt_pct += 30.0
    if attacker["cripple_until"] > t:
        dealt_pct -= 20.0
    taken_pct = d_st["damage_taken_pct"]
    if defender["sturdy_until"] > t:
        taken_pct -= 40.0
    dealt_mult = max(0.0, (1.0 + dealt_pct / 100.0) * (1.0 + taken_pct / 100.0))

    if dtype == "true":
        return raw * dealt_mult
    if dtype == "physical":
        shred = min(24.0, attacker["longinus_stacks"] * 6.0)
        eff_armor = max(0.0, d_st["armor"] * (1.0 - shred / 100.0))
        pierce_pct = min(100.0, a_st["armor_pierce_pct"] + (15.0 if attacker["desperate_active"] else 0.0))
        mit = mitigation_multiplier(eff_armor, a_st["armor_pierce_flat"], pierce_pct)
        phys_taken = 1.0 + d_st.get("physical_damage_taken_pct", 0.0) / 100.0
        return raw * mit * dealt_mult * phys_taken

    # magic
    mdef = d_st["magic_defense"]
    if defender["evil_curse_until"] > t:
        mdef = max(0.0, mdef - 100.0)
    if defender["nature_rage_until"] > t:
        mdef = max(0.0, mdef - attacker["nature_rage_mdef_shred"])
    m_flat = a_st["magic_pierce_flat"] + attacker["soaring_stacks"] * attacker["soaring_per_stack"]
    m_pct = min(100.0, a_st["magic_pierce_pct"] + (15.0 if attacker["desperate_active"] else 0.0))
    mit = mitigation_multiplier(mdef, m_flat, m_pct)
    return raw * mit * dealt_mult


def _heal_multiplier(side: dict, t: float) -> float:
    mult = 1.0
    if "Regrowth" in side["enchs"]:
        mult += 0.20 if side["hp"] < 0.5 * side["max_hp"] else 0.10
    if "Gaia's Standard" in side["items"] and side["max_hp"] > 0:
        missing_ratio = max(0.0, 1.0 - side["hp"] / side["max_hp"])
        mult += 0.50 * missing_ratio
    if side["anti_heal_until"] > t:
        mult *= 0.60
    return mult


def _apply_heal(side: dict, amount: float, t: float) -> None:
    if amount <= 0 or side["revive_pending_until"] is not None or side["hp"] <= 0:
        return
    gained = amount * _heal_multiplier(side, t)
    side["hp"] = min(side["max_hp"], side["hp"] + gained)


def _add_shield(side: dict, amount: float, expires_at: float, kind: str = "all") -> None:
    if amount <= 0:
        return
    mult = 1.0
    if "Regrowth" in side["enchs"]:
        mult += 0.20 if side["hp"] < 0.5 * side["max_hp"] else 0.10
    side["shields"].append({"amount": amount * mult, "expires_at": expires_at, "kind": kind})


def _init_sim_side(
    stats: dict,
    skills: list[dict],
    ba: dict,
    procs: list[dict],
    kite: tuple[float, float],
    meta: dict | None,
) -> dict:
    s = stats["stats"]
    k_delay, k_mult = kite
    m = meta or {}
    items = set(m.get("items") or [])
    enchs = set(m.get("enchantments") or [])
    lv = int(m.get("level") or stats.get("level", 12))
    bonus_hp = max(0.0, s["max_hp"] - stats.get("sources", {}).get("level", {}).get("max_hp", 0.0))
    sim_skills = []
    for sk in skills:
        if sk["final_damage"] <= 0:
            continue
        cd = sk["cooldown"] if sk["cooldown"] > 0 else (5.0 if sk["slot"].startswith("Passive") else 0.5)
        entry = {
            **sk,
            "cooldown": cd,
            "ready": k_delay,
            "is_cc": bool(m.get("has_hard_cc") and _skill_has_keyword(sk, _CC_KEYWORDS)),
            "is_mobility": bool(
                m.get("has_mobility")
                and _skill_has_keyword(sk, _MOBILITY_KEYWORDS)
                and not sk["slot"].startswith("Passive")
            ),
        }
        if sk.get("recharge_cooldown"):
            entry["charges"] = 2
            entry["max_charges"] = 2
            entry["recharge_cd"] = max(0.5, float(sk["recharge_cooldown"]))
            entry["recharge_at"] = None
        sim_skills.append(entry)

    shields: list[dict] = []
    if "Medallion of Troy" in items:
        shields.append({"amount": 400.0 + lv * 60.0, "expires_at": DUEL_MAX_SECONDS + 10.0, "kind": "magic"})

    return {
        "hero": m.get("hero", stats.get("hero", "")),
        "level": lv,
        "is_ranged": bool(stats.get("is_ranged", False)),
        "raw_stats": s,
        "bonus_hp": bonus_hp,
        "items": items,
        "enchs": enchs,
        "enable_actives": bool(m.get("enable_actives", True)),
        "dual_form": bool(m.get("dual_form", False)),
        "hp": float(s["max_hp"]),
        "max_hp": float(s["max_hp"]),
        "steal": {"physical": s["life_steal"] / 100.0, "magic": s["magic_life_steal"] / 100.0},
        "skills": sim_skills,
        "ba": ba,
        "k_delay": k_delay,
        "k_mult": k_mult,
        "next_attack": k_delay,
        "next_cast": k_delay,
        "kiting": {"initial_delay": k_delay, "interval_multiplier": k_mult},
        "procs": [{**p, "ready": 0.0, "hits": 0} for p in procs],
        "dealt": 0.0,
        "breakdown": {},
        "shields": shields,
        # Dynamic combat states
        "anti_heal_until": -1.0,
        "invuln_until": -1.0,
        "stasis_until": -1.0,
        "silence_until": -1.0,
        "revive_pending_until": None,
        "boE_used": False,
        "death_sickle_ready": 0.0,
        "death_sickle_as_until": -1.0,
        "hercules_ready": 0.0,
        "hercules_ls_until": -1.0,
        "uriel_ready": 0.0,
        "carano_ready": 0.0,
        "beast_ready": 0.0,
        "light_shield_ready": 0.0,
        "rock_shield_ready": 0.0,
        "rock_shield_ad_until": -1.0,
        "barrier_ready": 0.0,
        "rejuv_ready": 0.0,
        "magic_eye_ready": 0.0,
        "magic_eye_next_tick": None,
        "magic_eye_ticks_left": 0,
        "arctic_ready": 0.0,
        "arctic_shield_at": None,
        "bow_ready": 0.0,
        "bow_ls_until": -1.0,
        "diminisher_sturdy_ready": 0.0,
        "sturdy_until": -1.0,
        "counter_stab_ready": 0.0,
        "counter_stab_until": -1.0,
        "odin_stacks": 0,
        "gaia_ready": 0.0,
        "hots": [],  # list of {"per_dt": float, "until": float}
        # Offensive & debuff states
        "spellblade_armed": False,
        "sb_apoc_ready": 0.0,
        "sb_loki_ready": 0.0,
        "sb_trick_ready": 0.0,
        "sb_frost_ready": 0.0,
        "fafnir_ready": 0.0,
        "blitz_ready": 0.0,
        "blitz_counter": 0,
        "eclipsing_ready": 0.0,
        "eclipsing_active_until": -1.0,
        "shuriken_ready": 0.0,
        "zweihander_ready": 0.0,
        "sudden_strike_ready": 0.0,
        "sudden_strike_stacks": 0,
        "sudden_strike_until": -1.0,
        "ifrit_stacks": 0,
        "ifrit_until": -1.0,
        "boomstick_ready": 0.0,
        "frost_hammer_ready": 0.0,
        "firestorm_ready": 0.0,
        "firestorm_stacks": 0,
        "berith_next": None,
        "berith_until": -1.0,
        "aura_next": 1.0 if ("Mantle of Ra" in items or "Leviathan" in items or "Heart of Incubus" in items) else None,
        "cripple_ready": 0.0,
        "cripple_armed": False,
        "cripple_until": -1.0,
        "longinus_ready": 0.0,
        "longinus_stacks": 0,
        "longinus_until": -1.0,
        "soaring_stacks": 0,
        "soaring_until": -1.0,
        "soaring_per_stack": lerp_by_level([10, 24], lv),
        "evil_curse_until": -1.0,
        "sentinel_until": -1.0,
        # Enchantment duel states
        "dmg_history": [],
        "sacred_prot_ready": 0.0,
        "sacred_prot_ls_until": -1.0,
        "desperate_stacks": 0,
        "desperate_until": -1.0,
        "desperate_active": False,
        "desperate_healed": False,
        "devils_ready": 0.0,
        "devils_until": -1.0,
        "shadow_blade_stacks": 0,
        "shadow_blade_until": -1.0,
        "vital_aid_ready": 15.0 if "Vital Aid" in enchs else None,
        "nature_rage_ready": 0.0,
        "nature_rage_until": -1.0,
        "nature_rage_next": None,
        "nature_rage_mdef_shred": lerp_by_level([30, 72], lv),
        "fairy_next": None,
        "fairy_until": -1.0,
        "curse_detonate_at": None,
        "curse_detonate_source": None,
        "exp_shield_icd_until": -1.0,
    }


def _attack_interval_for(side: dict, t: float) -> float:
    base_as = side["raw_stats"]["attack_speed"]
    bonus = 0.0
    if side["ifrit_until"] > t:
        bonus += side["ifrit_stacks"] * 10.0
    if side["sudden_strike_until"] > t:
        bonus += side["sudden_strike_stacks"] * 15.0
    if side["death_sickle_as_until"] > t:
        bonus += 25.0
    if side["sentinel_until"] > t or "The Aegis" in side["opp_items"]:
        bonus -= 30.0
    eff_as = max(-50.0, min(ATTACK_SPEED_CAP, base_as + bonus))
    aps = BASE_ATTACKS_PER_SEC * (1.0 + eff_as / 100.0)
    return (1.0 / max(0.2, aps)) * side["k_mult"]


def _emit_damage(
    attacker: dict,
    defender: dict,
    name: str,
    raw: float,
    dtype: str,
    t: float,
    is_skill: bool = False,
    is_attack: bool = False,
    is_proc: bool = False,
    precalculated: float | None = None,
    is_reflect: bool = False,
) -> bool:
    if attacker["revive_pending_until"] is not None or (attacker["stasis_until"] > t and (is_attack or is_skill)):
        return False
    if defender["revive_pending_until"] is not None or defender["invuln_until"] > t:
        return False
    dmg = precalculated if precalculated is not None else _calc_live_damage(attacker, defender, raw, dtype, t)
    if dmg <= 0:
        return False

    attacker["dealt"] += dmg
    attacker["breakdown"][name] = attacker["breakdown"].get(name, 0.0) + dmg

    # Soul Prison anti-heal
    if any(it in attacker["items"] for it in ("Curse of Death", "Soul Scroll", "Mantle of Ra")):
        defender["anti_heal_until"] = max(defender["anti_heal_until"], t + 3.0)

    # Life steal / magic life steal
    if is_attack:
        ls = attacker["steal"]["physical"]
        if attacker["hercules_ls_until"] > t:
            ls += 0.20
        if attacker["bow_ls_until"] > t:
            ls += 0.60
        _apply_heal(attacker, dmg * ls, t)
    elif is_skill and dtype == "magic" and not is_proc:
        mls = attacker["steal"]["magic"]
        if attacker["sacred_prot_ls_until"] > t:
            mls += 0.20
        _apply_heal(attacker, dmg * mls, t)

    # Trigger incoming damage & reactive defenses
    _take_damage(defender, attacker, dmg, dtype, t, is_reflect=is_reflect)
    return True


def _take_damage(defender: dict, attacker: dict, dmg: float, dtype: str, t: float, is_reflect: bool = False) -> None:
    if dmg <= 0 or defender["revive_pending_until"] is not None:
        return
    if defender["invuln_until"] > t:
        return

    # Proactive / damage-triggered actives before shield absorb
    if defender["enable_actives"] and not is_reflect:
        if "Mail of Pain" in defender["items"] and t + 1e-9 >= defender["counter_stab_ready"]:
            defender["counter_stab_ready"] = t + 75.0
            defender["counter_stab_until"] = t + 3.0
        if (
            "The Diminisher" in defender["items"]
            and t + 1e-9 >= defender["diminisher_sturdy_ready"]
            and defender["hp"] < 0.65 * defender["max_hp"]
        ):
            defender["diminisher_sturdy_ready"] = t + 90.0
            defender["sturdy_until"] = t + 2.0

    # Absorb via shields (magic shields first on magic damage, then general shields)
    defender["shields"] = [sh for sh in defender["shields"] if sh["expires_at"] > t and sh["amount"] > 0]
    remaining = dmg
    for kind in ("magic", "all") if dtype == "magic" else ("all",):
        for sh in defender["shields"]:
            if sh["kind"] == kind and remaining > 0:
                absorbed = min(sh["amount"], remaining)
                sh["amount"] -= absorbed
                remaining -= absorbed

    if remaining > 0:
        defender["hp"] -= remaining
        defender["dmg_history"].append((t, remaining))

    # Sacred Protection: >30% Max HP taken within 3s -> shield 400-820 + 20% magic life steal for 6s
    defender["dmg_history"] = [(ts, amt) for ts, amt in defender["dmg_history"] if t - ts <= 3.0]
    if "Sacred Protection" in defender["enchs"] and t + 1e-9 >= defender["sacred_prot_ready"]:
        if sum(amt for _, amt in defender["dmg_history"]) > 0.30 * defender["max_hp"]:
            defender["sacred_prot_ready"] = t + 30.0
            defender["sacred_prot_ls_until"] = t + 6.0
            _add_shield(defender, lerp_by_level([400, 820], defender["level"]), t + 6.0)

    # Low HP item thresholds & actives
    hp_ratio = defender["hp"] / defender["max_hp"] if defender["max_hp"] > 0 else 0.0
    if "Hercules's Madness" in defender["items"] and t + 1e-9 >= defender["hercules_ready"] and 0 < hp_ratio < 0.40:
        defender["hercules_ready"] = t + 60.0
        defender["hercules_ls_until"] = t + 8.0
        _add_shield(defender, 800.0 + defender["level"] * 80.0, t + 8.0)
    if "Uriel's Brand" in defender["items"] and t + 1e-9 >= defender["uriel_ready"] and 0 < hp_ratio < 0.40:
        defender["uriel_ready"] = t + 75.0
        _add_shield(defender, lerp_by_level([600, 2000], defender["level"]), t + 5.0, kind="magic")
    if "Carano's Pledge" in defender["items"] and t + 1e-9 >= defender["carano_ready"] and 0 < hp_ratio < 0.30:
        defender["carano_ready"] = t + 75.0
        sh_amt = (
            lerp_by_level([510, 1000], defender["level"])
            + defender["raw_stats"]["ability_power"]
            + 0.08 * defender["bonus_hp"]
        )
        _add_shield(defender, sh_amt, t + 4.0)
    if "The Beast" in defender["items"] and t + 1e-9 >= defender["beast_ready"] and 0 < hp_ratio < 0.30:
        defender["beast_ready"] = t + 20.0
        heal_total = lerp_by_level([400, 610], defender["level"])
        defender["hots"].append({"per_dt": heal_total / (5.0 / DUEL_DT), "until": t + 5.0})

    if defender["enable_actives"] and defender["hp"] > 0:
        if "Rock Shield" in defender["items"] and t + 1e-9 >= defender["rock_shield_ready"] and hp_ratio < 0.60:
            defender["rock_shield_ready"] = t + 60.0
            defender["rock_shield_ad_until"] = t + 3.0
            sh_amt = 0.30 * defender["max_hp"] + 0.10 * max(0.0, defender["max_hp"] - defender["hp"])
            _add_shield(defender, sh_amt, t + 3.0)
        if (
            any(it in defender["items"] for it in ("Wildfire - Barrier", "Mother Earth - Barrier"))
            and t + 1e-9 >= defender["barrier_ready"]
            and hp_ratio < 0.70
        ):
            defender["barrier_ready"] = t + 60.0
            _add_shield(defender, lerp_by_level([680, 1800], defender["level"]), t + 3.0)
        if (
            any(
                it in defender["items"]
                for it in ("Wildfire - Rejuvenate", "Mother Earth - Rejuvenate", "Aquaflame - Rejuvenate")
            )
            and t + 1e-9 >= defender["rejuv_ready"]
            and hp_ratio < 0.75
        ):
            defender["rejuv_ready"] = t + 50.0
            # Rejuvenate reduces to 20% while in combat with enemy heroes
            heal_total = 0.20 * (lerp_by_level([500, 1000], defender["level"]) + 0.20 * defender["max_hp"])
            defender["hots"].append({"per_dt": heal_total / (5.0 / DUEL_DT), "until": t + 5.0})
        if (
            "Bow of Slaughter" in defender["items"]
            and defender["is_ranged"]
            and t + 1e-9 >= defender["bow_ready"]
            and hp_ratio < 0.75
        ):
            defender["bow_ready"] = t + 60.0
            defender["bow_ls_until"] = t + 3.0
        if "Arctic Orb" in defender["items"] and t + 1e-9 >= defender["arctic_ready"] and hp_ratio < 0.35:
            defender["arctic_ready"] = t + 75.0
            defender["invuln_until"] = max(defender["invuln_until"], t + 2.0)
            defender["stasis_until"] = max(defender["stasis_until"], t + 2.0)
            defender["silence_until"] = max(defender["silence_until"], t + 2.0)
            defender["arctic_shield_at"] = round(t + 2.0, 4)

    # Reactive passives on taking non-reflected damage
    if not is_reflect:
        if "Mail of Pain" in defender["items"]:
            pct = 0.25 if defender["counter_stab_until"] > t else 0.05
            if attacker["is_ranged"]:
                pct *= 0.50
            _emit_damage(
                defender,
                attacker,
                "Mail of Pain (Reflect)",
                dmg * pct,
                "true",
                t,
                precalculated=dmg * pct,
                is_reflect=True,
            )
        if "Shield of the Lost" in defender["items"]:
            attacker["sentinel_until"] = max(attacker["sentinel_until"], t + 2.0)
        if "Odin's Will" in defender["items"]:
            defender["odin_stacks"] = min(5, defender["odin_stacks"] + 1)
        if "Gaia's Standard" in defender["items"] and t + 1e-9 >= defender["gaia_ready"]:
            defender["gaia_ready"] = t + 10.0
            defender["hots"].append({"per_dt": (0.04 * defender["max_hp"]) / (2.0 / DUEL_DT), "until": t + 2.0})
        for p in defender["procs"]:
            if p.get("trigger") == "damage_taken" and t + 1e-9 >= defender["exp_shield_icd_until"]:
                defender["exp_shield_icd_until"] = t + 1.0
                p["hits"] += 1
                if t + 1e-9 >= p["ready"] and p["hits"] >= p["hits_needed"]:
                    p["ready"] = t + p["cooldown"]
                    p["hits"] -= p["hits_needed"]
                    _emit_damage(
                        defender,
                        attacker,
                        p["name"],
                        p["damage"],
                        p["damage_type"],
                        t,
                        precalculated=p["damage"],
                        is_reflect=True,
                    )
                    _apply_heal(defender, 0.07 * defender["max_hp"], t)

    # Death prevention / Resurrection checks
    if defender["hp"] <= 0:
        if "Death Sickle" in defender["items"] and t + 1e-9 >= defender["death_sickle_ready"]:
            defender["death_sickle_ready"] = t + 120.0
            defender["hp"] = 1.0
            defender["invuln_until"] = max(defender["invuln_until"], t + 0.75)
            defender["death_sickle_as_until"] = max(defender["death_sickle_as_until"], t + 0.75)
        elif "Blade of Eternity" in defender["items"] and not defender["boE_used"]:
            defender["boE_used"] = True
            defender["hp"] = 0.0
            defender["revive_pending_until"] = round(t + 2.0, 4)


def _tick_side_timers(me: dict, opp: dict, t: float) -> None:
    if me["revive_pending_until"] is not None:
        if t + 1e-9 >= me["revive_pending_until"]:
            me["revive_pending_until"] = None
            me["hp"] = min(me["max_hp"], 2000.0 + me["level"] * 100.0)
        return

    # Devil's Awakening accelerates non-Ultimate skill CDs by 20% while active
    if me["devils_until"] > t:
        bonus_dt = DUEL_DT * 0.20
        for sk in me["skills"]:
            if sk["level_slot"] != "Ultimate" and sk["ready"] > t:
                sk["ready"] -= bonus_dt

    # Bonnie Skill 1 ammo recharge
    for sk in me["skills"]:
        if sk.get("recharge_at") is not None and t + 1e-9 >= sk["recharge_at"]:
            sk["charges"] = min(sk["max_charges"], sk["charges"] + 1)
            sk["recharge_at"] = round(t + sk["recharge_cd"], 4) if sk["charges"] < sk["max_charges"] else None

    # Expiring timers
    if me["arctic_shield_at"] is not None and t + 1e-9 >= me["arctic_shield_at"]:
        me["arctic_shield_at"] = None
        _add_shield(me, 500.0 + me["level"] * 40.0 + 0.5 * me["raw_stats"]["ability_power"], t + 1.0)
    if me["desperate_until"] <= t:
        me["desperate_stacks"] = 0
        me["desperate_active"] = False
    if me["longinus_until"] <= t:
        me["longinus_stacks"] = 0
    if me["soaring_until"] <= t:
        me["soaring_stacks"] = 0
    if me["ifrit_until"] <= t:
        me["ifrit_stacks"] = 0
    if me["sudden_strike_until"] <= t:
        me["sudden_strike_stacks"] = 0
    if me["shadow_blade_until"] <= t:
        me["shadow_blade_stacks"] = 0

    # Passive HP regeneration (/5s) & HoT ticks
    if me["hp"] < me["max_hp"] and me["raw_stats"].get("hp_regen_5s", 0.0) > 0:
        _apply_heal(me, (me["raw_stats"]["hp_regen_5s"] / 5.0) * DUEL_DT, t)
    active_hots = []
    for h in me["hots"]:
        if h["until"] > t - 1e-9:
            _apply_heal(me, h["per_dt"], t)
            active_hots.append(h)
    me["hots"] = active_hots

    # Vital Aid heal pack every 15s
    if me["vital_aid_ready"] is not None and t + 1e-9 >= me["vital_aid_ready"]:
        me["vital_aid_ready"] = round(t + 15.0, 4)
        _apply_heal(me, 210.0 + me["level"] * 15.0, t)

    # Ongoing DoT & Aura ticks (Berith's Agony, Burn Auras, Holy Summoner fairy, Nature's Rage, Curse of Death delayed, Magic Eye)
    if (
        me["berith_next"] is not None
        and me["berith_until"] + 1e-9 >= me["berith_next"]
        and t + 1e-9 >= me["berith_next"]
    ):
        me["berith_next"] = round(me["berith_next"] + 1.0, 4)
        _emit_damage(me, opp, "Berith's Agony (Torture)", 80.0 + 0.02 * opp["max_hp"], "magic", t, is_proc=True)
    if me["aura_next"] is not None and t + 1e-9 >= me["aura_next"]:
        me["aura_next"] = round(t + 1.0, 4)
        if "Mantle of Ra" in me["items"] or "Leviathan" in me["items"]:
            _emit_damage(me, opp, "Incantation Burn", 0.02 * me["max_hp"], "magic", t, is_proc=True)
        elif "Heart of Incubus" in me["items"]:
            _emit_damage(me, opp, "Incantation Burn", lerp_by_level([50, 78], me["level"]), "magic", t, is_proc=True)
    if me["fairy_next"] is not None and t + 1e-9 >= me["fairy_next"]:
        if t <= me["fairy_until"] + 1e-9:
            me["fairy_next"] = round(t + 1.0, 4)
            _emit_damage(me, opp, "Holy Summoner (Fairy)", 0.02 * opp["max_hp"], "true", t, is_proc=True)
        else:
            me["fairy_next"] = None
    if me["nature_rage_next"] is not None and t + 1e-9 >= me["nature_rage_next"]:
        if t <= me["nature_rage_until"] + 1e-9:
            me["nature_rage_next"] = round(t + 0.5, 4)
            opp["nature_rage_until"] = max(opp["nature_rage_until"], t + 0.6)
            _emit_damage(me, opp, "Nature's Rage Burn", 0.02 * opp["max_hp"], "magic", t, is_proc=True)
        else:
            me["nature_rage_next"] = None
    if me["curse_detonate_at"] is not None and t + 1e-9 >= me["curse_detonate_at"]:
        me["curse_detonate_at"] = None
        lost_hp = max(0.0, opp["max_hp"] - opp["hp"])
        bonus_ad = me["raw_stats"]["bonus_attack_damage"]
        ap = me["raw_stats"]["ability_power"]
        pct = 6.0 + bonus_ad / 100.0 + ap / 200.0
        _emit_damage(me, opp, "Curse of Death (Detonation)", pct / 100.0 * lost_hp, "magic", t, is_proc=True)
    if me["magic_eye_next_tick"] is not None and t + 1e-9 >= me["magic_eye_next_tick"]:
        _emit_damage(me, opp, "Magic Eye (Active)", 0.08 * max(0.0, opp["hp"]), "magic", t, is_proc=True)
        me["magic_eye_ticks_left"] -= 1
        me["magic_eye_next_tick"] = round(t + 1.0, 4) if me["magic_eye_ticks_left"] > 0 else None


def _handle_post_hit_effects(
    me: dict, opp: dict, t: float, did_skill: bool, did_attack: bool, skill_used: dict | None, base_hit_count: int
) -> None:
    if did_skill or did_attack:
        # On-damage-dealt item triggers (Light Shield, Frost Hammer, Spear of Longinus, Soaring Aura)
        if "Light Shield" in me["items"] and t + 1e-9 >= me["light_shield_ready"]:
            me["light_shield_ready"] = t + (12.5 if me["is_ranged"] else 10.0)
            sh = (lerp_by_level([250, 500], me["level"]) + 0.04 * me["max_hp"]) * 1.5
            _add_shield(me, sh, t + 3.0)
        if "Frost Hammer" in me["items"] and t + 1e-9 >= me["frost_hammer_ready"]:
            me["frost_hammer_ready"] = t + 3.0
            raw = lerp_by_level([140, 280], me["level"]) + 0.45 * me["raw_stats"]["bonus_attack_damage"]
            _emit_damage(me, opp, "Frost Hammer (Scar)", raw, "physical", t, is_proc=True)
        if "Spear of Longinus" in me["items"] and t + 1e-9 >= me["longinus_ready"]:
            me["longinus_ready"] = t + 0.3
            me["longinus_stacks"] = min(4, me["longinus_stacks"] + 1)
            me["longinus_until"] = t + 5.0
        if "Soaring Aura" in me["items"]:
            me["soaring_stacks"] = min(10, me["soaring_stacks"] + 1)
            me["soaring_until"] = t + 3.0

        # Desperate Duel
        if "Desperate Duel" in me["enchs"]:
            me["desperate_stacks"] = min(10, me["desperate_stacks"] + (1 if me["is_ranged"] else 2))
            me["desperate_until"] = t + 3.0
            if me["desperate_stacks"] >= 10:
                me["desperate_active"] = True
                if not me["desperate_healed"]:
                    me["desperate_healed"] = True
                    _apply_heal(me, 0.10 * max(0.0, me["max_hp"] - me["hp"]), t)

        # Holy Thunder -1s CD reduction on subsequent attacks/skills
        for p in me["procs"]:
            if p.get("canonical_name") == "Holy Thunder" and p["ready"] > t:
                p["ready"] = max(t, p["ready"] - 1.0)

    if did_skill and skill_used is not None:
        if "Boomstick" in me["items"] and t + 1e-9 >= me["boomstick_ready"]:
            me["boomstick_ready"] = t + 5.0
            _emit_damage(
                me, opp, "Boomstick (Echo)", 120.0 + 0.40 * me["raw_stats"]["ability_power"], "magic", t, is_proc=True
            )
        elif "Orrery" in me["items"] and t + 1e-9 >= me["boomstick_ready"]:
            me["boomstick_ready"] = t + 5.0
            _emit_damage(me, opp, "Orrery (Echo)", 180.0, "magic", t, is_proc=True)
        if "Berith's Agony" in me["items"]:
            me["berith_until"] = t + 3.0
            if me["berith_next"] is None or me["berith_next"] < t:
                me["berith_next"] = round(t + 1.0, 4)
        if "Evil Secrets" in me["items"]:
            opp["evil_curse_until"] = max(opp["evil_curse_until"], t + 3.0)
        if "The Diminisher" in me["items"] and t + 1e-9 >= me["cripple_ready"]:
            me["cripple_ready"] = t + 8.0
            opp["cripple_until"] = max(opp["cripple_until"], t + 3.0)
        if "Nature's Rage" in me["enchs"] and skill_used.get("is_cc") and t + 1e-9 >= me["nature_rage_ready"]:
            me["nature_rage_ready"] = t + 20.0
            me["nature_rage_until"] = t + 3.0
            me["nature_rage_next"] = round(t + 0.5, 4)
            opp["nature_rage_until"] = max(opp["nature_rage_until"], t + 0.6)
        if "Shadow Blade" in me["enchs"] and skill_used.get("is_mobility"):
            me["shadow_blade_stacks"] = min(3, me["shadow_blade_stacks"] + 1)
            me["shadow_blade_until"] = t + 2.0
        if (
            "Devil's Awakening" in me["enchs"]
            and skill_used.get("level_slot") == "Ultimate"
            and t + 1e-9 >= me["devils_ready"]
        ):
            me["devils_ready"] = t + 30.0
            me["devils_until"] = t + 6.0
            for sk in me["skills"]:
                if sk["level_slot"] != "Ultimate" and sk["ready"] > t:
                    sk["ready"] = t + 0.70 * (sk["ready"] - t)

    if did_attack:
        if "Fafnir's Talon" in me["items"] and t + 1e-9 >= me["fafnir_ready"]:
            me["fafnir_ready"] = t + 0.35
            _emit_damage(me, opp, "Fafnir's Talon", 0.08 * max(0.0, opp["hp"]), "physical", t, is_proc=True)
        if "Blitz Blade" in me["items"]:
            _emit_damage(me, opp, "Blitz Blade (Hit)", lerp_by_level([45, 87], me["level"]), "magic", t, is_proc=True)
            me["blitz_counter"] += 1
            if me["blitz_counter"] >= 3 and t + 1e-9 >= me["blitz_ready"]:
                me["blitz_counter"] = 0
                me["blitz_ready"] = t + 0.30
                _emit_damage(
                    me, opp, "Blitz Blade (Chain)", lerp_by_level([150, 430], me["level"]), "magic", t, is_proc=True
                )
        if "The Morning Star" in me["items"]:
            _emit_damage(me, opp, "Morning Star", 100.0 if me["is_ranged"] else 50.0, "physical", t, is_proc=True)
        if "Eclipsing Bow" in me["items"] and t + 1e-9 >= me["eclipsing_ready"]:
            me["eclipsing_ready"] = t + 0.35
            _emit_damage(me, opp, "Eclipsing Bow", 100.0 if me["is_ranged"] else 50.0, "physical", t, is_proc=True)
        if "Shuriken" in me["items"] and t + 1e-9 >= me["shuriken_ready"]:
            me["shuriken_ready"] = t + 0.30
            lo, hi = [42, 70] if me["is_ranged"] else [21, 35]
            _emit_damage(me, opp, "Shuriken (Heel)", lerp_by_level([lo, hi], me["level"]), "physical", t, is_proc=True)
        if "Zweihander" in me["items"]:
            if t + 1e-9 >= me["zweihander_ready"]:
                me["zweihander_ready"] = t + 0.35
                _emit_damage(
                    me,
                    opp,
                    "Zweihander (Scorching)",
                    40.0 + 0.20 * me["raw_stats"]["ability_power"],
                    "magic",
                    t,
                    is_proc=True,
                )
            if t + 1e-9 >= me["sudden_strike_ready"]:
                me["sudden_strike_stacks"] = min(2, me["sudden_strike_stacks"] + 1)
                me["sudden_strike_until"] = t + 4.0
                if me["sudden_strike_stacks"] >= 2:
                    me["sudden_strike_ready"] = t + 10.0
        if "Ifrit's Claw" in me["items"]:
            me["ifrit_stacks"] = min(5, me["ifrit_stacks"] + 1)
            me["ifrit_until"] = t + 2.0
        if "Firestorm Bow" in me["items"] and t + 1e-9 >= me["firestorm_ready"]:
            me["firestorm_ready"] = t + 0.30
            me["firestorm_stacks"] = min(6, me["firestorm_stacks"] + 1)
            _emit_damage(
                me, opp, "Firestorm Bow", me["firestorm_stacks"] * (15.0 + me["level"] // 3), "magic", t, is_proc=True
            )
        if "War Boots" in me["items"]:
            _apply_heal(me, 20.0, t)
        if "Shadow Blade" in me["enchs"] and me["shadow_blade_stacks"] > 0 and me["shadow_blade_until"] > t:
            raw_sb = me["shadow_blade_stacks"] * lerp_by_level([30, 100], me["level"])
            me["shadow_blade_stacks"] = 0
            _emit_damage(me, opp, "Shadow Blade", raw_sb, "physical", t, is_proc=True)
        if me["spellblade_armed"]:
            me["spellblade_armed"] = False
            ad, bad, ap = (
                me["raw_stats"]["attack_damage"],
                me["raw_stats"]["bonus_attack_damage"],
                me["raw_stats"]["ability_power"],
            )
            if "Apocalypse" in me["items"] and t + 1e-9 >= me["sb_apoc_ready"]:
                me["sb_apoc_ready"] = t + 2.0
                _emit_damage(me, opp, "Apocalypse (Spellblade)", 0.30 * ad + 0.80 * ap, "magic", t, is_proc=True)
            elif "Trick Blade" in me["items"] and t + 1e-9 >= me["sb_trick_ready"]:
                me["sb_trick_ready"] = t + 3.0
                _emit_damage(me, opp, "Trick Blade (Spellblade)", 0.30 * ad + 0.18 * ap, "magic", t, is_proc=True)
            if "Loki's Curse" in me["items"] and t + 1e-9 >= me["sb_loki_ready"]:
                me["sb_loki_ready"] = t + 2.0
                _emit_damage(me, opp, "Loki's Curse (Spellblade)", 0.35 * ad + 0.50 * ap, "magic", t, is_proc=True)
            if "Frost Cape" in me["items"] and t + 1e-9 >= me["sb_frost_ready"]:
                me["sb_frost_ready"] = t + 0.65
                _emit_damage(me, opp, "Frost Cape (Frost Power)", 100.0 + 0.30 * bad, "physical", t, is_proc=True)

    # Configured proc list (Enchantment procs + Hero stack passives)
    for p in me["procs"]:
        trig = p.get("trigger", "any")
        if trig == "damage_taken":
            continue
        if trig == "attack" and not did_attack:
            continue
        if trig == "skill" and not did_skill:
            continue
        inc = (
            1 if trig == "attack" else (skill_used.get("hits", 1) if trig == "skill" and skill_used else base_hit_count)
        )
        cname = p.get("canonical_name")
        if cname == "Holy Summoner" and t < p["ready"] - 1e-9:
            continue
        p["hits"] += inc
        if t + 1e-9 >= p["ready"] and p["hits"] >= p["hits_needed"]:
            p["ready"] = t + p["cooldown"]
            p["hits"] -= p["hits_needed"]
            if cname == "Holy Summoner":
                me["fairy_until"] = t + 5.0
                me["fairy_next"] = round(t + 1.0, 4)
            elif cname == "Curse of Death":
                me["curse_detonate_at"] = round(t + 1.0, 4)
                _emit_damage(
                    me, opp, p["name"], p["damage"], p["damage_type"], t, is_proc=True, precalculated=p["damage"]
                )
            else:
                _emit_damage(
                    me, opp, p["name"], p["damage"], p["damage_type"], t, is_proc=True, precalculated=p["damage"]
                )


def simulate_duel(
    side_a,
    side_b,
    kite_a: tuple[float, float] = (0.0, 1.0),
    kite_b: tuple[float, float] = (0.0, 1.0),
    sim_meta_a: dict | None = None,
    sim_meta_b: dict | None = None,
) -> dict:
    """Fixed-step 50ms combat simulation with passives, actives, enchantments, kiting, and mitigation."""
    sides = [
        _init_sim_side(*side_a, kite_a, sim_meta_a),
        _init_sim_side(*side_b, kite_b, sim_meta_b),
    ]
    sides[0]["opp_items"] = sides[1]["items"]
    sides[1]["opp_items"] = sides[0]["items"]

    # Immediate opener actives (e.g., Magic Eye reveals & hits, Eclipsing Bow Reach)
    for i, me in enumerate(sides):
        if me["enable_actives"] and any("Magic Eye" in it for it in me["items"]):
            me["magic_eye_ready"] = 45.0
            me["magic_eye_next_tick"] = 0.0
            me["magic_eye_ticks_left"] = 2

    timeline = []
    t = 0.0
    winner = None
    step = 0
    while t <= DUEL_MAX_SECONDS:
        for i in (0, 1):
            _tick_side_timers(sides[i], sides[1 - i], t)

        for i, me in enumerate(sides):
            opp = sides[1 - i]
            if me["revive_pending_until"] is not None or me["silence_until"] > t:
                continue

            did_skill = False
            did_attack = False
            skill_used = None
            base_hit_count = 0

            if t + 1e-9 >= me["next_cast"]:
                for sk in me["skills"]:
                    has_charge = sk.get("charges", 1) > 0
                    if has_charge and t + 1e-9 >= sk["ready"]:
                        # Adjust skill raw damage dynamically for Rock Shield -70% AD & live target HP ratios; live shreds/buffs run in _calc_live_damage
                        raw_dmg = sk["raw_damage"]
                        if sk["damage_type"] == "physical" and me["rock_shield_ad_until"] > t:
                            raw_dmg *= 0.30
                        opp_ratio = max(0.0, opp["hp"]) / opp["max_hp"] if opp["max_hp"] > 0 else 1.0
                        cur_pct = sk.get("target_current_hp_pct", 0.0)
                        lost_pct = sk.get("target_lost_hp_pct", 0.0)
                        if cur_pct:
                            raw_dmg -= (1.0 - opp_ratio) * (cur_pct / 100.0) * opp["max_hp"]
                        if lost_pct:
                            raw_dmg += (1.0 - opp_ratio) * (lost_pct / 100.0) * opp["max_hp"]

                        if _emit_damage(me, opp, sk["name"], max(0.0, raw_dmg), sk["damage_type"], t, is_skill=True):
                            did_skill = True
                            skill_used = sk
                            base_hit_count += sk.get("hits", 1)
                        me["spellblade_armed"] = True

                        if "charges" in sk:
                            sk["charges"] -= 1
                            if sk["recharge_at"] is None:
                                sk["recharge_at"] = round(t + sk["recharge_cd"], 4)
                            sk["ready"] = t + 0.5
                        else:
                            cd_ready = t + max(sk["cooldown"], 0.5)
                            sk["ready"] = cd_ready
                            if me["dual_form"]:
                                grp = sk.get("level_slot", sk["slot"])
                                for other in me["skills"]:
                                    if other.get("level_slot", other["slot"]) == grp:
                                        other["ready"] = max(other["ready"], cd_ready)
                        me["next_cast"] = t + SKILL_CAST_GAP
                        break

            if t + 1e-9 >= me["next_attack"] and me["stasis_until"] <= t:
                raw_atk = me["ba"]["raw_per_hit"] * (0.30 if me["rock_shield_ad_until"] > t else 1.0)
                if _emit_damage(me, opp, "Normal Attack", raw_atk, "physical", t, is_attack=True):
                    did_attack = True
                    base_hit_count += 1
                me["next_attack"] = t + _attack_interval_for(me, t)

            if did_skill or did_attack:
                _handle_post_hit_effects(me, opp, t, did_skill, did_attack, skill_used, base_hit_count)

        dead = [s["hp"] <= 0 and s["revive_pending_until"] is None for s in sides]
        if step % 5 == 0 or any(dead):
            timeline.append(
                {
                    "t": round(t, 2),
                    "hp_a": round(max(0.0, sides[0]["hp"]), 1),
                    "hp_b": round(max(0.0, sides[1]["hp"]), 1),
                }
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
            "kiting": s["kiting"],
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
