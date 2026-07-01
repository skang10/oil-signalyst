# oil-signalyst — Foundation Phase Spec

**Version:** 0.6 — FINAL
**Phase:** 1 — Foundation  
**Last updated:** 2026-07-01  
**Changelog:**  
- v0.2: Q1–Q4 decisions incorporated  
- v0.3: Bug fixes (missing import, health date cast, depends_on condition, session logic); added crud.py, alembic.ini, gitkeep files; removed duplicate checklist; fixed config path resolution  
- v0.4: Added `users` table; `DataFetchCache`; `data/models/` directory; `api/dependencies.py`; fixed `spec_net_pct` window param; added `core/cache.py`  
- v0.5 FINAL: Phase 2–4 forward compatibility — added `feature_snapshot_id` FK to Prediction; added `user_id` FK to SystemLog; fixed `asyncio.get_event_loop()` deprecation in runner.py; added Parquet write in jobs.py; added `FEATURES_DIR` / `MODELS_DIR` to config_paths.py; fixed `return_dist` key naming (pure underscores)
- v0.6 FINAL: Fixed async Alembic setup; normalized repo-root paths; replaced Docker curl healthcheck; fixed weekly feature window units; clarified integration tests require API keys; corrected minor consistency issues

---

## 1. Overview

This document specifies everything needed to complete Phase 1 of oil-signalyst: a working project scaffold, data pipeline, database schema, and API skeleton. Phase 1 is complete when `docker compose up` starts both services, `/health` returns green, and the daily pipeline runs end-to-end and writes a row to the database.

**Out of scope for Phase 1:** ML models, predictions, frontend, Agent.

---

## 2. Repository Structure

Monorepo. Root contains `docker-compose.yml` and shared config. `backend/` is the Python package. `frontend/` is scaffolded but empty in Phase 1.

```
oil-signalyst/
├── backend/
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── .python-version          # 3.12
│   ├── Dockerfile
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   ├── api/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI app factory
│   │   ├── dependencies.py      # Depends() helpers: get_db_session, get_current_user
│   │   └── routes/
│   │       ├── __init__.py
│   │       └── health.py        # GET /health
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py            # pydantic-settings Settings class
│   │   ├── config_paths.py      # Repo-root-relative path constants
│   │   ├── cache.py             # DataFetchCache (in-memory → Redis in cloud)
│   │   ├── logging.py           # JSON structured logger
│   │   ├── exceptions.py        # Custom exception hierarchy
│   │   └── data/
│   │       ├── __init__.py
│   │       ├── registry.py      # DataRegistry (uses DataFetchCache)
│   │       └── sources/
│   │           ├── __init__.py
│   │           ├── base.py      # Abstract BaseSource
│   │           ├── eia.py       # EIA adapter (holiday-aware)
│   │           ├── yahoo.py     # Yahoo Finance adapter
│   │           ├── fred.py      # FRED adapter
│   │           └── cftc.py      # CFTC COT adapter (ZIP download + cache)
│   ├── features/
│   │   ├── __init__.py
│   │   └── engine.py            # FeatureEngine
│   ├── db/
│   │   ├── __init__.py
│   │   ├── database.py          # SQLAlchemy engine + session factory
│   │   ├── models.py            # ORM table definitions (incl. User)
│   │   └── crud.py              # Read/write helpers
│   ├── scheduler/
│   │   ├── __init__.py
│   │   ├── runner.py            # APScheduler entry point
│   │   └── jobs.py              # Daily pipeline job
│   └── tests/
│       ├── __init__.py
│       ├── test_data.py
│       ├── test_features.py
│       └── test_health.py
├── frontend/                    # Empty in Phase 1
├── config/
│   ├── data_sources.yaml
│   └── features.yaml
│   # Note: user config lives in the database (users table), not in YAML
├── data/                        # Mounted as Docker volume
│   ├── oilmarket.db             # SQLite database
│   ├── raw/                     # Raw fetched data (Parquet)
│   │   └── cftc/                # CFTC annual ZIP cache
│   ├── features/                # Feature matrices (Parquet)
│   └── models/                  # Trained model files (.joblib) — used in Phase 2
├── logs/                        # Mounted as Docker volume
├── .env                         # Never committed
├── .env.example                 # Committed
├── .gitignore
├── docker-compose.yml
└── README.md
```

---

## 3. Environment & Tooling

### 3.1 Python version

```
# backend/.python-version
3.12
```

### 3.2 Dependencies (`backend/pyproject.toml`)

```toml
[project]
name = "oil-signalyst"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "apscheduler>=3.10.0",
    "sqlalchemy>=2.0.0",
    "alembic>=1.13.0",
    "pydantic-settings>=2.5.0",
    "aiosqlite>=0.20.0",
    "yfinance>=0.2.0",
    "fredapi>=0.5.0",
    "requests>=2.32.0",
    "pandas>=2.2.0",
    "numpy>=1.26.0",
    "pyarrow>=17.0.0",
    "pyyaml>=6.0.0",
    "python-dotenv>=1.0.0",
    "tenacity>=8.5.0",
    "workalendar>=17.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "httpx>=0.27.0",
    "ruff>=0.8.0",
]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

### 3.3 Key commands

```bash
# Install all deps
uv sync

# Install with dev deps
uv sync --extra dev

# Run API (development)
uv run uvicorn api.main:app --reload --port 8000

# Run scheduler
uv run python scheduler/runner.py

# Run tests
uv run pytest

# Lint + format
uv run ruff check .
uv run ruff format .

# Database migrations
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "description"
```

---

## 4. Environment Variables

### 4.1 `.env.example`

```bash
# API Keys
EIA_API_KEY=your_eia_key_here
FRED_API_KEY=your_fred_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here

# Database
# Optional. If omitted, the app uses data/oilmarket.db under the resolved repo/app root.
# DB_URL=sqlite+aiosqlite:////absolute/path/to/oilmarket.db

# Environment
ENV=local                        # local | staging | production
LOG_LEVEL=INFO

# Scheduler
SCHEDULER_ENABLED=true
PIPELINE_CRON_HOUR=22            # UTC hour for daily pipeline
PIPELINE_CRON_MINUTE=0
```

### 4.2 Settings class (`core/config.py`)

```python
from pydantic_settings import BaseSettings
from core.config_paths import DEFAULT_DB_URL, ENV_FILE

class Settings(BaseSettings):
    # API keys
    eia_api_key: str
    fred_api_key: str
    anthropic_api_key: str = ""        # Not needed in Phase 1

    # Database
    db_url: str = DEFAULT_DB_URL

    # Environment
    env: str = "local"
    log_level: str = "INFO"

    # Scheduler
    scheduler_enabled: bool = True
    pipeline_cron_hour: int = 22
    pipeline_cron_minute: int = 0

    class Config:
        env_file = ENV_FILE
        env_file_encoding = "utf-8"

# Singleton
settings = Settings()
```

---

## 5. Docker

### 5.1 `backend/Dockerfile`

```dockerfile
FROM python:3.12-slim

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Layer 1: dependency files only (cached until deps change)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

