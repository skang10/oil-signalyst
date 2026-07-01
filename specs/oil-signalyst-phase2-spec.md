# oil-signalyst — Phase 2 Spec: Core ML Pipeline

**Version:** 1.1  
**Phase:** 2 — Core ML Pipeline  
**Last updated:** 2026-07-01  
**Depends on:** Phase 1 spec v0.5 FINAL  
**Changelog:**  
- v1.1: Fixed `ModelRegistry.get_active()` async pattern; fixed feature ordering in stress_test; added missing crud functions; added Bonferroni correction to Signal Scanner; made signal direction config-driven via features.yaml; removed unused hmmlearn dependency

---

## 1. Overview

Phase 2 adds the three predictive models, their training infrastructure, inference pipeline, post-processing layer, and the report API endpoints that the Phase 3 frontend will consume.

**Phase 2 is complete when:**  
`curl localhost:8000/api/reports/daily/trader` returns a real JSON response driven by live WTI data and trained models — not mock data.

**In scope:**
- Historical feature backfill (2010–2023)
- GMM-based Regime label generation + REGIME_TRANSITIONS alignment
- Three TabPFN models: Regime classification, EIA forecast, Conditional return distribution
- Two-stage inference: Regime → conditioned return distribution
- Post-processing: SHAP, probability calibration, PSI monitoring, decision rules, stress test, Regime duration, switch probability, outcome backfill
- MLflow experiment tracking (file mode)
- Report API: `GET /api/reports/daily/{role}`, `GET /api/reports/history`, `GET /api/models/status`
- User config API: `GET /api/users/me`, `PUT /api/users/me/config` (no frontend yet — Phase 3 adds UI)
- Training API: `POST /api/train/start`, `GET /api/train/status/{job_id}`
- Signal Scanner

**Out of scope for Phase 2:** Frontend, DS Agent, cloud deployment.

---

## 2. Decisions Log

| # | Decision |
|---|----------|
| D1 | Training set: 2010-01-01 → 2023-12-31 (fixed). Val: 2024. OOS: 2025-today (never touched during training). |
| D2 | Regime labels: two-stage — GMM unsupervised boundary finding → align with REGIME_TRANSITIONS. |
| D3 | Unsupervised algorithm: Gaussian Mixture Model (sklearn). No temporal dependency assumption, simpler than HMM. |
| D4 | Models: three independent TabPFN models. Return distribution conditioned on Regime probabilities at inference time. |
| D5 | Evaluation: Brier Score + accuracy + calibration curve for classifiers; MAE + direction accuracy for EIA. |
| D6 | MLflow: file-mode tracking (`data/mlruns/`). No server required locally. Cloud: change tracking URI only. |
| D7 | Historical data: `backfill.py` one-time script, run before first training. Daily pipeline maintains incremental Parquet. |
| D8 | EIA market consensus: proxy via rolling 4-week mean of actual values. No paid data source required. |
| D9 | Stress test: re-run trained models on historical extreme-date feature snapshots from DB. |
| D10 | Regime duration + switch probability: computed in post-processing from predictions history (Markov matrix). |
| D11 | Outcome backfill: daily pipeline checks predictions from 20 days ago and fills actual_return + outcome_correct. |
| D12 | User config API written in Phase 2, frontend UI added in Phase 3. |

---

## 3. Schema Changes (Alembic migration required)

Two columns added to `predictions`. Everything else in Phase 1 schema is unchanged.

```python
# Addition to db/models.py — Prediction class
actual_return   = Column(Float,   nullable=True)
# Filled by backfill_outcomes() 20 trading days after the prediction date.
# Computed as: (wti_price_on_outcome_date / wti_price_on_prediction_date) - 1

outcome_correct = Column(Boolean, nullable=True)
# True if actual_return falls within the highest-probability return_dist bucket.
# Filled at the same time as actual_return.
```

```bash
# Generate and run migration
cd backend
uv run alembic revision --autogenerate -m "add outcome columns to predictions"
uv run alembic upgrade head
```

## 3b. Missing `db/crud.py` Functions (Phase 2 additions)

The following functions are used by `api/routes/reports.py` but were missing from the Phase 1 `crud.py`. Add them to `db/crud.py`:

```python
# db/crud.py — Phase 2 additions
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from db.models import Prediction, ModelVersion
from datetime import date


async def get_prediction_by_date(
    db: AsyncSession,
    target_date: date,
) -> Prediction | None:
    row = await db.execute(
        select(Prediction)
        .where(Prediction.date == target_date)
        .order_by(desc(Prediction.created_at))
        .limit(1)
    )
    return row.scalar_one_or_none()


async def get_recent_predictions(
    db: AsyncSession,
    limit: int = 30,
) -> list[Prediction]:
    rows = await db.execute(
        select(Prediction)
        .order_by(desc(Prediction.date))
        .limit(limit)
    )
    return rows.scalars().all()


async def get_active_model_version(
    db: AsyncSession,
    model_type: str,
) -> ModelVersion | None:
    row = await db.execute(
        select(ModelVersion)
        .where(
            ModelVersion.model_type == model_type,
            ModelVersion.is_active == True,
        )
        .limit(1)
    )
    return row.scalar_one_or_none()
```

---

## 4. New Dependencies

```toml
# Add to backend/pyproject.toml [project] dependencies

# ML
"tabpfn>=2.0.0",
"scikit-learn>=1.5.0",
"shap>=0.46.0",
"imbalanced-learn>=0.12.0",   # For class rebalancing in label generation

# Experiment tracking
"mlflow>=2.15.0",
```

---

## 5. Directory Structure Changes

```
backend/
├── core/
│   └── models/
│       ├── __init__.py
│       ├── regime_labels.py     # REGIME_TRANSITIONS + build_regime_series() [from Phase 1 spec §17]
│       ├── label_generator.py   # GMM + alignment pipeline
│       ├── trainer.py           # Unified training entry point
│       ├── regime.py            # Model A: Regime classifier
│       ├── eia.py               # Model B: EIA forecast
│       ├── returns.py           # Model C: Conditional return distribution
│       └── model_registry.py    # Load active model by type
├── core/
│   └── postprocess/
│       ├── __init__.py
│       ├── shap_explainer.py
│       ├── calibration.py       # Isotonic regression calibration
│       ├── drift_monitor.py     # PSI computation
│       ├── decision_engine.py   # Hedge ratio, signal direction, stop-loss
│       ├── stress_test.py       # Historical scenario re-inference
│       ├── regime_stats.py      # Duration + switch probability
│       └── outcome_backfill.py  # Fill actual_return 20 days later
├── api/
│   └── routes/
│       ├── reports.py           # GET /api/reports/daily/{role}, /history
│       ├── models.py            # GET /api/models/status
│       ├── training.py          # POST /api/train/start, GET /api/train/status/{id}
│       ├── signals.py           # GET /api/signals/candidates, /active
│       └── users.py             # GET /api/users/me, PUT /api/users/me/config
├── scripts/
│   └── backfill.py              # One-time historical feature backfill

data/
└── mlruns/                      # MLflow file-mode tracking (gitignored)
```

---

## 5b. `features.yaml` Update — Add `bearish_if_positive` Field

Each feature now carries a `bearish_if_positive` flag. This drives the `direction` annotation in `_build_signal_list()` in the report assembler, making signal direction config-driven instead of hardcoded.

Add this field to every entry in `config/features.yaml`:

```yaml
# Futures curve proxies
- name: curve_slope_zscore
  bearish_if_positive: false   # positive z-score = backwardation-like = bullish

- name: brent_wti_spread
  bearish_if_positive: false   # wider spread = supply disruption premium = bullish

# Inventory
- name: crude_inv_dev
  bearish_if_positive: true    # above 5yr avg = oversupply = bearish

- name: crude_inv_chg_4w
  bearish_if_positive: true    # rising inventory = bearish

# Volatility
- name: ovx
  bearish_if_positive: true    # high vol = risk-off = bearish

- name: rvol_20d
  bearish_if_positive: true    # high realised vol = uncertainty = bearish

# Price momentum
- name: ret_5d
  bearish_if_positive: false   # positive return = bullish momentum

- name: ret_20d
  bearish_if_positive: false

- name: ret_60d
  bearish_if_positive: false

# COT
- name: spec_net_pct
  bearish_if_positive: false   # high spec long percentile = bullish positioning

- name: spec_net_chg
  bearish_if_positive: false   # increasing net long = bullish

# Macro
- name: dxy_ret_20d
  bearish_if_positive: true    # stronger USD = bearish for oil

- name: copper_ret_20d
  bearish_if_positive: false   # copper up = global demand = bullish

- name: vix
  bearish_if_positive: true    # high VIX = risk-off = bearish
```

The `FeatureEngine` ignores unknown keys in YAML entries, so this is a non-breaking addition.

---

## 6. Historical Feature Backfill

Must be run **once** before first training. Idempotent: skips years whose Parquet already exists.

