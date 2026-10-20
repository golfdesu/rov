import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ITEMS_JSON_PATH = ROOT / "data" / "items.json"
OVERRIDES_JSON_PATH = ROOT / "data" / "items_overrides.json"

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


def merge_extracted_items():
    all_items = []
    missing_files = []

    for g_idx in range(6):
        file_path = ROOT / "scripts" / f"extracted_items_g{g_idx}.json"
        if not file_path.exists():
            missing_files.append(str(file_path))
            continue
        with open(file_path, "r", encoding="utf-8") as f:
            group_items = json.load(f)
            print(f"Group {g_idx}: loaded {len(group_items)} items")
            all_items.extend(group_items)

    if missing_files:
        print(f"ERROR: Missing group files: {missing_files}")
        return False

    print(f"\nTotal merged items: {len(all_items)}")

    # Validation
    errors = []
    slugs = set()
    names = set()

    for item in all_items:
        for f in REQUIRED_FIELDS:
            if f not in item:
                errors.append(f"{item.get('name', 'Unknown')}: missing field '{f}'")
        if item.get("slug") in slugs:
            errors.append(f"Duplicate slug: {item.get('slug')}")
        slugs.add(item.get("slug"))

        if item.get("name") in names:
            errors.append(f"Duplicate name: {item.get('name')}")
        names.add(item.get("name"))

        if not isinstance(item.get("desc_th"), list) or len(item.get("desc_th", [])) == 0:
            # Check if item with no passives
            if len(item.get("passives", [])) == 0:
                pass
            else:
                errors.append(f"{item.get('name')}: empty desc_th for item with passives")

        if item.get("price") is None:
            errors.append(f"{item.get('name')}: price is None")

    if errors:
        print(f"Validation failed with {len(errors)} errors:")
        for e in errors[:20]:
            print(f"  - {e}")
        return False

    # Load master items.json
    with open(ITEMS_JSON_PATH, "r", encoding="utf-8") as f:
        master = json.load(f)

    # Build existing lookup for patch and sources preservation
    existing_by_name = {i.get("name"): i for i in master.get("items", [])}
    existing_by_slug = {i.get("slug"): i for i in master.get("items", [])}

    # Aliases for renamed items
    NAME_ALIASES = {
        "Carano's Pledge": ["Carano's Vow"],
        "Broken Spears": ["Rankbreaker"],
        "The Morning Star": ["Dawnning Star"],
        "Soul Scroll": ["Tome of the Reaper"],
        "Ifrit's Claw": ["Devil's Handshake"],
        "Hunter's Knife": ["Kukri"],
        "Elemental Stone": ["Elemental Gem"],
        "Frostguard": ["Frost Guard"],
        "Hercules's Madness": ["Hercules' Madness"],
        "Spear of Longinus": ["Longinus' Spear"],
        "Spooky Mask": ["Spoopy Mask"],
        "Monsters' Bane": ["Monster's Bane"],
        "Curse of Death": ["Curse of Death (Item)"],
        "Bloodthirsty Blade": ["Ancestral Glory"],
    }

    # Patch and sources metadata
    for item in all_items:
        name = item.get("name")
        slug = item.get("slug")

        # Set aliases if applicable
        if name in NAME_ALIASES:
            item["alias"] = NAME_ALIASES[name]

        # Match existing item
        ex = existing_by_name.get(name) or existing_by_slug.get(slug)
        if not ex and name in NAME_ALIASES:
            for old_name in NAME_ALIASES[name]:
                ex = existing_by_name.get(old_name)
                if ex:
                    break

        if ex:
            if "patch" in ex and "patch" not in item:
                item["patch"] = ex["patch"]
            if "sources" in ex and "sources" not in item:
                item["sources"] = ex["sources"]

    # Specific Beta 55 assertions verification
    for item in all_items:
        if item.get("name") == "Stealth Bracer" and "patch" not in item:
            item["patch"] = "Beta 55"
        elif item.get("name") == "Light Shield" and "patch" not in item:
            item["patch"] = "Beta 55"
        elif item.get("name") == "Mail of Pain" and "patch" not in item:
            item["patch"] = "Beta 55 (rework)"

    # Sort items consistently by category, tier, and name
    cat_order = {"attack": 0, "magic": 1, "defense": 2, "movement": 3, "jungle": 4, "support": 5}
    all_items.sort(key=lambda x: (cat_order.get(x.get("category", ""), 99), x.get("tier", 1), x.get("name", "")))

    master["items"] = all_items
    master["count"] = len(all_items)

    with open(ITEMS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(master, f, indent=2, ensure_ascii=False)

    print(f"\nSuccessfully wrote {len(all_items)} validated items to {ITEMS_JSON_PATH}!")
    return True


if __name__ == "__main__":
    merge_extracted_items()
