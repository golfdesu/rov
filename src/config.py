from pathlib import Path


class PathConfig:
    def __init__(self):
        self.base_dir: Path = Path(__file__).resolve().parent.parent
        self.data_dir: Path = self.base_dir / "data"
        self.models_dir: Path = self.base_dir / "models"
        self.configs_dir: Path = self.base_dir / "configs"
        self.best_params_dir: Path = self.base_dir / "best_params"

        self.heroes_json_path: Path = self.data_dir / "heroes_130_full.json"
        self.heroes_csv_path: Path = self.data_dir / "heroes_130_summary.csv"
        self.hero_skills_json_path: Path = self.data_dir / "hero_skills_full.json"
        self.matches_json_path: Path = self.data_dir / "matches_draft_full.json"
        self.matches_csv_path: Path = self.data_dir / "matches_draft_flat.csv"
        self.hero_stats_csv_path: Path = self.data_dir / "hero_draft_stats.csv"
        self.items_json_path: Path = self.data_dir / "items.json"
        self.hero_patch_history_path: Path = self.data_dir / "hero_patch_history.json"
        self.hero_level_stats_json_path: Path = self.data_dir / "hero_level_stats.json"
        self.hero_level_stats_csv_path: Path = self.data_dir / "hero_level_stats.csv"
        self.arcana_json_path: Path = self.data_dir / "arcana.json"
        self.enchantments_json_path: Path = self.data_dir / "enchantments.json"
        self.synergy_csv_path: Path = self.data_dir / "synergy_matrix.csv"
        self.counter_csv_path: Path = self.data_dir / "counter_matrix.csv"
        self.draft_session_path: Path = self.data_dir / "draft_session_state.json"

        self.sota_model_path: Path = self.models_dir / "sota_draft_gnn_transformer.pt"
        self.baseline_model_path: Path = self.models_dir / "draft_predictor.pt"
        self.production_params_path: Path = self.configs_dir / "selected_production_params.json"
        self.top5_trials_path: Path = self.best_params_dir / "sota_rov_top5_trials.json"


class DraftModelConfig:
    def __init__(
        self,
        num_heroes: int = 130,
        d_model: int = 128,
        nhead: int = 4,
        num_layers: int = 4,
        dropout: float = 0.3025,
        neural_scale: float = 0.2754,
        lr: float = 0.001184,
        weight_decay: float = 0.04004,
        label_smoothing: float = 0.0030,
        win_loss_weight: float = 0.2572,
        batch_size: int = 512,
        augment_factor: int = 1,
        random_state: int = 42,
    ):
        self.num_heroes = num_heroes
        self.d_model = d_model
        self.nhead = nhead
        self.num_layers = num_layers
        self.dropout = dropout
        self.neural_scale = neural_scale
        self.lr = lr
        self.weight_decay = weight_decay
        self.label_smoothing = label_smoothing
        self.win_loss_weight = win_loss_weight
        self.batch_size = batch_size
        self.augment_factor = augment_factor
        self.random_state = random_state


class HPOConfig:
    def __init__(
        self,
        n_trials: int = 40,
        trial_epochs: int = 14,
        epsilon_tolerance: float = 0.01,
        random_state: int = 42,
    ):
        self.n_trials = n_trials
        self.trial_epochs = trial_epochs
        self.epsilon_tolerance = epsilon_tolerance
        self.random_state = random_state


class Config:
    def __init__(
        self,
        paths: PathConfig | None = None,
        model: DraftModelConfig | None = None,
        hpo: HPOConfig | None = None,
    ):
        self.paths = paths if paths is not None else PathConfig()
        self.model = model if model is not None else DraftModelConfig()
        self.hpo = hpo if hpo is not None else HPOConfig()


config = Config()
