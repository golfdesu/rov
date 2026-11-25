#!/usr/bin/env python3
"""Static Anti-Slop Copy, i18n Completeness & Popover Wrapping Auditor.

Verifies:
1. Every active `t(...)`, `<StableButtonLabel>`, and localized map key exists in
   `frontend/src/i18n/englishMessages.ts` (`0` missing keys).
2. Zero AI-slop / academic jargon / leaked internal path strings in active UI copy
   (outside optional `<details>` technical/theory glossaries and `src/utils/`).
3. Dropdowns/menus (`role="menu"` / `top-full`) inside `whitespace-nowrap` containers
   explicitly reset `whitespace-normal`, and Combat Lab avoids `line-clamp-1` clipping.
4. Warns on split `<StableButtonLabel>` fragments ending in `(` or mixed `Thai (English)`
   parenthetical glosses outside legitimate RoV terms.

Usage:
    python .agents/skills/frontend-e2e-inspector/scripts/audit_copy_i18n.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
SRC_DIR = REPO_ROOT / "frontend" / "src"
EN_PATH = SRC_DIR / "i18n" / "englishMessages.ts"

BANNED_UI_SUBSTRINGS = (
    "Wilson (1927)",
    "Empirical Bayes",
    "Bradley-Terry",
    "Linear Interpolation",
    "Shannon Entropy",
    "100% In-Game",
    "(Excel Style)",
    "PRO SCRIM SCOUTING DOSSIER",
    "Description (EN):",
    "โฟลเดอร์ heroes/",
)

PARENS_ALLOWLIST = {
    "Ctrl+Z",
    "Ctrl+Y",
    "Phase 1 vs Phase 2",
    "P1–P3",
    "P4–P5",
    "G1–G7",
    "Hero Pool",
    "Global Ban",
    "Team",
    "Personal",
    "Cloudflare",
    "Read-only",
    "Bow of Slaughter",
    "Rock Shield",
    "Five Forces",
    "Active",
    "Auto-Lock",
    "Auto",
    "Playoffs",
    "JGL+MID+SUP",
    "B - A",
    "EN",
    "TH",
}

LOCALIZED_DICT_FILES = {
    "TierListView.tsx",
    "ArcanaBoard.tsx",
    "ItemCardModal.tsx",
    "SkillDamageTable.tsx",
    "scrimAdvancedStats.ts",
    "enchantmentFactions.ts",
    "draft.ts",
    "ScrimDashboardView.tsx",
    "AdminDashboardView.tsx",
    "AdminStatsModal.tsx",
    "ScoreBar.tsx",
    "useDraftTimer.ts",
    "AuthModal.tsx",
    "MobileNavDrawer.tsx",
}


def check_i18n_coverage() -> list[str]:
    en_text = EN_PATH.read_text(encoding="utf-8")
    en_keys = {
        k.replace(r"\n", "\n").replace(r"\"", '"')
        for k in re.findall(r'^\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*:', en_text, re.M)
    }

    used: dict[str, set[str]] = {}

    def add(k: str, rel: str) -> None:
        k = k.replace(r"\n", "\n").replace(r"\"", '"')
        if not k or any(tok in k for tok in ("bg-", "text-", "border-", "hover:", "px-", "py-", "font-")):
            return
        used.setdefault(k, set()).add(rel)

    call_pat = re.compile(r'(?<![.\w])t\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"')
    trans_pat = re.compile(r'translateMessage\(\s*t\s*,\s*"([^"\\]*(?:\\.[^"\\]*)*)"')
    sbl_pat = re.compile(r'<StableButtonLabel\b[^>]*\bmessage="([^"\\]*(?:\\.[^"\\]*)*)"')
    alt_pat = re.compile(r"alternatives=\{\[([^\]]+)\]")
    th_val_pat = re.compile(r'"([^"\\]*(?:\\.[^"\\]*)*[\u0E00-\u0E7F][^"\\]*(?:\\.[^"\\]*)*)"')

    for p in sorted(SRC_DIR.rglob("*.ts*")):
        if p == EN_PATH:
            continue
        rel = p.relative_to(SRC_DIR).as_posix()
        txt = p.read_text(encoding="utf-8")
        for pat in (call_pat, trans_pat, sbl_pat):
            for m in pat.finditer(txt):
                add(m.group(1), rel)
        for m in alt_pat.finditer(txt):
            for s in re.findall(r'"([^"\\]*(?:\\.[^"\\]*)*)"', m.group(1)):
                add(s, rel)
        for m in re.finditer(r"(?<![.\w])t\(\s*[^\n;)]*\?[^\n;)]*\)", txt):
            for s in re.findall(r'"([^"\\]*(?:\\.[^"\\]*)*)"', m.group(0)):
                if re.search(r"[\u0E00-\u0E7F]", s):
                    add(s, rel)
        if p.name in LOCALIZED_DICT_FILES:
            for line in txt.splitlines():
                stripped = line.strip()
                if stripped.startswith("//") or stripped.startswith("*"):
                    continue
                if re.search(
                    r"(?:label|title|tag|nameTh|role|secondaryHint|physical|magic|true|none|"
                    r"frontline_teamfight|dive_pick|double_carry_poke|protect_utility|balanced|"
                    r"attack_damage|ability_power|armor|magic_defense|max_hp|critical_chance_pct|"
                    r"critical_damage_pct|attack_speed_pct|movement_speed_pct|cooldown_reduction_pct|"
                    r"armor_pierce|magic_pierce|life_steal_pct|magic_life_steal_pct|hp_regen_5s|"
                    r"base|bonus_ad|as_to_ad|own_hp|target_hp|target_current_hp|target_lost_hp|"
                    r"extra|th|subtitle)\s*[:=]",
                    line,
                ):
                    for m in th_val_pat.finditer(line):
                        add(m.group(1), rel)

    return sorted(
        f"{k!r} ({', '.join(sorted(used[k]))})"
        for k in used
        if k not in en_keys and (re.search(r"[\u0E00-\u0E7F]", k) or k in {"Hero Pools", "Survey"})
    )


def check_static_ui_hygiene() -> tuple[list[str], list[str]]:
    issues: list[str] = []
    warnings: list[str] = []
    split_sbl_pat = re.compile(r'<StableButtonLabel\b[^>]*\bmessage="[^"]*\(\s*"')
    mixed_parens_pat = re.compile(r"[\u0E00-\u0E7F][^\"\n]*?\(([A-Za-z][A-Za-z0-9 &/\-+]{2,})\)")

    for p in sorted(SRC_DIR.rglob("*.ts*")):
        if p == EN_PATH:
            continue
        rel = p.relative_to(REPO_ROOT).as_posix()
        is_ui_component = p == SRC_DIR / "App.tsx" or "components" in p.parts
        lines = p.read_text(encoding="utf-8").splitlines()
        in_details = 0

        for idx, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
                continue

            if "<details" in line:
                in_details += line.count("<details")
            if "</details>" in line:
                in_details = max(0, in_details - line.count("</details>"))

            if is_ui_component and in_details == 0:
                for bad in BANNED_UI_SUBSTRINGS:
                    if bad in line:
                        issues.append(f"{rel}:{idx}: banned UI jargon/path token {bad!r}")

            if split_sbl_pat.search(line):
                warnings.append(f"{rel}:{idx}: split <StableButtonLabel> fragment ending with '('")

            if p.parent.name == "lab" and "line-clamp-1" in line:
                issues.append(f"{rel}:{idx}: line-clamp-1 inside Combat Lab risks clipping stats vertically")

            if is_ui_component and in_details == 0:
                for m in mixed_parens_pat.finditer(line):
                    inner = m.group(1).strip()
                    if inner in PARENS_ALLOWLIST or inner.startswith("http"):
                        continue
                    if '"' in line and (
                        "t(" in line or "StableButtonLabel" in line or "title=" in line or "label:" in line
                    ):
                        if any(
                            tok in inner
                            for tok in ("Win Rate", "Rate", "Pool", "Ban", "Phase", "CDR", "HP", "AD", "AP")
                        ):
                            continue
                        warnings.append(f"{rel}:{idx}: mixed Thai(English) UI gloss ({inner!r})")

            if ('role="menu"' in line or "top-full" in line) and "className=" in line:
                window = "\n".join(lines[max(0, idx - 3) : min(len(lines), idx + 3)])
                if ('role="menu"' in window or "top-full" in window) and "absolute" in window:
                    ancestor_window = "\n".join(lines[max(0, idx - 145) : idx])
                    if "whitespace-nowrap" in ancestor_window and "whitespace-normal" not in window:
                        issues.append(
                            f"{rel}:{idx}: positioned menu/popover inside whitespace-nowrap block must set whitespace-normal"
                        )

    return issues, warnings


def main() -> int:
    print("=" * 72)
    print("RoV Frontend Copy, i18n & Popover Wrapping Auditor")
    print("=" * 72)

    missing = check_i18n_coverage()
    issues, warnings = check_static_ui_hygiene()

    if missing:
        print(f"[FAIL] Missing EN translations ({len(missing)}):")
        for m in missing:
            print(f"  - {m}")
    else:
        print("[OK] 100% EN dictionary coverage (0 missing keys).")

    if issues:
        print(f"[FAIL] Copy/layout hygiene errors ({len(issues)}):")
        for h in issues:
            print(f"  - {h}")
    else:
        print("[OK] Zero AI-slop tokens, Combat Lab line-clamp-1, or nowrap popover bugs.")

    if warnings:
        print(f"[WARN] Non-blocking legacy UI copy notices ({len(warnings)}):")
        for w in warnings:
            print(f"  - {w}")

    if missing or issues:
        return 1
    print("[PASS] Copy, i18n, and wrapping guardrails clean.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