# Layer 2: source code
COPY . .
RUN uv sync --frozen

EXPOSE 8000
```

### 5.2 `docker-compose.yml`

```yaml
services:

  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
      - ./config:/app/config
      - ./logs:/app/logs
    env_file:
      - .env
    command: uv run uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=5)"]
      interval: 30s
      timeout: 10s
      retries: 3
    depends_on:
      migrate:
        condition: service_completed_successfully

  scheduler:
    build:
      context: ./backend
      dockerfile: Dockerfile
    volumes:
      - ./data:/app/data
      - ./config:/app/config
      - ./logs:/app/logs
    env_file:
      - .env
    command: uv run python scheduler/runner.py
    depends_on:
      migrate:
        condition: service_completed_successfully

  migrate:
    build:
      context: ./backend
      dockerfile: Dockerfile
    volumes:
      - ./data:/app/data
    env_file:
      - .env
    command: uv run alembic upgrade head
    # Runs once and exits; api + scheduler wait for it
```

**Note:** `migrate` service runs Alembic on every `docker compose up`, then exits. The `api` and `scheduler` services use `depends_on` to ensure migrations complete first. This is safe because Alembic is idempotent — if the schema is already current, it does nothing.

---

## 6. Database Schema

### 6.1 ORM models (`db/models.py`)

Six tables. All use `Integer` primary keys for SQLite compatibility (UUID would require additional handling).

```python
from sqlalchemy import (
    Column, Integer, String, Float, Boolean,
    DateTime, Date, Text, JSON, ForeignKey
)
from sqlalchemy.orm import DeclarativeBase, relationship
from datetime import datetime

class Base(DeclarativeBase):
    pass


class User(Base):
    """
    One row per team member.
    Stores role, instrument preferences, and alert thresholds.
    Replaces user_config.yaml — config is CRUD'd via API, not hand-edited.

    Phase 1: table is created and seeded with a default user.
    Phase 2: GET/PUT /api/users/me endpoints allow the frontend
             three-step config UI to read and write this table.

    Identity in Phase 1 is minimal: X-User-Id header (integer).
    Phase 2+ can add proper auth without changing the schema.
    """
    __tablename__ = "users"

    id                       = Column(Integer, primary_key=True, autoincrement=True)
    name                     = Column(String(100), nullable=False)
    role                     = Column(String(20), nullable=False, default="researcher")
    # role values: "trader" | "risk" | "researcher" | "ds"

    # Notification
    email                    = Column(String(255))
    alert_channel            = Column(String(20), default="email")
    alert_slack_channel      = Column(String(100))

    # Instrument preferences
    instruments              = Column(JSON, default=lambda: ["CL=F"])
    horizon_days             = Column(Integer, default=20)
    exposure_barrels         = Column(Integer, default=100000)

    # Alert thresholds
    alert_downside_threshold = Column(Float, default=0.45)
    alert_regime_threshold   = Column(Float, default=0.30)
    alert_eia_threshold      = Column(Float, default=1.5)

    created_at               = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at               = Column(DateTime, default=datetime.utcnow,
                                      onupdate=datetime.utcnow, nullable=False)


class Prediction(Base):
    """
    One row per model run per day.
    Stores all three model outputs together for easy retrieval.
    JSON columns keep schema flexible as models evolve.

    return_dist key convention (pure underscores, no hyphens — matches frontend TS types):
        lt_minus10  → P(return < -10%)
        neg_10_0    → P(-10% ≤ return < 0%)
        pos_0_10    → P(0% ≤ return < +10%)
        gt_10       → P(return ≥ +10%)
    """
    __tablename__ = "predictions"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    date                = Column(Date, nullable=False, index=True)
    regime_probs        = Column(JSON)   # {"R1": 0.18, "R2": 0.08, "R3": 0.61, "R4": 0.13}
    return_dist         = Column(JSON)   # {"lt_minus10": 0.21, "neg_10_0": 0.30, "pos_0_10": 0.34, "gt_10": 0.15}
    eia_forecast        = Column(JSON)   # {"crude": -2.8, "interval_80": [-4.5, -1.1], ...}
    shap_values         = Column(JSON)   # {"curve_slope": 0.18, "crude_inv_dev": 0.16, ...}
    decision            = Column(JSON)   # {"direction": "FLAT", "hedge_ratio": 0.75, ...}
    model_version_id    = Column(Integer, ForeignKey("model_versions.id"), nullable=True)
    # FK to the exact feature snapshot used as model input for this prediction.
    # Allows the History detail drawer (Features tab) to show the precise inputs.
    # Nullable in Phase 1 (no predictions yet); populated by Phase 2 inference.
    feature_snapshot_id = Column(Integer, ForeignKey("feature_snapshots.id"), nullable=True)
    created_at          = Column(DateTime, default=datetime.utcnow, nullable=False)

    model_version    = relationship("ModelVersion", back_populates="predictions")
    feature_snapshot = relationship("FeatureSnapshot")


class FeatureSnapshot(Base):
    """
    Raw feature values used as model input each day.
    Used for drift monitoring (PSI) and prediction explainability.
    Unique constraint on date: one snapshot per day.
    """
    __tablename__ = "feature_snapshots"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    date            = Column(Date, nullable=False, unique=True, index=True)
    features        = Column(JSON, nullable=False)  # {"curve_slope": -2.41, "ovx": 28.3, ...}
    feature_version = Column(String(16))             # MD5[:8] of features.yaml
    psi_scores      = Column(JSON)                   # {"curve_slope": 0.08, ...} — null until Phase 2
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False)


class ModelVersion(Base):
    """
    Every trained model gets a version row.
    is_active=True means this version is currently serving predictions.
    Only one row per model_type should have is_active=True at any time.
    """
    __tablename__ = "model_versions"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    model_type    = Column(String(20), nullable=False)  # "regime" | "eia" | "returns"
    version       = Column(String(32), nullable=False)  # e.g. "2026.07.01.v1"
    file_path     = Column(String(255))                 # "data/models/regime_v1.joblib"
    train_config  = Column(JSON)    # {"n_splits": 5, "gap": 20, "train_end": "2022-12-31"}
    metrics_train = Column(JSON)    # {"brier": 0.22, "accuracy": 0.71}
    metrics_oos   = Column(JSON)    # {"brier": 0.21, "accuracy": 0.73}
    feature_list  = Column(JSON)    # ["curve_slope", "crude_inv_dev", ...]
    is_active     = Column(Boolean, default=False, nullable=False)
    deployed_at   = Column(DateTime)
    created_at    = Column(DateTime, default=datetime.utcnow, nullable=False)

    predictions   = relationship("Prediction", back_populates="model_version")


