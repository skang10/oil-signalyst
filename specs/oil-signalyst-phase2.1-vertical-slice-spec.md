# oil-signalyst — Phase 2.1 Spec: ML Vertical Slice

**Version:** 0.1  
**Phase:** 2.1 — Core ML Vertical Slice  
**Last updated:** 2026-07-01  
**Depends on:** Phase 1 spec v0.6 FINAL  

---

## 1. Overview

Phase 2.1 delivers the first real model-driven product loop:

`data sources -> feature snapshots -> independent labels -> baseline models -> daily predictions -> report API`

Phase 2.1 is complete when:

```bash
curl localhost:8000/api/reports/daily/trader
```

returns a real JSON response backed by live WTI data, persisted feature snapshots, trained baseline models, and a `predictions` row. The response must not use mock model output.

## 2. Scope

In scope:

- Historical feature backfill for 2010-2024.
- Independent raw-data label construction for regime, EIA inventory change, and 20-trading-day WTI return bucket targets.
- Baseline sklearn models for regime, EIA forecast, and return distribution.
- Model artifact save/load under `data/models/`.
- `model_versions` rows and active model lookup.
- Daily pipeline inference that writes `predictions`.
- Outcome backfill for predictions whose 20-trading-day horizon has elapsed.
- Report API endpoints required by the Phase 3 frontend.
- User config API endpoints already planned for Phase 2.

Out of scope for Phase 2.1:

- TabPFN.
- SHAP.
- MLflow.
- Probability calibration.
- PSI drift monitoring.
- Signal Scanner.
- Stress testing API.
- Formal model promotion workflow.

Those move to Phase 2.2.

## 3. Key Decisions

| # | Decision |
|---|----------|
| D1 | Use simple sklearn baselines first: `RandomForestClassifier` for regime and returns, `RandomForestRegressor` for EIA. |
| D2 | Label construction reads raw source data independently through `DataRegistry`; production feature matrices stay feature-only. |
| D3 | Training set: 2010-01-01 to 2023-12-31. Validation: 2024. OOS reporting starts at 2025 but is not a training input. |
| D4 | Phase 2.1 model quality thresholds are sanity thresholds, not trading-grade thresholds. |
| D5 | Pipeline idempotency is split: feature snapshot existence and prediction existence are checked separately. |
| D6 | Current adaptive `config_paths.py` path resolution is preserved; `MLRUNS_DIR` is deferred to Phase 2.2. |

## 4. Schema Changes

Add two nullable columns to `predictions`:

```python
actual_return = Column(Float, nullable=True)
outcome_correct = Column(Boolean, nullable=True)
```

Generate an Alembic migration from `backend/`:

```bash
uv run alembic revision --autogenerate -m "add outcome columns to predictions"
uv run alembic upgrade head
```

## 5. Dependencies

Add only the baseline ML dependencies needed for 2.1:

```toml
"scikit-learn>=1.5.0",
"joblib>=1.4.0",
```

Do not add TabPFN, SHAP, MLflow, or imbalanced-learn in Phase 2.1.

## 6. Directory Changes

```text
backend/
├── core/
│   └── models/
│       ├── __init__.py
│       ├── labels.py          # Independent raw-data label builders
│       ├── trainer.py         # Baseline training entry point
│       ├── regime.py          # Baseline regime classifier
│       ├── eia.py             # Baseline EIA regressor
│       ├── returns.py         # Baseline return bucket classifier
│       └── model_registry.py  # Active model artifact lookup/cache
├── core/
│   └── postprocess/
│       ├── __init__.py
│       ├── decision_engine.py
│       ├── outcome_backfill.py
│       ├── regime_stats.py
│       └── report_assembler.py
├── api/
│   └── routes/
│       ├── reports.py
│       ├── models.py
│       ├── training.py
│       └── users.py
└── scripts/
    └── backfill.py
```

## 7. Feature Backfill

Create `backend/scripts/backfill.py`.

Requirements:

- Build feature matrices for 2010-01-01 through 2024-12-31.
- Write one Parquet file per year to `data/features/features_YEAR.parquet`.
- Be idempotent by default: skip existing files unless `--force` is passed.
- Use the existing `FeatureEngine` and `DataRegistry`.

Example command:

```bash
cd backend
uv run python scripts/backfill.py
```

## 8. Independent Label Construction

Create `backend/core/models/labels.py`.

The label module must fetch raw source series independently. Do not require raw `wti`, `crude_inventory`, or `cushing_inventory` columns to be present in `FeatureEngine` output.

### 8.1 Regime Labels

Use the Phase 1 `REGIME_TRANSITIONS` reference as the initial 2.1 regime target.

```python
def build_regime_labels(start: str, end: str) -> pd.Series:
    """Return daily R1/R2/R3/R4 labels from REGIME_TRANSITIONS."""
```

The GMM alignment work moves to Phase 2.2.

### 8.2 EIA Labels

Fetch raw `crude_inventory` through `DataRegistry`.

```python
def build_eia_labels(start: str, end: str, registry: DataRegistry | None = None) -> pd.Series:
    """
    Target at date T: next published weekly crude inventory change in million barrels.
    Align the weekly target back to available feature dates without peeking past T.
    """
```

Requirements:

- Use actual raw inventory levels.
- Compute weekly changes from published observations.
- Forward-fill the next scheduled target only where the publication schedule makes it valid.
- Return a numeric `pd.Series`.

### 8.3 Return Bucket Labels

Fetch raw `wti` through `DataRegistry`.

```python
RETURN_BIN_LABELS = ["lt_minus10", "neg_10_0", "pos_0_10", "gt_10"]

def build_return_bucket_labels(
    start: str,
    end: str,
    horizon_trading_days: int = 20,
    registry: DataRegistry | None = None,
) -> pd.Series:
    """Return integer bucket labels for forward WTI returns over 20 trading sessions."""
```

Requirements:

- Use the next 20 available WTI trading sessions, not 20 calendar days.
- Use bins `[-inf, -0.10, 0.0, 0.10, inf]`.
- Return labels `0..3` matching `RETURN_BIN_LABELS`.

## 9. Baseline Models

Use stable sklearn pipelines:

- Impute missing values with `SimpleImputer(strategy="median")`.
- Scale only where needed.
- Keep `feature_list` exactly equal to the training dataframe columns.

### 9.1 Regime Classifier

Baseline:

```python
RandomForestClassifier(
    n_estimators=300,
    max_depth=6,
    min_samples_leaf=10,
    random_state=42,
    class_weight="balanced",
)
```

Metrics:

- Accuracy.
- Multiclass Brier score.
- Class counts.

### 9.2 EIA Regressor

Baseline:

```python
RandomForestRegressor(
    n_estimators=300,
    max_depth=6,
    min_samples_leaf=10,
    random_state=42,
)
```

Metrics:

- MAE.
- Direction accuracy.
- MAE versus 4-week rolling-change baseline.

### 9.3 Return Bucket Classifier

Baseline:

```python
RandomForestClassifier(
    n_estimators=300,
    max_depth=6,
    min_samples_leaf=10,
    random_state=42,
    class_weight="balanced",
)
```

Metrics:

- Multiclass Brier score.
- Accuracy.
- Bucket counts.

## 10. Training

Create `backend/core/models/trainer.py`.

Requirements:

- Load feature Parquet files for the requested date ranges.
- Build labels through `core.models.labels`.
- Align `X` and `y` by index.
- Drop rows where the target is missing.
- Train all three baseline models.
- Save artifacts to `data/models/{model_type}_{version}.joblib`.
- Deactivate old active `model_versions` rows per model type.
- Insert one active `model_versions` row per model type.
- Store metrics in `metrics_train` and `metrics_oos` for compatibility with existing schema.

Training command:

```bash
cd backend
uv run python -c "import asyncio; from core.models.trainer import run_full_training; asyncio.run(run_full_training())"
```

## 11. Model Registry

Create `backend/core/models/model_registry.py`.

Requirements:

- `await ModelRegistry.get_active(model_type)` loads the active artifact from `model_versions.file_path`.
- `await ModelRegistry.get_active_version_id(model_type)` returns an `int | None`.
- Cache loaded models per process.
- Provide `ModelRegistry.invalidate(model_type)` after training.
- Raise `ModelNotFoundError` if no active model exists.

## 12. Daily Inference Pipeline