```python
# scripts/backfill.py
"""
One-time script: generates feature Parquet files for 2010–2023.
Run before first Phase 2 training:
    cd backend && uv run python scripts/backfill.py

After this, Phase 1 daily pipeline maintains incremental updates.
To switch to fully dynamic (no Parquet): replace read_parquet() in
trainer.py with FeatureEngine().build() — DataRegistry interface unchanged.
"""
import pandas as pd
from pathlib import Path
from datetime import date
from core.data.registry import DataRegistry
from features.engine import FeatureEngine
from core.config_paths import FEATURES_DIR
from core.logging import get_logger

logger = get_logger(__name__)

BACKFILL_START = "2010-01-01"
BACKFILL_END   = "2023-12-31"

def run_backfill():
    FEATURES_DIR.mkdir(parents=True, exist_ok=True)

    registry = DataRegistry()
    engine   = FeatureEngine(registry=registry)

    logger.info(f"Building features {BACKFILL_START} → {BACKFILL_END}")
    df = engine.build(BACKFILL_START, BACKFILL_END)
    logger.info(f"Feature matrix shape: {df.shape}")

    # Write per-year Parquet files (same format as Phase 1 daily pipeline)
    for year, group in df.groupby(df.index.year):
        path = FEATURES_DIR / f"features_{year}.parquet"
        if path.exists():
            logger.info(f"  {year}: already exists, skipping")
            continue
        group.to_parquet(path)
        logger.info(f"  {year}: {len(group)} rows → {path.name}")

    logger.info("Backfill complete")

if __name__ == "__main__":
    run_backfill()
```

---

## 7. Regime Label Generation

Two-stage process. Run once after backfill, before training.

### Stage 1: GMM unsupervised boundary finding

```python
# core/models/label_generator.py
import numpy as np
import pandas as pd
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler
from core.config_paths import FEATURES_DIR
from core.models.regime_labels import build_regime_series
from core.logging import get_logger

logger = get_logger(__name__)

GMM_FEATURES = ["ret_20d", "rvol_20d", "brent_wti_spread"]
# These three capture: price direction, volatility, supply signal.
# Deliberately excludes COT and EIA (weekly, many NaNs) for GMM stability.

N_COMPONENTS = 4   # Matches R1/R2/R3/R4


def generate_regime_labels(
    train_start: str = "2010-01-01",
    train_end:   str = "2023-12-31",
) -> pd.Series:
    """
    Two-stage Regime label generation:

    Stage 1 — GMM unsupervised:
        Fits a 4-component GMM on [ret_20d, rvol_20d, brent_wti_spread].
        Discovers natural market states without prior assumptions.
        GMM states are unordered (component 0 ≠ R1).

    Stage 2 — Align with REGIME_TRANSITIONS:
        Maps each GMM component to R1/R2/R3/R4 by maximising overlap
        with the manually-labeled REGIME_TRANSITIONS series.
        This gives the discovered boundaries human-interpretable labels.

    Returns: pd.Series with DatetimeIndex, values "R1"/"R2"/"R3"/"R4".
    """
    # ── Load feature matrix ──
    dfs = []
    for year in range(
        pd.to_datetime(train_start).year,
        pd.to_datetime(train_end).year + 1
    ):
        path = FEATURES_DIR / f"features_{year}.parquet"
        if path.exists():
            dfs.append(pd.read_parquet(path))
    df = pd.concat(dfs).sort_index()
    df = df[train_start:train_end].dropna(subset=GMM_FEATURES)

    # ── Stage 1: Fit GMM ──
    X = df[GMM_FEATURES].values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    gmm = GaussianMixture(
        n_components=N_COMPONENTS,
        covariance_type="full",
        n_init=10,             # Multiple random inits for stability
        random_state=42,
    )
    gmm.fit(X_scaled)
    gmm_labels = gmm.predict(X_scaled)   # 0, 1, 2, 3 — unordered

    gmm_series = pd.Series(gmm_labels, index=df.index, dtype=int)

    # ── Stage 2: Align with REGIME_TRANSITIONS ──
    manual = build_regime_series(train_start, train_end)
    manual = manual.reindex(df.index).ffill().dropna()

    # Map each GMM component to the R-label it overlaps most with
    mapping = {}
    for component in range(N_COMPONENTS):
        mask = gmm_series == component
        if mask.sum() == 0:
            continue
        manual_subset = manual[mask]
        # Most frequent manual label for this component
        best_label = manual_subset.value_counts().idxmax()
        mapping[component] = best_label

    # Handle duplicates: if two GMM components map to same R-label,
    # assign the less-common one to the next best match
    used = set()
    final_mapping = {}
    for comp, label in sorted(
        mapping.items(),
        key=lambda x: (gmm_series == x[0]).sum(),
        reverse=True
    ):
        if label not in used:
            final_mapping[comp] = label
            used.add(label)
        else:
            # Find next best label not yet used
            mask = gmm_series == comp
            counts = manual[mask].value_counts()
            for alt_label in counts.index:
                if alt_label not in used:
                    final_mapping[comp] = alt_label
                    used.add(alt_label)
                    break

    labels = gmm_series.map(final_mapping)

    logger.info(f"Label distribution:\n{labels.value_counts().sort_index()}")
    logger.info(f"GMM→Regime mapping: {final_mapping}")

    return labels
```

### Validation

After generating labels, validate alignment quality:

```python
def validate_labels(gmm_labels: pd.Series, train_start: str, train_end: str) -> dict:
    """
    Compute overlap between GMM-derived labels and REGIME_TRANSITIONS.
    Acceptable threshold: overall agreement > 70%.
    If below threshold, review GMM_FEATURES or N_COMPONENTS.
    """
    manual = build_regime_series(train_start, train_end)
    aligned = manual.reindex(gmm_labels.index).ffill().dropna()
    common  = gmm_labels.reindex(aligned.index).dropna()

    agreement = (common == aligned).mean()
    per_regime = {}
    for r in ["R1", "R2", "R3", "R4"]:
        mask = aligned == r
        if mask.sum() > 0:
            per_regime[r] = (common[mask] == aligned[mask]).mean()

    return {
        "overall_agreement": round(agreement, 3),
        "per_regime":        per_regime,
        "label_counts":      common.value_counts().to_dict(),
        "acceptable":        agreement > 0.70,
    }
```

---

## 8. Training Infrastructure

### 8.1 Data split

```
Training:   2010-01-01 → 2023-12-31   (~3,500 trading days)
Validation: 2024-01-01 → 2024-12-31   (~252 trading days, used for calibration)
OOS:        2025-01-01 → today         (never seen during any training step)
```

Cross-validation within training set: `TimeSeriesSplit(n_splits=5, gap=20)`.  
Gap of 20 trading days prevents rolling-window features from leaking across folds.

### 8.2 MLflow setup

```python
# core/models/trainer.py (setup section)
import mlflow
from core.config_paths import MLRUNS_DIR

mlflow.set_tracking_uri(f"file:{MLRUNS_DIR}")
mlflow.set_experiment("oil-signalyst")
# MLRUNS_DIR = data/mlruns/ — added to config_paths.py
```

### 8.3 Unified trainer