class SignalEvaluation(Base):
    """
    Results from Signal Scanner runs.
    status: "candidate" → "approved" | "rejected"
    mechanism: free-text economic rationale (required before approval).
    """
    __tablename__ = "signal_evaluations"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    signal_name  = Column(String(100), nullable=False)
    source_config = Column(JSON)    # {"type": "yahoo", "ticker": "NG=F", "field": "Close"}
    ic_scores    = Column(JSON)     # {"ic_lag5": 0.19, "pval_lag5": 0.018, ...}
    oos_decay    = Column(Float)
    correlation  = Column(JSON)     # {"curve_slope": 0.12, "ovx": 0.08}
    coverage     = Column(Float)    # fraction of trading days with valid data
    status       = Column(String(20), default="candidate")
    mechanism    = Column(Text)     # required before status → "approved"
    evaluated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class SystemLog(Base):
    """
    Audit trail for all pipeline runs, training jobs, Agent actions.
    event_type examples: "pipeline_run", "model_trained", "signal_added", "agent_action"
    status: "running" | "success" | "failed"

    user_id: who triggered the event. Null for automated scheduler jobs.
    Populated in Phase 4 when DS Agent executes operations on behalf of a user.
    Indexed for the DS Console log view which filters by user.
    """
    __tablename__ = "system_logs"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    event_type  = Column(String(50), nullable=False, index=True)
    payload     = Column(JSON)
    status      = Column(String(20), nullable=False, default="running")
    error       = Column(Text)      # null unless status="failed"
    duration_ms = Column(Integer)   # wall-clock duration
    user_id     = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
```

### 6.2 Alembic setup

```python
# alembic/env.py — key section
from asyncio import run
from db.models import Base
from core.config import settings
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

config.set_main_option("sqlalchemy.url", settings.db_url)
target_metadata = Base.metadata

def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    run(run_async_migrations(connectable))
```

Use Alembic's async migration pattern because `settings.db_url` uses the
`sqlite+aiosqlite` async driver. Do not pass an async URL to the default sync
Alembic template.

```bash
# First migration (run once after writing models)
cd backend
uv run alembic revision --autogenerate -m "initial schema"
uv run alembic upgrade head
```

---

## 7. Data Layer

### 7.1 `config/data_sources.yaml`

```yaml
sources:

  # ── Price & futures ──
  # Note: M1-M6 continuous contract data requires paid subscription.
  # We use two free proxies for curve slope instead:
  #   1. WTI z-score vs 252-day MA (backwardation proxy)
  #   2. Brent-WTI spread (East-West arbitrage signal)
  wti:
    type: yahoo
    ticker: "CL=F"
    field: Close
    freq: D
    lag_days: 0

  brent:
    type: yahoo
    ticker: "BZ=F"
    field: Close
    freq: D
    lag_days: 0

  ovx:
    type: yahoo
    ticker: "^OVX"
    field: Close
    freq: D
    lag_days: 0

  # ── Inventory ──
  crude_inventory:
    type: eia
    series_id: "PET.WCRSTUS1.W"
    freq: W
    release_day: 2         # Wednesday (0=Monday)
    lag_days: 0

  cushing_inventory:
    type: eia
    series_id: "PET.WCUOK1.W"
    freq: W
    release_day: 2
    lag_days: 0

  gasoline_inventory:
    type: eia
    series_id: "PET.WGTSTUS1.W"
    freq: W
    release_day: 2
    lag_days: 0

  distillate_inventory:
    type: eia
    series_id: "PET.WDISTUS1.W"
    freq: W
    release_day: 2
    lag_days: 0

  # ── Macro ──
  dxy:
    type: fred
    series_id: "DTWEXBGS"
    freq: D
    lag_days: 1            # Published next day

  vix:
    type: yahoo
    ticker: "^VIX"
    field: Close
    freq: D
    lag_days: 0

  copper:
    type: yahoo
    ticker: "HG=F"
    field: Close
    freq: D
    lag_days: 0

  natural_gas:
    type: yahoo
    ticker: "NG=F"
    field: Close
    freq: D
    lag_days: 0

  # ── CFTC Commitment of Traders ──
  # Published every Friday ~15:30 ET for the prior Tuesday's positions.
  # URL pattern: https://www.cftc.gov/files/dea/history/fut_disagg_txt_{YEAR}.zip
  cot_wti_spec_long:
    type: cftc
    market_name: "CRUDE OIL, LIGHT SWEET"
    field: "NonComm_Positions_Long_All"
    freq: W
    release_day: 4       # Friday (0=Monday)
    lag_days: 0

  cot_wti_spec_short:
    type: cftc
    market_name: "CRUDE OIL, LIGHT SWEET"
    field: "NonComm_Positions_Short_All"
    freq: W
    release_day: 4
    lag_days: 0
```

### 7.2 `DataRegistry` (`core/data/registry.py`)

```python
import yaml
import pandas as pd
from pathlib import Path
from core.cache import DataFetchCache
from core.config_paths import DATA_SOURCES_YAML
from core.data.sources.eia import EIASource
from core.data.sources.yahoo import YahooSource
from core.data.sources.fred import FREDSource
from core.data.sources.cftc import CFTCSource
from core.logging import get_logger

logger = get_logger(__name__)

class DataRegistry:
    """
    Single entry point for all data fetching.
    Adding a new source = add one entry to data_sources.yaml.
    No code changes required.

    Uses DataFetchCache for in-memory TTL caching within a pipeline run.
    Switching to Redis in cloud: replace DataFetchCache implementation only.
    """

    def __init__(
        self,
        config_path: Path | str = DATA_SOURCES_YAML,
        cache: DataFetchCache | None = None,
    ):
        with open(config_path) as f:
            self.config = yaml.safe_load(f)["sources"]
        self._cache = cache or DataFetchCache()
        self._adapters = {
            "yahoo": YahooSource(),
            "eia":   EIASource(),
            "fred":  FREDSource(),
            "cftc":  CFTCSource(),
        }

    def fetch(self, name: str, start: str, end: str) -> pd.Series:
        """
        Fetch a single named source. Returns daily pd.Series with DatetimeIndex.
        Results are cached via DataFetchCache for the TTL duration.
        """
        cache_key = f"{name}:{start}:{end}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        cfg = self.config[name]
        adapter = self._adapters[cfg["type"]]
        raw = adapter.fetch(cfg, start, end)
        aligned = self._align(raw, cfg)
        self._cache.set(cache_key, aligned)
        logger.info(f"Fetched {name}", extra={"rows": len(aligned), "source": cfg["type"]})
        return aligned

    def fetch_all(self, start: str, end: str) -> pd.DataFrame:
        """
        Fetch all registered sources and return as aligned daily DataFrame.
        Sources that fail are logged and skipped (degraded mode).
        """
        frames: dict[str, pd.Series] = {}
        for name in self.config:
            try:
                frames[name] = self.fetch(name, start, end)
            except Exception as e:
                logger.warning(f"Skipping {name}: {e}")
        return pd.DataFrame(frames)

    def _align(self, series: pd.Series, cfg: dict) -> pd.Series:
        """
        Resample to daily frequency and apply publication lag.
        Weekly sources (EIA): forward-fill, but only after release_day.
        """
        daily = series.resample("D").last().ffill()

        # Apply lag to avoid lookahead
        lag = cfg.get("lag_days", 0)
        if lag > 0:
            daily = daily.shift(lag)

        # For weekly EIA releases: use holiday-aware release date detection
        if cfg.get("freq") == "W" and cfg.get("type") == "eia":
            from core.data.sources.eia import get_eia_release_date
            # For each calendar day, determine if EIA data is available
            def is_available(dt: pd.Timestamp) -> bool:
                release = get_eia_release_date(dt.date())
                return dt.date() >= release
            mask = ~pd.Series(daily.index).map(is_available).values
            daily[mask] = None
            daily = daily.ffill()

        # For other weekly releases (CFTC): use fixed release_day
        elif cfg.get("freq") == "W":
            release_day = cfg.get("release_day", 2)
            mask = daily.index.dayofweek < release_day
            daily[mask] = None
            daily = daily.ffill()

        return daily
