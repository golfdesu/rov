import json
import warnings
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[4]
TOP5_PATH = ROOT_DIR / "best_params" / "sota_rov_top5_trials.json"
PROD_PATH = ROOT_DIR / "configs" / "selected_production_params.json"
CKPT_PATH = ROOT_DIR / "models" / "sota_draft_gnn_transformer.pt"


def print_production_status() -> None:
    """Shows what the served checkpoint actually is, next to what the curated config claims."""
    if CKPT_PATH.exists():
        import torch

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ckpt = torch.load(CKPT_PATH, map_location="cpu", weights_only=False)
        cfg = ckpt.get("model_config", {})
        print(
            f"Served checkpoint : val_loss={float(ckpt.get('val_loss', float('nan'))):.5f} | "
            f"win_acc={float(ckpt.get('val_win_acc', float('nan'))):.2f}% | {cfg}"
        )
    else:
        print(f"Served checkpoint : not found at {CKPT_PATH}")

    if PROD_PATH.exists():
        prod = json.loads(PROD_PATH.read_text(encoding="utf-8"))
        for name, model in prod.get("models", {}).items():
            for key, entry in model.items():
                if isinstance(entry, dict) and "val_loss" in entry:
                    print(
                        f"Config {name}.{key}: trial #{entry.get('trial_number')} | "
                        f"val_loss={entry['val_loss']:.5f} | updated {prod.get('last_updated', '?')}"
                    )
    print("If these disagree, the config is stale: trust the checkpoint and the HPO table above.")


def main():
    if not TOP5_PATH.exists():
        print(f"[WARN] {TOP5_PATH} not found. Run src/hpo_sota_optuna.py first.")
        return

    with open(TOP5_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    trials = data.get("top_5_trials", [])
    if not trials:
        print("[WARN] No trials in sota_rov_top5_trials.json")
        return

    min_val = min(t["val_loss"] for t in trials)
    threshold = min_val * 1.01
    eligible = [t for t in trials if t["val_loss"] <= threshold]

    safest = min(eligible, key=lambda r: r["val_loss"] + 0.25 * max(0.0, r["overfit_gap"]))
    most_compact = min(eligible, key=lambda r: (r["num_params"], r["val_loss"]))

    print("=" * 88)
    print(f"HPO PARSIMONY AUDIT (Min Val Loss: {min_val:.5f} | 1% Threshold: {threshold:.5f})")
    print("-" * 88)
    for t in trials:
        tags = []
        if t["trial_number"] == safest["trial_number"]:
            tags.append("SAFEST-GAP")
        if t["trial_number"] == most_compact["trial_number"]:
            tags.append("COMPACT-PARSIMONY")
        tag_str = f" [{', '.join(tags)}]" if tags else ""
        print(
            f"  Rank #{t['rank']} (Trial #{t['trial_number']:02d}){tag_str}: "
            f"Val={t['val_loss']:.5f} | Gap={t['overfit_gap']:+.5f} | "
            f"Top1={t['top1_pct']:.2f}% | Top5={t['top5_pct']:.2f}% | WinAcc={t['win_acc_pct']:.2f}% | "
            f"Params={t['num_params']:,}"
        )
    print("=" * 88)
    print_production_status()
    print("=" * 88)


if __name__ == "__main__":
    main()
