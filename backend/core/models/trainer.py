import os
from datetime import UTC, datetime
from numbers import Number

import joblib
import mlflow
import pandas as pd
from sqlalchemy import text

from core.config_paths import FEATURES_DIR, MLRUNS_DIR, MODELS_DIR
from core.logging import get_logger
from core.models.eia import build_eia_model
from core.models.labels import build_eia_labels, build_regime_labels, build_return_bucket_labels
from core.models.model_registry import ModelRegistry
from core.models.regime import build_regime_model
from core.models.returns import build_returns_model
from db.database import get_db
from db.models import ModelVersion
from features.engine import FeatureEngine

logger = get_logger(__name__)

TRAIN_START = "2010-01-01"
TRAIN_END = "2023-12-31"
VAL_START = "2024-01-01"
VAL_END = "2024-12-31"

MLFLOW_EXPERIMENT = "oil-signalyst"


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


async def run_full_training(triggered_by_user_id: int | None = None) -> dict:
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
    for model_type, builder in builders.items():
        x_train, y_train = _align(train_x, labels[model_type][0])
        x_val, y_val = _align(val_x, labels[model_type][1])

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
            _log_metrics_flat(metrics_train, prefix="train.")
            _log_metrics_flat(metrics_val, prefix="val.")
            mlflow.log_dict(metrics_train, "metrics_train.json")
            mlflow.log_dict(metrics_val, "metrics_val.json")

            results[model_type] = await _save_model(
                model_type=model_type,
                version=version,
                model=model,
                feature_list=list(x_train.columns),
                metrics_train=metrics_train,
                metrics_val=metrics_val,
                mlflow_run_id=run.info.run_id,
            )
            mlflow.log_artifact(results[model_type]["file_path"])

    return results


async def _save_model(
    model_type: str,
    version: str,
    model,
    feature_list: list[str],
    metrics_train: dict,
    metrics_val: dict,
    mlflow_run_id: str | None = None,
) -> dict:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    file_path = MODELS_DIR / f"{model_type}_{version}.joblib"
    artifact = {
        "model": model,
        "feature_list": feature_list,
        "model_type": model_type,
        "version": version,
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
    return {"file_path": str(file_path), "metrics": metrics_val}