```

### 7.3 Source adapters

Each adapter implements the same interface: `fetch(cfg, start, end) → pd.Series`.

```python
# core/data/sources/base.py
from abc import ABC, abstractmethod
import pandas as pd

class BaseSource(ABC):
    @abstractmethod
    def fetch(self, cfg: dict, start: str, end: str) -> pd.Series:
        ...
```

```python
# core/data/sources/yahoo.py
import yfinance as yf
import pandas as pd
from tenacity import retry, stop_after_attempt, wait_exponential
from .base import BaseSource

class YahooSource(BaseSource):
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=4, max=60))
    def fetch(self, cfg: dict, start: str, end: str) -> pd.Series:
        data = yf.download(cfg["ticker"], start=start, end=end, progress=False, auto_adjust=True)
        if data.empty:
            raise ValueError(f"No data returned for {cfg['ticker']}")
        return data[cfg["field"]].squeeze()
```

```python
# core/data/sources/eia.py
import requests
import pandas as pd
from datetime import date, timedelta
from tenacity import retry, stop_after_attempt, wait_exponential
from workalendar.usa.federal import UnitedStates
from core.config import settings
from .base import BaseSource

EIA_BASE = "https://api.eia.gov/v2/seriesid"
_us_cal = UnitedStates()

def get_eia_release_date(reference_date: date) -> date:
    """
    EIA publishes weekly petroleum data on Wednesday ~10:30 ET.
    If Wednesday is a US federal holiday, release shifts to Thursday.
    Returns the most recent EIA release date on or before reference_date.
    """
    # Find Wednesday of reference_date's week
    days_since_monday = reference_date.weekday()  # Monday=0
    wednesday = reference_date - timedelta(days=days_since_monday - 2)

    # If Wednesday is a holiday, release moves to Thursday
    if not _us_cal.is_working_day(wednesday):
        release_day = wednesday + timedelta(days=1)
    else:
        release_day = wednesday

    # If reference_date is before the release, use prior week's release
    if reference_date < release_day:
        return release_day - timedelta(weeks=1)
    return release_day

class EIASource(BaseSource):
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=4, max=60))
    def fetch(self, cfg: dict, start: str, end: str) -> pd.Series:
        url = f"{EIA_BASE}/{cfg['series_id']}"
        resp = requests.get(url, params={
            "api_key": settings.eia_api_key,
            "start":   start,
            "end":     end,
        }, timeout=30)
        resp.raise_for_status()
        data = resp.json()["response"]["data"]
        df = pd.DataFrame(data)
        df["period"] = pd.to_datetime(df["period"])
        series = df.set_index("period")["value"].astype(float).sort_index()
        series.name = cfg["series_id"]
        return series
```

```python
# core/data/sources/cftc.py
"""
CFTC Commitment of Traders (COT) adapter.

CFTC publishes the Disaggregated Futures report every Friday ~15:30 ET,
covering the prior Tuesday's open interest. No API key required.

Data is distributed as annual ZIP files containing pipe-delimited text:
  https://www.cftc.gov/files/dea/history/fut_disagg_txt_{YEAR}.zip

We download, cache locally to data/raw/cftc/, and parse the relevant columns.
"""
import io
import zipfile
import requests
import pandas as pd
from tenacity import retry, stop_after_attempt, wait_exponential
from core.config_paths import CFTC_RAW_DIR
from .base import BaseSource

CFTC_URL = "https://www.cftc.gov/files/dea/history/fut_disagg_txt_{year}.zip"

# Columns we care about from the disaggregated report
CFTC_COLUMNS = {
    "Market_and_Exchange_Names": "market_name",
    "As_of_Date_In_Form_YYMMDD": "date",
    "NonComm_Positions_Long_All": "NonComm_Positions_Long_All",
    "NonComm_Positions_Short_All": "NonComm_Positions_Short_All",
    "Comm_Positions_Long_All": "Comm_Positions_Long_All",
    "Comm_Positions_Short_All": "Comm_Positions_Short_All",
}

class CFTCSource(BaseSource):
    def __init__(self):
        CFTC_RAW_DIR.mkdir(parents=True, exist_ok=True)

    def fetch(self, cfg: dict, start: str, end: str) -> pd.Series:
        start_year = pd.to_datetime(start).year
        end_year   = pd.to_datetime(end).year

        frames = []
        for year in range(start_year, end_year + 1):
            frames.append(self._fetch_year(year))

        df = pd.concat(frames)
        df = df[df["market_name"].str.upper().str.contains(
            cfg["market_name"].upper()
        )]
        series = df.set_index("date")[cfg["field"]].sort_index()
        series = series[start:end]
        series.name = cfg["field"]
        return series

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=4, max=60))
    def _fetch_year(self, year: int) -> pd.DataFrame:
        cache_path = CFTC_RAW_DIR / f"fut_disagg_{year}.parquet"

        # Return cached file if it exists and year is complete
        if cache_path.exists() and year < pd.Timestamp.now().year:
            return pd.read_parquet(cache_path)

        url = CFTC_URL.format(year=year)
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()

        with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
            # The ZIP contains one .txt file
            txt_name = [n for n in z.namelist() if n.endswith(".txt")][0]
            with z.open(txt_name) as f:
                raw = pd.read_csv(f, usecols=list(CFTC_COLUMNS.keys()))

        raw = raw.rename(columns=CFTC_COLUMNS)
        raw["date"] = pd.to_datetime(raw["date"], format="%y%m%d")

        # Numeric columns
        for col in list(CFTC_COLUMNS.values())[2:]:
            raw[col] = pd.to_numeric(raw[col], errors="coerce")

        raw.to_parquet(cache_path)
        return raw
```

```python
# core/data/sources/fred.py
from fredapi import Fred
import pandas as pd
from tenacity import retry, stop_after_attempt, wait_exponential
from core.config import settings
from .base import BaseSource

class FREDSource(BaseSource):
    def __init__(self):
        self._fred = Fred(api_key=settings.fred_api_key)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=4, max=60))
    def fetch(self, cfg: dict, start: str, end: str) -> pd.Series:
        return self._fred.get_series(cfg["series_id"], start, end)
