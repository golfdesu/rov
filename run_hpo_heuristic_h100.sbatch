#!/bin/bash
# ==============================================================================
# SLURM Job Script: Fast GPU-Resident Optuna HPO for Heuristic RoVDraftGNNTransformer
# Target Hardware: compute4 node (NVIDIA H100 80GB HBM3) on 'gpu-h100'
# Dataset Target : data/matches_training_heuristic.json (0% True Pick Order)
# Output Target  : best_params/heuristic_sota_best_params.json, models/sota_draft_gnn_transformer_heuristic.pt
# ==============================================================================
#SBATCH --job-name=rov_hpo_heuristic
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

mkdir -p logs models best_params data

echo "=============================================================================="
echo "SLURM Job ID        : $SLURM_JOB_ID"
echo "Allocated Node      : $SLURMD_NODENAME"
echo "Partition           : $SLURM_JOB_PARTITION"
echo "Job Name            : $SLURM_JOB_NAME"
echo "Start Time          : $(date '+%Y-%m-%d %H:%M:%S')"
echo "Working Directory   : $(pwd)"
echo "Target Task         : Optuna HPO (50 Trials) on 0% True Order Dataset + Final Training"
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

# Ensure heuristic training dataset exists
if [ ! -f "data/matches_training_heuristic.json" ]; then
    echo "Building data/matches_training_heuristic.json..."
    python src/build_training_dataset.py --min-year 2025 --no-true-order --output data/matches_training_heuristic.json
fi

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
echo ">>> [STEP 1/2] Running Fast GPU-Resident Optuna HPO (50 Trials, 14 Epochs/Trial) on Heuristic Data..."
echo "=============================================================================="
python -u src/hpo_sota_optuna.py \
    --dataset-path data/matches_training_heuristic.json \
    --output-best-params best_params/heuristic_sota_best_params.json \
    --output-top5 best_params/heuristic_sota_top5_trials.json \
    --output-model-path models/sota_draft_gnn_transformer_heuristic.pt \
    --n-trials 50 \
    --trial-epochs 14

echo ""
echo "=============================================================================="
echo ">>> [STEP 2/2] Training Final Heuristic Model with Safest Top-5 HPO Candidate..."
echo "=============================================================================="
python -u src/train_sota_model.py \
    --preset h100 \
    --dataset-path data/matches_training_heuristic.json \
    --output-model-path models/sota_draft_gnn_transformer_heuristic.pt \
    --top5-path best_params/heuristic_sota_top5_trials.json \
    --best-params-path best_params/heuristic_sota_best_params.json \
    --use-safest

TOTAL_END=$(date +%s)
TOTAL_DIFF=$((TOTAL_END - TOTAL_START))
TOTAL_MIN=$((TOTAL_DIFF / 60))

echo ""
echo "=============================================================================="
echo ">>> ROV HEURISTIC HPO + TRAINING COMPLETED IN ${TOTAL_MIN}m (${TOTAL_DIFF}s)"
echo "Finished at : $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================================================="