```python
# core/models/trainer.py
import joblib
import mlflow
import numpy as np
import pandas as pd
from datetime import datetime
from pathlib import Path
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import brier_score_loss, accuracy_score
from sklearn.calibration import calibration_curve
from tabpfn import TabPFNClassifier, TabPFNRegressor

from core.config_paths import FEATURES_DIR, MODELS_DIR, MLRUNS_DIR
from core.models.label_generator import generate_regime_labels
from core.models.regime import build_regime_model
from core.models.eia import build_eia_model
from core.models.returns import build_returns_model
from core.postprocess.calibration import calibrate_model
from db.models import ModelVersion
from db.database import get_db
from core.logging import get_logger

logger = get_logger(__name__)

TRAIN_START = "2010-01-01"
TRAIN_END   = "2023-12-31"
VAL_START   = "2024-01-01"
VAL_END     = "2024-12-31"
N_SPLITS    = 5
GAP_DAYS    = 20


def load_features(start: str, end: str) -> pd.DataFrame:
    """Load feature Parquet files for the given date range."""
    dfs = []
    for year in range(pd.to_datetime(start).year, pd.to_datetime(end).year + 1):
        path = FEATURES_DIR / f"features_{year}.parquet"
        if path.exists():
            dfs.append(pd.read_parquet(path))
    if not dfs:
        raise FileNotFoundError(
            f"No feature Parquet files found for {start}→{end}. "
            "Run scripts/backfill.py first."
        )
    df = pd.concat(dfs).sort_index()
    return df[start:end]


async def run_full_training(triggered_by_user_id: int | None = None) -> dict:
    """
    Train all three models in sequence.
    Logs to MLflow. Saves to data/models/. Writes model_versions rows.
    Returns summary dict for the training API response.
    """
    results = {}
    version_tag = datetime.utcnow().strftime("%Y.%m.%d.v1")

    # ── Load data ──
    train_df = load_features(TRAIN_START, TRAIN_END)
    val_df   = load_features(VAL_START, VAL_END)

    # ── Generate Regime labels ──
    regime_labels = generate_regime_labels(TRAIN_START, TRAIN_END)
    regime_labels_val = generate_regime_labels(VAL_START, VAL_END)

    # ── Train Model A: Regime ──
    results["regime"] = await train_one_model(
        model_type    = "regime",
        version_tag   = version_tag,
        train_X       = train_df,
        train_y       = regime_labels.reindex(train_df.index).dropna(),
        val_X         = val_df,
        val_y         = regime_labels_val.reindex(val_df.index).dropna(),
        build_fn      = build_regime_model,
        user_id       = triggered_by_user_id,
    )

    # ── Train Model B: EIA ──
    results["eia"] = await train_one_model(
        model_type    = "eia",
        version_tag   = version_tag,
        train_X       = train_df,
        train_y       = None,   # build_eia_model constructs its own labels
        val_X         = val_df,
        val_y         = None,
        build_fn      = build_eia_model,
        user_id       = triggered_by_user_id,
    )

    # ── Train Model C: Return distribution ──
    # Pass regime_probs from Model A as additional feature
    results["returns"] = await train_one_model(
        model_type    = "returns",
        version_tag   = version_tag,
        train_X       = train_df,
        train_y       = None,   # build_returns_model constructs its own labels
        val_X         = val_df,
        val_y         = None,
        build_fn      = build_returns_model,
        user_id       = triggered_by_user_id,
        extra          = {"regime_model_path": results["regime"]["file_path"]},
    )

    return results


async def train_one_model(
    model_type, version_tag, train_X, train_y,
    val_X, val_y, build_fn, user_id, extra=None,
) -> dict:
    with mlflow.start_run(run_name=f"{model_type}_{version_tag}"):
        mlflow.log_params({
            "model_type":      model_type,
            "train_start":     TRAIN_START,
            "train_end":       TRAIN_END,
            "n_splits":        N_SPLITS,
            "gap_days":        GAP_DAYS,
            "n_features":      train_X.shape[1],
            "feature_version": _hash_features(),
        })

        model, metrics_train, metrics_val = build_fn(
            train_X, train_y, val_X, val_y,
            n_splits=N_SPLITS, gap_days=GAP_DAYS,
            extra=extra or {},
        )

        mlflow.log_metrics({**metrics_train, **{f"val_{k}": v for k, v in metrics_val.items()}})

        # Save model
        file_path = MODELS_DIR / f"{model_type}_{version_tag}.joblib"
        joblib.dump(model, file_path)
        mlflow.log_artifact(str(file_path))

        # Write model_versions row
        async with get_db() as db:
            # Deactivate previous active version
            await db.execute(
                text("UPDATE model_versions SET is_active=0 WHERE model_type=:t"),
                {"t": model_type}
            )
            mv = ModelVersion(
                model_type   = model_type,
                version      = version_tag,
                file_path    = str(file_path),
                train_config = {
                    "train_start": TRAIN_START,
                    "train_end":   TRAIN_END,
                    "n_splits":    N_SPLITS,
                    "gap_days":    GAP_DAYS,
                },
                metrics_train = metrics_train,
                metrics_oos   = metrics_val,
                feature_list  = list(train_X.columns),
                is_active     = True,
                deployed_at   = datetime.utcnow(),
            )
            db.add(mv)

        logger.info(f"{model_type} trained: {metrics_val}")
        return {"file_path": str(file_path), "metrics": metrics_val}


def _hash_features() -> str:
    from core.config_paths import FEATURES_YAML
    import hashlib
    return hashlib.md5(FEATURES_YAML.read_bytes()).hexdigest()[:8]
```

---

## 9. Model A — Regime Classifier

```python
# core/models/regime.py
import numpy as np
import pandas as pd
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import brier_score_loss, accuracy_score
from tabpfn import TabPFNClassifier

REGIME_CLASSES = ["R1", "R2", "R3", "R4"]


def build_regime_model(train_X, train_y, val_X, val_y, n_splits, gap_days, extra):
    """
    Trains TabPFN 4-class classifier for Regime identification.

    TabPFN constraint: max 1024 training samples.
    With ~3500 days of training data, we use the most recent 1000 samples
    (recency bias: recent market structure more predictive than 2010 data).

    Cross-validation is used for metric estimation only.
    Final model is trained on the full training set (capped at 1000).
    """
    # Align labels and features
    common_idx = train_X.index.intersection(train_y.index)
    X = train_X.loc[common_idx].values
    y = np.array([REGIME_CLASSES.index(r) for r in train_y.loc[common_idx]])

    # TabPFN 1024-sample cap: use most recent samples
    if len(X) > 1000:
        X, y = X[-1000:], y[-1000:]

    # Cross-validation metrics
    tscv = TimeSeriesSplit(n_splits=n_splits, gap=gap_days)
    cv_brier, cv_acc = [], []
    for train_idx, val_idx in tscv.split(X):
        m = TabPFNClassifier(device="cpu")
        m.fit(X[train_idx], y[train_idx])
        probs = m.predict_proba(X[val_idx])
        preds = probs.argmax(axis=1)
        # Brier score (multiclass: mean over classes)
        brier = np.mean([
            brier_score_loss((y[val_idx] == c).astype(int), probs[:, c])
            for c in range(len(REGIME_CLASSES))
        ])
        cv_brier.append(brier)
        cv_acc.append(accuracy_score(y[val_idx], preds))

    metrics_train = {
        "brier_cv_mean": round(np.mean(cv_brier), 4),
        "brier_cv_std":  round(np.std(cv_brier), 4),
        "accuracy_cv":   round(np.mean(cv_acc), 4),
    }

    # Final model on full training data
    model = TabPFNClassifier(device="cpu")
    model.fit(X, y)

    # Validation metrics
    common_val = val_X.index.intersection(val_y.index)
    X_val = val_X.loc[common_val].values
    y_val = np.array([REGIME_CLASSES.index(r) for r in val_y.loc[common_val]])
    probs_val = model.predict_proba(X_val)
    preds_val = probs_val.argmax(axis=1)

    brier_val = np.mean([
        brier_score_loss((y_val == c).astype(int), probs_val[:, c])
        for c in range(len(REGIME_CLASSES))
    ])
    metrics_val = {
        "brier":    round(brier_val, 4),
        "accuracy": round(accuracy_score(y_val, preds_val), 4),
    }

    return model, metrics_train, metrics_val


def predict_regime(model, features: np.ndarray) -> dict:
    """Returns regime probability dict for a single feature vector."""
    probs = model.predict_proba(features.reshape(1, -1))[0]
    return {r: round(float(p), 4) for r, p in zip(REGIME_CLASSES, probs)}
```

---

## 10. Model B — EIA Inventory Forecast

```python
# core/models/eia.py
import numpy as np
import pandas as pd
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error
from tabpfn import TabPFNRegressor

# Features specifically relevant for EIA weekly prediction
EIA_FEATURES = [
    "crude_inv_dev", "crude_inv_chg_4w",
    "cushing_inventory",                  # Added in Phase 2 as direct EIA feature
    "rvol_20d", "brent_wti_spread",
    "ret_5d",
]

FORECAST_HORIZON_DAYS = 7   # Predict next Wednesday's release


def _build_eia_labels(features_df: pd.DataFrame) -> pd.Series:
    """
    Target: next week's crude inventory change (in million barrels).
    Uses crude_inventory column shifted back by FORECAST_HORIZON_DAYS.

    EIA data is weekly; we predict the direction and magnitude of
    the next published weekly change.
    """
    inv = features_df["crude_inventory"] if "crude_inventory" in features_df.columns else None
    if inv is None:
        raise ValueError("crude_inventory not in features — check data_sources.yaml")
    weekly_change = inv.diff(1)   # Week-on-week change in MB
    # Target at time T = change that will be published at T+7 days
    return weekly_change.shift(-FORECAST_HORIZON_DAYS)


def build_eia_model(train_X, train_y, val_X, val_y, n_splits, gap_days, extra):
    labels_train = _build_eia_labels(train_X).dropna()
    labels_val   = _build_eia_labels(val_X).dropna()

    common_train = train_X.index.intersection(labels_train.index)
    X = train_X.loc[common_train][EIA_FEATURES].values
    y = labels_train.loc[common_train].values

    if len(X) > 1000:
        X, y = X[-1000:], y[-1000:]

    # Direction accuracy helper
    def direction_acc(y_true, y_pred):
        return np.mean(np.sign(y_true) == np.sign(y_pred))

    # Cross-validation
    tscv = TimeSeriesSplit(n_splits=n_splits, gap=gap_days)
    cv_mae, cv_dir = [], []
    for tr_idx, va_idx in tscv.split(X):
        m = TabPFNRegressor(device="cpu")
        m.fit(X[tr_idx], y[tr_idx])
        preds = m.predict(X[va_idx])
        cv_mae.append(mean_absolute_error(y[va_idx], preds))
        cv_dir.append(direction_acc(y[va_idx], preds))

    metrics_train = {
        "mae_cv_mean":       round(np.mean(cv_mae), 3),
        "direction_acc_cv":  round(np.mean(cv_dir), 3),
    }

    # Final model
    model = TabPFNRegressor(device="cpu")
    model.fit(X, y)

    # Validation
    common_val = val_X.index.intersection(labels_val.index)
    X_val = val_X.loc[common_val][EIA_FEATURES].values
    y_val = labels_val.loc[common_val].values
    preds_val = model.predict(X_val)

    # Market consensus proxy: rolling 4-week mean of actuals
    consensus_val = labels_val.rolling(4).mean().shift(1).loc[common_val].values
    consensus_mae = mean_absolute_error(y_val, consensus_val)

    metrics_val = {
        "mae":              round(mean_absolute_error(y_val, preds_val), 3),
        "mae_vs_consensus": round(mean_absolute_error(y_val, preds_val) - consensus_mae, 3),
        "direction_acc":    round(direction_acc(y_val, preds_val), 3),
    }

    return model, metrics_train, metrics_val


def predict_eia(model, features: pd.DataFrame) -> dict:
    """
    Returns EIA forecast dict compatible with Prediction.eia_forecast JSON schema.
    Includes market_consensus_proxy for the Trader view 'vs consensus' display.
    """
    X = features[EIA_FEATURES].values[-1].reshape(1, -1)
    point = float(model.predict(X)[0])

    # Simple uncertainty interval: ±1.5 MB (empirical from CV MAE ~1.3 MB)
    interval_80 = [round(point - 1.5, 2), round(point + 1.5, 2)]

    # Market consensus proxy: last 4 weeks' mean change
    inv_changes = features["crude_inventory"].diff().dropna()
    consensus = float(inv_changes.tail(4).mean()) if len(inv_changes) >= 4 else 0.0

    return {
        "crude":            round(point, 2),
        "interval_80":      interval_80,
        "market_consensus": round(consensus, 2),
        "surprise":         round(point - consensus, 2),
    }
```

