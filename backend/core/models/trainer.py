import os
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from numbers import Number

import joblib
import mlflow
import pandas as pd
from sqlalchemy import select, text

from core.config_paths import FEATURES_DIR, MLRUNS_DIR, MODELS_DIR
from core.logging import get_logger
from core.models.eia import build_eia_model
from core.models.feature_prep import to_model_matrix
from core.models.labels import build_eia_labels, build_regime_labels, build_return_bucket_labels
from core.models.model_registry import ModelRegistry
from core.models.regime import build_regime_model, predict_regime_batch
from core.models.returns import build_returns_model
from db.database import get_db
from db.models import ModelVersion, TrainJob
from features.engine import FeatureEngine

logger = get_logger(__name__)

TRAIN_START = "2010-01-01"
TRAIN_END = "2023-12-31"
VAL_START = "2024-01-01"
VAL_END = "2024-12-31"

MLFLOW_EXPERIMENT = "oil-signalyst"
SHAP_BACKGROUND_SIZE = 30

# Mirrors api/routes/models.py's PRIMARY_METRIC_KEY - duplicated rather than
# imported since core/ shouldn't depend on api/.
PRIMARY_METRIC_KEY = {"regime": "accuracy", "eia": "mae", "returns": "brier"}


def _init_mlflow() -> None:
    MLRUNS_DIR.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")
    mlflow.set_tracking_uri(f"file://{MLRUNS_DIR}")
    mlflow.set_experiment(MLFLOW_EXPERIMENT)


def _log_metrics_flat(metrics: dict, prefix: str = "") -> None:
    for key, value in metrics.items():
        name = f"{prefix}{key}"
        if isinstance(value, bool):
            continue
        if isinstance(value, Number):
            mlflow.log_metric(name, value)
        elif isinstance(value, dict):
            _log_metrics_flat(value, prefix=f"{name}.")


def load_features(start: str, end: str) -> pd.DataFrame:
    frames = []
    for year in range(pd.Timestamp(start).year, pd.Timestamp(end).year + 1):
        path = FEATURES_DIR / f"features_{year}.parquet"
        if path.exists():
            frames.append(pd.read_parquet(path))
    if not frames:
        raise FileNotFoundError(f"No feature Parquet files found for {start} to {end}")
    df = pd.concat(frames).sort_index()
    # Column order in each yearly Parquet file reflects whatever order the
    # feature pool (DB-backed, ordered by row id) was in on the day that
    # file was first written - re-adding a removed pool feature gives it a
    # new, higher id, so the current year's file can end up with columns in
    # a different order than prior years'. pd.concat only reconciles that
    # when the range spans multiple files (it adopts the first frame's
    # order); a single-file range - e.g. a recent cutoff_date backtest's
    # val window, which draws only from the current year - passes that
    # file's own order straight through. TabPFN Client's fit/predict column
    # check is order-sensitive, so two same-named-but-differently-ordered
    # frames 422 with "columns ... differ" deep inside model.fit/predict.
    # Sorting here makes every load_features() call return the same order
    # regardless of which files backed it.
    df = df[sorted(df.columns)]
    return df[start:end]


def _align(features: pd.DataFrame, target: pd.Series) -> tuple[pd.DataFrame, pd.Series]:
    common = features.index.intersection(target.dropna().index)
    x = features.loc[common]
    y = target.loc[common]
    mask = ~y.isna()
    return x.loc[mask], y.loc[mask]


