import json
import os
import re
from pathlib import Path
import requests
from bs4 import BeautifulSoup
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "ROVResearchProject/1.0 (https://github.com/rov-draft-ai; contact@example.com)"
}
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
}

# Mapping aliases/old names to canonical 2026 RoV hero names
EXCLUDED_DUPLICATES = {"Celica", "Mortos", "Payna", "Peura", "Batman", "The Joker"}

NAME_MAPPING_TO_FANDOM = {
    "Diao Chan": "Diaochan",
    "Richter": "Riktor",
    "Flowborn (Marksman)": "Flowborn/Archer",
    "Flowborn (Mage)": "Flowborn/Mage",
}

# Official skill data for 2025-2026 RoV heroes whose Fandom pages are stubs or not yet created
OFFICIAL_2025_2026_SKILLS = {
    "Goverra": {
        "class": "Mage",
        "specialty": "Poke / Pusher / Crowd Control",
        "attack_range": "Ranged",
        "skills": [
            {
                "slot": "Passive",
                "name": "Mechanoid Legion",
                "type": "Summon / Magic",
                "cooldown": "0",
                "description": "When Goverra defeats an enemy or minion, she summons a Mechanoid drone that automatically attacks nearby enemies. Mechanoids can merge to upgrade their combat power and explode upon expiration to deal magic damage to surrounding enemies."
            },
            {
                "slot": "Skill 1",
                "name": "Strafe",
                "type": "Magic / Slow",
                "cooldown": "7",
                "description": "Goverra commands fighter drones to fly along a target path, dealing magic damage to enemies hit. Can be recast to order the drones to converge on a specific target; enemies hit by multiple drones simultaneously are slowed by 50% for 1.5 seconds."
            },
            {
                "slot": "Skill 2",
                "name": "Air Assault",
                "type": "Magic / Summon",
                "cooldown": "10",
                "description": "Goverra deploys a squad of Mechanoids to bombard and land at the target area, dealing magic damage to enemies in the zone and attacking nearby targets or towers."
            },
            {
                "slot": "Ultimate",
                "name": "Deadly Payload",
                "type": "Crowd Control / Magic / Buff",
                "cooldown": "36",
                "description": "Goverra locks onto an enemy hero with a targeting beacon, stunning the target, dealing continuous magic damage, and slowing their movement speed. Empowers allied Mechanoids in range, and explodes for heavy magic damage when the mark expires."
            }
        ]
    },
    "Edras": {
        "class": "Warrior / Assassin",
        "specialty": "Transform / Mobility / Damage",
        "attack_range": "Melee",
        "skills": [
            {
                "slot": "Passive",
                "name": "Essence Blade",
                "type": "Buff / Physical",
                "cooldown": "0",
                "description": "Edras's normal attacks and Skill 2 grant bonus EXP (+10) when hitting enemy heroes. Edras can switch combat forms upon unlocking his ultimate, converting bonus attack speed or attack damage into armor pierce and enhanced strikes."
            },
            {
                "slot": "Skill 1",
                "name": "Valiant Sprint",
                "type": "Movement / Physical",
                "cooldown": "6",
                "description": "Edras dashes rapidly in the target direction, empowering his next attack and allowing him to engage or reposition in combat."
            },
            {
                "slot": "Skill 2",
                "name": "Powerful Slash",
                "type": "Physical / Slow",
                "cooldown": "8",
                "description": "Edras unleashes an aura blade wave in the target direction, dealing physical damage to all enemies along the path and slowing their movement speed. Grants bonus EXP when hitting enemy heroes."
            },
            {
                "slot": "Ultimate",
                "name": "Essence Discovery: Light",
                "type": "Transform / Buff / Crowd Control",
                "cooldown": "30",
                "description": "Edras awakens his lineage power and transforms into Light Form (or Dark/Berserker Form), gaining enhanced stats, knockback/control effects, and upgraded basic abilities."
            }
        ]
    },
    "Tamyn": {
        "class": "Warrior / Assassin",
        "specialty": "Mobility / Sustained Damage / Recovery",
        "attack_range": "Melee",
        "skills": [
            {
                "slot": "Passive",
                "name": "Radiant Holy Spear",
                "type": "Buff / Physical / Heal",
                "cooldown": "0",
                "description": "Whenever Tamyn retrieves or recalls his spear, his next basic attack within 4 seconds is empowered (stacks up to 2 times) to deal bonus physical damage, grants 20-40% movement speed briefly, reduces all skill cooldowns by 1 second, and restores HP."
            },
            {
                "slot": "Skill 1",
                "name": "Sky-Piercing Spear",
                "type": "Physical / Movement",
                "cooldown": "7",
                "description": "Tamyn hurls his spear forward or dashes along its trajectory, dealing physical damage to enemies in the path and leaving the spear for retrieval combos."
            },
            {
                "slot": "Skill 2",
                "name": "Twilight Spear",
                "type": "Physical / Slow",
                "cooldown": "9",
                "description": "Tamyn plants a spear into the target area, dealing physical damage and slowing enemies within the zone. Can be retrieved or recalled to trigger Radiant Holy Spear."
            },
            {
                "slot": "Ultimate",
                "name": "Gathering Holy Spear",
                "type": "Physical / Buff / Heal",
                "cooldown": "18",
                "description": "Tamyn immediately recalls all planted spears back to himself regardless of distance, dealing heavy physical damage to enemies struck along the return path, restoring HP, granting movement speed, and resetting skill cooldowns via his passive."
            }
        ]
    },
    "Evita": {
        "class": "Mage",
        "specialty": "Crowd Control / Sustained Damage / Shield",
        "attack_range": "Ranged",
        "skills": [
            {
                "slot": "Passive",
                "name": "Umbral Origin",
                "type": "Magic / Buff",
                "cooldown": "0",
                "description": "Evita continuously accumulates dark energy. When full, her next skill hit on an enemy hero consumes all energy to summon Abyssal Beasts that pounce on the target, dealing magic damage, increasing Evita's movement speed, and reducing the cooldowns of Skill 1 and Skill 2."
            },
            {
                "slot": "Skill 1",
                "name": "Abyssal Assault",
                "type": "Magic / Area",
                "cooldown": "6",
                "description": "Evita releases an abyssal beast in the target direction that explodes upon hitting an enemy or reaching max range, dealing magic damage and scattering dark energy around the area."
            },
            {
                "slot": "Skill 2",
                "name": "Hand of Abyss",
                "type": "Crowd Control / Magic",
                "cooldown": "9",
                "description": "Evita summons a Hand of Abyss from a rift that deals continuous magic damage and pulls enemies toward the center before exploding to stun targets. Also pulls nearby dark energy from Skill 1 to detonate together."
            },
            {
                "slot": "Ultimate",
                "name": "Umbral Cloak",
                "type": "Magic / Shield / Slow",
                "cooldown": "40",
                "description": "Evita gains a protective shield and releases abyssal beasts to hunt nearby enemies, dealing magic damage, slowing targets, and rapidly charging dark energy. Each beast hit on enemies or towers grants additional shield. Takedowns extend the ultimate's duration."
            }
        ]
    }
}


