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
) -> dict:
    del triggered_by_user_id
    _init_mlflow()
    train_x = load_features(TRAIN_START, TRAIN_END)
    val_x = load_features(VAL_START, VAL_END)
    version = datetime.now(UTC).strftime("%Y.%m.%d.%H%M%S")
    feature_version = FeatureEngine().feature_version

    labels = {
        "regime": (
            build_regime_labels(TRAIN_START, TRAIN_END),
            build_regime_labels(VAL_START, VAL_END),
        ),
        "eia": (build_eia_labels(TRAIN_START, TRAIN_END), build_eia_labels(VAL_START, VAL_END)),
        "returns": (
            build_return_bucket_labels(TRAIN_START, TRAIN_END),
            build_return_bucket_labels(VAL_START, VAL_END),
        ),
    }
    builders = {
        "regime": build_regime_model,
        "eia": build_eia_model,
        "returns": build_returns_model,
    }

    results = {}
    regime_model = None
    for model_type in ("regime", "eia", "returns"):
        builder = builders[model_type]
        x_train, y_train = _align(train_x, labels[model_type][0])
        x_val, y_val = _align(val_x, labels[model_type][1])

        if model_type == "returns":
            x_train = pd.concat([x_train, predict_regime_batch(regime_model, x_train)], axis=1)
            x_val = pd.concat([x_val, predict_regime_batch(regime_model, x_val)], axis=1)

        with mlflow.start_run(run_name=f"{model_type}_{version}") as run:
            mlflow.log_params(
                {
                    "model_type": model_type,
                    "feature_version": feature_version,
                    "train_start": TRAIN_START,
                    "train_end": TRAIN_END,
                    "val_start": VAL_START,
                    "val_end": VAL_END,
                    "feature_count": len(x_train.columns),
                }
            )
            model, metrics_train, metrics_val = builder(x_train, y_train, x_val, y_val)
            if model_type == "regime":
                regime_model = model
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


async def run_full_training_with_log(job_id: str, triggered_by_user_id: int | None = None) -> dict:
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

    old_metrics = await _capture_active_metrics()
    await log("Starting training run...")
    result = await run_full_training(triggered_by_user_id=triggered_by_user_id, on_progress=log)
    await log("Training run complete.")

    new_metrics = {model_type: info["metrics"] for model_type, info in result.items()}
    old_returns_brier = (old_metrics.get("returns") or {}).get("brier")
    new_returns_brier = (new_metrics.get("returns") or {}).get("brier")
    improvement_pct = None
    if old_returns_brier:
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