```

---

## 8. Feature Engine

### 8.1 `config/features.yaml`

```yaml
features:

  # ── Futures curve proxies (free alternatives to M1-M6 data) ──
  # curve_slope_zscore: WTI z-score vs 252-day MA
  #   Positive = price above long-run mean = market in backwardation-like state
  #   Negative = price below long-run mean = contango-like state
  - name: curve_slope_zscore
    source: wti
    transform: zscore
    window: 252

  # brent_wti_spread: East-West arbitrage signal
  #   Widens in supply disruptions (geopolitical risk premium)
  #   Narrows in oversupply (US crude exports competitive)
  - name: brent_wti_spread
    source_a: brent
    source_b: wti
    transform: ratio_diff

  # spread_1_2 placeholder — kept for Phase 2 when real contract data added
  # - name: spread_1_2
  #   source: wti_m1
  #   transform: raw

  # ── Inventory ──
  - name: crude_inv_dev
    source: crude_inventory
    transform: seasonal_dev
    seasons: 52

  - name: crude_inv_chg_4w
    source: crude_inventory
    transform: pct_change
    window: 4

  # ── Volatility ──
  - name: ovx
    source: ovx
    transform: raw

  - name: rvol_20d
    source: wti
    transform: rolling_std
    window: 20
    annualize: true

  # ── Price momentum ──
  - name: ret_5d
    source: wti
    transform: pct_change
    window: 5

  - name: ret_20d
    source: wti
    transform: pct_change
    window: 20

  - name: ret_60d
    source: wti
    transform: pct_change
    window: 60

  # ── COT positioning ──
  - name: spec_net_pct
    source_a: cot_wti_spec_long
    source_b: cot_wti_spec_short
    transform: net_position_pct
    window: 104                   # rolling percentile window in weeks

  - name: spec_net_chg
    source_a: cot_wti_spec_long
    source_b: cot_wti_spec_short
    transform: net_position_chg
    window: 1                     # week-on-week change

  # ── Macro ──
  - name: dxy_ret_20d
    source: dxy
    transform: pct_change
    window: 20

  - name: copper_ret_20d
    source: copper
    transform: pct_change
    window: 20

  - name: vix
    source: vix
    transform: raw
```

### 8.2 `FeatureEngine` (`features/engine.py`)

```python
import yaml
import hashlib
import pandas as pd
from pathlib import Path
from core.data.registry import DataRegistry
from core.config_paths import FEATURES_YAML
from core.logging import get_logger

logger = get_logger(__name__)

class FeatureEngine:
    def __init__(
        self,
        feature_config: str | Path = FEATURES_YAML,
        registry: DataRegistry | None = None,
    ):
        with open(feature_config) as f:
            self.features = yaml.safe_load(f)["features"]
        self.registry = registry or DataRegistry()
        self.feature_version = self._hash_config(feature_config)

    def build(self, start: str, end: str) -> pd.DataFrame:
        """
        Build the full feature matrix for a date range.
        Returns daily DataFrame, NaN rows dropped.
        Index is DatetimeIndex.
        """
        raw = self.registry.fetch_all(start, end)
        result: dict[str, pd.Series] = {}

        for feat in self.features:
            try:
                result[feat["name"]] = self._apply(feat, raw)
            except Exception as e:
                logger.warning(f"Feature {feat['name']} failed: {e}")

        df = pd.DataFrame(result)
        df = df.dropna()
        logger.info(f"Feature matrix built: {df.shape}")
        return df

    def _apply(self, feat: dict, raw: pd.DataFrame) -> pd.Series:
        t = feat["transform"]

        if t == "raw":
            return raw[feat["source"]]

        elif t == "pct_change":
            return raw[feat["source"]].pct_change(self._window_days(feat, feat["source"]))

        elif t == "rolling_std":
            s = raw[feat["source"]].pct_change().rolling(feat["window"]).std()
            if feat.get("annualize"):
                s = s * (252 ** 0.5)
            return s

        elif t == "seasonal_dev":
            src = raw[feat["source"]]
            # Rolling expanding mean by week-of-year
            avg = src.groupby(src.index.isocalendar().week.astype(int)) \
                     .transform(lambda x: x.expanding().mean())
            return src - avg

        elif t == "zscore":
            src = raw[feat["source"]]
            window = feat["window"]
            mean = src.rolling(window).mean()
            std  = src.rolling(window).std()
            return (src - mean) / std.replace(0, float("nan"))

        elif t == "net_position_pct":
            long_  = raw[feat["source_a"]]
            short_ = raw[feat["source_b"]]
            net    = long_ - short_
            total  = (long_ + short_).replace(0, float("nan"))
            ratio  = net / total
            window = feat.get("window", 104)   # configurable, default 104 weeks
            window_days = self._window_days(feat, feat["source_a"])
            return ratio.rolling(window_days).rank(pct=True)

        elif t == "net_position_chg":
            long_  = raw[feat["source_a"]]
            short_ = raw[feat["source_b"]]
            net    = long_ - short_
            window = feat.get("window", 1)     # configurable, default 1 week
            return net.diff(self._window_days(feat, feat["source_a"]))

        elif t == "ratio_diff":
            return raw[feat["source_a"]] - raw[feat["source_b"]]

        else:
            raise ValueError(f"Unknown transform: {t}")

    @staticmethod
    def _hash_config(path: str) -> str:
        with open(path) as f:
            return hashlib.md5(f.read().encode()).hexdigest()[:8]

    def _window_days(self, feat: dict, source_name: str) -> int:
        """
        Convert YAML window units to daily-index steps.
        Weekly source windows are specified in weeks because those features are
        reasoned about at release cadence, then represented on a daily index.
        """
        window = feat.get("window", 1)
        source_cfg = self.registry.config.get(source_name, {})
        if source_cfg.get("freq") == "W":
            return window * 7
        return window
```

---

## 9. FastAPI Application

### 9.1 App factory (`api/main.py`)

```python
from fastapi import FastAPI
from contextlib import asynccontextmanager
from db.database import get_db
from db.crud import get_or_create_default_user
from api.routes.health import router as health_router
from core.logging import get_logger

logger = get_logger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed default user (id=1) on first startup
    async with get_db() as db:
        await get_or_create_default_user(db)
    logger.info("Starting oil-signalyst API")
    yield
    logger.info("Shutting down oil-signalyst API")