def fetch_rovmeta_heroes():
    """Fetch hero list and 2026 pro/meta statistics from rovmeta.com."""
    print("Fetching hero metadata and 2026 stats from rovmeta.com...")
    resp = requests.get("https://rovmeta.com/heroes", headers=BROWSER_HEADERS, timeout=20)
    resp.raise_for_status()
    text = resp.text.replace('\\"', '"')

    # Extract JSON objects matching hero entries
    pattern = re.compile(
        r'\{"slug":"([^"]+)","hero":\{"id":"([^"]+)","name_en":"([^"]+)","role":"([^"]+)","sub_role":"([^"]+)"[^}]*\},"tier":"([^"]+)","confidence":"([^"]+)","reasoning_en":"([^"]*?)","balanceChange":(null|"[^"]*"),"stats":\{"win_rate":([0-9.]+),"pick_rate":([0-9.]+),"ban_rate":([0-9.]+),"source":"([^"]+)"\}\}'
    )
    meta_by_name = {}
    for m in pattern.finditer(text):
        slug, hid, name_en, role, sub_role, tier, conf, reason, bal, wr, pr, br, src = m.groups()
        if name_en in EXCLUDED_DUPLICATES:
            continue
        sub_role_clean = None if sub_role == "$undefined" else sub_role
        bal_clean = None if bal == "null" else bal.strip('"')
        meta_by_name[name_en] = {
            "slug": slug,
            "name_en": name_en,
            "primary_role": role.capitalize(),
            "secondary_role": sub_role_clean.capitalize() if sub_role_clean else None,
            "meta_tier_2026": tier,
            "pro_win_rate_2026": float(wr),
            "pro_pick_rate_2026": float(pr),
            "pro_ban_rate_2026": float(br),
            "stats_source": src,
            "balance_change_latest": bal_clean,
            "meta_notes": reason,
        }

    # Expand Flowborn into its 2 in-game RoV roles: Flowborn (Marksman) and Flowborn (Mage)
    if "Flowborn" in meta_by_name:
        fb = meta_by_name.pop("Flowborn")
        fb_mm = dict(fb)
        fb_mm["name_en"] = "Flowborn (Marksman)"
        fb_mm["slug"] = "flowborn-marksman"
        fb_mm["primary_role"] = "Marksman"
        fb_mm["secondary_role"] = None

        fb_mage = dict(fb)
        fb_mage["name_en"] = "Flowborn (Mage)"
        fb_mage["slug"] = "flowborn-mage"
        fb_mage["primary_role"] = "Mage"
        fb_mage["secondary_role"] = None

        meta_by_name["Flowborn (Marksman)"] = fb_mm
        meta_by_name["Flowborn (Mage)"] = fb_mage

    print(f"Found {len(meta_by_name)} canonical RoV heroes (including Flowborn Marksman & Mage, Tamyn, Evita).")
    return meta_by_name


