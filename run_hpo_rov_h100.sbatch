#!/bin/bash
# ==============================================================================
# SLURM Job Script: Fast GPU-Resident Optuna HPO for RoVDraftGNNTransformer
# Target Hardware: compute4 node (NVIDIA H100 80GB HBM3) on 'gpu-h100'
# Output Target  : best_params/sota_rov_best_params.json, models/sota_draft_gnn_transformer.pt
# ==============================================================================
#SBATCH --job-name=rov_hpo_h100
#SBATCH --output=logs/%x_%j.out
#SBATCH --error=logs/%x_%j.out
#SBATCH --partition=gpu-h100
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --gres=gpu:1
#SBATCH --mem=64G
#SBATCH --time=01:30:00

set -eo pipefail

mkdir -p logs models best_params

echo "=============================================================================="
echo "SLURM Job ID        : $SLURM_JOB_ID"
echo "Allocated Node      : $SLURMD_NODENAME"
echo "Partition           : $SLURM_JOB_PARTITION"
echo "Job Name            : $SLURM_JOB_NAME"
echo "Start Time          : $(date '+%Y-%m-%d %H:%M:%S')"
echo "Working Directory   : $(pwd)"
echo "Target Task         : Fast GPU-Resident Optuna HPO (50 Trials) + Final SOTA Training"
echo "Unified Log File    : logs/${SLURM_JOB_NAME}_${SLURM_JOB_ID}.out"
echo "=============================================================================="

# 1. Environment & CUDA Setup
if command -v module &> /dev/null; then
    module purge
    module load cuda/12.4 2>/dev/null || module load cuda 2>/dev/null || true
fi

# Prefer HPO .venv if present, or project environment .venv
if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
elif [ -f "$HOME/project/HPO/.venv/bin/activate" ]; then
    source "$HOME/project/HPO/.venv/bin/activate"
elif [ -f "../environment/.venv/bin/activate" ]; then
    source ../environment/.venv/bin/activate
elif [ -f "../.venv/bin/activate" ]; then
    source ../.venv/bin/activate
elif [ -d "$HOME/project/my-model/.venv" ]; then
    source "$HOME/project/my-model/.venv/bin/activate"
elif [ -f "$HOME/.venv/bin/activate" ]; then
    source "$HOME/.venv/bin/activate"
else
    echo "Warning: No virtualenv found, using default python: $(which python)"
fi

echo "Python Executable   : $(which python)"

# Ensure optuna and mlflow are installed in the active environment
python -c "import optuna" 2>/dev/null || pip install -q optuna
python -c "import mlflow" 2>/dev/null || pip install -q mlflow

# 2. Hardware Verification
echo "------------------------------------------------------------------------------"
nvidia-smi
echo "------------------------------------------------------------------------------"

# 3. High-Performance Hopper & H100 Settings
export PYTHONUNBUFFERED=1
export NVIDIA_TF32_OVERRIDE=1
export TORCH_CUDA_ARCH_LIST="9.0"
export CUDA_DEVICE_ORDER="PCI_BUS_ID"
export OMP_NUM_THREADS=16

python -c "import torch, optuna; print(f'PyTorch: {torch.__version__} | Optuna: {optuna.__version__} | CUDA: {torch.cuda.is_available()}')"

TOTAL_START=$(date +%s)

echo ""
echo "=============================================================================="
echo ">>> [STEP 1/3] Running Fast GPU-Resident Optuna HPO (50 Trials, 14 Epochs/Trial)..."
echo "=============================================================================="
python -u src/hpo_sota_optuna.py --n-trials 50 --trial-epochs 14

echo ""
echo "=============================================================================="
echo ">>> [STEP 2/3] Training Final SOTA Model with Safest Top-5 HPO Candidate..."
echo "=============================================================================="
python -u src/train_sota_model.py --preset h100 --use-safest

echo ""
echo "=============================================================================="
echo ">>> [STEP 3/3] Running Pro Draft Prediction Scenarios..."
echo "=============================================================================="
python -u src/predict_draft_cli.py --demo

TOTAL_END=$(date +%s)
TOTAL_DIFF=$((TOTAL_END - TOTAL_START))
TOTAL_MIN=$((TOTAL_DIFF / 60))

echo ""
echo "=============================================================================="
echo ">>> ROV FAST HPO + SOTA TRAINING COMPLETED IN ${TOTAL_MIN}m (${TOTAL_DIFF}s)"
echo "Finished at : $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================================================="
