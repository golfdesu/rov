"""Fetch skill icons and Thai descriptions from rovmeta.com and Liquipedia.

Downloads skill icon images into frontend/public/skills/<hero>/ and updates
data/hero_skills_full.json with local icon_url paths and desc_th.
"""

from __future__ import annotations

import io
import json
import re
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_JSON = REPO_ROOT / "data" / "hero_skills_full.json"
PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
SKILLS_DIR = PUBLIC_DIR / "skills"
DIST_SKILLS_DIR = REPO_ROOT / "frontend" / "dist" / "skills"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Encoding": "gzip",
}

ROVMETA_SLUGS: dict[str, str] = {
    "Arthur": "arthur",
    "Brunhilda": "celica",
    "Richter": "riktor",
    "Bolt Baron": "bolt-baron",
}

LIQUIPEDIA_SKILLS: dict[str, list[tuple[str, str]]] = {
    "Evita": [
        ("Conversion Ritual", "https://liquipedia.net/commons/images/6/67/Evita_Conversion_Ritual.png"),
        ("Essence Devourer's Rage", "https://liquipedia.net/commons/images/6/66/Evita_Essence_Devourer%27s_Rage.png"),
        ("Hand of Mastery", "https://liquipedia.net/commons/images/e/ed/Evita_Hand_of_Mastery.png"),
        ("Umbral Detonation", "https://liquipedia.net/commons/images/4/45/Evita_Umbral_Detonation.png"),
    ],
    "Tamyn": [
        ("Scorching Light", "https://liquipedia.net/commons/images/7/7a/Tamyn_Scorching_Light.png"),
        ("Shadow Devourer", "https://liquipedia.net/commons/images/e/ee/Tamyn_Shadow_Devourer.png"),
        ("Spear Strike", "https://liquipedia.net/commons/images/d/dc/Tamyn_Spear_Strike.png"),
        ("Thrust of Judgment", "https://liquipedia.net/commons/images/3/37/Tamyn_Thrust_of_Judgment.png"),
    ],
    "Flowborn (Mage)": [
        ("Flow Formation", "https://liquipedia.net/commons/images/5/52/Flowborn_%28Mage%29_Flow_Formation.png"),
        ("Flow of the World", "https://liquipedia.net/commons/images/7/77/Flowborn_%28Mage%29_Flow_of_the_World.png"),
        ("Arcane Arts", "https://liquipedia.net/commons/images/e/e2/Flowborn_%28Mage%29_Arcane_Arts.png"),
        ("Stellar Flare", "https://liquipedia.net/commons/images/2/27/Flowborn_%28Mage%29_Stellar_Flare_2.png"),
    ],
    "Flowborn (Marksman)": [
        ("Flow Formation", "https://liquipedia.net/commons/images/5/52/Flowborn_%28Mage%29_Flow_Formation.png"),
        ("Arrowstorm", "https://liquipedia.net/commons/images/f/f6/Flowborn_%28Marksman%29_Arrowstorm.png"),
        (
            "Arrow of No Retreat",
            "https://liquipedia.net/commons/images/1/1a/Flowborn_%28Marksman%29_Arrow_of_No_Retreat.png",
        ),
        ("Stellar Flare", "https://liquipedia.net/commons/images/2/27/Flowborn_%28Mage%29_Stellar_Flare_2.png"),
    ],
}


def to_slug(name: str) -> str:
    if name in ROVMETA_SLUGS:
        return ROVMETA_SLUGS[name]
    return name.lower().replace("'", "-").replace(" ", "-").replace("(", "").replace(")", "")


def clean_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def safe_dirname(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "", name.replace("'", "_").replace(" ", "_").replace("(", "_").replace(")", "_"))


def fetch_rovmeta_hero(hero_name: str) -> list[dict]:
    slug = to_slug(hero_name)
    url = f"https://rovmeta.com/heroes/{slug}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=12)
        if resp.status_code != 200:
            return []
        idx = resp.text.find('id="abilities"')
        if idx == -1:
            return []
        sec = resp.text[idx : idx + 25000]
        end_idx = sec.find("</section>")
        if end_idx != -1:
            sec = sec[:end_idx]

        cards = re.findall(r'<div class="rounded-lg p-5"[^>]*>(.*?)</div>\s*</div>', sec, re.DOTALL)
        skills = []
        for card in cards:
            slot_m = re.search(r">(PASSIVE|SKILL \d|ULTIMATE)</div>", card)
            name_m = re.search(r"<h3[^>]*>([^<]+)</h3>", card)
            img_m = re.search(r'<img src="(https://[^"]+)"', card)
            desc_m = re.search(r'<p class="mt-4[^"]*"[^>]*>(.*?)</p>', card)

            if slot_m and name_m:
                slot_txt = slot_m.group(1).title()
                sname = name_m.group(1).strip()
                img = img_m.group(1) if img_m else None
                desc = desc_m.group(1).strip() if desc_m else ""

                wikia_m = re.search(r"\((https://static\.wikia\.nocookie\.net[^\)]+)\)", sname)
                if wikia_m:
                    img = wikia_m.group(1)
                    sname = re.sub(r"\[\]\(https:[^\)]+\)", "", sname).strip()

                skills.append(
                    {
                        "slot": slot_txt,
                        "name": sname,
                        "icon_url": img,
                        "desc_th": desc,
                    }
                )
        return skills
    except Exception:
        return []