async def run_full_training(
    triggered_by_user_id: int | None = None,
    on_progress: Callable[[str], Awaitable[None]] | None = None,
    model_types: list[str] | None = None,
    cutoff_date: str | None = None,
) -> dict:
    del triggered_by_user_id
    _init_mlflow()
    selected = model_types or ["regime", "eia", "returns"]
    # Canonical dependency order, regardless of the order the caller sent:
    # the returns model consumes regime probabilities as input features
    # (predict_regime_batch below), so regime must train before returns
    # whenever both are selected. The frontend sends checkbox-click order,
    # which crashed returns-first runs with "'NoneType' object has no
    # attribute 'predict_proba'" - regime_model was still None in the loop.
    selected = [t for t in ("regime", "eia", "returns") if t in selected]
    if not selected:
        raise ValueError(
            f"No valid model types in {model_types} - expected any of 'regime', 'eia', 'returns'."
        )
    # cutoff_date shifts the train/val split boundary for a what-if backtest:
    # train up to cutoff, validate on everything since. Real k-fold
    # cross-validation (cv_folds/gap_days) isn't implemented - this project
    # uses a single train/val split; see api/routes/training.py's start_training.
    train_end = cutoff_date or TRAIN_END
    val_start = str((pd.Timestamp(cutoff_date) + pd.Timedelta(days=1)).date()) if cutoff_date else VAL_START
    val_end = str(datetime.now(UTC).date()) if cutoff_date else VAL_END

    train_x = to_model_matrix(load_features(TRAIN_START, train_end))
    val_x = to_model_matrix(load_features(val_start, val_end))
    version = datetime.now(UTC).strftime("%Y.%m.%d.%H%M%S")
    feature_version = FeatureEngine().feature_version

    labels = {
        "regime": (
            build_regime_labels(TRAIN_START, train_end),
            build_regime_labels(val_start, val_end),
        ),
        "eia": (build_eia_labels(TRAIN_START, train_end), build_eia_labels(val_start, val_end)),
        "returns": (
            build_return_bucket_labels(TRAIN_START, train_end),
            build_return_bucket_labels(val_start, val_end),
        ),
    }
    builders = {
        "regime": build_regime_model,
        "eia": build_eia_model,
        "returns": build_returns_model,
    }

    results = {}
    regime_model = None
    regime_feature_list = None
    if "returns" in selected and "regime" not in selected:
        # Returns model needs regime probabilities as input features even
        # when regime itself isn't being retrained this run - fall back to
        # the currently deployed regime model. Its feature_list may differ
        # (order or content) from the current FeatureEngine output, so it
        # must travel with the model rather than being inferred from x_train.
        regime_artifact = await ModelRegistry.get_active("regime")
        regime_model = regime_artifact["model"]
        regime_feature_list = regime_artifact["feature_list"]

    for model_type in selected:
        builder = builders[model_type]
        x_train, y_train = _align(train_x, labels[model_type][0])
        x_val, y_val = _align(val_x, labels[model_type][1])

        if x_train.empty or x_val.empty:
            # Forward-looking labels (eia/returns) need N trailing days of
            # future data to compute - a cutoff_date too close to "today"
            # leaves the validation window with zero labeled rows. Fail
            # fast with a clear message instead of a cryptic TabPFN
            # "x_test is empty" error deep inside predict_regime_batch.
            empty_side = "training" if x_train.empty else "validation"
            raise ValueError(
                f"No {empty_side} rows available for '{model_type}' with "
                f"train_end={train_end}, val_start={val_start}, val_end={val_end}. "
                "Pick an earlier cutoff date - forward-looking labels need trailing "
                "days of future data that don't exist yet this close to today."
            )

        if model_type == "returns":
            x_train = pd.concat(
                [x_train, predict_regime_batch(regime_model, x_train, regime_feature_list)], axis=1
            )
            x_val = pd.concat(
                [x_val, predict_regime_batch(regime_model, x_val, regime_feature_list)], axis=1
            )

        with mlflow.start_run(run_name=f"{model_type}_{version}") as run:
            mlflow.log_params(
                {
                    "model_type": model_type,
                    "feature_version": feature_version,
                    "train_start": TRAIN_START,
                    "train_end": train_end,
                    "val_start": val_start,
                    "val_end": val_end,
                    "feature_count": len(x_train.columns),
                }
            )
            model, metrics_train, metrics_val = builder(x_train, y_train, x_val, y_val)
            if model_type == "regime":
                regime_model = model
                regime_feature_list = list(x_train.columns)
            _log_metrics_flat(metrics_train, prefix="train.")
            _log_metrics_flat(metrics_val, prefix="val.")
            mlflow.log_dict(metrics_train, "metrics_train.json")
            mlflow.log_dict(metrics_val, "metrics_val.json")

            extra_artifact = (
                {"shap_background": x_train.tail(SHAP_BACKGROUND_SIZE)}
                if model_type == "regime"
                else None
            )
            results[model_type] = await _save_model(
                model_type=model_type,
                version=version,
                model=model,
                feature_list=list(x_train.columns),
                metrics_train=metrics_train,
                metrics_val=metrics_val,
                mlflow_run_id=run.info.run_id,
                extra_artifact=extra_artifact,
            )
            mlflow.log_artifact(results[model_type]["file_path"])
            if on_progress:
                await on_progress(f"{model_type} model trained: {metrics_val}")

    return results


