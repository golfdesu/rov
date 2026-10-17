---
name: erawan-hpc-ops
description: >-
  Operational runbook for running SLURM jobs, Optuna HPO, and SOTA PyTorch training on the
  ERAWAN HPC cluster (compute4 node, NVIDIA H100 80GB HBM3, partition gpu-h100). Use this
  skill whenever modifying .sbatch files, troubleshooting HPC jobs, or syncing logs and
  checkpoints via Git between Windows and ERAWAN HPC.
---

# ERAWAN HPC Operations & H100 Playbook (`SKILL.hpc`)

Use this skill whenever preparing, launching, monitoring, or syncing SLURM jobs on ERAWAN HPC (`compute4` node, NVIDIA H100 80GB HBM3).

---

## 1. Critical ERAWAN HPC Hardware & Software Constraints

1. **SLURM Partition & Node**:
   - Always use `#SBATCH --partition=gpu-h100` and `#SBATCH --gres=gpu:1`.
2. **NEVER Use `torch.compile`**:
   - Rocky Linux on `compute4` does not have `python3-devel` (`Python.h`). Calling `torch.compile` crashes immediately. Always use PyTorch eager mode with Hopper TF32 + `bfloat16` AMP:
     ```python
     if device.type == "cuda":
         torch.backends.cuda.matmul.allow_tf32 = True
         torch.backends.cudnn.allow_tf32 = True
         torch.backends.cudnn.benchmark = True
     ```
3. **Line Endings Must Be LF (`.gitattributes`)**:
   - `.sbatch` and `.sh` files MUST have LF line endings so SLURM on Linux does not fail with `dos2unix` / `\r` errors.
4. **Virtual Environment Resolution**:
   - ERAWAN jobs automatically check `.venv/bin/activate`, `$HOME/project/HPO/.venv/bin/activate`, and `../environment/.venv/bin/activate`.

---

## 2. Standard ERAWAN Workflow Commands

### Submit Jobs on ERAWAN
```bash
git pull origin main
# Option A: Full Fast Optuna HPO (40 trials) + Safest Model Training
sbatch run_hpo_rov_h100.sbatch

# Option B: Direct SOTA Training using locked best_params
sbatch run_sota_rov_h100.sbatch
```

### Monitor Jobs & View Real-Time Logs
```bash
squeue -j <JOB_ID>
tail -f logs/rov_hpo_h100_<JOB_ID>.out
```

### Push Trained Artifacts Back from ERAWAN to GitHub
If `git push` on ERAWAN triggers `gnome-ssh-askpass: cannot open display`, disable GUI askpass first:
```bash
unset SSH_ASKPASS
unset GIT_ASKPASS
git config --global core.askPass ""
git add best_params/sota_rov_best_params.json best_params/sota_rov_top5_trials.json models/sota_draft_gnn_transformer.pt
git commit -m "Update H100 HPO results and trained SOTA checkpoint"
git push origin main
```
