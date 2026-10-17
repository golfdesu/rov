"""Download square hero icons for the web UI.

Primary source is the Garena TH icon set referenced by https://rovmeta.com/heroes
(parsed from the page's embedded hero JSON). A few heroes are overridden with
Liquipedia Commons icons where the Garena file is blocked or outdated.

Writes 160x160 JPEGs to ``frontend/public/avatars/`` and the name -> path map to
``frontend/public/hero_images.json``.

Usage:
    python scripts/fetch_hero_icons.py            # download missing icons only
    python scripts/fetch_hero_icons.py --force    # re-download everything
"""

from __future__ import annotations

import argparse
import io
import json
import re
import time
from pathlib import Path

import requests
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
HEROES_JSON = REPO_ROOT / "data" / "heroes_130_full.json"
PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
AVATAR_DIR = PUBLIC_DIR / "avatars"
OUT_PATH = PUBLIC_DIR / "hero_images.json"

ROVMETA_URL = "https://rovmeta.com/heroes"
LIQUIPEDIA_API = "https://liquipedia.net/commons/api.php"
HEADERS = {"User-Agent": "RoVDraftResearch/1.0 (personal project)", "Accept-Encoding": "gzip"}
ICON_SIZE = 160

# rovmeta lists Thai server names separately; their icons are the current TH art
ROVMETA_ALIASES = {
    "Arthur": "Mortos",
    "Brunhilda": "Celica",
    "Flowborn (Mage)": "Flowborn",
    "Flowborn (Marksman)": "Flowborn",
}

# Garena file is 403 (Evita) or outdated / not an icon (Tamyn, reworked Azzen'Ka)
LIQUIPEDIA_OVERRIDES = {
    "Evita": "File:Evita Hero Icon.jpg",
    "Tamyn": "File:Tamyn Hero Icon.jpg",
    "Azzen'Ka": "File:Azzen'Ka Hero Icon 2025.jpg",
}


def safe_filename(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "", name.replace("'", "_").replace(" ", "_")) + ".jpg"


def fetch_rovmeta_icons() -> dict[str, str]:
    html = requests.get(ROVMETA_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=30).text.replace('\\"', '"')
    icons: dict[str, str] = {}
    for m in re.finditer(r'"name_en":"([^"]+)"[^{}]{0,300}?"icon_url":"(https://[^"]+)"', html):
        icons.setdefault(m.group(1), m.group(2))
    return icons


def resolve_liquipedia_urls(titles: list[str]) -> dict[str, str]:
    params = {"action": "query", "titles": "|".join(titles), "prop": "imageinfo", "iiprop": "url", "format": "json"}
    query = requests.get(LIQUIPEDIA_API, params=params, headers=HEADERS, timeout=30).json()["query"]
    norm = {n["to"]: n["from"] for n in query.get("normalized", [])}
    return {
        norm.get(p["title"], p["title"]): p["imageinfo"][0]["url"] for p in query["pages"].values() if "imageinfo" in p
    }


def save_square_icon(content: bytes, dest: Path) -> None:
    im = Image.open(io.BytesIO(content)).convert("RGB")
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 4 if h > w else (h - side) // 2  # keep faces in tall art
    im = im.crop((left, top, left + side, top + side)).resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    im.save(dest, "JPEG", quality=88)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="Re-download icons that already exist")
    args = parser.parse_args()

    raw = json.loads(HEROES_JSON.read_text(encoding="utf-8"))
    names = [h["name"] for h in (raw if isinstance(raw, list) else raw.get("heroes", []))]

    rovmeta = fetch_rovmeta_icons()
    lq_urls = resolve_liquipedia_urls(list(LIQUIPEDIA_OVERRIDES.values()))

    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    mapping: dict[str, str] = {}
    missing: list[str] = []
    for name in names:
        filename = safe_filename(name)
        dest = AVATAR_DIR / filename
        if name in LIQUIPEDIA_OVERRIDES:
            url = lq_urls.get(LIQUIPEDIA_OVERRIDES[name])
        else:
            url = rovmeta.get(ROVMETA_ALIASES.get(name, name)) or rovmeta.get(name)

        if dest.exists() and not args.force:
            mapping[name] = f"/avatars/{filename}"
            continue
        if not url:
            missing.append(name)
            continue
        try:
            resp = requests.get(url, headers=HEADERS, timeout=20)
            resp.raise_for_status()
            save_square_icon(resp.content, dest)
            mapping[name] = f"/avatars/{filename}"
        except (requests.RequestException, OSError) as exc:
            print(f"Failed {name}: {exc}")
            missing.append(name)
        time.sleep(0.15)

    OUT_PATH.write_text(json.dumps(dict(sorted(mapping.items())), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Heroes: {len(names)} | with icon: {len(mapping)} | missing: {len(missing)}")
    if missing:
        print("Missing (UI falls back to a monogram):", ", ".join(missing))
    print(f"Saved: {OUT_PATH}")


if __name__ == "__main__":
    main()
