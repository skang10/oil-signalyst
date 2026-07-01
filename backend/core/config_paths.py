from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_LOCAL_REPO_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND_ROOT if (_BACKEND_ROOT / "config").exists() else _LOCAL_REPO_ROOT

CONFIG_DIR = _REPO_ROOT / "config"
DATA_DIR = _REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
CFTC_RAW_DIR = RAW_DIR / "cftc"
FEATURES_DIR = DATA_DIR / "features"
MODELS_DIR = DATA_DIR / "models"
MLRUNS_DIR = DATA_DIR / "mlruns"
LOGS_DIR = _REPO_ROOT / "logs"
ENV_FILE = _REPO_ROOT / ".env"

DATA_SOURCES_YAML = CONFIG_DIR / "data_sources.yaml"
FEATURES_YAML = CONFIG_DIR / "features.yaml"
DEFAULT_DB_URL = f"sqlite+aiosqlite:///{DATA_DIR / 'oilmarket.db'}"
