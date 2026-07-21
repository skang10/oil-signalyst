from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_LOCAL_REPO_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND_ROOT if (_BACKEND_ROOT / "config").exists() else _LOCAL_REPO_ROOT

CONFIG_DIR = _REPO_ROOT / "config"
DATA_DIR = _REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
CFTC_RAW_DIR = RAW_DIR / "cftc"
# Per-source persisted raw series (one Parquet per source) for the adapters that
# don't manage their own disk cache - Yahoo/FRED/EIA. Lets backfill and process
# restarts read history from disk instead of re-downloading it. See
# core/data/series_store.py.
SERIES_CACHE_DIR = RAW_DIR / "series"
FEATURES_DIR = DATA_DIR / "features"
MODELS_DIR = DATA_DIR / "models"
MLRUNS_DIR = DATA_DIR / "mlruns"
LOGS_DIR = _REPO_ROOT / "logs"
ENV_FILE = _REPO_ROOT / ".env"

DATA_SOURCES_YAML = CONFIG_DIR / "data_sources.yaml"
FEATURES_YAML = CONFIG_DIR / "features.yaml"

# Per-source freshness snapshot: the expensive live fetch of every source's
# last-updated timestamp, persisted off the interactive request path (written
# by the daily pipeline and a background startup warm) so the Data/Model
# Monitor pages read it in milliseconds instead of re-fetching all sources.
FRESHNESS_SNAPSHOT = DATA_DIR / "freshness_snapshot.json"
DEFAULT_DB_URL = f"sqlite+aiosqlite:///{DATA_DIR / 'oilmarket.db'}"