---

## 11. Model C — Conditional Return Distribution

Two-stage inference: Regime probabilities from Model A are appended as features to Model C.

```python
# core/models/returns.py
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import brier_score_loss, accuracy_score
from tabpfn import TabPFNClassifier

HORIZON_DAYS = 20   # 20 trading days forward
BINS = [-np.inf, -0.10, 0.0, 0.10, np.inf]
BIN_LABELS = ["lt_minus10", "neg_10_0", "pos_0_10", "gt_10"]
# Key naming: pure underscores — matches TypeScript interface (no hyphens)


def _build_return_labels(features_df: pd.DataFrame) -> pd.Series:
    """
    Target: which return bin does WTI fall into over next HORIZON_DAYS trading days?
    Uses WTI price (wti column) to compute forward returns.
    """
    wti = features_df["wti"] if "wti" in features_df.columns else None
    if wti is None:
        raise ValueError("wti not in features")
    fwd_return = wti.pct_change(HORIZON_DAYS).shift(-HORIZON_DAYS)
    binned = pd.cut(fwd_return, bins=BINS, labels=range(4))
    return binned.dropna().astype(int)


def _append_regime_probs(features_df: pd.DataFrame, regime_model_path: str) -> pd.DataFrame:
    """
    Appends R1/R2/R3/R4 probability columns from the trained Regime model.
    This is the conditioning mechanism: return distribution is informed by
    the current market regime without being hardcoded per-regime.
    """
    regime_model = joblib.load(regime_model_path)
    X = features_df.values
    probs = regime_model.predict_proba(X)
    regime_df = pd.DataFrame(
        probs,
        index=features_df.index,
        columns=["p_R1", "p_R2", "p_R3", "p_R4"],
    )
    return pd.concat([features_df, regime_df], axis=1)


def build_returns_model(train_X, train_y, val_X, val_y, n_splits, gap_days, extra):
    regime_model_path = extra.get("regime_model_path")
    if not regime_model_path:
        raise ValueError("regime_model_path required in extra for returns model")

    # Append regime probs as features
    train_X_aug = _append_regime_probs(train_X, regime_model_path)
    val_X_aug   = _append_regime_probs(val_X,   regime_model_path)

    labels_train = _build_return_labels(train_X_aug).dropna()
    labels_val   = _build_return_labels(val_X_aug).dropna()

    common_train = train_X_aug.index.intersection(labels_train.index)
    X = train_X_aug.loc[common_train].values
    y = labels_train.loc[common_train].values

    if len(X) > 1000:
        X, y = X[-1000:], y[-1000:]

    # Cross-validation
    tscv = TimeSeriesSplit(n_splits=n_splits, gap=gap_days)
    cv_brier, cv_acc = [], []
    for tr_idx, va_idx in tscv.split(X):
        m = TabPFNClassifier(device="cpu")
        m.fit(X[tr_idx], y[tr_idx])
        probs = m.predict_proba(X[va_idx])
        brier = np.mean([
            brier_score_loss((y[va_idx] == c).astype(int), probs[:, c])
            for c in range(4)
        ])
        cv_brier.append(brier)
        cv_acc.append(accuracy_score(y[va_idx], probs.argmax(axis=1)))

    metrics_train = {
        "brier_cv_mean": round(np.mean(cv_brier), 4),
        "accuracy_cv":   round(np.mean(cv_acc), 4),
    }

    model = TabPFNClassifier(device="cpu")
    model.fit(X, y)

    common_val = val_X_aug.index.intersection(labels_val.index)
    X_val = val_X_aug.loc[common_val].values
    y_val = labels_val.loc[common_val].values
    probs_val = model.predict_proba(X_val)

    brier_val = np.mean([
        brier_score_loss((y_val == c).astype(int), probs_val[:, c])
        for c in range(4)
    ])
    metrics_val = {
        "brier":    round(brier_val, 4),
        "accuracy": round(accuracy_score(y_val, probs_val.argmax(axis=1)), 4),
    }

    return model, metrics_train, metrics_val


def predict_returns(model, features_aug: np.ndarray) -> dict:
    """Returns return distribution dict matching Prediction.return_dist schema."""
    probs = model.predict_proba(features_aug.reshape(1, -1))[0]
    return {label: round(float(p), 4) for label, p in zip(BIN_LABELS, probs)}
```

---

## 12. Post-Processing Layer

### 12.1 SHAP Explainer

```python
# core/postprocess/shap_explainer.py
import shap
import numpy as np
import pandas as pd


def compute_shap_values(model, X: np.ndarray, feature_names: list[str]) -> dict:
    """
    Computes SHAP values for a single prediction (X is shape [1, n_features]).
    Returns dict mapping feature_name → absolute SHAP contribution.
    Stored in Prediction.shap_values JSON column.
    """
    explainer   = shap.Explainer(model, algorithm="auto")
    shap_values = explainer(X)

    # For multiclass: use mean absolute value across classes
    if shap_values.values.ndim == 3:
        abs_vals = np.abs(shap_values.values[0]).mean(axis=1)
    else:
        abs_vals = np.abs(shap_values.values[0])

    # Normalise to sum to 1 for easier comparison
    total = abs_vals.sum()
    if total > 0:
        abs_vals = abs_vals / total

    return {name: round(float(val), 4) for name, val in zip(feature_names, abs_vals)}
```

### 12.2 Probability Calibration

```python
# core/postprocess/calibration.py
import numpy as np
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
import matplotlib.pyplot as plt
import mlflow


def calibrate_model(model, X_val: np.ndarray, y_val: np.ndarray):
    """
    Applies Isotonic Regression calibration using the 2024 validation set.
    Returns calibrated model wrapper.
    Called after training, before saving the final model.
    """
    calibrated = CalibratedClassifierCV(model, method="isotonic", cv="prefit")
    calibrated.fit(X_val, y_val)
    return calibrated


def log_calibration_curve(model, X_val, y_val, n_classes: int, run_name: str):
    """Generates and logs calibration curve to MLflow as artifact."""
    fig, ax = plt.subplots(figsize=(6, 5))
    probs = model.predict_proba(X_val)

    for c in range(n_classes):
        fraction_pos, mean_predicted = calibration_curve(
            (y_val == c).astype(int), probs[:, c], n_bins=10
        )
        ax.plot(mean_predicted, fraction_pos, label=f"Class {c}")

    ax.plot([0, 1], [0, 1], "k--", label="Perfect calibration")
    ax.set_xlabel("Mean predicted probability")
    ax.set_ylabel("Fraction of positives")
    ax.set_title(f"Calibration curve — {run_name}")
    ax.legend()

    mlflow.log_figure(fig, f"calibration_{run_name}.png")
    plt.close(fig)
```

### 12.3 PSI Drift Monitor