def clean_wikitext(text: str) -> str:
    """Strip MediaWiki markup into clean readable text."""
    if not text:
        return ""
    # Remove HTML comments
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    # Replace {{PD}} / {{MD}} / {{TD}} templates
    text = text.replace("{{PD}}", "physical damage").replace("{{MD}}", "magic damage").replace("{{TD}}", "true damage")
    # Replace {{SkillTextID|...|text}} with text
    text = re.sub(r"\{\{SkillTextID\|[^|}]+\|([^|}]+)\}\}", r"\1", text)
    # Remove nested tables {| ... |}
    text = re.sub(r"\{\|.*?\|\}", "", text, flags=re.DOTALL)
    # Remove File/Image links
    text = re.sub(r"\[\[(?:File|Image):[^\]]+\]\]", "", text, flags=re.IGNORECASE)
    # Replace [[Page|Label]] -> Label and [[Page]] -> Page
    text = re.sub(r"\[\[(?:[^|\]]+\|)?([^\]]+)\]\]", r"\1", text)
    # Remove remaining templates {{...}}
    text = re.sub(r"\{\{[^{}]*\}\}", "", text)
    # Remove HTML tags
    text = BeautifulSoup(text, "html.parser").get_text(" ")
    # Remove bold/italic wiki quotes
    text = text.replace("'''", "").replace("''", "")
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_fandom_wikitext(wikitext: str):
    """Extract base stats and skills from AoV Fandom wikitext."""
    info = {
        "class": None,
        "specialty": None,
        "attack_range": None,
        "max_hp": None,
        "armor": None,
        "magic_defense": None,
        "attack_damage": None,
        "movement_speed": None,
        "skills": [],
    }
    if not wikitext:
        return info

    # Parse Infobox parameters
    def extract_param(param_name):
        m = re.search(rf"\|\s*{param_name}\s*=\s*([^\n|]+)", wikitext, re.IGNORECASE)
        return clean_wikitext(m.group(1)) if m else None

    info["class"] = extract_param("Class")
    info["specialty"] = extract_param("Role")
    info["attack_range"] = extract_param("Attackrange")
    info["max_hp"] = extract_param("Maxhp")
    info["armor"] = extract_param("Armor")
    info["magic_defense"] = extract_param("Magicdefense")
    info["attack_damage"] = extract_param("Attackdamage")
    info["movement_speed"] = extract_param("Movementspeed")

    # Find Skills section
    skills_match = re.search(r"==+\s*Skills?\s*==+(.*?)(?:\n==\s*[^=]+\s*==|\Z)", wikitext, re.DOTALL | re.IGNORECASE)
    skills_block = skills_match.group(1) if skills_match else wikitext

    # Replace inner nested tables {| ... |} inside cells with a marker containing extracted cooldown
    def replace_inner_table(m):
        tbl = m.group(0)
        cd_match = re.search(r"\|\s*Cooldown\s*\n((?:\|[^\n]+\n?)+)", tbl, re.IGNORECASE)
        if cd_match:
            cd_cells = [clean_wikitext(c.lstrip("|").strip()) for c in cd_match.group(1).strip().split("\n") if c.strip().startswith("|")]
            cd_cells = [c for c in cd_cells if c]
            if cd_cells:
                return f" [CD_EXTRACTED:{'/'.join(cd_cells)}] "
        return ""

    # Remove inner tables (tables that appear after the first {| header)
    first_table_start = skills_block.find("{|")
    if first_table_start != -1:
        header_part = skills_block[:first_table_start + 2]
        body_part = skills_block[first_table_start + 2:]
        # Replace any nested {| ... |} that do not contain another {|
        for _ in range(3):
            body_part = re.sub(r"\{\|(?:(?!\{\|).)*?\|\}", replace_inner_table, body_part, flags=re.DOTALL)
        skills_block_clean = header_part + body_part
    else:
        skills_block_clean = skills_block

    raw_chunks = re.split(r"\n\|-[^\n]*\n", skills_block_clean)
    slot_names = ["Passive", "Skill 1", "Skill 2", "Ultimate", "Skill 4", "Skill 5", "Skill 6", "Skill 7"]

    skill_idx = 0
    for chunk in raw_chunks:
        chunk_stripped = chunk.strip()
        if not chunk_stripped or chunk_stripped.startswith("!"):
            continue
        cd_val = ""
        cd_m = re.search(r"\[CD_EXTRACTED:([^\]]+)\]", chunk_stripped)
        if cd_m:
            cd_val = cd_m.group(1)
            chunk_stripped = chunk_stripped.replace(cd_m.group(0), " ")

        # Normalize || into newline | and join continuation lines onto their cell
        chunk_norm = chunk_stripped.replace("||", "\n|")
        raw_lines = chunk_norm.split("\n")
        merged_cells = []
        for line in raw_lines:
            sline = line.strip()
            if not sline or sline.startswith("|}") or sline.startswith("{|"):
                continue
            if sline.startswith("!"):
                # Header row inside chunk, skip
                merged_cells = []
                break
            if sline.startswith("|"):
                merged_cells.append(sline[1:].strip())
            elif merged_cells:
                merged_cells[-1] = merged_cells[-1] + " " + sline

        if not merged_cells:
            continue

        def strip_cell_attrs(cell_text: str) -> str:
            # First remove [[File:...]] or [[Image:...]] so its internal pipes don't confuse attribute stripping
            has_file = bool(re.search(r"\[\[(?:File|Image):", cell_text, re.IGNORECASE))
            no_file = re.sub(r"\[\[(?:File|Image):[^\]]+\]\]", "", cell_text, flags=re.IGNORECASE).strip()
            # Strip leading wiki cell attributes like rowspan="5" align="center" |
            no_attr = re.sub(
                r"^(?:(?:rowspan|colspan|align|style|width|valign|class)\s*=\s*[^|]+|\s)+(?:\|\s*)",
                "",
                no_file,
                flags=re.IGNORECASE,
            ).strip()
            return ("__FILE_ICON__ " + no_attr).strip() if has_file and not no_attr else no_attr

        cleaned_cells = [strip_cell_attrs(c) for c in merged_cells]
        cleaned_cells = [c for c in cleaned_cells if c and c != "__FILE_ICON__"]

        if len(cleaned_cells) >= 2:
            s_name = clean_wikitext(cleaned_cells[0].replace("__FILE_ICON__", ""))
            s_desc = clean_wikitext(cleaned_cells[1].replace("__FILE_ICON__", ""))
            s_type = clean_wikitext(cleaned_cells[2].replace("__FILE_ICON__", "")) if len(cleaned_cells) >= 3 else ""
            if not cd_val and len(cleaned_cells) >= 3:
                for extra_c in cleaned_cells[2:]:
                    c_txt = clean_wikitext(extra_c)
                    if re.search(r"\b\d+(?:\.\d+)?s\b", c_txt):
                        cd_val = c_txt
                        break
            # Real skill descriptions have at least 5 words
            if (
                s_name
                and s_desc
                and len(s_desc.split()) >= 5
                and s_name.lower() not in {"attribute", "base damage", "cooldown", "level", "1", "icon", "name"}
            ):
                slot_label = slot_names[skill_idx] if skill_idx < len(slot_names) else f"Skill {skill_idx}"
                info["skills"].append({
                    "slot": slot_label,
                    "name": s_name,
                    "type": s_type,
                    "cooldown": cd_val,
                    "description": s_desc,
                })
                skill_idx += 1

    return info


