import json
import re
from pathlib import Path

item_dir = Path("item")
crop_dir = Path("scripts/item_crops")

folders = sorted([d.name for d in item_dir.iterdir() if d.is_dir()])
print(f"Total item folders: {len(folders)}")

with open("data/items.json", "r", encoding="utf-8") as f:
    existing_items = {i["name"]: i for i in json.load(f)["items"]}

# Divide 114 into 6 groups of 19
groups = []
num_groups = 6
group_size = (len(folders) + num_groups - 1) // num_groups

for g_idx in range(num_groups):
    start = g_idx * group_size
    end = min(start + group_size, len(folders))
    group_folders = folders[start:end]

    items_meta = []
    for f in group_folders:
        safe_name = re.sub(r"[^\w\s-]", "", f).strip().replace(" ", "_")
        crops = sorted([str(p) for p in crop_dir.glob(f"{safe_name}_*.png")])

        # Find in existing_items by direct name or alias
        ex = existing_items.get(f)
        items_meta.append({"name": f, "crops": crops, "existing": ex})
    groups.append(items_meta)
    print(f"Group {g_idx + 1}: {len(items_meta)} items ({group_folders[0]} ... {group_folders[-1]})")

with open("scripts/item_groups.json", "w", encoding="utf-8") as f:
    json.dump(groups, f, indent=2, ensure_ascii=False)