def create_app() -> FastAPI:
    app = FastAPI(
        title="oil-signalyst",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.include_router(health_router)
    return app

app = create_app()
```

### 9.2 `/health` endpoint (`api/routes/health.py`)

```python
from fastapi import APIRouter
from sqlalchemy import text
from api.dependencies import DbSession
from datetime import date

router = APIRouter()

@router.get("/health")
async def health(db: DbSession):
    checks = {}

    # Database connectivity
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"failed: {e}"

    # Default user exists
    try:
        result = await db.execute(text("SELECT COUNT(*) FROM users"))
        user_count = result.scalar()
        checks["users"] = f"{user_count} configured"
    except Exception:
        checks["users"] = "unknown"

    # Latest feature snapshot freshness
    try:
        result = await db.execute(
            text("SELECT MAX(date) FROM feature_snapshots")
        )
        latest_raw = result.scalar()
        if latest_raw:
            latest = date.fromisoformat(str(latest_raw))
            checks["latest_snapshot"] = str(latest)
            checks["snapshot_fresh"] = (date.today() - latest).days <= 1
        else:
            checks["latest_snapshot"] = "none"
            checks["snapshot_fresh"] = False
    except Exception:
        checks["latest_snapshot"] = "unknown"

    status = "healthy" if checks.get("database") == "ok" else "degraded"
    return {"status": status, "checks": checks}
```

### 9.3 Database session (`db/database.py`)

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from contextlib import asynccontextmanager
from core.config import settings
from db.models import Base

engine = create_async_engine(settings.db_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def init_db():
    """Called at startup to verify DB connection (migrations handled by Alembic)."""
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: None)  # Ping

@asynccontextmanager
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

---

## 10. Scheduler

### 10.1 Entry point (`scheduler/runner.py`)

```python
import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from core.config import settings
from core.logging import get_logger
from scheduler.jobs import run_daily_pipeline

logger = get_logger(__name__)

async def _run():
    """
    Async entry point. Starts APScheduler and waits indefinitely.
    Uses asyncio.Event().wait() instead of the deprecated
    get_event_loop().run_forever() which raises DeprecationWarning
    in Python 3.12 and will error in Python 3.14.
    """
    scheduler = AsyncIOScheduler()

    if settings.scheduler_enabled:
        scheduler.add_job(
            run_daily_pipeline,
            "cron",
            hour=settings.pipeline_cron_hour,
            minute=settings.pipeline_cron_minute,
            id="daily_pipeline",
            replace_existing=True,
        )
        logger.info(
            f"Daily pipeline scheduled at "
            f"{settings.pipeline_cron_hour:02d}:{settings.pipeline_cron_minute:02d} UTC"
        )

    scheduler.start()
    logger.info("Scheduler running")

    stop_event = asyncio.Event()
    try:
        await stop_event.wait()   # Suspend until KeyboardInterrupt
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        scheduler.shutdown()
        logger.info("Scheduler shut down")

def main():
    asyncio.run(_run())

if __name__ == "__main__":
    main()
```

### 10.2 Daily pipeline job (`scheduler/jobs.py`)

```python
from datetime import date, datetime
from datetime import timedelta
from sqlalchemy import text
import pandas as pd
from db.database import get_db
from db.models import FeatureSnapshot, SystemLog
from db.crud import get_feature_snapshot_by_date
from core.data.registry import DataRegistry
from core.config_paths import FEATURES_DIR
from features.engine import FeatureEngine
from core.logging import get_logger

logger = get_logger(__name__)

async def run_daily_pipeline(target_date: date | None = None):
    """
    Daily pipeline: fetch data → build features → save snapshot.
    Idempotent: skips if today's snapshot already exists.
    Phase 1 only saves features. Model inference added in Phase 2.
    """
    target_date = target_date or date.today()
    start_time = datetime.utcnow()

    # ── Idempotency check ──
    async with get_db() as db:
        existing = await get_feature_snapshot_by_date(db, target_date)
        if existing:
            logger.info(f"Snapshot for {target_date} already exists — skipping")
            return

    # ── Log pipeline start ──
    # Separate session so log row is committed before long-running work begins
    log_id: int
    async with get_db() as db:
        log = SystemLog(
            event_type="pipeline_run",
            status="running",
            payload={"date": str(target_date)},
        )
        db.add(log)
        await db.flush()   # Assigns log.id within this session
        log_id = log.id
        # Session commits on __exit__, persisting the log row

    try:
        # ── Fetch data (last 2 years for rolling feature windows) ──
        end   = str(target_date)
        start = str(target_date - timedelta(days=730))

        registry   = DataRegistry()
        engine     = FeatureEngine(registry=registry)
        features_df = engine.build(start, end)

        # ── Extract today's row ──
        mask = features_df.index.normalize() == pd.Timestamp(target_date)
        today_features = features_df[mask]
        if today_features.empty:
            raise ValueError(f"No features available for {target_date}")

        feature_dict = today_features.iloc[0].to_dict()
        duration_ms  = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        # ── Write full feature matrix to Parquet (for Phase 2 model training) ──
        # Appends today's data to the current year's Parquet file.
        # Phase 2 training reads these files instead of re-fetching 12 years of data.
        parquet_path = FEATURES_DIR / f"features_{target_date.year}.parquet"
        if parquet_path.exists():
            existing_df = pd.read_parquet(parquet_path)
            # Replace today's row if it already exists (idempotent)
            existing_df = existing_df[
                existing_df.index.normalize() != pd.Timestamp(target_date)
            ]
            updated_df = pd.concat([existing_df, features_df[mask]])
        else:
            updated_df = features_df[mask]
        updated_df.sort_index().to_parquet(parquet_path)

        # ── Persist snapshot and mark log success ──
        async with get_db() as db:
            db.add(FeatureSnapshot(
                date=target_date,
                features=feature_dict,
                feature_version=engine.feature_version,
            ))
            await db.execute(
                text("UPDATE system_logs SET status='success', duration_ms=:d WHERE id=:id"),
                {"d": duration_ms, "id": log_id},
            )

        logger.info(
            f"Pipeline complete for {target_date}",
            extra={"features": len(feature_dict), "duration_ms": duration_ms},
        )

    except Exception as e:
        duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        async with get_db() as db:
            await db.execute(
                text("UPDATE system_logs SET status='failed', error=:e, duration_ms=:d WHERE id=:id"),
                {"e": str(e), "d": duration_ms, "id": log_id},
            )
        logger.error(f"Pipeline failed for {target_date}: {e}")
        raise
```

---

## 11. Supporting Files

### 11.1 `core/cache.py` — `DataFetchCache`

In-memory cache for data source fetch results. Scoped to a single pipeline run (one `DataRegistry` instance). Switching to Redis in cloud deployment means replacing only this class — `DataRegistry` interface stays identical.

```python
# core/cache.py
from datetime import datetime, timedelta
from typing import Any

class DataFetchCache:
    """
    In-memory TTL cache for DataRegistry fetch results.

    Naming rationale: 'DataFetch' describes what is cached (data fetch results),
    not how it is stored. This name remains valid when the backend
    switches from dict to Redis without interface changes.

    TTL default: 4 hours — long enough to survive a full pipeline run,
    short enough to pick up intraday EIA/Yahoo updates if the pipeline
    re-runs after a failure.

    Cloud migration path:
        Replace __init__, get, set, delete with Redis calls.
        DataRegistry code is unchanged.
    """

    def __init__(self, ttl_seconds: int = 14_400):  # 4 hours
        self._store: dict[str, dict] = {}
        self._ttl = timedelta(seconds=ttl_seconds)

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        if datetime.utcnow() > entry["expires"]:
            del self._store[key]
            return None
        return entry["value"]

    def set(self, key: str, value: Any) -> None:
        self._store[key] = {
            "value":   value,
            "expires": datetime.utcnow() + self._ttl,
        }

    def delete(self, key: str) -> None:
        self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()

    def __len__(self) -> int:
        return len(self._store)
```

### 11.2 `db/crud.py`

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from db.models import FeatureSnapshot, User
from datetime import date

# ── FeatureSnapshot ──────────────────────────────────────────────

async def get_feature_snapshot_by_date(
    db: AsyncSession,
    target_date: date,
) -> FeatureSnapshot | None:
    result = await db.execute(
        select(FeatureSnapshot).where(FeatureSnapshot.date == target_date)
    )
    return result.scalar_one_or_none()

# ── User ─────────────────────────────────────────────────────────

async def get_user(db: AsyncSession, user_id: int) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()

async def get_or_create_default_user(db: AsyncSession) -> User:
    """
    Returns user id=1, creating a default researcher account if none exists.
    Called at API startup to guarantee at least one user row exists.
    """
    user = await get_user(db, 1)
    if user is None:
        user = User(id=1, name="Default User", role="researcher")
        db.add(user)
        await db.flush()
    return user
```

### 11.3 `api/dependencies.py`

All FastAPI routes use these `Depends()` helpers. Centralising here means session management and user resolution are consistent across every route — no route ever opens a session directly.

```python
# api/dependencies.py
from typing import AsyncGenerator, Annotated
from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from db.database import AsyncSessionLocal
from db.models import User
from db.crud import get_user

async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Yields an async SQLAlchemy session.
    Commits on success, rolls back on exception, always closes.
    Use with: db: DbSession = Depends(get_db_session)
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

# Type alias for cleaner route signatures
DbSession = Annotated[AsyncSession, Depends(get_db_session)]

async def get_current_user(
    x_user_id: Annotated[int, Header(alias="X-User-Id")] = 1,
    db: AsyncSession = Depends(get_db_session),
) -> User:
    """
    Resolves the current user from the X-User-Id header.
    Defaults to user id=1 if header is absent (local single-user mode).

    Phase 1: header-based identity, no auth tokens.
    Phase 2+: replace this function with JWT validation without
              changing any route signatures.
    """
    user = await get_user(db, x_user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"User {x_user_id} not found")
    return user

# Type alias
CurrentUser = Annotated[User, Depends(get_current_user)]
```

**Usage in routes (Phase 2 example):**

```python
@router.get("/api/reports/daily/{role}")
async def get_daily_report(
    role: str,
    db: DbSession,       # ← injected session
    user: CurrentUser,   # ← resolved user
):
    ...
```

### 11.4 `alembic.ini`

Minimal config. The `sqlalchemy.url` is overridden at runtime in `alembic/env.py`.

```ini
[alembic]
script_location = alembic
file_template = %%(year)d%%(month).2d%%(day).2d_%%(rev)s_%%(slug)s
prepend_sys_path = .

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

### 11.5 Config path resolution

All config file paths use `pathlib` relative to the repo root, so the code works whether run directly (`uv run uvicorn ...` from `backend/`) or inside Docker (`WORKDIR /app`).

```python
# core/config_paths.py
from pathlib import Path

# Works from any working directory:
# - Docker: backend package is copied to /app, config is mounted at /app/config
# - Local:  package lives at repo/backend, config is at repo/config
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_LOCAL_REPO_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND_ROOT if (_BACKEND_ROOT / "config").exists() else _LOCAL_REPO_ROOT

CONFIG_DIR  = _REPO_ROOT / "config"
DATA_DIR    = _REPO_ROOT / "data"
RAW_DIR      = DATA_DIR / "raw"
CFTC_RAW_DIR = RAW_DIR / "cftc"
FEATURES_DIR = DATA_DIR / "features"
MODELS_DIR   = DATA_DIR / "models"
ENV_FILE     = _REPO_ROOT / ".env"
DEFAULT_DB_URL = f"sqlite+aiosqlite:///{DATA_DIR / 'oilmarket.db'}"

DATA_SOURCES_YAML = CONFIG_DIR / "data_sources.yaml"
FEATURES_YAML     = CONFIG_DIR / "features.yaml"
```

Update `DataRegistry` and `FeatureEngine` constructors:

```python
# In DataRegistry.__init__:
from core.config_paths import DATA_SOURCES_YAML
def __init__(self, config_path: Path | str = DATA_SOURCES_YAML):
    ...

# In FeatureEngine.__init__:
from core.config_paths import FEATURES_YAML
def __init__(self, feature_config: Path | str = FEATURES_YAML, ...):
    ...
```

### 11.6 Git placeholder files

`data/` content is excluded from git, but Docker volume mounts require the directories to exist on first clone. Add empty placeholder files:

```
data/.gitkeep
data/raw/.gitkeep
data/raw/cftc/.gitkeep
data/features/.gitkeep
data/models/.gitkeep
logs/.gitkeep
```

Update `.gitignore` to exclude data files but keep the placeholders:

```gitignore
# Data files — never commit
*.db
*.joblib
*.parquet

# Keep directory structure
!data/.gitkeep
!data/raw/.gitkeep
!data/raw/cftc/.gitkeep
!data/features/.gitkeep
!data/models/.gitkeep
!logs/.gitkeep

# Python artefacts
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
backend/.venv/

# Secrets
.env
```

---

## 12. Logging (`core/logging.py`)

```python
import logging
import json
from datetime import datetime

class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps({
            "timestamp": datetime.utcnow().isoformat(),
            "level":     record.levelname,
            "module":    record.module,
            "message":   record.getMessage(),
            "extra":     {
                k: v for k, v in record.__dict__.items()
                if k not in logging.LogRecord.__dict__
                and not k.startswith("_")
            },
        })

def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JSONFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger
```

---

## 13. Exception Hierarchy (`core/exceptions.py`)

```python
class OilSignalystError(Exception):
    """Base exception for all oil-signalyst errors."""
    pass

class DataFetchError(OilSignalystError):
    def __init__(self, source: str, reason: str):
        self.source = source
        self.reason = reason
        super().__init__(f"[{source}] fetch failed: {reason}")

class FeatureBuildError(OilSignalystError):
    pass

class InsufficientDataError(OilSignalystError):
    pass

class ModelNotFoundError(OilSignalystError):
    pass

class PipelineError(OilSignalystError):
    pass
```

---

## 14. Tests

### Scope for Phase 1

Three test files, focused on verifiable behaviour without mocking the entire world.

```python
# tests/test_data.py

def test_yahoo_source_returns_series():
    """YahooSource returns a non-empty pd.Series for WTI."""
    from core.data.sources.yahoo import YahooSource
    source = YahooSource()
    result = source.fetch({"ticker": "CL=F", "field": "Close"}, "2024-01-01", "2024-01-31")
    assert len(result) > 0
    assert result.index.dtype == "datetime64[ns]"

def test_registry_fetch_all_returns_dataframe():
    """DataRegistry.fetch_all returns a DataFrame with expected columns."""
    from core.data.registry import DataRegistry
    registry = DataRegistry()
    df = registry.fetch_all("2024-06-01", "2024-06-30")
    assert "wti" in df.columns
    assert "crude_inventory" in df.columns
    assert len(df) > 0
```

These are real integration tests. They require network access plus valid
`EIA_API_KEY` and `FRED_API_KEY` values in `.env`; they are intentionally not
mocked in Phase 1.

```python
# tests/test_features.py

def test_feature_engine_no_future_leakage():
    """
    Feature values at date T must not use data published after T.
    Verify by checking that crude_inv_dev on a Wednesday uses
    EIA data from that Wednesday's release, not Thursday's.
    """
    from features.engine import FeatureEngine
    engine = FeatureEngine()
    df = engine.build("2023-01-01", "2024-06-30")
    df = df["2024-01-01":"2024-06-30"]
    assert "crude_inv_dev" in df.columns
    assert df["crude_inv_dev"].notna().mean() > 0.8

def test_feature_engine_returns_no_nan_rows():
    """Dropped NaN rows: no fully-empty rows in output."""
    from features.engine import FeatureEngine
    engine = FeatureEngine()
    df = engine.build("2023-01-01", "2024-06-30")
    df = df["2024-01-01":"2024-06-30"]
    assert len(df) > 0
    assert df.isnull().all(axis=1).sum() == 0
```

```python
# tests/test_health.py

import pytest
from httpx import AsyncClient, ASGITransport
from api.main import app

@pytest.mark.asyncio
async def test_health_returns_200():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] in ("healthy", "degraded")

