"""Builds high-accuracy broadcast card templates for RoV heroes from verified pro draft screenshots.

Harvests vertical card crops from ground-truth pro draft screenshots in data/draft_screenshots/
across all supported leagues (AOG, APL, RPL, GCS) and saves reference templates into
data/broadcast_templates/.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image

from scripts.process_draft_screenshots import LEAGUE_LAYOUTS, TARGET_SIZE

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TEMPLATES_DIR = DATA_DIR / "broadcast_templates"
TRUE_ORDER_PATH = DATA_DIR / "true_pick_order.json"
HEROES_PATH = DATA_DIR / "heroes_130_full.json"
HERO_IMAGES_PATH = Path(__file__).resolve().parent.parent / "frontend" / "public" / "hero_images.json"


def detect_league_from_path(shot_rel: str) -> str | None:
    s = shot_rel.lower()
    for lg in ("aog", "apl", "rpl", "gcs"):
        if lg in s:
            return lg
    return None


def build_templates():
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

    with open(TRUE_ORDER_PATH, "r", encoding="utf-8") as f:
        tpo = json.load(f)

    with open(HEROES_PATH, "r", encoding="utf-8") as f:
        heroes_data = json.load(f)
    if isinstance(heroes_data, list):
        all_heroes = sorted(h["name"] for h in heroes_data)
    else:
        all_heroes = sorted(heroes_data.keys())

    with open(HERO_IMAGES_PATH, "r", encoding="utf-8") as f:
        hero_images = json.load(f)

    hero_crops = {h: [] for h in all_heroes}

    # Harvest from verified broadcast screenshots across all leagues
    harvested_games = 0
    for g in tpo["games"]:
        shot_rel = g.get("screenshot")
        if not shot_rel:
            continue
        lg = detect_league_from_path(shot_rel)
        if not lg or lg not in LEAGUE_LAYOUTS:
            continue
        shot_path = DATA_DIR / "draft_screenshots" / shot_rel
        if not shot_path.exists():
            continue

        layout = LEAGUE_LAYOUTS[lg]
        blue_xs = layout["blue_xs"]
        red_xs = layout["red_xs"]
        y_top = layout["y_top"]
        y_bottom = layout["y_bottom"]
        card_w = layout["card_w"]

        try:
            im = Image.open(shot_path)
            W, H = im.size
            if W < 500 or H < 100:
                continue

            # Blue picks (B1..B5)
            for slot_idx, h_name in enumerate(g.get("blue_picks", [])):
                if h_name in hero_crops and slot_idx < len(blue_xs):
                    x = blue_xs[slot_idx]
                    crop = im.crop((int(W * x), int(H * y_top), int(W * (x + card_w)), int(H * y_bottom)))
                    crop_resized = crop.convert("RGB").resize(TARGET_SIZE, Image.Resampling.LANCZOS)
                    hero_crops[h_name].append(np.array(crop_resized, dtype=np.float32))

            # Red picks (R1..R5)
            for slot_idx, h_name in enumerate(g.get("red_picks", [])):
                if h_name in hero_crops and slot_idx < len(red_xs):
                    x = red_xs[slot_idx]
                    crop = im.crop((int(W * x), int(H * y_top), int(W * (x + card_w)), int(H * y_bottom)))
                    crop_resized = crop.convert("RGB").resize(TARGET_SIZE, Image.Resampling.LANCZOS)
                    hero_crops[h_name].append(np.array(crop_resized, dtype=np.float32))

            harvested_games += 1
        except Exception:
            continue

    # Flowborn (Marksman) and Flowborn (Mage) share the exact same broadcast portrait
    if len(hero_crops.get("Flowborn (Mage)", [])) < 3 and len(hero_crops.get("Flowborn (Marksman)", [])) >= 3:
        hero_crops["Flowborn (Mage)"] = list(hero_crops["Flowborn (Marksman)"])

    print(f"Scanned {harvested_games} broadcast screenshots across all leagues.")

    # Save representative template for each hero
    manifest = {}
    harvested_count = 0
    fallback_count = 0

    for h_name in all_heroes:
        crops = hero_crops[h_name]
        out_path = TEMPLATES_DIR / f"{h_name}.png"

        if len(crops) >= 3:
            # Use median array to eliminate single-game animation glints or borders
            median_crop = np.median(np.stack(crops, axis=0), axis=0).astype(np.uint8)
            img = Image.fromarray(median_crop)
            img.save(out_path)
            manifest[h_name] = {"source": "broadcast_median", "sample_count": len(crops)}
            harvested_count += 1
        elif len(crops) >= 1:
            img = Image.fromarray(crops[0].astype(np.uint8))
            img.save(out_path)
            manifest[h_name] = {"source": "broadcast_single", "sample_count": len(crops)}
            harvested_count += 1
        else:
            # Fallback to avatar
            rel_avatar = hero_images.get(h_name, "").lstrip("/")
            avatar_path = Path(__file__).resolve().parent.parent / "frontend" / "public" / rel_avatar
            if avatar_path.exists():
                av_img = Image.open(avatar_path).convert("RGB").resize(TARGET_SIZE, Image.Resampling.LANCZOS)
                av_img.save(out_path)
                manifest[h_name] = {"source": "avatar_fallback", "sample_count": 0}
            else:
                blank = Image.new("RGB", TARGET_SIZE, (128, 128, 128))
                blank.save(out_path)
                manifest[h_name] = {"source": "blank_fallback", "sample_count": 0}
            fallback_count += 1

    manifest_path = TEMPLATES_DIR / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(
        f"Done! Created {len(all_heroes)} templates ({harvested_count} harvested from broadcast, {fallback_count} fallbacks)."
    )


if __name__ == "__main__":
    build_templates()