Extend `scheduler/jobs.py`.

Requirements:

- Preserve existing feature snapshot creation.
- If a feature snapshot already exists, still attempt prediction creation if no prediction exists for that date.
- Use `model_versions.feature_list` to order feature vectors. Do not rely on dict insertion order.
- Run regime, EIA, and returns models.
- For returns, use the same feature vector shape used at training time. In 2.1 this means base features only; regime-conditioning moves to 2.2.
- Build a decision dict using `core.postprocess.decision_engine`.
- Write one `Prediction` row for the target date if none exists.
- Set `model_version_id = await ModelRegistry.get_active_version_id("regime")`.
- Call outcome backfill after prediction insertion.

If active models do not exist, the daily pipeline should still write feature snapshots and log a clear "prediction skipped: no active models" message, not fail the entire feature pipeline.

## 13. Outcome Backfill

Create `backend/core/postprocess/outcome_backfill.py`.

Requirements:

- Use 20 available WTI trading sessions, not 20 calendar days.
- Find predictions with `actual_return IS NULL`.
- For each eligible prediction, compute realized return from raw WTI prices.
- Set `outcome_correct` by comparing the highest-probability predicted bucket to the realized bucket.

## 14. Report Assembly

Create `backend/core/postprocess/report_assembler.py`.

The report must include:

```json
{
  "date": "2026-07-01",
  "price": 81.23,
  "dominant_regime": "R3",
  "regime_probs": {"R1": 0.1, "R2": 0.2, "R3": 0.6, "R4": 0.1},
  "return_dist": {"lt_minus10": 0.1, "neg_10_0": 0.3, "pos_0_10": 0.5, "gt_10": 0.1},
  "eia_forecast": {"crude": -1.2, "market_consensus": -0.4, "surprise": -0.8},
  "decision": {"direction": "LONG", "hedge_ratio": 0.2}
}
```

Feature-signal direction is driven by `config/features.yaml` using `bearish_if_positive`. Add that field to every configured feature.

## 15. API Endpoints

Add routers:

- `GET /api/reports/daily/{role}`
- `GET /api/reports/history`
- `GET /api/reports/history/{prediction_date}`
- `GET /api/models/status`
- `POST /api/train/start`
- `GET /api/train/status/{job_id}`
- `GET /api/users/me`
- `PUT /api/users/me/config`

`POST /api/train/start` must return HTTP `202`.

Unknown report roles should return HTTP `400`, not silently fall back to trader fields.

## 16. Tests

Add focused tests that do not require live API keys by default:

- Label builders align to feature dates with fixture data.
- Return labels use 20 trading observations.
- Model registry returns active model and version id.
- Pipeline creates prediction when snapshot already exists and prediction is missing.
- `/api/reports/daily/trader` returns either real report JSON or a clear `no_prediction` status.
- `/api/train/start` returns `202`.

Live-data backfill/training remains a manual verification step unless API keys are present.

## 17. Completion Checklist

```text
Prerequisites:
[ ] Phase 1 checks are green.
[ ] uv sync --extra dev completes.
[ ] Alembic migration adds predictions.actual_return and predictions.outcome_correct.

Backfill:
[ ] uv run python scripts/backfill.py completes.
[ ] data/features/ contains Parquet files for 2010-2024.

Training:
[ ] run_full_training() completes.
[ ] data/models/ contains 3 baseline model artifacts.
[ ] model_versions table has active rows for regime, eia, and returns.

Pipeline:
[ ] Daily pipeline writes/keeps FeatureSnapshot.
[ ] Daily pipeline writes Prediction when active models exist.
[ ] Pipeline skips prediction gracefully when models are missing.
[ ] outcome_correct is populated for eligible old predictions.

API:
[ ] GET /api/reports/daily/trader returns model-driven JSON or clear no_prediction status.
[ ] GET /api/reports/history returns prediction rows.
[ ] GET /api/models/status returns active model entries.
[ ] POST /api/train/start returns 202 with job_id.
[ ] GET /api/users/me returns user config.
[ ] PUT /api/users/me/config persists changes.

Quality:
[ ] Regime baseline beats majority-class accuracy on validation.
[ ] EIA baseline direction accuracy is reported.
[ ] Returns baseline Brier score is reported.
```