def fetch_fandom_pages(titles):
    """Batch fetch wikitext from AoV Fandom API."""
    results = {}
    batch_size = 40
    for i in range(0, len(titles), batch_size):
        batch = titles[i:i + batch_size]
        url = "https://arenaofvalor.fandom.com/api.php"
        params = {
            "action": "query",
            "prop": "revisions",
            "rvprop": "content",
            "redirects": 1,
            "titles": "|".join(batch),
            "format": "json",
        }
        r = requests.get(url, params=params, headers=HEADERS, timeout=25)
        r.raise_for_status()
        data = r.json()
        pages = data.get("query", {}).get("pages", {})
        redirects = {red["to"]: red["from"] for red in data.get("query", {}).get("redirects", [])}
        for p in pages.values():
            title = p.get("title")
            content = p.get("revisions", [{}])[0].get("*", "") if "revisions" in p else ""
            results[title] = content
            if title in redirects:
                results[redirects[title]] = content
    return results


def fetch_fandom_parsed_html_skills(page_title: str):
    """Fallback HTML parser for Fandom pages that use non-standard skill templates."""
    url = "https://arenaofvalor.fandom.com/api.php"
    params = {
        "action": "parse",
        "page": page_title,
        "prop": "text",
        "redirects": 1,
        "format": "json",
    }
    r = requests.get(url, params=params, headers=HEADERS, timeout=20)
    if r.status_code != 200:
        return []
    data = r.json()
    html = data.get("parse", {}).get("text", {}).get("*", "")
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    skills = []
    slot_names = ["Passive", "Skill 1", "Skill 2", "Ultimate", "Skill 4", "Skill 5", "Skill 6", "Skill 7"]

    for table in soup.find_all("table"):
        if table.find_parent("table") is not None:
            continue
        rows = table.find_all("tr", recursive=False)
        tbody = table.find("tbody", recursive=False)
        if tbody:
            rows = tbody.find_all("tr", recursive=False)
        if not rows:
            continue
        header_text = " ".join(th.get_text(" ", strip=True).lower() for th in rows[0].find_all(["th", "td"]))
        if "description" in header_text or ("name" in header_text and "icon" in header_text):
            for tr in rows[1:]:
                cd_val = ""
                for inner_tbl in tr.find_all("table"):
                    for inner_tr in inner_tbl.find_all("tr"):
                        row_cells = [c.get_text(" ", strip=True) for c in inner_tr.find_all(["td", "th"])]
                        if row_cells and "cooldown" in row_cells[0].lower():
                            cd_val = "/".join(row_cells[1:])
                    inner_tbl.decompose()
                tds = tr.find_all(["td", "th"], recursive=False)
                if len(tds) >= 3:
                    s_name = re.sub(r"\s+", " ", tds[1].get_text(" ", strip=True)).strip()
                    s_desc = re.sub(r"\s+", " ", tds[2].get_text(" ", strip=True)).strip()
                    s_type = re.sub(r"\s+", " ", tds[3].get_text(" ", strip=True)).strip() if len(tds) >= 4 else ""
                    if s_name and s_desc and len(s_desc) > 10:
                        slot_label = slot_names[len(skills)] if len(skills) < len(slot_names) else f"Skill {len(skills)}"
                        skills.append({
                            "slot": slot_label,
                            "name": s_name,
                            "type": s_type,
                            "cooldown": cd_val,
                            "description": s_desc,
                        })
    return skills


