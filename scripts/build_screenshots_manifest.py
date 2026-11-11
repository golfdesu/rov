"""Build a complete JSON manifest linking every in-game screenshot to structured text and stats.

This script audits all:
- 566 hero skill screenshots in heroes/*/skill/
- 268 hero status screenshots in heroes/*/status/
- 159 item equipment card screenshots in item/*/

And associates each image with its exact official text, damage numbers, cooldowns,
mana costs, scalings, and passives extracted from data/hero_skills_full.json,
data/hero_level_stats.json, and data/items.json.

Output:
    data/screenshots_manifest.json

Usage:
    python scripts/build_screenshots_manifest.py
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
HEROES_DIR = REPO_ROOT / "heroes"
ITEMS_DIR = REPO_ROOT / "item"
SKILLS_JSON = REPO_ROOT / "data" / "hero_skills_full.json"
LEVEL_STATS_JSON = REPO_ROOT / "data" / "hero_level_stats.json"
ITEMS_JSON = REPO_ROOT / "data" / "items.json"
OUTPUT_JSON = REPO_ROOT / "data" / "screenshots_manifest.json"

HERO_CANONICAL: dict[str, str] = {
    "Arthur": "Mortos",
    "Brunhilda": "Celica",
    "Richter": "Riktor",
}


def _natural_sort_key(file_path: Path) -> list[int | str]:
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r"(\d+)", file_path.name)]


def _skill_sort_key(file_path: Path) -> tuple[int, int, int, list[int | str]]:
    stem = file_path.stem.lower()
    form_group = 1 if any(tag in stem for tag in ("_form2", "_fox", "_awakened")) else 0
    if stem.startswith("passive"):
        slot_rank = 0
    elif stem.startswith("skill1"):
        slot_rank = 1
    elif stem.startswith("skill2"):
        slot_rank = 2
    elif stem.startswith("ultimate") or stem.startswith("skill3"):
        slot_rank = 3
    elif stem.startswith("skill4"):
        slot_rank = 4
    elif stem.startswith("skill5"):
        slot_rank = 5
    else:
        slot_rank = 9
    variant_rank = 2 if "_v2" in stem else (1 if "_cannon" in stem else 0)
    return (form_group, slot_rank, variant_rank, _natural_sort_key(file_path))


def _match_skill(
    h_canon: str, fname: str, skills_by_slot: dict[str, dict[str, Any]]
) -> tuple[dict[str, Any], str, int]:
    page = 2 if "_v2" in fname else 1

    if h_canon == "Edras":
        if "_normal" in fname:
            if fname.startswith("passive"):
                return skills_by_slot["Passive"], "normal", page
            if fname.startswith("skill1"):
                return skills_by_slot["Skill 1"], "normal", page
            if fname.startswith("skill2"):
                return skills_by_slot["Skill 2"], "normal", page
            if fname.startswith("ultimate"):
                return skills_by_slot["Ultimate"], "normal", page
            if fname.startswith("skill4"):
                return skills_by_slot["Skill 4"], "normal", page
        elif "_awakened" in fname:
            if fname.startswith("passive"):
                return skills_by_slot["Passive (Berserker Mode)"], "awakened", page
            if fname.startswith("skill1"):
                return skills_by_slot["Skill 1 (Berserker Mode)"], "awakened", page
            if fname.startswith("skill2"):
                return skills_by_slot["Skill 2 (Berserker Mode)"], "awakened", page
            if fname.startswith("ultimate"):
                return skills_by_slot["Ultimate (Berserker Mode)"], "awakened", page
            if fname.startswith("skill4"):
                return skills_by_slot["Skill 4 (Berserker Mode)"], "awakened", page
    elif h_canon == "Liliana":
        if fname.startswith("passive"):
            return skills_by_slot["Passive"], "default", page
        if fname == "skill1_human.jpg":
            return skills_by_slot["Skill 1"], "human", 1
        if fname == "skill2_human.jpg":
            return skills_by_slot["Skill 2"], "human", 1
        if fname == "ultimate_human.jpg":
            return skills_by_slot["Skill 3"], "human", 1
        if fname == "skill1_fox.jpg":
            return skills_by_slot["Skill 4"], "fox", 1
        if fname == "skill2_fox.jpg":
            return skills_by_slot["Skill 5"], "fox", 1
        if fname == "ultimate_fox.jpg":
            return skills_by_slot["Ultimate"], "fox", 1
    elif h_canon == "Yena":
        if fname == "passive_form1.jpg":
            return skills_by_slot["Passive"], "dual_blade", 1
        if fname == "skill1_form1.jpg":
            return skills_by_slot["Skill 1"], "dual_blade", 1
        if fname == "skill2_form1.jpg":
            return skills_by_slot["Skill 2"], "dual_blade", 1
        if fname == "ultimate_form1.jpg":
            return skills_by_slot["Ultimate"], "dual_blade", 1
        if fname == "passive_form2.jpg":
            return skills_by_slot["Passive 2"], "combined_blade", 1
        if fname == "skill1_form2.jpg":
            return skills_by_slot["Skill 3"], "combined_blade", 1
        if fname == "skill2_form2.jpg":
            return skills_by_slot["Skill 4"], "combined_blade", 1
        if fname == "ultimate_form2.jpg":
            return skills_by_slot["Skill 5"], "combined_blade", 1
    elif h_canon == "Capheny":
        if fname.startswith("passive"):
            return skills_by_slot["Passive"], "default", page
        if "rapid" in fname and fname.startswith("skill1"):
            return skills_by_slot["Skill 1"], "rapid", page
        if "cannon" in fname and fname.startswith("skill1"):
            return skills_by_slot["Skill 1"], "cannon", page
        if "rapid" in fname and fname.startswith("skill2"):
            return skills_by_slot["Skill 2"], "rapid", page
        if "cannon" in fname and fname.startswith("skill2"):
            return skills_by_slot["Skill 2"], "cannon", page
        if fname.startswith("ultimate"):
            return skills_by_slot["Ultimate"], "default", page
    elif h_canon == "Dirak" and fname.startswith("skill4"):
        return skills_by_slot["Skill 4"], "default", page
    else:
        if fname.startswith("passive"):
            return skills_by_slot["Passive"], "default", page
        if fname.startswith("skill1"):
            return skills_by_slot["Skill 1"], "default", page
        if fname.startswith("skill2"):
            return skills_by_slot["Skill 2"], "default", page
        if fname.startswith("ultimate"):
            return skills_by_slot["Ultimate"], "default", page
        if fname.startswith("skill4") and "Skill 4" in skills_by_slot:
            return skills_by_slot["Skill 4"], "default", page

    raise ValueError(f"Unmatched skill file for {h_canon}: {fname}")


def build_manifest() -> dict[str, Any]:
    with open(SKILLS_JSON, "r", encoding="utf-8") as f:
        skills_catalog = json.load(f)["heroes"]

    with open(LEVEL_STATS_JSON, "r", encoding="utf-8") as f:
        level_stats_catalog = json.load(f)["heroes"]

    with open(ITEMS_JSON, "r", encoding="utf-8") as f:
        items_catalog = json.load(f)["items"]
    items_by_name = {it["name"].lower(): it for it in items_catalog}

    hero_skills_manifest: dict[str, list[dict[str, Any]]] = {}
    hero_status_manifest: dict[str, list[dict[str, Any]]] = {}
    items_manifest: dict[str, list[dict[str, Any]]] = {}

    total_skill_files = 0
    total_status_files = 0
    total_item_files = 0

    # 1. Hero screenshots
    if HEROES_DIR.is_dir():
        for hero_dir in sorted(HEROES_DIR.iterdir()):
            if not hero_dir.is_dir():
                continue
            folder_name = hero_dir.name
            hero_name = HERO_CANONICAL.get(folder_name, folder_name)

            # 1a. Skill screenshots
            skill_dir = hero_dir / "skill"
            if skill_dir.is_dir():
                hero_skills = skills_catalog.get(hero_name, [])
                by_slot = {s["slot"]: s for s in hero_skills}
                file_entries: list[dict[str, Any]] = []

                for f in sorted(skill_dir.iterdir(), key=_skill_sort_key):
                    if f.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                        continue
                    skill_obj, form, page = _match_skill(hero_name, f.name, by_slot)
                    file_entries.append(
                        {
                            "file": f.name,
                            "relative_path": f"heroes/{folder_name}/skill/{f.name}",
                            "hero": hero_name,
                            "folder": folder_name,
                            "slot": skill_obj.get("slot"),
                            "form": form,
                            "page": page,
                            "skill_name": skill_obj.get("name"),
                            "damage_type": skill_obj.get("damage_type"),
                            "type": skill_obj.get("type"),
                            "cooldown": skill_obj.get("cooldown"),
                            "mana_cost": skill_obj.get("mana_cost"),
                            "base_damage": skill_obj.get("base_damage"),
                            "scaling": skill_obj.get("scaling"),
                            "desc_th": skill_obj.get("desc_th"),
                            "description": skill_obj.get("description"),
                        }
                    )
                    total_skill_files += 1

                hero_skills_manifest[hero_name] = file_entries

            # 1b. Status screenshots
            status_dir = hero_dir / "status"
            if status_dir.is_dir():
                status_entries: list[dict[str, Any]] = []
                lv_stats_table = level_stats_catalog.get(hero_name, {}).get("levels", {})

                for f in sorted(status_dir.iterdir(), key=_natural_sort_key):
                    if f.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                        continue
                    lv = 15 if "lv15" in f.name.lower() else 1
                    stats = lv_stats_table.get(str(lv), {})
                    variant = "alt" if "alt" in f.name.lower() else "base"
                    status_entries.append(
                        {
                            "file": f.name,
                            "relative_path": f"heroes/{folder_name}/status/{f.name}",
                            "hero": hero_name,
                            "folder": folder_name,
                            "level": lv,
                            "variant": variant,
                            "stats": stats,
                        }
                    )
                    total_status_files += 1

                hero_status_manifest[hero_name] = status_entries

    # 2. Item equipment card screenshots
    if ITEMS_DIR.is_dir():
        for item_dir in sorted(ITEMS_DIR.iterdir()):
            if not item_dir.is_dir():
                continue
            folder_name = item_dir.name
            it_obj = items_by_name.get(folder_name.lower())
            if not it_obj:
                continue

            item_entries: list[dict[str, Any]] = []
            valid_item_files = [
                f
                for f in sorted(item_dir.iterdir(), key=_natural_sort_key)
                if f.suffix.lower() in (".jpg", ".jpeg", ".png")
            ]
            for page_idx, f in enumerate(valid_item_files, start=1):
                item_entries.append(
                    {
                        "file": f.name,
                        "relative_path": f"item/{folder_name}/{f.name}",
                        "page": page_idx,
                        "item_name": it_obj.get("name"),
                        "slug": it_obj.get("slug"),
                        "category": it_obj.get("category"),
                        "tier": it_obj.get("tier"),
                        "price": it_obj.get("price"),
                        "stats": it_obj.get("stats"),
                        "stats_raw": it_obj.get("stats_raw"),
                        "passives": it_obj.get("passives"),
                        "desc_th": it_obj.get("desc_th"),
                    }
                )
                total_item_files += 1

            items_manifest[it_obj["name"]] = item_entries

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "version": "1.0",
        "summary": {
            "total_heroes": len(hero_skills_manifest),
            "total_hero_skill_screenshots": total_skill_files,
            "total_hero_status_screenshots": total_status_files,
            "total_items": len(items_manifest),
            "total_item_screenshots": total_item_files,
        },
        "hero_skills": hero_skills_manifest,
        "hero_statuses": hero_status_manifest,
        "items": items_manifest,
    }

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"Manifest written to {OUTPUT_JSON}")
    print(f"Summary: {manifest['summary']}")
    return manifest


if __name__ == "__main__":
    build_manifest()
