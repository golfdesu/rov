---
name: erawan-hpc-ops
description: >-
  Operational runbook for running SLURM jobs, Optuna HPO, and SOTA PyTorch training on the
  ERAWAN HPC cluster (compute4 node, NVIDIA H100 80GB HBM3, partition gpu-h100). Use this
  skill whenever modifying .sbatch files, troubleshooting HPC jobs, or syncing logs and
  checkpoints via Git between Windows and ERAWAN HPC.
---

# ERAWAN HPC Operations & H100 Playbook

Use this skill whenever preparing, launching, monitoring, or syncing SLURM jobs on ERAWAN HPC (`compute4` node, NVIDIA H100 80GB HBM3).

---

## 1. Critical ERAWAN HPC Hardware & Software Constraints

1. **SLURM Partition & Node**: always `#SBATCH --partition=gpu-h100` and `#SBATCH --gres=gpu:1`.
2. **NEVER Use `torch.compile`**: Rocky Linux on `compute4` has no `python3-devel` (`Python.h`), so `torch.compile` crashes immediately. Use eager mode with Hopper TF32 + `bfloat16` AMP:
   ```python
   if device.type == "cuda":
       torch.backends.cuda.matmul.allow_tf32 = True
       torch.backends.cudnn.allow_tf32 = True
       torch.backends.cudnn.benchmark = True
   ```
3. **GPU-Resident Training**: use `GPUTensorBatcher` and the vectorized `evaluate_sota_model()`. No per-sample `.item()` loops on GPU.
4. **Line Endings Must Be LF**: `.gitattributes` forces `eol=lf` for `*.sbatch`, `*.sh`, and `*.py`, so SLURM never sees `\r`. If you write these files from Windows tools, check them with `file <path>` before committing.
5. **Virtual Environment Resolution**: the `.sbatch` jobs try, in order, `.venv/bin/activate`, `$HOME/project/HPO/.venv/bin/activate`, `../environment/.venv/bin/activate`, `../.venv/bin/activate`.

---

## 2. Standard ERAWAN Workflow Commands

### Submit Jobs on ERAWAN
```bash
git pull origin main
# Option A: Fast GPU-resident Optuna HPO (40 trials) + safest-model training
sbatch run_hpo_rov_h100.sbatch

# Option B: Direct SOTA training with the locked best_params
sbatch run_sota_rov_h100.sbatch
```

### Monitor Jobs & View Real-Time Logs
```bash
squeue -j <JOB_ID>
tail -f logs/rov_hpo_h100_<JOB_ID>.out
```

### Experiment Tracking (MLflow)
`src/train_sota_model.py` logs params, per-epoch metrics, and the checkpoint to the MLflow experiment `RoV_Draft_Intelligence` when `mlflow` is importable (it is in `requirements.txt`). `mlruns/` and `mlflow.db` are gitignored, so copy them off the cluster yourself if you need the run history; only the checkpoint and `best_params/*.json` travel through Git.

### Push Trained Artifacts Back from ERAWAN to GitHub
If `git push` on ERAWAN fails with `gnome-ssh-askpass: cannot open display`, disable GUI askpass first:
```bash
unset SSH_ASKPASS
unset GIT_ASKPASS
git config --global core.askPass ""
git add best_params/sota_rov_best_params.json best_params/sota_rov_top5_trials.json models/sota_draft_gnn_transformer.pt
git commit -m "Update H100 HPO results and trained SOTA checkpoint"
git push origin main
```

### After Pulling a New Checkpoint on Windows
1. `python .agents/skills/hpo-parsimony-selector/scripts/select_parsimonious_params.py`: confirm the served metrics and update the config / `AGENTS.md` table if they changed.
2. `pytest -v`: `tests/test_predictor_golden.py` will fail because recommendations changed. Regenerate it on purpose (see `rov-draft-serving`).
3. Add a `CHANGELOG.md` entry.
