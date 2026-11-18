#!/usr/bin/env python3
"""Automated Dataset Metadata & Documentation Synchronizer.

Acts as the Single Source of Truth (SSOT) engine for all dataset metrics:
1. Calculates exact real-time metrics directly from data/*.json and data/*.csv files.
2. Updates data/dataset_metadata.json (and frontend/public/dataset_metadata.json).
3. Automatically updates stale hardcoded numbers across:
   - AGENTS.md
   - README.md
   - docs/COMPETITORS.md
   - .agents/skills/rov-data-guardian/SKILL.md
   - .agents/skills/draft-screenshot-reader/SKILL.md
4. Automatically mirrors .agents/skills/ to .claude/skills/.

Usage:
    python scripts/sync_metadata.py          # Performs complete sync
    python scripts/sync_metadata.py --check  # Verifies files without writing (exit 1 if stale)
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime
import json
import re
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
FRONTEND_PUBLIC_DIR = REPO_ROOT / "frontend" / "public"
AGENTS_SKILLS_DIR = REPO_ROOT / ".agents" / "skills"
CLAUDE_SKILLS_DIR = REPO_ROOT / ".claude" / "skills"


def collect_dataset_metrics() -> dict:
    """Read all data files on disk and calculate canonical metrics."""
    # 1. Heroes & Skills
    heroes_file = DATA_DIR / "heroes_130_full.json"
    with open(heroes_file, "r", encoding="utf-8") as f:
        heroes_data = json.load(f)
    heroes_list = heroes_data if isinstance(heroes_data, list) else heroes_data.get("heroes", [])
    total_heroes = len(heroes_list)

    skills_file = DATA_DIR / "hero_skills_full.json"
    with open(skills_file, "r", encoding="utf-8") as f:
        skills_data = json.load(f)
    skills_heroes = skills_data.get("heroes")
    total_skills = (
        sum(len(v) for v in skills_heroes.values())
        if isinstance(skills_heroes, dict)
        else skills_data.get("total_skills", 0)
    )

    # 2. Historical Match Archive
    matches_file = DATA_DIR / "matches_draft_full.json"
    with open(matches_file, "r", encoding="utf-8") as f:
        matches_data = json.load(f)
    matches_list = matches_data if isinstance(matches_data, list) else matches_data.get("matches", [])
    total_matches = len(matches_list)

    year_counts = collections.Counter(str(m.get("year", "")) for m in matches_list)
    matches_2024 = year_counts.get("2024", 0)
    matches_2025 = year_counts.get("2025", 0)
    matches_2026 = year_counts.get("2026", 0)

    # 3. Curated Training Dataset
    train_file = DATA_DIR / "matches_training.json"
    with open(train_file, "r", encoding="utf-8") as f:
        train_data = json.load(f)
    train_list = train_data if isinstance(train_data, list) else train_data.get("matches", [])
    training_matches = len(train_list)
    training_true_order = sum(bool(m.get("is_true_order")) for m in train_list)
    true_order_pct = round(training_true_order / training_matches * 100, 1) if training_matches > 0 else 0.0

    # 4. True Pick Order Dataset
    tpo_file = DATA_DIR / "true_pick_order.json"
    with open(tpo_file, "r", encoding="utf-8") as f:
        tpo_data = json.load(f)
    tpo_games = len(tpo_data.get("games", [])) if isinstance(tpo_data, dict) else len(tpo_data)

    # 5. Patch History
    patch_file = DATA_DIR / "hero_patch_history.json"
    with open(patch_file, "r", encoding="utf-8") as f:
        patch_data = json.load(f)
    changes_list = patch_data.get("changes", [])
    patch_changes = len(changes_list) if isinstance(changes_list, list) else patch_data.get("count", 0)
    patch_heroes = (
        len({c.get("hero") for c in changes_list if isinstance(c, dict) and c.get("hero")})
        if isinstance(changes_list, list)
        else patch_data.get("heroes", 0)
    )

    # 6. Matrices
    synergy_file = DATA_DIR / "synergy_matrix.csv"
    with open(synergy_file, "r", encoding="utf-8") as f:
        synergy_pairs = max(0, len(list(csv.reader(f))) - 1)

    counter_file = DATA_DIR / "counter_matrix.csv"
    with open(counter_file, "r", encoding="utf-8") as f:
        counter_pairs = max(0, len(list(csv.reader(f))) - 1)

    # 7. Arcana & Enchantments
    arcana_file = DATA_DIR / "arcana.json"
    with open(arcana_file, "r", encoding="utf-8") as f:
        arcana_data = json.load(f)
    arcana_count = len(arcana_data.get("arcana", [])) if isinstance(arcana_data, dict) else len(arcana_data)

    ench_file = DATA_DIR / "enchantments.json"
    with open(ench_file, "r", encoding="utf-8") as f:
        ench_data = json.load(f)
    ench_count = len(ench_data.get("enchantments", [])) if isinstance(ench_data, dict) else len(ench_data)

    flowborn_mage_count = sum(
        1 for g in matches_list if "Flowborn (Mage)" in (g.get("blue_picks", []) + g.get("red_picks", []))
    )

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    return {
        "updated_at": now_iso,
        "total_heroes": total_heroes,
        "total_skills": total_skills,
        "total_matches": total_matches,
        "matches_by_year": {
            "2024": matches_2024,
            "2025": matches_2025,
            "2026": matches_2026,
        },
        "training_matches": training_matches,
        "training_true_order": training_true_order,
        "true_order_pct": true_order_pct,
        "tpo_games": tpo_games,
        "patch_changes": patch_changes,
        "patch_heroes": patch_heroes,
        "synergy_pairs": synergy_pairs,
        "counter_pairs": counter_pairs,
        "arcana_tier3": arcana_count,
        "enchantments": ench_count,
        "flowborn_mage_matches": flowborn_mage_count,
    }


def update_agents_md(content: str, m: dict) -> str:
    """Synchronize AGENTS.md metrics."""
    tot_m = f"{m['total_matches']:,}"
    train_m = f"{m['training_matches']:,}"
    true_m = f"{m['training_true_order']:,}"
    tpo_g = f"{m['tpo_games']:,}"
    pct = f"{m['true_order_pct']:.1f}%"
    tot_h = str(m["total_heroes"])
    tot_s = str(m["total_skills"])
    m_2024 = str(m["matches_by_year"]["2024"])
    m_2025 = f"{m['matches_by_year']['2025']:,}"
    m_2026 = f"{m['matches_by_year']['2026']:,}"
    syn_p = f"{m['synergy_pairs']:,}"
    cnt_p = f"{m['counter_pairs']:,}"
    pat_c = str(m["patch_changes"])
    pat_h = str(m["patch_heroes"])
    arc_c = str(m["arcana_tier3"])

    # Status table
    content = re.sub(
        r"\|\s*\*\*Hero & Skill Database\*\*\s*\|\s*\*\*(\d+)\s*/\s*(\d+)\s*Heroes\*\*",
        f"| **Hero & Skill Database** | **{tot_h} / {tot_h} Heroes**",
        content,
    )
    content = re.sub(
        r"\|\s*\*\*Pro Match Archive\*\*\s*\|\s*\*\*([0-9,]+)\s*Complete Pro Games\*\*",
        f"| **Pro Match Archive** | **{tot_m} Complete Pro Games**",
        content,
    )
    curated_pat = (
        r"\|\s*\*\*Curated Training Dataset\*\*\s*\|\s*\*\*([0-9,]+)\s*Games \(2025–2026\)\*\*"
        r"(\s*\(`data/matches_training\.json`\))?\. All \d+ games from 2024.*?"
        r"\*\*True Pick Order coverage = [0-9.]+%\*\* \([0-9,]+ / [0-9,]+ games\)\."
    )
    if "| **Curated Training Dataset** |" in content and not re.search(curated_pat, content):
        raise ValueError("Failed to match 'Curated Training Dataset' row in AGENTS.md")
    content = re.sub(
        curated_pat,
        f"| **Curated Training Dataset** | **{train_m} Games (2025–2026)** (`data/matches_training.json`). All {m_2024} games from 2024 are strictly excluded to remove legacy meta noise; includes all {m_2026} games from 2026 with 100% verified true pick order. **True Pick Order coverage = {pct}** ({true_m} / {train_m} games).",
        content,
    )

    # Rule 13
    content = re.sub(
        r"data/matches_draft_full\.json` \([0-9,]+ games\)",
        f"data/matches_draft_full.json` ({tot_m} games)",
        content,
    )
    content = re.sub(
        r"All \d+ games from 2024 are excluded",
        f"All {m_2024} games from 2024 are excluded",
        content,
    )
    content = re.sub(
        r"containing \*\*([0-9,]+) games strictly from 2025–2026\*\* \([0-9,]+ from 2025 \+ [0-9,]+ from 2026([^)]*)\) with \*\*([0-9.]+)% True Pick Order coverage\*\* \([0-9,]+ / [0-9,]+ games[^)]*\)",
        lambda _m: (
            f"containing **{train_m} games strictly from 2025–2026** "
            f"({m_2025} from 2025 + {m_2026} from 2026{_m.group(2)}) "
            f"with **{pct} True Pick Order coverage** ({true_m} / {train_m} games = 100% of 2026 games, verified from broadcast screenshots)"
        ),
        content,
    )

    # Repository tree
    content = re.sub(
        r"rov-data-guardian/       # Data integrity: \d+ heroes, [0-9,]+ matches",
        f"rov-data-guardian/       # Data integrity: {tot_h} heroes, {tot_m} matches",
        content,
    )
    content = re.sub(
        r"matches_training\.json        # Curated training set: [0-9,]+ games \(2025–2026 only, 2024 excluded, [0-9.]+% true order\)",
        f"matches_training.json        # Curated training set: {train_m} games (2025–2026 only, 2024 excluded, {pct} true order)",
        content,
    )
    content = re.sub(
        r"matches_draft_full\.json      # Full historical archive: [0-9,]+ pro tournament draft games",
        f"matches_draft_full.json      # Full historical archive: {tot_m} pro tournament draft games",
        content,
    )
    content = re.sub(
        r"true_pick_order\.json         # [0-9,]+ screenshot-verified chronological pick orders",
        f"true_pick_order.json         # {tpo_g} screenshot-verified chronological pick orders",
        content,
    )
    content = re.sub(
        r"synergy_matrix\.csv           # Pairwise ally synergy matrix \([0-9,]+ pairs\)",
        f"synergy_matrix.csv           # Pairwise ally synergy matrix ({syn_p} pairs)",
        content,
    )
    content = re.sub(
        r"counter_matrix\.csv           # Pairwise enemy counter matrix \([0-9,]+ pairs\)",
        f"counter_matrix.csv           # Pairwise enemy counter matrix ({cnt_p} pairs)",
        content,
    )
    content = re.sub(
        r"hero_patch_history\.json      # \d+ historical balance adjustments across \d+ heroes",
        f"hero_patch_history.json      # {pat_c} historical balance adjustments across {pat_h} heroes",
        content,
    )
    content = re.sub(
        r"hero_skills_full\.json        # \d+ structured hero skills",
        f"hero_skills_full.json        # {tot_s} structured hero skills",
        content,
    )
    content = re.sub(
        r"arcana\.json                  # \d+ Tier-III Arcana runes",
        f"arcana.json                  # {arc_c} Tier-III Arcana runes",
        content,
    )
    content = re.sub(
        r"test_data_integrity\.py       # Verifies \d+ heroes, skills, [0-9,]+ match mappings",
        f"test_data_integrity.py       # Verifies {tot_h} heroes, skills, {tot_m} match mappings",
        content,
    )

    return content


def update_readme_md(content: str, m: dict) -> str:
    """Synchronize README.md metrics."""
    tot_m = f"{m['total_matches']:,}"
    train_m = f"{m['training_matches']:,}"
    tpo_g = f"{m['tpo_games']:,}"
    pct = f"{m['true_order_pct']:.1f}%"
    tot_h = str(m["total_heroes"])
    tot_s = str(m["total_skills"])
    syn_p = f"{m['synergy_pairs']:,}"
    cnt_p = f"{m['counter_pairs']:,}"
    pat_c = str(m["patch_changes"])
    pat_h = str(m["patch_heroes"])
    arc_c = str(m["arcana_tier3"])

    content = re.sub(
        r"covering all \*\*\d+ heroes \(up to ([^)]+)\)\*\*, pro match dataset with \*\*([0-9,]+) complete games",
        lambda _m: (
            f"covering all **{tot_h} heroes (up to {_m.group(1)})**, pro match dataset with **{tot_m} complete games"
        ),
        content,
    )
    content = re.sub(
        r"matches_draft_full\.json` & `data/matches_draft_flat\.csv` — [0-9,]+ pro match drafts",
        f"matches_draft_full.json` & `data/matches_draft_flat.csv` — {tot_m} pro match drafts",
        content,
    )
    content = re.sub(
        r"matches_training\.json` — Curated training set: [0-9,]+ games from 2025–2026 \(2024 excluded\), [0-9.]+% with screenshot-verified true pick order",
        f"matches_training.json` — Curated training set: {train_m} games from 2025–2026 (2024 excluded), {pct} with screenshot-verified true pick order",
        content,
    )
    content = re.sub(
        r"true_pick_order\.json` — [0-9,]+ games with true chronological pick order",
        f"true_pick_order.json` — {tpo_g} games with true chronological pick order",
        content,
    )
    content = re.sub(
        r"ally synergy matrix \([0-9,]+ pairs\), and enemy counter matrix \([0-9,]+ pairs\)",
        f"ally synergy matrix ({syn_p} pairs), and enemy counter matrix ({cnt_p} pairs)",
        content,
    )
    content = re.sub(
        r"hero_patch_history\.json` — \d+ numerical hero balance adjustments across \d+ characters",
        f"hero_patch_history.json` — {pat_c} numerical hero balance adjustments across {pat_h} characters",
        content,
    )
    content = re.sub(
        r"hero_skills_full\.json` — Structured numerical catalog of \d+ hero skills for all \d+ heroes",
        f"hero_skills_full.json` — Structured numerical catalog of {tot_s} hero skills for all {tot_h} heroes",
        content,
    )
    content = re.sub(
        r"arcana\.json` — \d+ Tier-III Arcana runes",
        f"arcana.json` — {arc_c} Tier-III Arcana runes",
        content,
    )

    return content


def update_competitors_md(content: str, m: dict) -> str:
    """Synchronize docs/COMPETITORS.md metrics."""
    tot_m = f"{m['total_matches']:,}"
    tot_h = str(m["total_heroes"])
    tot_s = str(m["total_skills"])

    content = re.sub(
        r"[0-9,]+ pro matches \(2024–2026\), \d+ verified heroes",
        f"{tot_m} pro matches (2024–2026), {tot_h} verified heroes",
        content,
    )
    content = re.sub(
        r"trained on 64,000\+ decision steps from [0-9,]+ pro games",
        f"trained on 64,000+ decision steps from {tot_m} pro games",
        content,
    )
    content = re.sub(
        r"queried from our [0-9,]+ pro match dataset",
        f"queried from our {tot_m} pro match dataset",
        content,
    )
    content = re.sub(
        r"\d+ skills with exact base/scaling damage",
        f"{tot_s} skills with exact base/scaling damage",
        content,
    )

    return content


def update_rov_data_guardian_md(content: str, m: dict) -> str:
    """Synchronize rov-data-guardian SKILL.md metrics."""
    tot_m = f"{m['total_matches']:,}"
    train_m = f"{m['training_matches']:,}"
    true_m = f"{m['training_true_order']:,}"
    pct = f"{m['true_order_pct']:.1f}%"
    tot_h = str(m["total_heroes"])
    m_2024 = str(m["matches_by_year"]["2024"])

    content = re.sub(
        r"Audits, validates, and updates the \d+ RoV hero skill database, the [0-9,]+ professional",
        f"Audits, validates, and updates the {tot_h} RoV hero skill database, the {tot_m} professional",
        content,
    )
    content = re.sub(
        r"data/matches_draft_full\.json` \([0-9,]+ games\)",
        f"data/matches_draft_full.json` ({tot_m} games)",
        content,
    )
    content = re.sub(
        r"data/matches_training\.json` is the \*\*curated training dataset\*\* containing \*\*([0-9,]+) games strictly from 2025–2026\*\*",
        f"data/matches_training.json` is the **curated training dataset** containing **{train_m} games strictly from 2025–2026**",
        content,
    )
    content = re.sub(
        r"All \d+ games from 2024 are excluded",
        f"All {m_2024} games from 2024 are excluded",
        content,
    )
    content = re.sub(
        r"True Pick Order coverage is [0-9.]+%\s*\([0-9,]+ / [0-9,]+ games\)",
        f"True Pick Order coverage is {pct} ({true_m} / {train_m} games)",
        content,
    )

    return content


def update_draft_screenshot_reader_md(content: str, m: dict) -> str:
    """Synchronize draft-screenshot-reader SKILL.md metrics."""
    tot_m = f"{m['total_matches']:,}"
    flow_m = str(m["flowborn_mage_matches"])

    content = re.sub(
        r"Mage is rare: \d+ of [0-9,]+ games",
        f"Mage is rare: {flow_m} of {tot_m} games",
        content,
    )
    return content


def _collect_skill_files(root_dir: Path) -> dict[Path, Path]:
    if not root_dir.exists():
        return {}
    return {p.relative_to(root_dir): p for p in root_dir.rglob("*") if p.is_file() and "__pycache__" not in p.parts}


def _skills_in_sync() -> bool:
    if not AGENTS_SKILLS_DIR.exists():
        return True
    if not CLAUDE_SKILLS_DIR.exists():
        return False
    src_files = _collect_skill_files(AGENTS_SKILLS_DIR)
    dst_files = _collect_skill_files(CLAUDE_SKILLS_DIR)
    if set(src_files) != set(dst_files):
        return False
    return all(src_files[rel].read_bytes() == dst_files[rel].read_bytes() for rel in src_files)


def mirror_skills_to_claude():
    """Mirror .agents/skills/ 1-to-1 to .claude/skills/, removing stale files."""
    if not AGENTS_SKILLS_DIR.exists():
        return
    CLAUDE_SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    src_files = _collect_skill_files(AGENTS_SKILLS_DIR)
    dst_files = _collect_skill_files(CLAUDE_SKILLS_DIR)

    for rel, dest_path in dst_files.items():
        if rel not in src_files:
            dest_path.unlink()

    for dir_path in sorted(CLAUDE_SKILLS_DIR.rglob("*"), reverse=True):
        if dir_path.is_dir() and dir_path.name != "__pycache__" and not any(dir_path.iterdir()):
            dir_path.rmdir()

    for rel, src_path in src_files.items():
        dest = CLAUDE_SKILLS_DIR / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dest)


def _json_metrics_match(path: Path, new_obj: dict) -> bool:
    if not path.exists():
        return False
    try:
        old_obj = json.loads(path.read_text(encoding="utf-8"))
        old_cmp = dict(old_obj)
        new_cmp = dict(new_obj)
        old_cmp.pop("updated_at", None)
        new_cmp.pop("updated_at", None)
        return old_cmp == new_cmp
    except Exception:
        return False


def sync_metadata(check: bool = False, quiet: bool = False) -> dict:
    """Core synchronization entry point."""
    metrics = collect_dataset_metrics()

    # Paths to sync
    metadata_json_path = DATA_DIR / "dataset_metadata.json"
    frontend_meta_path = FRONTEND_PUBLIC_DIR / "dataset_metadata.json"

    file_targets = [
        (REPO_ROOT / "AGENTS.md", update_agents_md),
        (REPO_ROOT / "docs" / "ARCHITECTURE_MAP.md", update_agents_md),
        (REPO_ROOT / "README.md", update_readme_md),
        (REPO_ROOT / "docs" / "COMPETITORS.md", update_competitors_md),
        (
            AGENTS_SKILLS_DIR / "rov-data-guardian" / "SKILL.md",
            update_rov_data_guardian_md,
        ),
        (
            AGENTS_SKILLS_DIR / "draft-screenshot-reader" / "SKILL.md",
            update_draft_screenshot_reader_md,
        ),
    ]

    has_diff = False
    new_json_str = json.dumps(metrics, indent=2, ensure_ascii=False) + "\n"
    new_obj = json.loads(new_json_str)

    # Check json metadata (backend + frontend copy)
    backend_meta_ok = _json_metrics_match(metadata_json_path, new_obj)
    frontend_meta_ok = (not FRONTEND_PUBLIC_DIR.exists()) or (
        frontend_meta_path.exists()
        and _json_metrics_match(frontend_meta_path, new_obj)
        and metadata_json_path.exists()
        and frontend_meta_path.read_text(encoding="utf-8") == metadata_json_path.read_text(encoding="utf-8")
    )
    if not backend_meta_ok:
        has_diff = True
        if not quiet:
            print(f"[DIFF] {metadata_json_path.relative_to(REPO_ROOT)} is out of sync")
    if not frontend_meta_ok:
        has_diff = True
        if not quiet:
            print(f"[DIFF] {frontend_meta_path.relative_to(REPO_ROOT)} is out of sync")

    # Check markdown targets
    for target_path, update_func in file_targets:
        if not target_path.exists():
            continue
        old_content = target_path.read_text(encoding="utf-8")
        new_content = update_func(old_content, metrics)
        if old_content != new_content:
            has_diff = True
            if not quiet:
                print(f"[DIFF] {target_path.relative_to(REPO_ROOT)} is out of sync")

    # Check .claude/skills mirror parity
    skills_synced = _skills_in_sync()
    if not skills_synced:
        has_diff = True
        if not quiet:
            print("[DIFF] .claude/skills/ is out of sync with .agents/skills/")

    if check:
        if has_diff:
            if not quiet:
                print("[FAIL] Metadata or documentation files are stale. Run 'python scripts/sync_metadata.py'")
            sys.exit(1)
        else:
            if not quiet:
                print("[OK] All dataset metadata and documentation files are 100% synchronized.")
            return metrics

    # Perform writes only when content changed to avoid updated_at churn
    if not backend_meta_ok:
        metadata_json_path.write_text(new_json_str, encoding="utf-8")
        if FRONTEND_PUBLIC_DIR.exists():
            frontend_meta_path.write_text(new_json_str, encoding="utf-8")
    elif not frontend_meta_ok and FRONTEND_PUBLIC_DIR.exists():
        frontend_meta_path.write_text(metadata_json_path.read_text(encoding="utf-8"), encoding="utf-8")

    for target_path, update_func in file_targets:
        if not target_path.exists():
            continue
        old_content = target_path.read_text(encoding="utf-8")
        new_content = update_func(old_content, metrics)
        if old_content != new_content:
            target_path.write_text(new_content, encoding="utf-8")
            if not quiet:
                print(f"[SYNC] Updated {target_path.relative_to(REPO_ROOT)}")

    # Mirror skills to claude
    mirror_skills_to_claude()
    if not quiet:
        print(
            f"[OK] Dataset metadata synchronized: {metrics['total_matches']:,} matches, {metrics['total_heroes']} heroes, {metrics['training_matches']:,} training ({metrics['true_order_pct']}%)"
        )

    return metrics


def main():
    parser = argparse.ArgumentParser(description="Synchronize dataset metadata and documentation")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check whether documentation and metadata are up to date without modifying files",
    )
    parser.add_argument("--quiet", action="store_true", help="Suppress console output")
    args = parser.parse_args()

    sync_metadata(check=args.check, quiet=args.quiet)


if __name__ == "__main__":
    main()