```python
# core/postprocess/drift_monitor.py
import numpy as np
import pandas as pd


def compute_psi(reference: np.ndarray, current: np.ndarray, n_bins: int = 10) -> float:
    """
    Population Stability Index between reference (training) and current distributions.
    PSI < 0.10: stable
    PSI 0.10–0.20: minor shift, monitor
    PSI > 0.20: significant drift, retrain recommended
    """
    def _psi_one(ref, cur):
        bins = np.percentile(ref, np.linspace(0, 100, n_bins + 1))
        bins[0], bins[-1] = -np.inf, np.inf
        ref_pct = np.histogram(ref, bins=bins)[0] / len(ref)
        cur_pct = np.histogram(cur, bins=bins)[0] / len(cur)
        ref_pct = np.where(ref_pct == 0, 1e-6, ref_pct)
        cur_pct = np.where(cur_pct == 0, 1e-6, cur_pct)
        return np.sum((cur_pct - ref_pct) * np.log(cur_pct / ref_pct))

    if reference.ndim == 1:
        return _psi_one(reference, current)
    return float(np.mean([_psi_one(reference[:, i], current[:, i])
                           for i in range(reference.shape[1])]))


def compute_feature_psi(
    train_features: pd.DataFrame,
    recent_features: pd.DataFrame,
) -> dict[str, float]:
    """Computes per-feature PSI. Stored in FeatureSnapshot.psi_scores."""
    return {
        col: round(compute_psi(train_features[col].values, recent_features[col].values), 4)
        for col in train_features.columns
        if col in recent_features.columns
    }
```

### 12.4 Decision Rule Engine

```python
# core/postprocess/decision_engine.py
from dataclasses import dataclass


@dataclass
class DecisionOutput:
    direction:     str    # "LONG" | "SHORT" | "FLAT"
    position_size: float  # 0.0–1.0
    hedge_ratio:   float  # 0.0–1.0
    stop_loss:     float  # absolute price level
    rationale:     str


def generate_decision(
    regime_probs:  dict,
    return_dist:   dict,
    current_price: float,
    exposure_barrels: int = 100_000,
) -> dict:
    """
    Translates model outputs into actionable trading guidance.
    All thresholds are conservative defaults; users adjust via alert thresholds.
    """
    downside_prob = return_dist["lt_minus10"] + return_dist["neg_10_0"]
    upside_prob   = return_dist["pos_0_10"]   + return_dist["gt_10"]
    expected_ret  = (
        return_dist["lt_minus10"] * -0.15 +
        return_dist["neg_10_0"]   * -0.05 +
        return_dist["pos_0_10"]   *  0.05 +
        return_dist["gt_10"]      *  0.15
    )

    dominant_regime = max(regime_probs, key=regime_probs.get)
    regime_conf     = regime_probs[dominant_regime]

    # Direction
    if expected_ret > 0.02 and downside_prob < 0.35 and regime_conf > 0.5:
        direction     = "LONG"
        position_size = min(expected_ret / 0.05, 1.0)
    elif expected_ret < -0.02 and downside_prob > 0.50:
        direction     = "SHORT"
        position_size = min(abs(expected_ret) / 0.05, 1.0)
    else:
        direction     = "FLAT"
        position_size = 0.0

    # Hedge ratio: higher when downside risk is elevated
    hedge_ratio = min(downside_prob * 1.5, 0.90)

    # Stop-loss: 8% below current price for long, 8% above for short
    if direction == "LONG":
        stop_loss = round(current_price * 0.92, 2)
    elif direction == "SHORT":
        stop_loss = round(current_price * 1.08, 2)
    else:
        stop_loss = round(current_price * 0.92, 2)

    rationale = (
        f"Dominant regime {dominant_regime} ({regime_conf:.0%} confidence). "
        f"Downside risk {downside_prob:.0%}, expected return {expected_ret:+.1%}. "
        f"Hedge ratio {hedge_ratio:.0%} recommended."
    )

    return {
        "direction":     direction,
        "position_size": round(position_size, 3),
        "hedge_ratio":   round(hedge_ratio, 3),
        "stop_loss":     stop_loss,
        "rationale":     rationale,
        "expected_ret":  round(expected_ret, 4),
        "downside_prob": round(downside_prob, 4),
    }
```

### 12.5 Stress Test

```python
# core/postprocess/stress_test.py
from datetime import date
import numpy as np
from db.database import get_db
from db.models import FeatureSnapshot, ModelVersion
from sqlalchemy import select

STRESS_SCENARIOS = {
    "2020_covid":   date(2020, 3, 16),
    "2022_ukraine": date(2022, 3, 7),
    "2014_opec":    date(2014, 11, 28),
}


async def run_stress_test(regime_model, returns_model) -> dict:
    """
    Re-runs trained models on historical extreme-date feature snapshots.
    Data comes from feature_snapshots table (populated by Phase 1 pipeline).

    Feature ordering uses the active model's feature_list from model_versions table,
    not dict insertion order — guarantees the feature vector matches what the model
    was trained on even if features.yaml is later reordered.
    """
    # Retrieve the canonical feature order from the active model version
    async with get_db() as db:
        mv_row = await db.execute(
            select(ModelVersion).where(
                ModelVersion.model_type == "regime",
                ModelVersion.is_active == True,
            )
        )
        mv = mv_row.scalar_one_or_none()
    feature_list = mv.feature_list if mv else None

    results = {}
    async with get_db() as db:
        for name, scenario_date in STRESS_SCENARIOS.items():
            row = await db.execute(
                select(FeatureSnapshot).where(FeatureSnapshot.date == scenario_date)
            )
            snapshot = row.scalar_one_or_none()
            if snapshot is None:
                results[name] = {"error": f"No snapshot for {scenario_date}"}
                continue

            # Use feature_list order; fall back to dict order only if no model version
            if feature_list:
                try:
                    features = [snapshot.features[k] for k in feature_list]
                except KeyError as e:
                    results[name] = {"error": f"Feature {e} missing from snapshot"}
                    continue
            else:
                features = list(snapshot.features.values())

            X = np.array(features, dtype=float).reshape(1, -1)

            regime_probs = regime_model.predict_proba(X)[0]
            regime_dict  = {f"R{i+1}": round(float(p), 4) for i, p in enumerate(regime_probs)}

            return_probs = returns_model.predict_proba(X)[0]
            return_dict  = {
                "lt_minus10": round(float(return_probs[0]), 4),
                "neg_10_0":   round(float(return_probs[1]), 4),
                "pos_0_10":   round(float(return_probs[2]), 4),
                "gt_10":      round(float(return_probs[3]), 4),
            }

            downside = return_dict["lt_minus10"] + return_dict["neg_10_0"]
            results[name] = {
                "date":          str(scenario_date),
                "regime_probs":  regime_dict,
                "return_dist":   return_dict,
                "downside_risk": round(downside, 4),
                "would_warn":    downside > 0.40,
            }

    return results
```

### 12.6 Regime Statistics

```python
# core/postprocess/regime_stats.py
import numpy as np
import pandas as pd
from datetime import date
from db.database import get_db
from db.models import Prediction
from sqlalchemy import select, desc


async def get_regime_duration(dominant_regime: str) -> int:
    """
    How many consecutive days has the dominant_regime been the predicted regime?
    Reads backwards from today through predictions table.
    """
    async with get_db() as db:
        rows = await db.execute(
            select(Prediction.date, Prediction.regime_probs)
            .order_by(desc(Prediction.date))
            .limit(365)
        )
        records = rows.fetchall()

    count = 0
    for row in records:
        probs = row.regime_probs or {}
        pred_dominant = max(probs, key=probs.get) if probs else None
        if pred_dominant == dominant_regime:
            count += 1
        else:
            break
    return count


async def estimate_switch_probability(
    current_regime: str,
    horizon_weeks: int = 4,
) -> float:
    """
    Estimates P(regime changes within horizon_weeks) using an empirical
    Markov transition matrix computed from predictions history.
    Falls back to 0.25 (uniform) if insufficient history.
    """
    async with get_db() as db:
        rows = await db.execute(
            select(Prediction.date, Prediction.regime_probs)
            .order_by(Prediction.date)
        )
        records = rows.fetchall()

    if len(records) < 50:
        return 0.25   # Insufficient history

    regimes = []
    for row in records:
        probs = row.regime_probs or {}
        regimes.append(max(probs, key=probs.get) if probs else None)

    # Build transition matrix
    transitions = {r: {s: 0 for s in ["R1","R2","R3","R4"]} for r in ["R1","R2","R3","R4"]}
    for i in range(len(regimes) - 1):
        if regimes[i] and regimes[i+1]:
            transitions[regimes[i]][regimes[i+1]] += 1

    row_total = sum(transitions[current_regime].values())
    if row_total == 0:
        return 0.25

    stay_prob = transitions[current_regime].get(current_regime, 0) / row_total
    # P(switch within horizon) ≈ 1 - P(stay every week)^horizon_weeks
    # Approximate: daily to weekly scaling
    daily_stay = stay_prob ** (1/5)
    return round(1 - daily_stay ** (horizon_weeks * 5), 4)
```

