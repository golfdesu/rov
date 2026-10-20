import os
import shutil
from pathlib import Path

from PIL import Image, ImageDraw


def crop_enchantments():
    src_dir = Path("frontend/public/enchantments")
    dist_dir = Path("frontend/dist/enchantments")

    files = sorted([f for f in os.listdir(src_dir) if f.endswith(".png")])
    print(f"Found {len(files)} enchantment icons in {src_dir}")

    cx, cy, r = 83, 97, 72
    box = (cx - r, cy - r, cx + r, cy + r)  # (11, 25, 155, 169) -> 144x144
    w, h = 2 * r, 2 * r

    # 4x Supersampled anti-aliased mask
    scale = 4
    mask_hi = Image.new("L", (w * scale, h * scale), 0)
    draw = ImageDraw.Draw(mask_hi)
    draw.ellipse((0, 0, w * scale - 1, h * scale - 1), fill=255)
    mask = mask_hi.resize((w, h), Image.Resampling.LANCZOS)

    for f in files:
        file_path = src_dir / f
        im = Image.open(file_path)
        crop = im.crop(box).convert("RGBA")
        crop.putalpha(mask)
        crop.save(file_path, "PNG", optimize=True)
        print(f"  [OK] Cropped & masked: {f} -> {w}x{h} RGBA")

    if dist_dir.exists():
        for f in files:
            shutil.copy2(src_dir / f, dist_dir / f)
        print(f"Synced {len(files)} icons to {dist_dir}")


if __name__ == "__main__":
    crop_enchantments()