def fetch_liquipedia_skills(hero_names):
    """Fetch SkillCard data from Liquipedia for heroes missing skills on Fandom."""
    out = {}
    batch_size = 30
    for i in range(0, len(hero_names), batch_size):
        batch = hero_names[i:i + batch_size]
        url = "https://liquipedia.net/arenaofvalor/api.php"
        params = {
            "action": "query",
            "prop": "revisions",
            "rvprop": "content",
            "redirects": 1,
            "titles": "|".join(batch),
            "format": "json",
        }
        r = requests.get(url, params=params, headers=HEADERS, timeout=20)
        r.raise_for_status()
        pages = r.json().get("query", {}).get("pages", {})
        for p in pages.values():
            title = p.get("title")
            wt = p.get("revisions", [{}])[0].get("*", "") if "revisions" in p else ""
            if not wt:
                continue
            skills = []
            cards = re.findall(r"\{\{SkillCard(.*?)\n\}\}", wt, flags=re.DOTALL)
            for idx, card in enumerate(cards):
                def get_field(f):
                    m = re.search(rf"\|\s*{f}\s*=\s*(.*?)(?=\n\||\Z)", card, flags=re.DOTALL)
                    return clean_wikitext(m.group(1)) if m else ""
                s_name = get_field("name")
                s_slot = get_field("skill") or (f"Skill {idx}" if idx > 0 else "Passive")
                s_type = "/".join([x for x in [get_field("type"), get_field("type2"), get_field("dmg")] if x])
                s_cd = get_field("cooldown")
                s_desc = get_field("desc")
                if s_name and s_desc:
                    skills.append({
                        "slot": s_slot,
                        "name": s_name,
                        "type": s_type,
                        "cooldown": s_cd,
                        "description": s_desc,
                    })
            if skills:
                out[title] = skills
    return out


