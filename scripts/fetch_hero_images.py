"""Fetch hero splash-art URLs from the Arena of Valor Fandom wiki.

Writes ``web/hero_images.json`` mapping hero name -> image URL. Only links are
stored (no image files are downloaded). Heroes without an image are reported
and the UI falls back to a monogram.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.scrape_heroes import HEADERS, NAME_MAPPING_TO_FANDOM  # noqa: E402

API_URL = "https://arenaofvalor.fandom.com/api.php"
HEROES_JSON = REPO_ROOT / "data" / "heroes_130_full.json"
OUT_PATH = REPO_ROOT / "web" / "hero_images.json"
BATCH = 40
THUMB_WIDTH = 256


def fetch_batch(titles: list[str]) -> dict[str, str]:
    params = {
        "action": "query",
        "titles": "|".join(titles),
        "prop": "pageimages",
        "piprop": "thumbnail",
        "pithumbsize": THUMB_WIDTH,
        "redirects": 1,
        "format": "json",
    }
    resp = requests.get(API_URL, params=params, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    query = resp.json().get("query", {})

    # Map redirected/normalized titles back to the requested titles.
    alias: dict[str, str] = {}
    for key in ("normalized", "redirects"):
        for item in query.get(key, []):
            alias[item["to"]] = alias.get(item["from"], item["from"])

    found: dict[str, str] = {}
    for page in query.get("pages", {}).values():
        thumb = page.get("thumbnail", {}).get("source")
        if thumb:
            title = page["title"]
            found[alias.get(title, title)] = thumb
    return found


def main() -> None:
    raw = json.loads(HEROES_JSON.read_text(encoding="utf-8"))
    heroes = raw if isinstance(raw, list) else raw.get("heroes", [])
    names = [h["name"] for h in heroes]

    titles = {name: NAME_MAPPING_TO_FANDOM.get(name, name) for name in names}
    unique_titles = sorted(set(titles.values()))

    by_title: dict[str, str] = {}
    for i in range(0, len(unique_titles), BATCH):
        by_title.update(fetch_batch(unique_titles[i : i + BATCH]))

    images = {name: by_title[t] for name, t in titles.items() if t in by_title}
    missing = [name for name in names if name not in images]

    OUT_PATH.write_text(json.dumps(images, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Heroes: {len(names)} | with image: {len(images)} | missing: {len(missing)}")
    if missing:
        print("Missing:", ", ".join(missing))
    print(f"Saved: {OUT_PATH}")


if __name__ == "__main__":
    main()