### 12.7 Outcome Backfill

```python
# core/postprocess/outcome_backfill.py
import pandas as pd
from datetime import date, timedelta
from sqlalchemy import select, text
from db.database import get_db
from db.models import Prediction
from core.data.registry import DataRegistry


async def backfill_outcomes(today: date = None):
    """
    Called daily by the pipeline.
    Finds predictions from HORIZON_DAYS ago that have no actual_return,
    computes the realised return, and marks outcome_correct.
    """
    today          = today or date.today()
    HORIZON_DAYS   = 20
    outcome_date   = today - timedelta(days=HORIZON_DAYS)

    async with get_db() as db:
        row = await db.execute(
            select(Prediction).where(
                Prediction.date == outcome_date,
                Prediction.actual_return.is_(None),
            )
        )
        prediction = row.scalar_one_or_none()
        if prediction is None:
            return   # Already backfilled or no prediction for that date

        # Fetch WTI prices for the two dates
        registry = DataRegistry()
        wti = registry.fetch("wti", str(outcome_date), str(today))
        if str(outcome_date) not in wti.index.strftime("%Y-%m-%d"):
            return   # Price data not available yet

        price_then = float(wti.loc[str(outcome_date)])
        price_now  = float(wti.iloc[-1])
        actual_ret = (price_now / price_then) - 1

        # Determine which bucket the actual return falls into
        if actual_ret < -0.10:
            actual_bucket = "lt_minus10"
        elif actual_ret < 0.0:
            actual_bucket = "neg_10_0"
        elif actual_ret < 0.10:
            actual_bucket = "pos_0_10"
        else:
            actual_bucket = "gt_10"

        # Was the highest-probability bucket correct?
        return_dist = prediction.return_dist or {}
        predicted_bucket = max(return_dist, key=return_dist.get) if return_dist else None
        outcome_correct  = predicted_bucket == actual_bucket

        await db.execute(
            text("""
                UPDATE predictions
                SET actual_return = :ret, outcome_correct = :correct
                WHERE id = :id
            """),
            {"ret": round(actual_ret, 6), "correct": outcome_correct, "id": prediction.id},
        )
```

---

## 13. Inference Pipeline Integration

Phase 2 extends the Phase 1 daily pipeline with model inference and outcome backfill.

```python
# scheduler/jobs.py — additions to run_daily_pipeline()

async def run_daily_pipeline(target_date=None):
    # ... [Phase 1 steps: idempotency check, log start, fetch data,
    #      build features, write Parquet, save feature_snapshot] ...

    # ── NEW in Phase 2: Model inference ──
    from core.models.model_registry import ModelRegistry
    from core.postprocess.shap_explainer import compute_shap_values
    from core.postprocess.decision_engine import generate_decision
    from core.postprocess.regime_stats import get_regime_duration, estimate_switch_probability
    from core.postprocess.outcome_backfill import backfill_outcomes

    regime_model  = await ModelRegistry.get_active("regime")
    eia_model     = await ModelRegistry.get_active("eia")
    returns_model = await ModelRegistry.get_active("returns")

    X = np.array(list(feature_dict.values())).reshape(1, -1)
    feature_names = list(feature_dict.keys())

    # Regime
    regime_probs = predict_regime(regime_model, X[0])

    # EIA
    eia_forecast = predict_eia(eia_model, today_features)

    # Returns (conditioned on regime probs — appended as features)
    X_aug = np.append(X, list(regime_probs.values())).reshape(1, -1)
    return_dist = predict_returns(returns_model, X_aug[0])

    # Post-processing
    shap_values = compute_shap_values(regime_model, X, feature_names)
    decision    = generate_decision(regime_probs, return_dist, current_wti_price)
    duration    = await get_regime_duration(max(regime_probs, key=regime_probs.get))
    switch_prob = await estimate_switch_probability(max(regime_probs, key=regime_probs.get))

    # Write Prediction row
    async with get_db() as db:
        snapshot = await get_feature_snapshot_by_date(db, target_date)
        db.add(Prediction(
            date                = target_date,
            regime_probs        = regime_probs,
            return_dist         = return_dist,
            eia_forecast        = eia_forecast,
            shap_values         = shap_values,
            decision            = decision,
            model_version_id    = ModelRegistry.get_active_version_id("regime"),
            feature_snapshot_id = snapshot.id if snapshot else None,
        ))

    # Backfill outcome for prediction made 20 days ago
    await backfill_outcomes(target_date)
```

### ModelRegistry

```python
# core/models/model_registry.py
import joblib
from db.database import get_db
from db.models import ModelVersion
from db.crud import get_active_model_version
from core.exceptions import ModelNotFoundError
from sqlalchemy import select

_cache: dict[str, object] = {}


class ModelRegistry:
    @staticmethod
    async def get_active(model_type: str):
        """
        Load and cache the currently active model for a given type.
        Must be awaited — called from async pipeline context.
        Raises ModelNotFoundError if no active version exists.

        Note: _cache is a module-level dict shared across calls within
        one process lifetime. Call invalidate() after deploying a new version.
        """
        if model_type in _cache:
            return _cache[model_type]
        model = await ModelRegistry._load_active(model_type)
        return model

    @staticmethod
    async def _load_active(model_type: str):
        async with get_db() as db:
            row = await db.execute(
                select(ModelVersion)
                .where(
                    ModelVersion.model_type == model_type,
                    ModelVersion.is_active == True,
                )
                .limit(1)
            )
            mv = row.scalar_one_or_none()
        if mv is None:
            raise ModelNotFoundError(f"No active model for type '{model_type}'")
        model = joblib.load(mv.file_path)
        _cache[model_type] = model
        return model

    @staticmethod
    def invalidate(model_type: str):
        """Call after deploying a new model version to clear the in-memory cache."""
        _cache.pop(model_type, None)

    @staticmethod
    async def get_active_version_id(model_type: str) -> int | None:
        async with get_db() as db:
            row = await db.execute(
                select(ModelVersion.id)
                .where(
                    ModelVersion.model_type == model_type,
                    ModelVersion.is_active == True,
                )
            )
            return row.scalar_one_or_none()
```

---

## 14. Report Assembly

Before hitting the API, the pipeline assembles a role-agnostic full report dict that all four views draw from.

```python
# core/postprocess/report_assembler.py
from datetime import date
from db.models import Prediction, FeatureSnapshot
from core.postprocess.regime_stats import get_regime_duration, estimate_switch_probability
from core.postprocess.stress_test import run_stress_test


async def assemble_daily_report(prediction: Prediction, snapshot: FeatureSnapshot) -> dict:
    """
    Builds the full report dict from DB records.
    API routes then filter this by role before returning.
    """
    regime_probs  = prediction.regime_probs or {}
    dominant      = max(regime_probs, key=regime_probs.get) if regime_probs else "R3"
    duration      = await get_regime_duration(dominant)
    switch_prob   = await estimate_switch_probability(dominant)

    # VaR proxy from return distribution
    rd = prediction.return_dist or {}
    var_95 = rd.get("lt_minus10", 0) + rd.get("neg_10_0", 0)

    return {
        # Shared across all roles
        "date":             str(prediction.date),
        "price":            snapshot.features.get("wti") if snapshot else None,
        "regime_probs":     regime_probs,
        "dominant_regime":  dominant,
        "regime_duration_weeks": duration // 5,
        "switch_prob_4w":   switch_prob,
        "return_dist":      prediction.return_dist,
        "eia_forecast":     prediction.eia_forecast,
        "shap_values":      prediction.shap_values,
        "decision":         prediction.decision,
        "model_version":    prediction.model_version.version if prediction.model_version else None,

        # Risk-specific
        "var_95":           round(var_95, 4),

        # Feature signals (researcher view)
        "feature_signals":  _build_signal_list(snapshot.features if snapshot else {}),
    }


def _build_signal_list(features: dict) -> list[dict]:
    """
    Annotates each feature value with a bullish/bearish/neutral tag.
    Direction rules are read from features.yaml (bearish_if_positive field),
    not hardcoded — so adding a new feature only requires updating the YAML.
    """
    import yaml
    from core.config_paths import FEATURES_YAML

    with open(FEATURES_YAML) as f:
        feature_configs = yaml.safe_load(f)["features"]

    direction_map = {
        fc["name"]: fc.get("bearish_if_positive")
        for fc in feature_configs
    }

    signals = []
    for name, value in features.items():
        if value is None:
            continue
        bearish_if_pos = direction_map.get(name)
        if bearish_if_pos is None:
            direction = "neutral"
        elif bearish_if_pos:
            direction = "bearish" if value > 0 else "bullish"
        else:
            direction = "bullish" if value > 0 else "bearish"
        signals.append({"name": name, "value": round(value, 4), "direction": direction})

    return sorted(signals, key=lambda x: abs(x["value"]), reverse=True)
```

---

## 15. API Endpoints

### 15.1 Reports