def extract_skill_features(skills, primary_role, secondary_role):
    """Derive structured boolean/numeric feature flags from a hero's skills for ML modeling."""
    combined_text = " ".join(
        f"{s.get('type', '')} {s.get('description', '')}" for s in skills
    ).lower()

    has_true_dmg = bool(re.search(r"\btrue damage\b|\btrue\b", combined_text))
    has_magic_dmg = bool(re.search(r"\bmagic damage\b|\bmagical damage\b|\bmgc\b", combined_text)) or (
        primary_role == "Mage" or secondary_role == "Mage"
    )
    has_phys_dmg = bool(re.search(r"\bphysical damage\b|\bphysic\b|\bphy\b", combined_text)) or (
        primary_role in {"Marksman", "Warrior", "Assassin"}
    )

    has_hard_cc = bool(
        re.search(
            r"\bstun\b|\bstuns\b|\bstunned\b|\bstunning\b|\bknock\b|\bknocks\b|\bknocked\b|\bairborne\b|\bpull\b|\bpulls\b|\bpulled\b|\bfreeze\b|\bfrozen\b|\bpetrif|\bsuppress|\btaunt\b|\bcharm\b|\bhook\b|\bimmobiliz",
            combined_text,
        )
    )
    has_suppress = bool(re.search(r"\bsuppress|\bdevour\b|\bimprison", combined_text))
    has_soft_cc = bool(re.search(r"\bslow\b|\bslows\b|\bslowed\b|\bslowing\b|\bsilence\b|\bsilenced\b|\bblind\b", combined_text))
    has_mobility = bool(
        re.search(
            r"\bdash\b|\bdashes\b|\bcharge\b|\bcharges\b|\bleap\b|\bleaps\b|\bblink\b|\bteleport\b|\bmovement speed\b|\bfly\b|\bflies\b|\bswing\b|\bsprint\b",
            combined_text,
        )
    )
    has_immunity = bool(
        re.search(
            r"\bimmune\b|\bimmunity\b|\biron body\b|\buntargetable\b|\binvincib|\bcannot be targeted\b|\bremove all control\b|\bcleanses\b",
            combined_text,
        )
    )
    has_heal = bool(
        re.search(
            r"\bheal\b|\bheals\b|\brecover\b|\brecovers\b|\brestore\b|\brestores\b|\blife steal\b|\blifesteal\b|\bregen\b|\bhp regen\b",
            combined_text,
        )
    )
    has_shield = bool(re.search(r"\bshield\b|\bshields\b", combined_text))

    return {
        "num_skills": len(skills),
        "has_true_damage": has_true_dmg,
        "has_physical_damage": has_phys_dmg,
        "has_magic_damage": has_magic_dmg,
        "has_hard_cc": has_hard_cc,
        "has_soft_cc": has_soft_cc,
        "has_suppress": has_suppress,
        "has_mobility": has_mobility,
        "has_immunity": has_immunity,
        "has_heal_sustain": has_heal,
        "has_shield": has_shield,
    }