def download_icon(url: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 1000:
        return True
    headers = dict(HEADERS)
    if "wikia" in url or "fandom" in url:
        headers["Referer"] = "https://strikeofkings.fandom.com/"
    elif "liquipedia" in url:
        headers["User-Agent"] = "RoVDraftResearch/1.0 (personal non-commercial project)"
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        im = Image.open(io.BytesIO(resp.content)).convert("RGBA")
        im = im.resize((80, 80), Image.Resampling.LANCZOS)
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, "PNG", optimize=True)
        return True
    except Exception as e:
        print(f"  [Error] download {url} -> {dest}: {e}")
        return False


def main():
    catalog_data = json.loads(SKILLS_JSON.read_text(encoding="utf-8"))
    heroes_dict: dict[str, list[dict]] = catalog_data.get("heroes", {})
    print(f"Loaded {len(heroes_dict)} heroes from {SKILLS_JSON}")

    SKILLS_DIR.mkdir(parents=True, exist_ok=True)

    print("Fetching abilities from rovmeta.com...")
    rovmeta_results: dict[str, list[dict]] = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        future_to_hero = {ex.submit(fetch_rovmeta_hero, h): h for h in heroes_dict}
        for future in as_completed(future_to_hero):
            hero = future_to_hero[future]
            try:
                res = future.result()
                if res:
                    rovmeta_results[hero] = res
            except Exception as e:
                print(f"Error scraping {hero}: {e}")

    print(f"Retrieved abilities from rovmeta for {len(rovmeta_results)}/{len(heroes_dict)} heroes")

    download_tasks = []
    total_skills = 0
    matched_icons = 0

    for hero_name, skills in heroes_dict.items():
        h_dir = safe_dirname(hero_name)
        rov_skills = rovmeta_results.get(hero_name, [])
        lq_skills = LIQUIPEDIA_SKILLS.get(hero_name, [])

        for idx, skill in enumerate(skills):
            total_skills += 1
            sname = skill["name"]
            slot = skill["slot"]
            sname_clean = clean_name(sname)

            icon_url = None
            desc_th = None

            for lq_name, lq_url in lq_skills:
                if clean_name(lq_name) in sname_clean or sname_clean in clean_name(lq_name):
                    icon_url = lq_url
                    break
            if not icon_url and lq_skills and idx < len(lq_skills):
                icon_url = lq_skills[idx][1]

            if not icon_url:
                for rs in rov_skills:
                    rs_clean = clean_name(rs["name"])
                    if rs_clean and (rs_clean == sname_clean or rs_clean in sname_clean or sname_clean in rs_clean):
                        icon_url = rs.get("icon_url")
                        desc_th = rs.get("desc_th")
                        break

            if not icon_url:
                for rs in rov_skills:
                    if rs["slot"] == slot:
                        icon_url = rs.get("icon_url")
                        if not desc_th:
                            desc_th = rs.get("desc_th")
                        break

            if not icon_url and idx < len(rov_skills):
                icon_url = rov_skills[idx].get("icon_url")
                if not desc_th:
                    desc_th = rov_skills[idx].get("desc_th")

            dest_filename = f"{idx}_{clean_name(sname)[:16]}.png"
            dest_file = SKILLS_DIR / h_dir / dest_filename
            local_rel_url = f"/skills/{h_dir}/{dest_filename}"

            skill["icon_url"] = local_rel_url
            if desc_th and len(desc_th) > 5:
                skill["desc_th"] = desc_th

            if icon_url:
                matched_icons += 1
                download_tasks.append((icon_url, dest_file))

    print(f"Matched {matched_icons}/{total_skills} skills with image URLs")
    print(f"Downloading/verifying {len(download_tasks)} skill icon images...")

    success_downloads = 0
    with ThreadPoolExecutor(max_workers=12) as ex:
        futures = [ex.submit(download_icon, url, dest) for url, dest in download_tasks]
        for f in as_completed(futures):
            if f.result():
                success_downloads += 1

    print(f"Successfully verified/saved {success_downloads} skill icons to {SKILLS_DIR}")

    if DIST_SKILLS_DIR.parent.exists():
        if DIST_SKILLS_DIR.exists():
            shutil.rmtree(DIST_SKILLS_DIR)
        shutil.copytree(SKILLS_DIR, DIST_SKILLS_DIR)
        print(f"Synced skill icons to {DIST_SKILLS_DIR}")

    SKILLS_JSON.write_text(json.dumps(catalog_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Updated {SKILLS_JSON} with icon URLs and Thai descriptions!")


if __name__ == "__main__":
    main()
