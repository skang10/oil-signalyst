import asyncio
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
from core.models.labels import build_eia_labels, build_return_bucket_labels
from core.models.metrics import PRIMARY_METRIC_KEY, evaluate_deployment_gate
from core.models.model_registry import ModelRegistry
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

# 'regime' is absent by design: it describes the current market state rather
# than forecasting anything with an observable outcome, so there is nothing to
# train it against. See core/models/regime.py.
TRAINABLE_MODEL_TYPES = ("eia", "returns")


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


def _prepare_training_data(
    train_end: str, val_start: str, val_end: str
) -> tuple[pd.DataFrame, pd.DataFrame, str, dict]:
    """Feature matrices, feature version, and every model type's labels.

    Pure blocking work, kept in one function so run_full_training can push it
    to a worker thread in a single hop: Parquet reads (load_features), the
    sync DB read behind FeatureEngine's feature pool, and the label builders,
    which fetch their source series over the network.
    """
    train_x = to_model_matrix(load_features(TRAIN_START, train_end))
    val_x = to_model_matrix(load_features(val_start, val_end))
    feature_version = FeatureEngine().feature_version
    labels = {
        "eia": (build_eia_labels(TRAIN_START, train_end), build_eia_labels(val_start, val_end)),
        "returns": (
            build_return_bucket_labels(TRAIN_START, train_end),
            build_return_bucket_labels(val_start, val_end),
        ),
    }
    return train_x, val_x, feature_version, labels


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
    selected = model_types or list(TRAINABLE_MODEL_TYPES)
    # Order is now cosmetic. It used to be load-bearing: returns consumed regime
    # probabilities, so regime had to train first. That coupling is gone, and
    # with it the "'NoneType' object has no attribute 'predict_proba'" crash on
    # returns-first runs.
    selected = [t for t in TRAINABLE_MODEL_TYPES if t in selected]
    if not selected:
        raise ValueError(
            f"No valid model types in {model_types} - expected any of "
            f"{', '.join(repr(t) for t in TRAINABLE_MODEL_TYPES)}. "
            "'regime' is no longer trainable: it describes the current market "
            "state rather than forecasting an observable outcome, so there is "
            "nothing to score it against."
        )
    # cutoff_date shifts the train/val split boundary for a what-if backtest:
    # train up to cutoff, validate on everything since. Real k-fold
    # cross-validation (cv_folds/gap_days) isn't implemented - this project
    # uses a single train/val split; see api/routes/training.py's start_training.
    train_end = cutoff_date or TRAIN_END
    val_start = str((pd.Timestamp(cutoff_date) + pd.Timedelta(days=1)).date()) if cutoff_date else VAL_START
    val_end = str(datetime.now(UTC).date()) if cutoff_date else VAL_END

    # Parquet reads, the DB-backed feature pool, and the label builders' source
    # fetches are all blocking - see _prepare_training_data.
    train_x, val_x, feature_version, labels = await asyncio.to_thread(
        _prepare_training_data, train_end, val_start, val_end
    )
    version = datetime.now(UTC).strftime("%Y.%m.%d.%H%M%S")

    builders = {
        "eia": build_eia_model,
        "returns": build_returns_model,
    }

    results = {}
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
            # The dominant blocker: every TabPFN fit/predict inside the builders
            # goes through tabpfn_client's synchronous httpx.Client, so running
            # this inline froze the event loop for the whole run - the live-log
            # SSE stream (api/routes/training.py) could not even be accepted
            # until training finished, which is why the first log line took the
            # entire run to appear in the UI.
            model, metrics_train, metrics_val = await asyncio.to_thread(
                builder, x_train, y_train, x_val, y_val
            )
            # Classifiers report how many distinct classes the validation window
            # actually contained; a single-class window makes accuracy vacuous.
            n_val_classes = None if model_type == "eia" else int(pd.Series(y_val).nunique())
            gate = evaluate_deployment_gate(
                model_type, metrics_val, n_val_rows=len(x_val), n_val_classes=n_val_classes
            )
            metrics_val["deployment_gate"] = gate

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
                activate=gate["passed"],
            )
            mlflow.log_artifact(results[model_type]["file_path"])
            if on_progress:
                if gate["passed"]:
                    await on_progress(f"{model_type} model trained and deployed: {metrics_val}")
                else:
                    await on_progress(
                        f"{model_type} model trained but NOT deployed - "
                        f"{'; '.join(gate['reasons'])}"
                    )

    return results


async def _save_model(
    model_type: str,
    version: str,
    model,
    feature_list: list[str],
    metrics_train: dict,
    metrics_val: dict,
    mlflow_run_id: str | None = None,
    activate: bool = True,
) -> dict:
    """Persists the artifact and its ModelVersion row.

    `activate=False` (the deployment gate rejected it) still writes the row and
    the joblib file - the run stays inspectable in the training history, and an
    operator can promote it by hand through deploy_service. It just does not
    become live on its own, which is how an accuracy-0.0 model trained on a
    3-row validation window silently replaced production twice.
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    file_path = MODELS_DIR / f"{model_type}_{version}.joblib"
    artifact = {
        "model": model,
        "feature_list": feature_list,
        "model_type": model_type,
        "version": version,
    }
    await asyncio.to_thread(joblib.dump, artifact, file_path)

    async with get_db() as db:
        if activate:
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
                is_active=activate,
                deployed_at=datetime.now(UTC).replace(tzinfo=None) if activate else None,
                mlflow_run_id=mlflow_run_id,
            )
        )

    if activate:
        ModelRegistry.invalidate(model_type)
    logger.info(
        "Model trained",
        extra={"model_type": model_type, "metrics": metrics_val, "deployed": activate},
    )
    return {
        "file_path": str(file_path),
        "metrics": metrics_val,
        "version": version,
        "mlflow_run_id": mlflow_run_id,
        "deployed": activate,
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

    # Baselines travel in their own map rather than as extra old/new_metrics
    # keys: ModelCompareCard builds its table rows from those dicts, so an added
    # key would render as a bogus row carrying the run-level improvement_pct.
    baselines = {
        f"{model_type}_{PRIMARY_METRIC_KEY[model_type]}": (
            new_metrics_by_type[model_type].get("baseline") or {}
        ).get(PRIMARY_METRIC_KEY[model_type])
        for model_type in result
    }
    blocked = {
        model_type: (new_metrics_by_type[model_type].get("deployment_gate") or {}).get("reasons")
        for model_type, info in result.items()
        if not info.get("deployed", True)
    }

    return {
        "old_metrics": old_metrics,
        "new_metrics": new_metrics,
        "baselines": baselines,
        "improvement_pct": improvement_pct,
        "versions": {model_type: info["version"] for model_type, info in result.items()},
        "deployed": {model_type: info.get("deployed", True) for model_type, info in result.items()},
        "blocked_reasons": blocked,
        "mlflow_run_id": (result.get("returns") or {}).get("mlflow_run_id"),
    }
