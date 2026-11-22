# ERAWAN HPC & NVIDIA H100 Playbook

This project executes heavy Optuna HPO and full `RoVDraftGNNTransformer` training on the **ERAWAN HPC cluster** (`compute4` node, **NVIDIA H100 80GB HBM3**).

---

## 1. Non-Negotiable SLURM & Environment Rules

1. **Partition & GPU Allocation**:
   - Every `.sbatch` script MUST specify `#SBATCH --partition=gpu-h100` and `#SBATCH --gres=gpu:1`.
   - `run_sota_rov_h100.sbatch` also enforces a runtime hardware assertion checking that `nvidia-smi` reports `*H100*` before launching training.
2. **STRICT BAN on `torch.compile()`**:
   - The Rocky Linux container/OS environment on `compute4` lacks `Python.h` (`python3-devel`) headers. Calling `torch.compile()` crashes immediately during Inductor/Triton compilation. Always run in PyTorch CUDA eager mode.
3. **No Artificial VRAM Throttling**:
   - Never call `torch.cuda.set_per_process_memory_fraction(...)` on H100 nodes; use the full 80GB HBM3 for resident dataset caching.
4. **Hopper TF32 & Determinism Environment Variables**:
   - SLURM scripts export `NVIDIA_TF32_OVERRIDE=1`, `TORCH_CUDA_ARCH_LIST="9.0"`, `CUDA_DEVICE_ORDER="PCI_BUS_ID"`, and `PYTHONUNBUFFERED=1`.

---

## 2. High-Throughput GPU Execution Architecture

- **`GPUTensorBatcher` (`src/train_sota_model.py`, `src/hpo_sota_optuna.py`)**:
  - Pre-loads the entire encoded tensor dataset onto GPU memory once before the epoch loop so `batch_size = 512` / `1024` steps run with zero CPU-to-GPU DataLoader bottlenecks.
- **Vectorized Evaluation (`evaluate_sota_model()`)**:
  - Computes validation loss, Top-1/3/5/10 accuracy, and WinAcc in pure vectorized tensor operations—never insert per-sample `.item()` synchronization loops on GPU.

---

## 3. SLURM Job Catalog

| Script | Purpose | Key Command |
| :--- | :--- | :--- |
| `run_hpo_rov_h100.sbatch` | 80-trial Optuna HPO (`14` epochs/trial) + final `--use-safest` training + CLI demo | `sbatch run_hpo_rov_h100.sbatch` |
| `run_sota_rov_h100.sbatch` | Direct SOTA training with `--preset h100 --use-safest` + hardware H100 check | `sbatch run_sota_rov_h100.sbatch` |
| `run_hpo_heuristic_h100.sbatch` | 50-trial ablation HPO on 0% true pick order (`matches_training_heuristic.json`) | `sbatch run_hpo_heuristic_h100.sbatch` |

---

## Related Wiki Articles

- [`production_hyperparameters_and_hpo.md`](production_hyperparameters_and_hpo.md)
- [`../traces/h100_hpo_and_training_trace.md`](../traces/h100_hpo_and_training_trace.md)
- [`../skills/scripts/preflight_check.py`](../skills/scripts/preflight_check.py)