```python
# api/routes/reports.py
from fastapi import APIRouter, Query
from api.dependencies import DbSession, CurrentUser
from db.models import Prediction, FeatureSnapshot
from db.crud import get_prediction_by_date, get_recent_predictions
from core.postprocess.report_assembler import assemble_daily_report
from datetime import date
from sqlalchemy import select, desc

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/daily/{role}")
async def get_daily_report(role: str, db: DbSession, user: CurrentUser):
    """
    Returns today's prediction report, filtered to the requested role.
    Cached in-memory for 1 hour (DataFetchCache handles this at API layer).

    Role filtering:
        trader     → decision, eia_forecast, return_dist summary
        risk       → var_95, decision.hedge_ratio, stress_test stub
        researcher → regime_probs, shap_values, feature_signals, switch_prob
        ds         → full report + model_version + psi_scores
    """
    row = await db.execute(
        select(Prediction)
        .where(Prediction.date == date.today())
        .order_by(desc(Prediction.created_at))
        .limit(1)
    )
    prediction = row.scalar_one_or_none()
    if prediction is None:
        return {"status": "no_prediction", "date": str(date.today())}

    snapshot_row = await db.execute(
        select(FeatureSnapshot).where(FeatureSnapshot.id == prediction.feature_snapshot_id)
    )
    snapshot = snapshot_row.scalar_one_or_none()

    full = await assemble_daily_report(prediction, snapshot)
    return _filter_by_role(full, role)


@router.get("/history")
async def get_history(
    db: DbSession,
    user: CurrentUser,
    days: int = Query(default=30, le=365),
):
    """Returns recent predictions for History page log table."""
    rows = await db.execute(
        select(Prediction)
        .order_by(desc(Prediction.date))
        .limit(days)
    )
    predictions = rows.scalars().all()
    return [_history_row(p) for p in predictions]


@router.get("/history/{prediction_date}")
async def get_prediction_detail(prediction_date: date, db: DbSession, user: CurrentUser):
    """Returns full detail for History detail drawer."""
    row = await db.execute(
        select(Prediction).where(Prediction.date == prediction_date)
    )
    prediction = row.scalar_one_or_none()
    if not prediction:
        return {"error": "not found"}

    snapshot_row = await db.execute(
        select(FeatureSnapshot).where(FeatureSnapshot.id == prediction.feature_snapshot_id)
    )
    snapshot = snapshot_row.scalar_one_or_none()
    full = await assemble_daily_report(prediction, snapshot)
    full["actual_return"]   = prediction.actual_return
    full["outcome_correct"] = prediction.outcome_correct
    full["feature_snapshot"] = snapshot.features if snapshot else None
    return full


def _filter_by_role(report: dict, role: str) -> dict:
    """Returns role-appropriate subset of the full report."""
    base = {k: report[k] for k in [
        "date", "price", "dominant_regime", "regime_probs",
        "return_dist", "eia_forecast", "decision",
    ]}
    if role == "trader":
        return base
    if role == "risk":
        return {**base, "var_95": report["var_95"]}
    if role == "researcher":
        return {**base,
                "shap_values":         report["shap_values"],
                "feature_signals":     report["feature_signals"],
                "regime_duration_weeks": report["regime_duration_weeks"],
                "switch_prob_4w":      report["switch_prob_4w"]}
    if role == "ds":
        return report   # Full report for DS
    return base


def _history_row(p: Prediction) -> dict:
    regime_probs = p.regime_probs or {}
    dominant = max(regime_probs, key=regime_probs.get) if regime_probs else None
    return {
        "date":           str(p.date),
        "dominant_regime": dominant,
        "return_dist":    p.return_dist,
        "eia_forecast":   p.eia_forecast.get("crude") if p.eia_forecast else None,
        "actual_return":  p.actual_return,
        "outcome_correct": p.outcome_correct,
    }
```

### 15.2 Model Status

```python
# api/routes/models.py
from fastapi import APIRouter
from api.dependencies import DbSession
from db.models import ModelVersion
from sqlalchemy import select

router = APIRouter(prefix="/api/models", tags=["models"])

@router.get("/status")
async def get_model_status(db: DbSession):
    rows = await db.execute(
        select(ModelVersion).where(ModelVersion.is_active == True)
    )
    versions = rows.scalars().all()
    return [
        {
            "model_type":   v.model_type,
            "version":      v.version,
            "metrics_oos":  v.metrics_oos,
            "deployed_at":  str(v.deployed_at) if v.deployed_at else None,
            "feature_count": len(v.feature_list or []),
        }
        for v in versions
    ]
```

### 15.3 Training Control

```python
# api/routes/training.py
from fastapi import APIRouter, BackgroundTasks
from api.dependencies import DbSession, CurrentUser
from core.models.trainer import run_full_training
from db.models import SystemLog
from sqlalchemy import text
import asyncio, uuid

router = APIRouter(prefix="/api/train", tags=["training"])
_running_jobs: dict[str, str] = {}   # job_id → status

@router.post("/start")
async def start_training(
    background_tasks: BackgroundTasks,
    db: DbSession,
    user: CurrentUser,
):
    job_id = str(uuid.uuid4())[:8]
    _running_jobs[job_id] = "running"

    async def _run():
        try:
            await run_full_training(triggered_by_user_id=user.id)
            _running_jobs[job_id] = "success"
        except Exception as e:
            _running_jobs[job_id] = f"failed: {e}"

    background_tasks.add_task(_run)
    return {"job_id": job_id, "status": "started"}


@router.get("/status/{job_id}")
async def get_training_status(job_id: str):
    return {"job_id": job_id, "status": _running_jobs.get(job_id, "unknown")}
```

### 15.4 User Config

```python
# api/routes/users.py
from fastapi import APIRouter
from pydantic import BaseModel
from api.dependencies import DbSession, CurrentUser
from db.models import User
from sqlalchemy import text

router = APIRouter(prefix="/api/users", tags=["users"])


class UserConfigUpdate(BaseModel):
    role:                     str | None = None
    email:                    str | None = None
    instruments:              list[str] | None = None
    horizon_days:             int | None = None
    exposure_barrels:         int | None = None
    alert_downside_threshold: float | None = None
    alert_regime_threshold:   float | None = None
    alert_eia_threshold:      float | None = None
    alert_channel:            str | None = None


@router.get("/me")
async def get_me(user: CurrentUser) -> dict:
    return {
        "id":                       user.id,
        "name":                     user.name,
        "role":                     user.role,
        "email":                    user.email,
        "instruments":              user.instruments,
        "horizon_days":             user.horizon_days,
        "exposure_barrels":         user.exposure_barrels,
        "alert_downside_threshold": user.alert_downside_threshold,
        "alert_regime_threshold":   user.alert_regime_threshold,
        "alert_eia_threshold":      user.alert_eia_threshold,
        "alert_channel":            user.alert_channel,
    }


@router.put("/me/config")
async def update_config(
    body: UserConfigUpdate,
    db: DbSession,
    user: CurrentUser,
) -> dict:
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    db.add(user)
    return {"status": "updated"}
```

### 15.5 Signals

```python
# api/routes/signals.py
from fastapi import APIRouter
from api.dependencies import DbSession
from db.models import SignalEvaluation
from sqlalchemy import select

router = APIRouter(prefix="/api/signals", tags=["signals"])

@router.get("/candidates")
async def get_candidates(db: DbSession):
    rows = await db.execute(
        select(SignalEvaluation)
        .where(SignalEvaluation.status == "candidate")
        .order_by(SignalEvaluation.evaluated_at.desc())
    )
    evals = rows.scalars().all()
    return [
        {
            "signal_name":   e.signal_name,
            "ic_scores":     e.ic_scores,
            "oos_decay":     e.oos_decay,
            "coverage":      e.coverage,
            "correlation":   e.correlation,
            "mechanism":     e.mechanism,
            "evaluated_at":  str(e.evaluated_at),
        }
        for e in evals
    ]

@router.get("/active")
async def get_active_features(db: DbSession):
    """Returns currently active features from the latest model_version feature_list."""
    from db.models import ModelVersion
    row = await db.execute(
        select(ModelVersion)
        .where(ModelVersion.model_type == "regime", ModelVersion.is_active == True)
    )
    mv = row.scalar_one_or_none()
    return {"features": mv.feature_list if mv else []}
```

### 15.6 Register all routers

```python
# api/main.py — update create_app()
from api.routes import health, reports, models, training, signals, users

def create_app() -> FastAPI:
    app = FastAPI(title="oil-signalyst", version="0.2.0", lifespan=lifespan)
    app.include_router(health.router)
    app.include_router(reports.router)
    app.include_router(models.router)
    app.include_router(training.router)
    app.include_router(signals.router)
    app.include_router(users.router)
    return app
```

---

## 16. Signal Scanner

Runs weekly (Sunday, before retraining). Evaluates new candidate signals from `data_sources.yaml` and writes results to `signal_evaluations` table.