async def _save_model(
    model_type: str,
    version: str,
    model,
    feature_list: list[str],
    metrics_train: dict,
    metrics_val: dict,
    mlflow_run_id: str | None = None,
    extra_artifact: dict | None = None,
) -> dict:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    file_path = MODELS_DIR / f"{model_type}_{version}.joblib"
    artifact = {
        "model": model,
        "feature_list": feature_list,
        "model_type": model_type,
        "version": version,
        **(extra_artifact or {}),
    }
    joblib.dump(artifact, file_path)

    async with get_db() as db:
        await db.execute(
            text("UPDATE model_versions SET is_active = 0 WHERE model_type = :model_type"),
            {"model_type": model_type},
        )
        db.add(
            ModelVersion(
                model_type=model_type,
                version=version,
                file_path=str(file_path),
                train_config={"train_start": TRAIN_START, "train_end": TRAIN_END},
                metrics_train=metrics_train,
                metrics_oos=metrics_val,
                feature_list=feature_list,
                is_active=True,
                deployed_at=datetime.now(UTC).replace(tzinfo=None),
                mlflow_run_id=mlflow_run_id,
            )
        )

    ModelRegistry.invalidate(model_type)
    logger.info("Model trained", extra={"model_type": model_type, "metrics": metrics_val})
    return {
        "file_path": str(file_path),
        "metrics": metrics_val,
        "version": version,
        "mlflow_run_id": mlflow_run_id,
    }


async def _capture_active_metrics() -> dict:
    async with get_db() as db:
        rows = (
            await db.execute(select(ModelVersion).where(ModelVersion.is_active.is_(True)))
        ).scalars().all()
    return {version.model_type: (version.metrics_oos or {}) for version in rows}


def _ts() -> str:
    return datetime.now(UTC).strftime("%H:%M:%S")


async def run_full_training_with_log(
    job_id: str,
    triggered_by_user_id: int | None = None,
    model_types: list[str] | None = None,
    cutoff_date: str | None = None,
) -> dict:
    """Wraps run_full_training() with per-milestone log lines appended to
    TrainJob.log_lines (for the /api/train/log/{job_id} SSE stream), and
    returns a structured result comparing pre-training (old) vs post-training
    (new) metrics for each model type.
    """

    async def log(line: str) -> None:
        async with get_db() as db:
            job = await db.get(TrainJob, job_id)
            if job:
                job.log_lines = (job.log_lines or []) + [f"[{_ts()}] {line}"]
                db.add(job)

    old_metrics_by_type = await _capture_active_metrics()
    await log("Starting training run...")
    result = await run_full_training(
        triggered_by_user_id=triggered_by_user_id,
        on_progress=log,
        model_types=model_types,
        cutoff_date=cutoff_date,
    )
    await log("Training run complete.")

    new_metrics_by_type = {model_type: info["metrics"] for model_type, info in result.items()}
    # Frontend's TrainJob.result expects flat {model_type}_{primary_metric}
    # keys (e.g. "returns_brier"), not the nested per-model-type dicts above -
    # see ModelCompareCard.tsx's METRIC_LABEL map.
    old_metrics = {
        f"{model_type}_{PRIMARY_METRIC_KEY[model_type]}": (old_metrics_by_type.get(model_type) or {}).get(
            PRIMARY_METRIC_KEY[model_type]
        )
        for model_type in result
    }
    new_metrics = {
        f"{model_type}_{PRIMARY_METRIC_KEY[model_type]}": new_metrics_by_type[model_type].get(
            PRIMARY_METRIC_KEY[model_type]
        )
        for model_type in result
    }

    old_returns_brier = (old_metrics_by_type.get("returns") or {}).get("brier")
    new_returns_brier = (new_metrics_by_type.get("returns") or {}).get("brier")
    improvement_pct = None
    # new_returns_brier is None whenever "returns" isn't among the trained
    # model types - without the second check this raised TypeError and marked
    # an otherwise-successful regime/eia-only job as failed.
    if old_returns_brier and new_returns_brier is not None:
        improvement_pct = round(
            (new_returns_brier - old_returns_brier) / old_returns_brier * 100, 1
        )

    return {
        "old_metrics": old_metrics,
        "new_metrics": new_metrics,
        "improvement_pct": improvement_pct,
        "versions": {model_type: info["version"] for model_type, info in result.items()},
        "mlflow_run_id": (result.get("returns") or {}).get("mlflow_run_id"),
    }
