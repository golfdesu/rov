"""WikiSkill Preflight Verifier for RoV Pro Draft Intelligence.

Scans source modules, utility scripts, SLURM .sbatch jobs, and production configs
for prohibited patterns and guardrail violations before training or deployment.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def _scan_python_files() -> tuple[list[str], list[str], int]:
    """Scan active Python files in src/ and scripts/ (excluding scripts/archive/)."""
    errors: list[str] = []
    warnings: list[str] = []
    files: list[Path] = []

    for rel_dir in ("src", "src/search", "scripts"):
        target = REPO_ROOT / rel_dir
        if target.exists():
            files.extend(sorted(target.glob("*.py")))

    aug_pattern = re.compile(r"augment_factor\s*=\s*(\d+)")

    for fpath in files:
        rel = fpath.relative_to(REPO_ROOT).as_posix()
        content = fpath.read_text(encoding="utf-8")

        for lineno, line in enumerate(content.splitlines(), start=1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue

            if "torch.compile(" in line:
                errors.append(
                    f"[{rel}:{lineno}] PROHIBITED: 'torch.compile(' crashes on ERAWAN compute4 (no Python.h)."
                )

            if "set_per_process_memory_fraction(" in line:
                errors.append(
                    f"[{rel}:{lineno}] PROHIBITED: 'set_per_process_memory_fraction(' throttles H100 80GB HBM3."
                )

            match = aug_pattern.search(line)
            if match and int(match.group(1)) > 2:
                errors.append(
                    f"[{rel}:{lineno}] PROHIBITED: augment_factor={match.group(1)} > 2 causes severe overfitting."
                )

        if fpath.name in {"train_sota_model.py", "hpo_sota_optuna.py"} and "allow_tf32" not in content:
            warnings.append(f"[{rel}] ADVISORY: Missing allow_tf32 flag for H100 Tensor Cores.")

    return errors, warnings, len(files)


def _scan_sbatch_files() -> tuple[list[str], int]:
    """Verify SLURM .sbatch files strictly target gpu-h100 with 1 GPU."""
    errors: list[str] = []
    sbatch_files = sorted(REPO_ROOT.glob("*.sbatch"))

    for fpath in sbatch_files:
        rel = fpath.relative_to(REPO_ROOT).as_posix()
        content = fpath.read_text(encoding="utf-8")
        if "#SBATCH --partition=gpu-h100" not in content:
            errors.append(f"[{rel}] PROHIBITED: Missing '#SBATCH --partition=gpu-h100'.")
        if "#SBATCH --gres=gpu:1" not in content:
            errors.append(f"[{rel}] PROHIBITED: Missing '#SBATCH --gres=gpu:1'.")

    return errors, len(sbatch_files)


def _check_production_params() -> list[str]:
    """Verify locked SOTA capacity guardrails in configs/selected_production_params.json."""
    errors: list[str] = []
    cfg_path = REPO_ROOT / "configs" / "selected_production_params.json"
    if not cfg_path.exists():
        return [f"Missing required production config: {cfg_path.relative_to(REPO_ROOT).as_posix()}"]

    data = json.loads(cfg_path.read_text(encoding="utf-8"))
    sota = data.get("models", {}).get("sota_rov_gnn_transformer", {})

    for key in ("selected_for_production_safest", "selected_for_production_rank1"):
        entry = sota.get(key, {})
        params = entry.get("params", {})
        if not params:
            errors.append(f"[configs/selected_production_params.json] Missing '{key}.params'.")
            continue
        if params.get("d_model") != 256:
            errors.append(f"[{key}] d_model={params.get('d_model')} violates locked SOTA capacity (256).")
        if params.get("num_layers") != 1:
            errors.append(f"[{key}] num_layers={params.get('num_layers')} violates locked SOTA depth (1).")
        if params.get("nhead") != 4:
            errors.append(f"[{key}] nhead={params.get('nhead')} violates locked SOTA heads (4).")
        aug = params.get("augment_factor", 1)
        if aug > 2:
            errors.append(f"[{key}] augment_factor={aug} exceeds max allowed (2).")

    return errors


def _check_wikiskill_coverage() -> list[str]:
    """Verify structural artifacts (modules, DB tables, UI views, VM lock) are covered in .wikiskill/wiki/."""
    errors: list[str] = []
    wiki_dir = REPO_ROOT / ".wikiskill" / "wiki"
    if not wiki_dir.exists():
        return ["Missing .wikiskill/wiki/ directory."]

    wiki_corpus = "\n".join(p.read_text(encoding="utf-8") for p in sorted(wiki_dir.glob("*.md")))

    src_dir = REPO_ROOT / "src"
    if src_dir.exists():
        for fpath in sorted(src_dir.glob("*.py")):
            if fpath.name != "__init__.py" and fpath.name not in wiki_corpus:
                errors.append(
                    f"[WikiSkill Coverage] New module 'src/{fpath.name}' is not documented in .wikiskill/wiki/*.md."
                )

    db_path = REPO_ROOT / "src" / "db.py"
    if db_path.exists():
        db_text = db_path.read_text(encoding="utf-8")
        for tbl in re.findall(r"CREATE TABLE IF NOT EXISTS (\w+)", db_text):
            if tbl not in wiki_corpus:
                errors.append(
                    f"[WikiSkill Coverage] SQLite table '{tbl}' in src/db.py is not documented in .wikiskill/wiki/*.md."
                )

    frontend_src = REPO_ROOT / "frontend" / "src"
    if frontend_src.exists():
        for fpath in sorted(frontend_src.rglob("*View.tsx")):
            if fpath.stem not in wiki_corpus:
                errors.append(
                    f"[WikiSkill Coverage] Frontend view '{fpath.name}' is not documented in .wikiskill/wiki/*.md."
                )

    prod_wiki = wiki_dir / "production_deployment_and_ui.md"
    if not prod_wiki.exists() or "sparse-checkout" not in prod_wiki.read_text(encoding="utf-8"):
        errors.append(
            "[WikiSkill Coverage] Production VM 'sparse-checkout' invariant missing from .wikiskill/wiki/production_deployment_and_ui.md."
        )

    return errors


def main() -> int:
    """Run all preflight guardrail scans and report pass/fail status."""
    print("=" * 70)
    print("[WikiSkill Preflight] Scanning RoV Codebase, SLURM Jobs & Configs...")
    print("=" * 70)

    py_errors, warnings, num_py = _scan_python_files()
    sb_errors, num_sb = _scan_sbatch_files()
    cfg_errors = _check_production_params()
    wk_errors = _check_wikiskill_coverage()

    errors = py_errors + sb_errors + cfg_errors + wk_errors
    print(f"Scanned {num_py} Python files, {num_sb} SLURM scripts, and production config.\n")

    if errors:
        print(f"[FAIL] PREFLIGHT FAILED: {len(errors)} Critical Errors Found:")
        for err in errors:
            print(f"  - {err}")
        print("=" * 70)
        return 1

    print("[OK] PREFLIGHT PASSED: Zero Critical Prohibited Patterns Detected!")
    if warnings:
        print(f"\n[WARN] {len(warnings)} Advisory Warnings:")
        for warn in warnings:
            print(f"  - {warn}")
    else:
        print("[OK] Zero Warnings.")

    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