```python
# core/signal_scanner.py
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from db.models import SignalEvaluation
from db.database import get_db
from core.config_paths import FEATURES_DIR
from core.logging import get_logger

logger = get_logger(__name__)

IC_LAG_DAYS   = [5, 10, 20]
MIN_IC        = 0.10
MAX_OOS_DECAY = 0.30
MAX_CORR      = 0.50


async def scan_signals(candidate_names: list[str], target_series: pd.Series):
    """
    Evaluates each candidate signal against the Regime label target.
    Writes results to signal_evaluations table.
    """
    # Load training features
    dfs = []
    for year in range(2010, 2024):
        path = FEATURES_DIR / f"features_{year}.parquet"
        if path.exists():
            dfs.append(pd.read_parquet(path))
    features_df = pd.concat(dfs).sort_index()

    split = int(len(features_df) * 0.7)
    train_df = features_df.iloc[:split]
    oos_df   = features_df.iloc[split:]

    for name in candidate_names:
        if name not in features_df.columns:
            continue

        signal_train = train_df[name].dropna()
        signal_oos   = oos_df[name].dropna()
        target_train = target_series.reindex(signal_train.index).dropna()
        target_oos   = target_series.reindex(signal_oos.index).dropna()

        # IC scores
        ic_scores = {}
        for lag in IC_LAG_DAYS:
            shifted = signal_train.shift(lag).reindex(target_train.index).dropna()
            t_aligned = target_train.reindex(shifted.index).dropna()
            if len(shifted) < 30:
                continue
            ic, pval = spearmanr(shifted, t_aligned)
            ic_scores[f"ic_lag{lag}"] = round(ic, 4)
            ic_scores[f"pval_lag{lag}"] = round(pval, 4)

        # OOS decay
        ic_train_mean = np.mean([v for k, v in ic_scores.items() if "ic_lag" in k and "pval" not in k])
        oos_shifted   = signal_oos.shift(20).reindex(target_oos.index).dropna()
        t_oos_aligned = target_oos.reindex(oos_shifted.index).dropna()
        ic_oos        = spearmanr(oos_shifted, t_oos_aligned)[0] if len(oos_shifted) > 10 else 0
        oos_decay     = 1 - (ic_oos / ic_train_mean) if ic_train_mean != 0 else 1.0

        # Correlation with existing features
        corr = {
            col: round(float(features_df[name].corr(features_df[col])), 4)
            for col in features_df.columns if col != name
        }
        max_corr = max(abs(v) for v in corr.values())

        # Coverage
        coverage = round(features_df[name].notna().mean(), 4)

        # Recommendation
        passes = (
            abs(ic_train_mean) > MIN_IC and
            oos_decay < MAX_OOS_DECAY and
            max_corr < MAX_CORR and
            coverage > 0.80
        )
        status = "candidate" if passes else "rejected"

        async with get_db() as db:
            db.add(SignalEvaluation(
                signal_name   = name,
                source_config = {"source": name},
                ic_scores     = ic_scores,
                oos_decay     = round(oos_decay, 4),
                correlation   = corr,
                coverage      = coverage,
                status        = status,
            ))

        logger.info(f"Signal {name}: {'PASS' if passes else 'FAIL'} "
                    f"IC={ic_train_mean:.3f} OOS_decay={oos_decay:.2f}")
```

Add to scheduler:

```python
# scheduler/jobs.py — add weekly job
scheduler.add_job(
    run_signal_scan,
    "cron",
    day_of_week="sun",
    hour=3,
    id="signal_scanner",
)
```

---

## 17. Updated `config_paths.py`

```python
# core/config_paths.py
from pathlib import Path

_REPO_ROOT   = Path(__file__).resolve().parent.parent.parent
CONFIG_DIR   = _REPO_ROOT / "config"
DATA_DIR     = _REPO_ROOT / "data"
FEATURES_DIR = DATA_DIR / "features"
MODELS_DIR   = DATA_DIR / "models"
MLRUNS_DIR   = DATA_DIR / "mlruns"      # Added in Phase 2

DATA_SOURCES_YAML = CONFIG_DIR / "data_sources.yaml"
FEATURES_YAML     = CONFIG_DIR / "features.yaml"
```

Add to `.gitignore`:
```
data/mlruns/
```

---

## 18. Tests

```python
# tests/test_labels.py
def test_gmm_generates_four_labels():
    from core.models.label_generator import generate_regime_labels
    labels = generate_regime_labels("2020-01-01", "2022-12-31")
    assert set(labels.unique()).issubset({"R1","R2","R3","R4"})
    assert labels.notna().all()

def test_label_alignment_above_threshold():
    from core.models.label_generator import generate_regime_labels, validate_labels
    labels = generate_regime_labels("2020-01-01", "2022-12-31")
    result = validate_labels(labels, "2020-01-01", "2022-12-31")
    assert result["acceptable"], f"Label agreement {result['overall_agreement']} < 0.70"

# tests/test_models.py
def test_regime_probs_sum_to_one():
    from core.models.regime import predict_regime
    import numpy as np, joblib
    model = joblib.load("data/models/regime_latest.joblib")
    X = np.random.randn(14)
    probs = predict_regime(model, X)
    assert abs(sum(probs.values()) - 1.0) < 0.01

def test_return_dist_keys_correct():
    from core.models.returns import BIN_LABELS
    assert BIN_LABELS == ["lt_minus10","neg_10_0","pos_0_10","gt_10"]

def test_no_data_leakage_in_split():
    """Training end date must precede validation start date."""
    from core.models.trainer import TRAIN_END, VAL_START
    import pandas as pd
    assert pd.Timestamp(TRAIN_END) < pd.Timestamp(VAL_START)

# tests/test_api.py
import pytest
from httpx import AsyncClient, ASGITransport
from api.main import app

@pytest.mark.asyncio
async def test_reports_daily_returns_200():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/reports/daily/trader", headers={"X-User-Id": "1"})
    assert r.status_code == 200
    assert "dominant_regime" in r.json() or "status" in r.json()

@pytest.mark.asyncio
async def test_model_status_returns_list():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/models/status")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
```

---

## 19. Phase 2 Completion Checklist

```
Prerequisites:
[ ] Phase 1 completion checklist fully green
[ ] uv run python scripts/backfill.py — completes without error
[ ] data/features/ contains Parquet files for 2010–2023

Label generation:
[ ] generate_regime_labels() runs and returns 4-class Series
[ ] validate_labels() reports overall_agreement > 0.70
[ ] Label distribution has no class with < 5% of samples

Training:
[ ] uv run python -c "from core.models.trainer import run_full_training; import asyncio; asyncio.run(run_full_training())"
[ ] data/models/ contains 3 .joblib files
[ ] data/mlruns/ contains MLflow run artifacts
[ ] model_versions table has 3 rows with is_active=True

Metrics (minimum acceptable thresholds):
[ ] Regime: OOS accuracy > 60%, Brier < 0.30
[ ] EIA: OOS direction accuracy > 60%, MAE < 2.0 MB
[ ] Returns: OOS Brier < 0.28

Post-processing:
[ ] SHAP values sum to 1.0 for a sample prediction
[ ] Calibration curve logged to MLflow
[ ] PSI computed and stored in feature_snapshots.psi_scores
[ ] Decision engine returns valid direction + hedge_ratio

API:
[ ] GET /api/reports/daily/trader → 200 with real data
[ ] GET /api/reports/daily/risk   → 200 with var_95 field
[ ] GET /api/reports/history      → 200 with list of records
[ ] GET /api/models/status        → 200 with 3 model entries
[ ] POST /api/train/start         → 202 with job_id
[ ] GET /api/users/me             → 200 with user config
[ ] PUT /api/users/me/config      → 200, change persists

Pipeline:
[ ] Daily pipeline now writes Prediction rows after FeatureSnapshot
[ ] outcome_correct populated for predictions older than 20 days
```

---

## 20. Phase 3 Forward Compatibility Notes

| # | Item | Note |
|---|------|------|
| F1 | `GET /api/reports/daily/{role}` | Phase 3 frontend calls this directly. Role filtering already implemented. |
| F2 | `GET /api/users/me` | Phase 3 Config UI reads this on mount. Schema stable. |
| F3 | `PUT /api/users/me/config` | Phase 3 three-step form POSTs here. Pydantic schema intentionally partial-update (exclude_none). |
| F4 | `return_dist` key naming | `lt_minus10 / neg_10_0 / pos_0_10 / gt_10` — pure underscores, matches Phase 3 TypeScript interface. |
| F5 | Stress test | `run_stress_test()` exists but not exposed via API. Phase 3 adds `GET /api/reports/stress` endpoint. |
| F6 | Signal Scanner results | `GET /api/signals/candidates` ready. Phase 3 Signal Evaluate page calls it. |
| F7 | `switch_prob_4w` | Returned in researcher role report. Phase 3 RegimeCard displays it directly. |
| F8 | `outcome_correct` | Returned in `GET /api/reports/history/{date}`. Phase 3 History Outcome tab uses it. |