@pytest.mark.asyncio
async def test_health_includes_database_check():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
    assert "database" in response.json()["checks"]
```

---

## 15. `.gitignore`

```
.env
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
backend/.venv/
*.db
*.joblib
*.parquet

# Runtime directories: ignore generated contents, keep placeholders
data/*
!data/.gitkeep
!data/raw/
data/raw/*
!data/raw/.gitkeep
!data/raw/cftc/
data/raw/cftc/*
!data/raw/cftc/.gitkeep
!data/features/
data/features/*
!data/features/.gitkeep
!data/models/
data/models/*
!data/models/.gitkeep
logs/*
!logs/.gitkeep
```

---

## 16. Decisions Log

| # | Question / Issue | Decision |
|---|-----------------|----------|
| Q1 | M1–M6 futures curve data | Free proxies: WTI z-score (252d) + Brent-WTI spread. Real contract data deferred to Phase 2 if budget allows. |
| Q2 | Regime labels | Historical labels provided (2010–2026, 16 transition points). Phase 2 validates with GMM alignment. |
| Q3 | CFTC COT adapter | Annual ZIP download, local Parquet cache, no API key required. |
| Q4 | EIA holiday handling | Dynamic detection via `workalendar`: Wednesday release, shifts to Thursday on US federal holidays. |
| Q5 | User config storage | `user_config.yaml` replaced by `users` database table. Config is CRUD'd via API (`GET/PUT /api/users/me`). Single-user local mode defaults to `X-User-Id: 1`. |
| Q6 | Cache class name | `SimpleCache` renamed to `DataFetchCache`. Name describes what is cached, remains valid when backend switches from dict to Redis. |
| Q7 | Cache as injectable | `DataFetchCache` injected into `DataRegistry.__init__`, making it testable and swappable. |
| Q8 | Phase 2–4 forward compat | `Prediction.feature_snapshot_id` FK added (History drawer Features tab); `SystemLog.user_id` FK added (DS Console audit trail); `asyncio.run()` replaces deprecated `get_event_loop()`; Parquet write added to daily pipeline for Phase 2 training. |
| Q9 | `return_dist` key naming | Pure underscores throughout: `lt_minus10 / neg_10_0 / pos_0_10 / gt_10`. No hyphens — matches TypeScript identifier constraints without needing quoted keys. |

---

## 17. Regime Label Reference (for Phase 2)

Provided by analysis of OPEC policy history, supply/demand balances, and price behaviour.
Phase 2 will convert this to a daily `pd.Series` with forward-fill between transition dates.

```python
# backend/core/models/regime_labels.py
# Format: {ISO date string: regime at that date, forward-filled until next entry}

REGIME_TRANSITIONS = {
    "2010-01-01": "R2",  # Global recovery; China demand surge
    "2011-03-01": "R1",  # Libya civil war supply disruption; Arab Spring
    "2012-07-01": "R2",  # Demand-driven; Iran sanctions risk premium fading
    "2014-07-01": "R3",  # US shale boom; OPEC refuses to cut (Nov 2014)
    "2016-02-01": "R2",  # Bottom reached; OPEC coordination begins
    "2017-01-01": "R1",  # OPEC+ formed; production cuts take effect
    "2018-10-01": "R3",  # Trump pressure to increase output; demand outlook cut
    "2019-06-01": "R1",  # OPEC+ deepens cuts; Iran sanctions tighten
    "2020-03-01": "R4",  # COVID-19 demand collapse + Saudi-Russia price war
    "2020-06-01": "R2",  # Economic reopening; demand rapid recovery
    "2021-07-01": "R1",  # Supply recovery lags demand; inventories draw
    "2022-02-01": "R1",  # Russia-Ukraine invasion; supply shock; Brent → $120
    "2022-12-01": "R3",  # Recession fears; demand outlook cut
    "2023-06-01": "R1",  # OPEC+ voluntary extra cuts (Saudi 1 mb/d)
    "2024-01-01": "R3",  # Non-OPEC supply growth; demand growth slowing
    "2025-05-01": "R3",  # OPEC+ begins unwinding cuts
    "2026-01-01": "R3",  # Current: oversupply persists
}

def build_regime_series(start: str, end: str) -> pd.Series:
    """
    Convert transition dict to daily pd.Series, forward-filled.
    Returns Series with DatetimeIndex and string values R1/R2/R3/R4.
    """
    import pandas as pd
    transitions = pd.Series(REGIME_TRANSITIONS)
    transitions.index = pd.to_datetime(transitions.index)
    idx = pd.date_range(start, end, freq="D")
    return transitions.reindex(idx, method="ffill")
```

**Validation approach for Phase 2:** Run a 4-component Gaussian Mixture Model on
`[ret_20d, rvol_20d, brent_wti_spread]`. Compare discovered clusters against
manual labels. Review GMM features or transition boundaries if agreement is below 70%.

---

## 18. Phase 1 Completion Checklist

```
[ ] uv sync completes without errors
[ ] docker compose up starts api + scheduler, migrate exits 0
[ ] GET /health returns {"status": "healthy", "checks": {"database": "ok", "users": "1 configured", ...}}
[ ] uv run pytest — all tests pass
[ ] Manual trigger of run_daily_pipeline() writes a row to feature_snapshots
[ ] Manual trigger of run_daily_pipeline() writes data/features/features_{year}.parquet
[ ] system_logs shows event_type="pipeline_run" status="success"
[ ] Alembic version table exists in data/oilmarket.db
[ ] users table exists and contains 1 default row (id=1, role="researcher")
[ ] CFTC ZIP downloads and caches to data/raw/cftc/
[ ] EIA holiday detection: verify Thanksgiving week (e.g. 2023-11-23) returns Thursday
[ ] data/models/ directory exists (gitkeep committed)
[ ] No .env file committed to git
[ ] DataFetchCache: second fetch of same source returns cached result (no network call)
```
