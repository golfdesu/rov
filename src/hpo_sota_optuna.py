import argparse
import copy
import json
import random
import time
from pathlib import Path
import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader
import optuna
from optuna.pruners import MedianPruner
from optuna.samplers import TPESampler

try:
    import mlflow
    HAS_MLFLOW = True
except ImportError:
    HAS_MLFLOW = False

from train_sota_model import (
    BASE_DIR,
    MODEL_DIR,
    BEST_PARAMS_DIR,
    SEED,
    load_sota_data_and_graphs,
    build_tensor_dataset,
    GPUTensorBatcher,
    RoVDraftGNNTransformer,
    evaluate_sota_model,
)

optuna.logging.set_verbosity(optuna.logging.WARNING)


def set_seed(seed=SEED):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def parse_args():
    parser = argparse.ArgumentParser(description="Fast GPU-Resident Optuna HPO for RoVDraftGNNTransformer")
    parser.add_argument("--n-trials", type=int, default=40, help="Number of Optuna HPO trials")
    parser.add_argument("--trial-epochs", type=int, default=14, help="Max epochs per HPO trial")
    return parser.parse_args()


def main():
    args = parse_args()
    set_seed(SEED)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = True

    use_amp = (device.type == "cuda" and torch.cuda.is_bf16_supported())
    print(f"=== Fast Optuna HPO for RoVDraftGNNTransformer on {device} (BF16 AMP={use_amp}) ===", flush=True)

    if HAS_MLFLOW:
        mlflow.set_experiment("RoV_Draft_Intelligence")
        print("MLflow tracking active (Experiment: 'RoV_Draft_Intelligence')", flush=True)

    t0 = time.time()
    (
        hero_names,
        hero_to_id,
        hero_features,
        lane_probs,
        priority_scores,
        graphs,
        priors,
        train_games,
        val_games,
    ) = load_sota_data_and_graphs()

    print("Pre-building and caching 1x and 2x datasets in memory/VRAM...", flush=True)
    train_ds_1x = build_tensor_dataset(train_games, hero_to_id, lane_probs, priority_scores, augment_factor=1)
    train_ds_2x = build_tensor_dataset(train_games, hero_to_id, lane_probs, priority_scores, augment_factor=2)
    val_ds = build_tensor_dataset(val_games, hero_to_id, lane_probs, priority_scores, augment_factor=1)

    if device.type == "cuda":
        val_loader = GPUTensorBatcher(val_ds, batch_size=2048, shuffle=False, device=device)
        train_cache = {
            (1, 512): GPUTensorBatcher(train_ds_1x, batch_size=512, shuffle=True, device=device),
            (1, 1024): GPUTensorBatcher(train_ds_1x, batch_size=1024, shuffle=True, device=device),
            (2, 512): GPUTensorBatcher(train_ds_2x, batch_size=512, shuffle=True, device=device),
            (2, 1024): GPUTensorBatcher(train_ds_2x, batch_size=1024, shuffle=True, device=device),
        }
    else:
        val_loader = DataLoader(val_ds, batch_size=1024, shuffle=False)
        train_cache = {
            (1, 512): DataLoader(train_ds_1x, batch_size=512, shuffle=True),
            (1, 1024): DataLoader(train_ds_1x, batch_size=1024, shuffle=True),
            (2, 512): DataLoader(train_ds_2x, batch_size=512, shuffle=True),
            (2, 1024): DataLoader(train_ds_2x, batch_size=1024, shuffle=True),
        }

    print(
        f"Datasets ready in {time.time()-t0:.1f}s | Train 1x: {len(train_ds_1x):,} | "
        f"Train 2x: {len(train_ds_2x):,} | Val: {len(val_ds):,}",
        flush=True,
    )

    global_best = {
        "val_loss": float("inf"),
        "val_metrics": None,
        "val_win_acc": 0.0,
        "model_config": None,
        "state_dict": None,
        "trial_number": -1,
    }
    trial_records = []

    def objective(trial: optuna.Trial):
        t_start = time.time()
        d_model = trial.suggest_categorical("d_model", [64, 128, 192, 256])
        nhead = trial.suggest_categorical("nhead", [4, 8])
        num_layers = trial.suggest_int("num_layers", 1, 4)
        dropout = trial.suggest_float("dropout", 0.12, 0.45)
        neural_scale = trial.suggest_float("neural_scale", 0.25, 1.35)
        lr = trial.suggest_float("lr", 4e-4, 3.5e-3, log=True)
        weight_decay = trial.suggest_float("weight_decay", 2e-4, 5e-2, log=True)
        label_smoothing = trial.suggest_float("label_smoothing", 0.0, 0.12)
        win_loss_weight = trial.suggest_float("win_loss_weight", 0.10, 0.35)
        batch_size = trial.suggest_categorical("batch_size", [512, 1024])
        augment_factor = trial.suggest_categorical("augment_factor", [1, 2])

        train_loader = train_cache[(augment_factor, batch_size)]
        model_config = {
            "d_model": d_model,
            "nhead": nhead,
            "num_layers": num_layers,
            "dropout": dropout,
            "neural_scale": neural_scale,
        }
        model = RoVDraftGNNTransformer(
            num_heroes=len(hero_names),
            hero_features=hero_features,
            lane_probs=lane_probs,
            graphs=graphs,
            priors=priors,
            **model_config,
        ).to(device)
        num_params = sum(p.numel() for p in model.parameters() if p.requires_grad)

        if HAS_MLFLOW:
            mlflow.start_run(run_name=f"trial_{trial.number:02d}", nested=True)
            mlflow.log_params(trial.params)
            mlflow.log_param("num_params", num_params)

        optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.trial_epochs)

        best_trial_loss = float("inf")
        best_trial_train_loss = float("inf")
        best_trial_ep = 1
        best_trial_metrics = None
        best_trial_win = 0.0
        best_trial_state = None

        for ep in range(1, args.trial_epochs + 1):
            model.train()
            ep_train_loss = 0.0
            ep_train_n = 0
            for batch in train_loader:
                if batch[0].device != device:
                    batch = [x.to(device, non_blocking=True) for x in batch]
                ap, ep_v, ab, eb, mask, th, tt, ts, tpad, mctx, act, ph, target, win_lbl = batch[:14]
                sw = batch[14] if len(batch) > 14 else torch.ones_like(win_lbl)
                optimizer.zero_grad(set_to_none=True)

                if use_amp:
                    with torch.amp.autocast("cuda", dtype=torch.bfloat16):
                        policy_logits, q_win_logits = model(ap, ep_v, ab, eb, mask, th, tt, ts, tpad, mctx, act, ph)
                        pol_raw = F.cross_entropy(policy_logits, target, label_smoothing=label_smoothing, reduction="none")
                        pol_loss = (pol_raw * sw).sum() / torch.clamp(sw.sum(), min=1e-5)
                        chosen_q = q_win_logits.gather(1, target.unsqueeze(1)).squeeze(1)
                        win_raw = F.binary_cross_entropy_with_logits(chosen_q, win_lbl, reduction="none")
                        win_loss = (win_raw * sw).sum() / torch.clamp(sw.sum(), min=1e-5)
                        loss = pol_loss + win_loss_weight * win_loss
                else:
                    policy_logits, q_win_logits = model(ap, ep_v, ab, eb, mask, th, tt, ts, tpad, mctx, act, ph)
                    pol_raw = F.cross_entropy(policy_logits, target, label_smoothing=label_smoothing, reduction="none")
                    pol_loss = (pol_raw * sw).sum() / torch.clamp(sw.sum(), min=1e-5)
                    chosen_q = q_win_logits.gather(1, target.unsqueeze(1)).squeeze(1)
                    win_raw = F.binary_cross_entropy_with_logits(chosen_q, win_lbl, reduction="none")
                    win_loss = (win_raw * sw).sum() / torch.clamp(sw.sum(), min=1e-5)
                    loss = pol_loss + win_loss_weight * win_loss

                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()

                with torch.no_grad():
                    raw_ce = F.cross_entropy(policy_logits, target)
                ep_train_loss += raw_ce.item() * target.size(0)
                ep_train_n += target.size(0)

            scheduler.step()
            cur_train_ce = ep_train_loss / max(1, ep_train_n)
            val_loss, val_metrics, val_win_acc = evaluate_sota_model(model, val_loader, device)

            if HAS_MLFLOW:
                mlflow.log_metrics({
                    "val_loss": val_loss,
                    "train_pol_loss": cur_train_ce,
                    "win_acc_pct": val_win_acc,
                }, step=ep)

            if val_loss < best_trial_loss:
                best_trial_loss = val_loss
                best_trial_train_loss = cur_train_ce
                best_trial_ep = ep
                best_trial_metrics = val_metrics
                best_trial_win = val_win_acc
                if val_loss < global_best["val_loss"]:
                    best_trial_state = copy.deepcopy(model.state_dict())

            trial.report(val_loss, step=ep)
            if trial.should_prune():
                print(
                    f"  [Trial {trial.number:02d}/{args.n_trials:02d}] PRUNED at ep {ep:02d} ({time.time()-t_start:.1f}s) | "
                    f"Best Val: {best_trial_loss:.4f} (d={d_model}, L={num_layers}, drop={dropout:.2f}, aug={augment_factor})",
                    flush=True,
                )
                if HAS_MLFLOW:
                    mlflow.set_tag("status", "PRUNED")
                    mlflow.end_run(status="KILLED")
                raise optuna.TrialPruned()

        ov = best_trial_metrics["overall"]
        t1 = ov["top1"] / ov["total"] * 100
        t3 = ov["top3"] / ov["total"] * 100
        t5 = ov["top5"] / ov["total"] * 100
        t10 = ov["top10"] / ov["total"] * 100
        overfit_gap = best_trial_loss - best_trial_train_loss

        rec = {
            "trial_number": trial.number,
            "val_loss": round(best_trial_loss, 5),
            "train_pol_loss": round(best_trial_train_loss, 5),
            "overfit_gap": round(overfit_gap, 5),
            "best_epoch": best_trial_ep,
            "top1_pct": round(t1, 2),
            "top3_pct": round(t3, 2),
            "top5_pct": round(t5, 2),
            "top10_pct": round(t10, 2),
            "win_acc_pct": round(best_trial_win, 2),
            "num_params": num_params,
            "params": dict(trial.params),
        }
        trial_records.append(rec)

        is_global_best = best_trial_loss < global_best["val_loss"]
        star = " *NEW BEST*" if is_global_best else ""
        print(
            f"  [Trial {trial.number:02d}/{args.n_trials:02d}] ({time.time()-t_start:.1f}s) | "
            f"Val: {best_trial_loss:.4f} (Train: {best_trial_train_loss:.4f}, Gap: {overfit_gap:+.4f}, ep={best_trial_ep:02d}) | "
            f"Top-1: {t1:.2f}% | Top-3: {t3:.2f}% | Top-5: {t5:.2f}% | Top-10: {t10:.2f}% | "
            f"(d={d_model}, h={nhead}, L={num_layers}, drop={dropout:.2f}, temp={neural_scale:.2f}, lr={lr:.4f}, aug={augment_factor}){star}",
            flush=True,
        )

        if HAS_MLFLOW:
            mlflow.log_metrics({
                "best_val_loss": best_trial_loss,
                "best_train_pol_loss": best_trial_train_loss,
                "overfit_gap": overfit_gap,
                "top1_pct": t1,
                "top3_pct": t3,
                "top5_pct": t5,
                "top10_pct": t10,
                "win_acc_pct": best_trial_win,
            })
            mlflow.set_tag("is_global_best", str(is_global_best))
            mlflow.end_run()

        if is_global_best and best_trial_state is not None:
            global_best["val_loss"] = best_trial_loss
            global_best["val_metrics"] = best_trial_metrics
            global_best["val_win_acc"] = best_trial_win
            global_best["model_config"] = model_config
            global_best["state_dict"] = best_trial_state
            global_best["trial_number"] = trial.number


        return best_trial_loss

    study = optuna.create_study(
        direction="minimize",
        sampler=TPESampler(seed=SEED),
        pruner=MedianPruner(n_startup_trials=6, n_warmup_steps=3),
    )

    # Enqueue 2 well-regularized baseline trials (compact 64d and medium 128d) so MedianPruner has solid benchmarks
    study.enqueue_trial({
        "d_model": 64,
        "nhead": 4,
        "num_layers": 2,
        "dropout": 0.22,
        "neural_scale": 0.60,
        "lr": 2.0e-3,
        "weight_decay": 8e-3,
        "label_smoothing": 0.04,
        "win_loss_weight": 0.20,
        "batch_size": 512,
        "augment_factor": 1,
    })
    study.enqueue_trial({
        "d_model": 128,
        "nhead": 4,
        "num_layers": 2,
        "dropout": 0.28,
        "neural_scale": 0.55,
        "lr": 1.5e-3,
        "weight_decay": 1.5e-2,
        "label_smoothing": 0.06,
        "win_loss_weight": 0.20,
        "batch_size": 512,
        "augment_factor": 1,
    })

    hpo_start = time.time()
    study.optimize(objective, n_trials=args.n_trials)
    hpo_elapsed = time.time() - hpo_start

    # Sort all completed trial records by val_loss ascending and select Top 5
    trial_records.sort(key=lambda r: r["val_loss"])
    top5_trials = []
    for rank_idx, rec in enumerate(trial_records[:5], start=1):
        r_copy = dict(rec)
        r_copy["rank"] = rank_idx
        top5_trials.append(r_copy)

    # Also identify the "safest" candidate among Top 5 (lowest overfit_gap + compact capacity)
    safest_trial = min(top5_trials, key=lambda r: r["val_loss"] + 0.25 * max(0.0, r["overfit_gap"])) if top5_trials else None

    print("\n" + "=" * 95, flush=True)
    print(f"Optuna HPO Finished {args.n_trials} Trials in {hpo_elapsed:.1f}s!", flush=True)
    print("TOP 5 HYPERPARAMETER CANDIDATES (Sorted by Val Loss + Overfit Gap Safety Metrics):", flush=True)
    print("-" * 95, flush=True)
    for item in top5_trials:
        p = item["params"]
        safe_tag = " [SAFEST]" if safest_trial and item["trial_number"] == safest_trial["trial_number"] else ""
        print(
            f"  Rank #{item['rank']} (Trial {item['trial_number']:02d}){safe_tag}: "
            f"Val={item['val_loss']:.4f} | Train={item['train_pol_loss']:.4f} | Gap={item['overfit_gap']:+.4f} | "
            f"Top-1={item['top1_pct']:.2f}% | Top-3={item['top3_pct']:.2f}% | Top-5={item['top5_pct']:.2f}% | Top-10={item['top10_pct']:.2f}% | "
            f"Params={item['num_params']:,}\n"
            f"      -> d_model={p['d_model']}, nhead={p['nhead']}, layers={p['num_layers']}, dropout={p['dropout']:.3f}, "
            f"neural_scale={p['neural_scale']:.3f}, lr={p['lr']:.5f}, wd={p['weight_decay']:.5f}, "
            f"smooth={p['label_smoothing']:.3f}, batch={p['batch_size']}, aug={p['augment_factor']}",
            flush=True,
        )
    print("=" * 95, flush=True)

    top5_path = BEST_PARAMS_DIR / "sota_rov_top5_trials.json"
    with open(top5_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "n_trials": args.n_trials,
                "elapsed_seconds": round(hpo_elapsed, 2),
                "safest_recommended_trial": safest_trial,
                "top_5_trials": top5_trials,
            },
            f,
            indent=2,
        )
    print(f"Saved Top 5 HPO candidates to: {top5_path}", flush=True)

    best_params_payload = {
        "best_trial_number": study.best_trial.number,
        "best_val_loss": study.best_value,
        "best_params": study.best_params,
        "safest_recommended_trial": safest_trial,
        "top_5_trials": top5_trials,
        "n_trials": args.n_trials,
        "elapsed_seconds": round(hpo_elapsed, 2),
    }
    best_params_path = BEST_PARAMS_DIR / "sota_rov_best_params.json"
    with open(best_params_path, "w", encoding="utf-8") as f:
        json.dump(best_params_payload, f, indent=2)
    print(f"Saved best hyperparameters to: {best_params_path}", flush=True)

    if global_best["state_dict"] is not None:
        ckpt = {
            "architecture": "RoVDraftGNNTransformer",
            "model_config": global_best["model_config"],
            "model_state_dict": global_best["state_dict"],
            "hero_names": hero_names,
            "hero_to_id": hero_to_id,
            "hero_features": hero_features,
            "lane_probs": lane_probs,
            "graphs": graphs,
            "priors": priors,
            "val_loss": global_best["val_loss"],
            "val_win_acc": global_best["val_win_acc"],
            "best_params": study.best_params,
            "top_5_trials": top5_trials,
        }
        torch.save(ckpt, MODEL_DIR / "sota_draft_gnn_transformer.pt")

        print("\n=== Best HPO Model Validation Metrics (Out of 130 Heroes) ===", flush=True)
        for k, label in [
            ("ban_p1", "Ban Phase 1 (Steps 1-4)"),
            ("pick_p1", "Pick Phase 1 (Steps 5-10)"),
            ("ban_p2", "Ban Phase 2 (Steps 11-14)"),
            ("pick_p2", "Pick Phase 2 (Steps 15-18)"),
            ("overall", "Overall All 18 Steps"),
        ]:
            m = global_best["val_metrics"][k]
            tot = max(1, m["total"])
            print(
                f"{label:28s} -> Top-1: {m['top1']/tot*100:5.2f}% | Top-3: {m['top3']/tot*100:5.2f}% | "
                f"Top-5: {m['top5']/tot*100:5.2f}% | Top-10: {m['top10']/tot*100:5.2f}%",
                flush=True,
            )
        print(f"Saved Best SOTA checkpoint to: {MODEL_DIR / 'sota_draft_gnn_transformer.pt'}", flush=True)

    if HAS_MLFLOW:
        with mlflow.start_run(run_name=f"hpo_study_summary_{int(time.time())}"):
            mlflow.log_params({"n_trials": args.n_trials, "trial_epochs": args.trial_epochs})
            mlflow.log_metrics({
                "best_study_val_loss": study.best_value,
                "best_study_trial": study.best_trial.number,
                "elapsed_seconds": round(hpo_elapsed, 2),
            })
            if top5_path.exists():
                mlflow.log_artifact(str(top5_path))
            if best_params_path.exists():
                mlflow.log_artifact(str(best_params_path))
            if (MODEL_DIR / "sota_draft_gnn_transformer.pt").exists():
                mlflow.log_artifact(str(MODEL_DIR / "sota_draft_gnn_transformer.pt"))
        print("MLflow: Logged HPO Study summary and artifacts to experiment 'RoV_Draft_Intelligence'", flush=True)


if __name__ == "__main__":
    main()
