"""Fetch and bundle all 114 RoV item icons locally into frontend/public/items/.

- 104 icons are downloaded from https://rovmeta.com/items/
- 10 icons (Beta 55 / rework items missing from rovmeta) are cropped from high-res
  in-game equipment screenshots in item/
- Updates data/items.json so every item points to /items/<slug>.png

Usage:
    python scripts/fetch_item_icons.py
"""

from __future__ import annotations

import glob
import json
import urllib.request
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
ITEMS_JSON = REPO_ROOT / "data" / "items.json"
OUT_DIR = REPO_ROOT / "frontend" / "public" / "items"

CROPPED_ITEMS: dict[str, dict] = {
    "bloodthirsty-blade": {
        "folder": "Bloodthirsty Blade",
        "file": "LINE_ALBUM_Item_261019_149.jpg",
        "box": (996, 1056, 1130, 1190),
    },
    "ifrits-claw": {
        "folder": "Ifrit's Claw",
        "file": "LINE_ALBUM_Item_261019_132.jpg",
        "box": (1448, 1051, 1582, 1185),
    },
    "stealth-bracer": {
        "folder": "Stealth Bracer",
        "file": "LINE_ALBUM_Item_261019_128.jpg",
        "box": (1448, 1438, 1582, 1572),
    },
    "soul-scroll": {
        "folder": "Soul Scroll",
        "file": "LINE_ALBUM_Item_261019_112.jpg",
        "box": (997, 1056, 1131, 1190),
    },
    "light-shield": {
        "folder": "Light Shield",
        "file": "LINE_ALBUM_Item_261019_75.jpg",
        "box": (1448, 1438, 1582, 1572),
    },
    "hunters-knife": {
        "folder": "Hunter's Knife",
        "file": "LINE_ALBUM_Item_261019_66.jpg",
        "box": (546, 417, 680, 551),
    },
    "aquaflame-accelerate": {
        "folder": "Aquaflame - Accelerate",
        "file": "LINE_ALBUM_Item_261019_8.jpg",
        "box": (1448, 799, 1582, 933),
    },
    "aquaflame-rejuvenate": {
        "folder": "Aquaflame - Rejuvenate",
        "file": "LINE_ALBUM_Item_261019_1.jpg",
        "box": (1448, 1182, 1582, 1316),
    },
    "mother-earth-accelerate": {
        "folder": "Mother Earth - Accelerate",
        "file": "LINE_ALBUM_Item_261019_26.jpg",
        "box": (1448, 799, 1582, 933),
    },
    "mother-earth-rejuvenate": {
        "folder": "Mother Earth - Rejuvenate",
        "file": "LINE_ALBUM_Item_261019_19.jpg",
        "box": (1448, 1182, 1582, 1316),
    },
}

ROVMETA_SLUG_MAP = {
    "magic-ring": "magic-ring.jpg",
    "spear-of-longinus": "longinus-spear.png",
    "the-morning-star": "dawnning-star.png",
    "spooky-mask": "spoopy-mask.png",
    "frostguard": "frost-guard.png",
    "caranos-pledge": "caranos-vow.jpg",
    "broken-spears": "rankbreaker.png",
    "shuriken": "kukri.png",
    "devils-handshake": "devils-handshake.png",
    "curse-of-death": "tome-of-the-reaper.png",
    "stormy-bow": "whispering-wind.png",
    "firestorm-bow": "scorching-wind.png",
    "elemental-stone": "elemental-gem.png",
    "hercules-madness": "hercules-madness.png",
    "frostys-revenge": "frostys-revenge.png",
    "mage-robe": "mage-robe.jpg",
    "orrery": "orrery.jpg",
}


def build_item_icons() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(ITEMS_JSON, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    items = catalog["items"]
    print(f"Bundling icons for {len(items)} items...")

    # 1. Process cropped items
    for slug, info in CROPPED_ITEMS.items():
        src_path = REPO_ROOT / "item" / info["folder"] / info["file"]
        if not src_path.exists():
            matches = glob.glob(str(REPO_ROOT / "item" / f"*{info['folder']}*" / "*.jpg"))
            if matches:
                src_path = Path(matches[0])
            else:
                raise FileNotFoundError(f"Source screenshot not found for {slug} at {src_path}")

        im = Image.open(src_path)
        icon = im.crop(info["box"]).resize((100, 100), Image.Resampling.LANCZOS)
        out_file = OUT_DIR / f"{slug}.png"
        icon.save(out_file, format="PNG")
        print(f"  [CROPPED] {slug} -> {out_file.name}")

    # 2. Process rovmeta downloaded items
    for item in items:
        slug = item["slug"]
        if slug in CROPPED_ITEMS:
            continue
        out_file = OUT_DIR / f"{slug}.png"
        if out_file.exists():
            continue

        target = ROVMETA_SLUG_MAP.get(slug, f"{slug}.png")
        url = f"https://rovmeta.com/items/{target}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()

        # Load with PIL to ensure it is valid and save as standard 100x100 PNG
        tmp_img = Image.open(urllib.request.io.BytesIO(data))
        if tmp_img.size != (100, 100):
            tmp_img = tmp_img.resize((100, 100), Image.Resampling.LANCZOS)
        tmp_img.save(out_file, format="PNG")
        print(f"  [ROVMETA] {slug} -> {out_file.name}")

    # 3. Update data/items.json icon_url paths
    for item in items:
        slug = item["slug"]
        item["icon_url"] = f"/items/{slug}.png"

    with open(ITEMS_JSON, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Updated {ITEMS_JSON} with local /items/<slug>.png paths.")

    # 4. Final verification
    missing = []
    for item in items:
        p = OUT_DIR / f"{item['slug']}.png"
        if not p.exists():
            missing.append(item["name"])

    if missing:
        raise RuntimeError(f"Missing {len(missing)} item icons: {missing}")

    print(f"Successfully verified all {len(items)} item icons exist in {OUT_DIR}")


if __name__ == "__main__":
    build_item_icons()
