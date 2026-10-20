import json
from pathlib import Path

import numpy as np
from PIL import Image

item_dir = Path("item")

# Tab y-ranges on a 1640 height image (approx):
# Attack: 430 - 520
# Magic: 580 - 670
# Defense: 730 - 820
# Movement: 880 - 970
# Jungle: 1030 - 1120
# Support: 1180 - 1270

TABS = [
    ("attack", (430, 520)),
    ("magic", (580, 670)),
    ("defense", (730, 820)),
    ("movement", (880, 970)),
    ("jungle", (1030, 1120)),
    ("support", (1180, 1270)),
]

item_categories = {}

for folder in sorted(item_dir.iterdir()):
    if not folder.is_dir():
        continue
    img_path = sorted(folder.glob("*.jpg"))[0]
    im = Image.open(img_path).convert("L")  # grayscale
    w, h = im.size
    # Sidebar x range is [0.03, 0.12] * width
    x1, x2 = int(w * 0.03), int(w * 0.12)

    best_cat = None
    max_brightness = -1

    for cat_name, (y1_ref, y2_ref) in TABS:
        y1 = int(h * (y1_ref / 1640))
        y2 = int(h * (y2_ref / 1640))
        crop = im.crop((x1, y1, x2, y2))
        arr = np.array(crop)
        # The active tab has bright white text (pixels > 180) and higher mean brightness
        bright_pixels = np.sum(arr > 180)
        mean_b = np.mean(arr)
        score = bright_pixels + mean_b * 2
        if score > max_brightness:
            max_brightness = score
            best_cat = cat_name

    item_categories[folder.name] = best_cat

print(f"Total classified items: {len(item_categories)}")
counts = {}
for k, v in item_categories.items():
    counts[v] = counts.get(v, 0) + 1
print("Counts by category:", counts)

with open("scripts/item_categories.json", "w", encoding="utf-8") as f:
    json.dump(item_categories, f, indent=2, ensure_ascii=False)