def main():
    meta_by_name = fetch_rovmeta_heroes()
    sorted_names = sorted(meta_by_name.keys())

    # Prepare Fandom titles to query
    fandom_titles = list({NAME_MAPPING_TO_FANDOM.get(name, name) for name in sorted_names})
    print(f"Fetching wikitext from AoV Fandom for {len(fandom_titles)} pages...")
    fandom_raw = fetch_fandom_pages(fandom_titles)

    # Check which heroes need Liquipedia or HTML fallback
    liquipedia_candidates = []
    parsed_fandom = {}
    for name in sorted_names:
        f_title = NAME_MAPPING_TO_FANDOM.get(name, name)
        wt = fandom_raw.get(f_title, "")
        info = parse_fandom_wikitext(wt)
        if len(info["skills"]) < 4 and name not in OFFICIAL_2025_2026_SKILLS:
            # Try HTML parse fallback on Fandom first
            html_skills = fetch_fandom_parsed_html_skills(f_title)
            if len(html_skills) >= 4:
                info["skills"] = html_skills
            else:
                liquipedia_candidates.append(name)
        parsed_fandom[name] = info

    if liquipedia_candidates:
        print(f"Fetching Liquipedia skill cards for: {liquipedia_candidates}")
        liq_skills = fetch_liquipedia_skills(liquipedia_candidates)
        for name, skills in liq_skills.items():
            if name in parsed_fandom and len(skills) >= 4:
                parsed_fandom[name]["skills"] = skills

    # Assemble final 130 heroes dataset
    all_heroes = []
    summary_rows = []

    for idx, name in enumerate(sorted_names, start=1):
        meta = meta_by_name[name]
        f_info = parsed_fandom.get(name, {})

        # Override with official 2025-2026 skills if applicable
        if name in OFFICIAL_2025_2026_SKILLS:
            off = OFFICIAL_2025_2026_SKILLS[name]
            f_info["class"] = off["class"]
            f_info["specialty"] = off["specialty"]
            f_info["attack_range"] = off["attack_range"]
            f_info["skills"] = off["skills"]

        skills = f_info.get("skills", [])
        features = extract_skill_features(skills, meta["primary_role"], meta["secondary_role"])

        hero_record = {
            "hero_id": idx,
            "name": name,
            "slug": meta["slug"],
            "primary_role": meta["primary_role"],
            "secondary_role": meta["secondary_role"],
            "fandom_class": f_info.get("class") or meta["primary_role"],
            "specialty": f_info.get("specialty"),
            "attack_range": f_info.get("attack_range"),
            "base_stats": {
                "max_hp": f_info.get("max_hp"),
                "armor": f_info.get("armor"),
                "magic_defense": f_info.get("magic_defense"),
                "attack_damage": f_info.get("attack_damage"),
                "movement_speed": f_info.get("movement_speed"),
            },
            "meta_2026": {
                "tier": meta["meta_tier_2026"],
                "pro_win_rate": meta["pro_win_rate_2026"],
                "pro_pick_rate": meta["pro_pick_rate_2026"],
                "pro_ban_rate": meta["pro_ban_rate_2026"],
                "balance_change_latest": meta["balance_change_latest"],
                "notes": meta["meta_notes"],
            },
            "features": features,
            "skills": skills,
        }
        all_heroes.append(hero_record)

        # Build flat summary row for CSV
        skill_names = [f"{s['slot']}: {s['name']}" for s in skills]
        summary_rows.append({
            "hero_id": idx,
            "name": name,
            "primary_role": meta["primary_role"],
            "secondary_role": meta["secondary_role"] or "",
            "specialty": f_info.get("specialty") or "",
            "attack_range": f_info.get("attack_range") or "",
            "meta_tier_2026": meta["meta_tier_2026"],
            "pro_win_rate_2026": meta["pro_win_rate_2026"],
            "pro_pick_rate_2026": meta["pro_pick_rate_2026"],
            "pro_ban_rate_2026": meta["pro_ban_rate_2026"],
            "num_skills": features["num_skills"],
            "has_true_damage": features["has_true_damage"],
            "has_physical_damage": features["has_physical_damage"],
            "has_magic_damage": features["has_magic_damage"],
            "has_hard_cc": features["has_hard_cc"],
            "has_soft_cc": features["has_soft_cc"],
            "has_suppress": features["has_suppress"],
            "has_mobility": features["has_mobility"],
            "has_immunity": features["has_immunity"],
            "has_heal_sustain": features["has_heal_sustain"],
            "has_shield": features["has_shield"],
            "skill_list": " | ".join(skill_names),
        })

    json_path = DATA_DIR / "heroes_130_full.json"
    csv_path = DATA_DIR / "heroes_130_summary.csv"

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(all_heroes, f, ensure_ascii=False, indent=2)

    df = pd.DataFrame(summary_rows)
    df.to_csv(csv_path, index=False, encoding="utf-8-sig")

    print(f"Saved {len(all_heroes)} heroes to {json_path}")
    print(f"Saved summary table to {csv_path}")

    # Verification checks
    missing_skills = [h["name"] for h in all_heroes if len(h["skills"]) < 3]
    print(f"Heroes with < 3 skills: {len(missing_skills)} -> {missing_skills}")


if __name__ == "__main__":
    main()
