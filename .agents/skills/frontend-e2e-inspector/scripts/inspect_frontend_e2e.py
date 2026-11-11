#!/usr/bin/env python3
"""RoV Frontend E2E & Asset Health Auditor.

Verifies production bundle integrity, static file mounts, hero portraits,
and in-game card media endpoints.

Usage:
    python .agents/skills/frontend-e2e-inspector/scripts/inspect_frontend_e2e.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from src.api import app  # noqa: E402

client = TestClient(app)


def audit_bundle_integrity() -> None:
    print("[1/4] Auditing Frontend Production Bundle (frontend/dist/)...")
    dist_dir = REPO_ROOT / "frontend" / "dist"
    assert dist_dir.is_dir(), f"frontend/dist/ directory not found at {dist_dir}. Run 'npm run build' first."

    index_html = dist_dir / "index.html"
    assert index_html.is_file(), f"index.html missing at {index_html}"
    html_text = index_html.read_text(encoding="utf-8")
    assert '<div id="root">' in html_text, "index.html missing root container '<div id=\"root\">'"
    assert '<script type="module"' in html_text, "index.html missing module script bundle reference"

    assets_dir = dist_dir / "assets"
    assert assets_dir.is_dir(), f"assets directory missing at {assets_dir}"
    js_chunks = list(assets_dir.glob("*.js"))
    css_chunks = list(assets_dir.glob("*.css"))
    assert len(js_chunks) > 0, "No compiled JS bundle chunks found in dist/assets/"
    assert len(css_chunks) > 0, "No compiled CSS bundle chunks found in dist/assets/"

    # Test HTTP serving of root
    r_root = client.get("/")
    assert r_root.status_code == 200
    assert '<div id="root">' in r_root.text
    print(f"      -> Production bundle verified ({len(js_chunks)} JS, {len(css_chunks)} CSS chunks).")


def audit_hero_avatars() -> None:
    print("[2/4] Auditing 130 Hero Avatars Delivery...")
    hero_images_json = REPO_ROOT / "frontend" / "public" / "hero_images.json"
    assert hero_images_json.is_file(), f"hero_images.json missing at {hero_images_json}"

    images_map: dict[str, str] = json.loads(hero_images_json.read_text(encoding="utf-8"))
    assert len(images_map) >= 130, f"Expected >= 130 heroes in images map, got {len(images_map)}"

    sample_heroes = ["Valhein", "Toro", "Liliana", "Florentino", "Mortos", "Celica", "Riktor", "Evita", "Tamyn"]
    for hero in sample_heroes:
        avatar_rel = images_map.get(hero)
        assert avatar_rel, f"Avatar mapping missing for {hero}"
        res = client.get(avatar_rel)
        assert res.status_code == 200, f"Avatar for {hero} at {avatar_rel} returned {res.status_code}"

    print(f"      -> Verified {len(images_map)} avatar mappings and HTTP delivery.")


def audit_hero_skill_media() -> None:
    print("[3/4] Auditing Hero Skill & Status Screenshot Endpoints...")
    test_heroes = ["Liliana", "Yena", "Capheny", "Valhein", "Mortos"]
    for hero in test_heroes:
        res = client.get(f"/combat/hero-screenshots/{hero}")
        assert res.status_code == 200, f"Hero screenshots endpoint failed for {hero}"
        data = res.json()
        assert len(data["skill_screenshots"]) >= 4, f"Insufficient skills for {hero}"
        assert len(data["status_screenshots"]) >= 2, f"Insufficient status for {hero}"

        # Verify first skill and status image HTTP 200
        r_skill = client.get(data["skill_screenshots"][0])
        assert r_skill.status_code == 200, f"Skill image {data['skill_screenshots'][0]} returned {r_skill.status_code}"
        r_status = client.get(data["status_screenshots"][0])
        assert r_status.status_code == 200, (
            f"Status image {data['status_screenshots'][0]} returned {r_status.status_code}"
        )

    print("      -> Hero skill/status media serving verified across sample archetypes.")


def audit_item_card_media() -> None:
    print("[4/4] Auditing Item Card Screenshot Endpoints...")
    test_items = [
        ("Amulet of Longevity", 1),
        ("Aquaflame - Accelerate", 4),
        ("Earth Gem", 3),
        ("Troy's Medallion", 1),
        ("Fafnir", 1),
    ]
    for item_query, expected_pages in test_items:
        res = client.get(f"/combat/item-screenshots/{item_query}")
        assert res.status_code == 200, f"Item screenshots failed for {item_query}"
        data = res.json()
        assert len(data["screenshots"]) == expected_pages, (
            f"Expected {expected_pages} pages for {item_query}, got {len(data['screenshots'])}"
        )
        # Verify first image serves 200
        r_img = client.get(data["screenshots"][0])
        assert r_img.status_code == 200, f"Item card image {data['screenshots'][0]} returned {r_img.status_code}"

    print("      -> Item card media serving verified across single-card and multi-page items.")


def main() -> None:
    print("=" * 72)
    print("RoV Frontend E2E & Asset Health Auditor")
    print("=" * 72)
    audit_bundle_integrity()
    audit_hero_avatars()
    audit_hero_skill_media()
    audit_item_card_media()
    print("=" * 72)
    print("[PASS] Frontend E2E assets and static endpoints verified healthy.")
    print("=" * 72)


if __name__ == "__main__":
    main()
