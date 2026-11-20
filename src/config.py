import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)


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
        self.hero_level_stats_json_path: Path = self.data_dir / "hero_level_stats.json"
        self.hero_level_stats_csv_path: Path = self.data_dir / "hero_level_stats.csv"
        self.hero_status_lv1_path: Path = self.data_dir / "hero_status_lv1.json"
        self.hero_status_lv15_path: Path = self.data_dir / "hero_status_lv15.json"
        self.matches_json_path: Path = self.data_dir / "matches_draft_full.json"
        self.matches_training_path: Path = self.data_dir / "matches_training.json"
        self.true_pick_order_path: Path = self.data_dir / "true_pick_order.json"
        self.screenshots_manifest_path: Path = self.data_dir / "screenshots_manifest.json"
        self.matches_csv_path: Path = self.data_dir / "matches_draft_flat.csv"
        self.hero_stats_csv_path: Path = self.data_dir / "hero_draft_stats.csv"
        self.items_json_path: Path = self.data_dir / "items.json"
        self.hero_patch_history_path: Path = self.data_dir / "hero_patch_history.json"
        self.arcana_json_path: Path = self.data_dir / "arcana.json"
        self.enchantments_json_path: Path = self.data_dir / "enchantments.json"
        self.synergy_csv_path: Path = self.data_dir / "synergy_matrix.csv"
        self.counter_csv_path: Path = self.data_dir / "counter_matrix.csv"
        self.draft_session_path: Path = self.data_dir / "draft_session_state.json"
        self.app_db_path: Path = Path(os.environ.get("ROV_DB_PATH", str(self.data_dir / "rov_app.db")))
        self.hero_tier_overrides_path: Path = self.data_dir / "hero_tier_overrides.json"
        self.frontend_dir: Path = self.base_dir / "frontend"
        self.frontend_dist_dir: Path = self.frontend_dir / "dist"
        self.frontend_dist_prod_dir: Path = self.frontend_dir / "dist-prod"

        self.sota_model_path: Path = self.models_dir / "sota_draft_gnn_transformer.pt"
        self.heuristic_model_path: Path = self.models_dir / "sota_draft_gnn_transformer_heuristic.pt"
        self.baseline_model_path: Path = self.models_dir / "draft_predictor.pt"
        self.production_params_path: Path = self.configs_dir / "selected_production_params.json"
        self.top5_trials_path: Path = self.best_params_dir / "sota_rov_top5_trials.json"


class DraftModelConfig:
    def __init__(
        self,
        num_heroes: int = 130,
        d_model: int = 256,
        nhead: int = 4,
        num_layers: int = 1,
        dropout: float = 0.2513,
        neural_scale: float = 1.3326,
        lr: float = 0.001211,
        weight_decay: float = 0.001459,
        label_smoothing: float = 0.0395,
        win_loss_weight: float = 0.1266,
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
        env: str | None = None,
    ):
        self.paths = paths if paths is not None else PathConfig()
        self.model = model if model is not None else DraftModelConfig()
        self.hpo = hpo if hpo is not None else HPOConfig()
        self.env: str = (env or os.environ.get("ROV_ENV", "development")).strip().lower()

        raw_origins = os.environ.get("ROV_CORS_ORIGINS", "").strip()
        if raw_origins:
            self.cors_origins: list[str] = [o.strip() for o in raw_origins.split(",") if o.strip()]
        elif self.env == "production":
            self.cors_origins = [
                "https://minidraft.app",
                "https://www.minidraft.app",
            ]
        else:
            self.cors_origins = [
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:8000",
                "http://127.0.0.1:8000",
            ]

        raw_proxies = os.environ.get("ROV_TRUSTED_PROXIES", "loopback").strip()
        self.trusted_proxies: tuple[str, ...] = tuple(
            p.strip().lower() for p in raw_proxies.split(",") if p.strip()
        ) or ("loopback",)

        self.google_client_id: str = os.environ.get("ROV_GOOGLE_CLIENT_ID", "").strip()
        self.google_client_secret: str = os.environ.get("ROV_GOOGLE_CLIENT_SECRET", "").strip()
        self.google_redirect_uri: str = os.environ.get("ROV_GOOGLE_REDIRECT_URI", "").strip()
        self.discord_client_id: str = os.environ.get("ROV_DISCORD_CLIENT_ID", "").strip()
        self.discord_client_secret: str = os.environ.get("ROV_DISCORD_CLIENT_SECRET", "").strip()
        self.discord_redirect_uri: str = os.environ.get("ROV_DISCORD_REDIRECT_URI", "").strip()

        raw_admins = os.environ.get("ROV_ADMIN_USERNAMES", "chayanin5392").strip()
        self.admin_usernames: tuple[str, ...] = tuple(
            u.strip().lower() for u in raw_admins.split(",") if u.strip()
        ) or ("chayanin5392",)
        self.cf_api_token: str = os.environ.get("ROV_CF_API_TOKEN", "").strip()
        self.cf_account_id: str = os.environ.get("ROV_CF_ACCOUNT_ID", "").strip()
        self.cf_zone_id: str = os.environ.get("ROV_CF_ZONE_ID", "").strip()

    def is_admin_username(self, username: str | None) -> bool:
        return bool(username and username.strip().lower() in self.admin_usernames)

    @property
    def google_oauth_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def discord_oauth_enabled(self) -> bool:
        return bool(self.discord_client_id and self.discord_client_secret)

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    def resolve_frontend_dist(self) -> Path:
        override = os.environ.get("ROV_FRONTEND_DIST", "").strip()
        if override:
            return Path(override)
        if self.is_production:
            if not self.paths.frontend_dist_prod_dir.is_dir():
                raise RuntimeError(
                    "Production frontend bundle missing at frontend/dist-prod/. "
                    "Build it first via: VITE_DRAFT_ONLY=true VITE_OUT_DIR=dist-prod npm run build:prod"
                )
            return self.paths.frontend_dist_prod_dir
        return self.paths.frontend_dist_dir


config = Config()
