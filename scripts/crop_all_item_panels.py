import re
from pathlib import Path

from PIL import Image

item_dir = Path("item")
out_dir = Path("scripts/item_crops")
out_dir.mkdir(parents=True, exist_ok=True)

count = 0
for folder in sorted(item_dir.iterdir()):
    if not folder.is_dir():
        continue
    images = sorted(folder.glob("*.jpg"))
    for idx, img_path in enumerate(images):
        im = Image.open(img_path)
        w, h = im.size
        # Right panel crop: title, stats, passives, flavor text
        box = (int(w * 0.77), int(h * 0.18), int(w * 0.99), int(h * 0.92))
        panel = im.crop(box)
        safe_name = re.sub(r"[^\w\s-]", "", folder.name).strip().replace(" ", "_")
        panel.save(out_dir / f"{safe_name}_{idx}.png")
        count += 1

print(f"Successfully cropped {count} item panels into {out_dir}")
