import asyncio
import os
import statistics
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime
from numbers import Number

import joblib
import mlflow
import pandas as pd
from sqlalchemy import select, text

from core.config_paths import FEATURES_DIR, MLRUNS_DIR, MODELS_DIR
from core.logging import get_logger
from core.models.eia import build_eia_model
from core.models.feature_prep import to_model_matrix
from core.models.labels import RETURN_BIN_LABELS, build_eia_labels, build_return_bucket_labels
from core.models.baseline_model import build_baseline_model, is_baseline_version
from core.models.metrics import (
    HIGHER_IS_BETTER,
    PRIMARY_METRIC_KEY,
    beats_baseline,
    evaluate_deployment_gate,
    skill_score,
)
from core.models.model_registry import ModelRegistry
from core.models.returns import build_returns_model
from db.database import get_db
from db.models import ModelVersion, TrainJob
from features.engine import FeatureEngine

logger = get_logger(__name__)

# Fixed, temporally-ordered two-way split. The purge between train and test is
# automatic: labels are built per-window (build_*_labels fetch only within
# [start, end]), so a forward-looking label can never reach past the train
# window's end into the test window - the last ~1 month of train is simply
# unlabeled and dropped. TRAIN_START matches the first row that actually exists
# (2012), not an aspirational 2010.
#
#   Train  2012-2024   fit the model
#   Test   2025->today held out; the honest metric and the deployment gate
#
# There is no separate calibration set: on this data the effective sample size
# is ~12 independent observations per year, far too few to fit even a 2-param
# sigmoid that generalizes, and TabPFN's native probabilities are reasonable -
# so a held-out calibration year would sacrifice scarce data for an unreliable
# gain. Dropping it also removes the calibration-leakage problem entirely.
#
# What-if backtesting by cutoff date is gone - it produced degenerate windows
# twice - and is replaced by walk-forward cross-validation (cross_validate).
TRAIN_START = "2012-01-01"
TRAIN_END = "2024-12-31"
TEST_START = "2025-01-01"
# Kept as an alias for the first post-training date, which drift_monitor uses as
# the start of the "recent production" window for PSI.
VAL_START = TEST_START

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


def _window(a: str, b: str) -> tuple[pd.DataFrame, dict]:
    """The model matrix and per-type labels for one date window."""
    x = to_model_matrix(load_features(a, b))
    labels = {
        "eia": build_eia_labels(a, b),
        "returns": build_return_bucket_labels(a, b),
    }
    return x, labels


def _prepare_training_data(
    test_end: str,
) -> tuple[dict[str, pd.DataFrame], str, dict]:
    """Train/test matrices, feature version, and every model type's labels for
    each split.

    Pure blocking work, kept in one function so run_full_training can push it to
    a worker thread in a single hop: Parquet reads (load_features), the sync DB
    read behind FeatureEngine's feature pool, and the label builders, which
    fetch their source series over the network.
    """
    train_x, train_y = _window(TRAIN_START, TRAIN_END)
    test_x, test_y = _window(TEST_START, test_end)
    feature_version = FeatureEngine().feature_version
    matrices = {"train": train_x, "test": test_x}
    # labels[model_type] = (train_y, test_y)
    labels = {mt: (train_y[mt], test_y[mt]) for mt in TRAINABLE_MODEL_TYPES}
    return matrices, feature_version, labels


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
    should_cancel: Callable[[], Awaitable[bool]] | None = None,
) -> dict:
    """Trains and deploys one model per selected type on the fixed two-way
    split: fit on train (2012-2024), report + gate on the held-out test window
    (2025->today). The metric here is a single honest test figure (small
    effective n - see cross_validate for the robust walk-forward distribution)."""
    del triggered_by_user_id
    _init_mlflow()
    selected = model_types or list(TRAINABLE_MODEL_TYPES)
    selected = [t for t in TRAINABLE_MODEL_TYPES if t in selected]
    if not selected:
        raise ValueError(
            f"No valid model types in {model_types} - expected any of "
            f"{', '.join(repr(t) for t in TRAINABLE_MODEL_TYPES)}. "
            "'regime' is no longer trainable: it describes the current market "
            "state rather than forecasting an observable outcome, so there is "
            "nothing to score it against."
        )
    test_end = str(datetime.now(UTC).date())

    # Parquet reads, the DB-backed feature pool, and the label builders' source
    # fetches are all blocking - see _prepare_training_data.
    matrices, feature_version, labels = await asyncio.to_thread(_prepare_training_data, test_end)
    version = datetime.now(UTC).strftime("%Y.%m.%d.%H%M%S")

    builders = {
        "eia": build_eia_model,
        "returns": build_returns_model,
    }

    results = {}
    for model_type in selected:
        if should_cancel and await should_cancel():
            if on_progress:
                await on_progress("Cancelled before " + model_type + ".")
            break
        builder = builders[model_type]
        train_y, test_y = labels[model_type]
        x_train, y_train = _align(matrices["train"], train_y)
        x_test, y_test = _align(matrices["test"], test_y)

        empty = next((n for n, x in [("train", x_train), ("test", x_test)] if x.empty), None)
        if empty:
            raise ValueError(
                f"No {empty} rows for '{model_type}'. The fixed split needs labeled "
                f"data in {TRAIN_START}..{TRAIN_END} (train) and {TEST_START}..{test_end} "
                "(test) - rebuild the feature matrix if a window is missing."
            )

        with mlflow.start_run(run_name=f"{model_type}_{version}") as run:
            mlflow.log_params(
                {
                    "model_type": model_type,
                    "feature_version": feature_version,
                    "train": f"{TRAIN_START}..{TRAIN_END}",
                    "test": f"{TEST_START}..{test_end}",
                    "feature_count": len(x_train.columns),
                }
            )
            # Off the event loop: the TabPFN calls inside the builders use
            # tabpfn_client's synchronous httpx.Client and would otherwise
            # freeze the SSE log stream for the whole run.
            model, metrics_train, metrics_test = await asyncio.to_thread(
                builder, x_train, y_train, x_test, y_test
            )
            # Gate on the held-out TEST window: how many rows, and (for the
            # classifier) how many distinct classes it actually contained.
            n_test_classes = None if model_type == "eia" else int(pd.Series(y_test).nunique())
            gate = evaluate_deployment_gate(
                model_type, metrics_test, n_val_rows=len(x_test), n_val_classes=n_test_classes
            )
            metrics_test["deployment_gate"] = gate

            _log_metrics_flat(metrics_train, prefix="train.")
            _log_metrics_flat(metrics_test, prefix="test.")
            mlflow.log_dict(metrics_train, "metrics_train.json")
            mlflow.log_dict(metrics_test, "metrics_test.json")

            results[model_type] = await _save_model(
                model_type=model_type,
                version=version,
                model=model,
                feature_list=list(x_train.columns),
                metrics_train=metrics_train,
                metrics_val=metrics_test,
                mlflow_run_id=run.info.run_id,
                activate=gate["passed"],
            )
            mlflow.log_artifact(results[model_type]["file_path"])
            if on_progress:
                if gate["passed"]:
                    await on_progress(f"{model_type} model trained and deployed: {metrics_test}")
                else:
                    await on_progress(
                        f"{model_type} model trained but NOT deployed - "
                        f"{'; '.join(gate['reasons'])}"
                    )

        if not gate["passed"]:
            await _ensure_baseline_floor(
                model_type=model_type,
                version=version,
                train_y=y_train,
                test_y=y_test,
                feature_list=list(x_train.columns),
                on_progress=on_progress,
            )

    return results


async def ensure_baseline_models(
    model_types: list[str] | None = None,
    on_progress: Callable[[str], Awaitable[None]] | None = None,
) -> list[str]:
    """Give every trainable type a serving model when it has none at all.

    The floor in _ensure_baseline_floor only applies after a training run - it
    reacts to a gate failure. This is the cold-start half: on an empty database
    nothing has ever been trained, so nothing reacts, and the pipeline used to
    just log "no active models" and produce nothing until someone trained by
    hand. A baseline needs no fitting - it is the training labels' base rates -
    so there is no reason to make the operator wait for a TabPFN run before the
    system can serve.

    Only fills genuine gaps: a type with any active version, baseline or
    trained, is left untouched. Returns the types it installed.

    Note this covers the trainable types only. 'regime' has no baseline because
    it has no observable outcome to take base rates over - it is a state
    descriptor, not a forecast (see core/models/regime.py).
    """
    selected = [t for t in TRAINABLE_MODEL_TYPES if t in (model_types or TRAINABLE_MODEL_TYPES)]

    missing = []
    async with get_db() as db:
        for model_type in selected:
            rows = await db.execute(
                select(ModelVersion).where(
                    ModelVersion.model_type == model_type, ModelVersion.is_active.is_(True)
                )
            )
            if rows.scalars().first() is None:
                missing.append(model_type)

    if not missing:
        return []

    if on_progress:
        await on_progress(f"No model serving {', '.join(missing)} - installing baselines.")

    test_end = str(datetime.now(UTC).date())
    matrices, _, labels = await asyncio.to_thread(_prepare_training_data, test_end)
    installed = []
    for model_type in missing:
        train_y, test_y = labels[model_type]
        x_train, y_train = _align(matrices["train"], train_y)
        _, y_test = _align(matrices["test"], test_y)
        await _ensure_baseline_floor(
            model_type=model_type,
            version=datetime.now(UTC).strftime("%Y.%m.%d.%H%M%S"),
            train_y=y_train,
            test_y=y_test,
            feature_list=list(x_train.columns),
            on_progress=on_progress,
        )
        installed.append(model_type)
    return installed


async def _ensure_baseline_floor(
    model_type: str,
    version: str,
    train_y,
    test_y,
    feature_list: list[str],
    on_progress: Callable[[str], Awaitable[None]] | None = None,
) -> None:
    """Put the constant baseline into production if nothing better is there.

    Only fires when the gate has just blocked a model, and only when whatever is
    live is *itself* at or below zero skill - i.e. losing to a predictor that
    ignores every feature. A live model with real skill is left alone; a failed
    retrain is no reason to throw it away.

    Without this, a blocked model leaves production holding the incumbent no
    matter how bad it is, and the only lever is the manual override - which is
    exactly how returns ended up live at -15.3% skill.
    """
    metric_key = PRIMARY_METRIC_KEY.get(model_type)
    if not metric_key:
        return

    async with get_db() as db:
        rows = await db.execute(
            select(ModelVersion).where(
                ModelVersion.model_type == model_type, ModelVersion.is_active.is_(True)
            )
        )
        live = rows.scalars().first()

    if live is not None:
        oos = live.metrics_oos or {}
        if is_baseline_version(oos):
            return  # already on the floor
        live_skill = skill_score(
            metric_key, oos.get(metric_key), (oos.get("baseline") or {}).get(metric_key)
        )
        if live_skill is not None and live_skill > 0:
            if on_progress:
                await on_progress(
                    f"{model_type}: keeping the live model (skill {live_skill:+.2%}) - "
                    "it still beats the baseline."
                )
            return

    n_classes = None if model_type == "eia" else len(RETURN_BIN_LABELS)
    model, metrics = await asyncio.to_thread(
        build_baseline_model, model_type, train_y, test_y, n_classes
    )
    await _save_model(
        model_type=model_type,
        version=f"baseline-{version}",
        model=model,
        feature_list=feature_list,
        metrics_train={},
        metrics_val=metrics,
        activate=True,
    )
    if on_progress:
        # Only the returns distribution feeds position sizing, so only that
        # baseline suppresses it (decision_engine.generate_decision).
        suffix = (
            " Position sizing, hedging, CVaR and Kelly are suppressed while it is live."
            if model_type == "returns"
            else ""
        )
        await on_progress(
            f"{model_type}: no model beats the baseline, so the baseline is now serving "
            f"({metric_key} {metrics[metric_key]})." + suffix
        )


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
        should_cancel=lambda: _job_cancelled(job_id),
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


# ---- Walk-forward cross-validation --------------------------------------

# The first year tested. Earlier origins leave too little training history to be
# worth a fold; from 2019 each fold still trains on 7+ years.
CV_FIRST_TEST_YEAR = 2019


def _cv_folds(today: str) -> list[dict]:
    """Expanding-window folds: for each year from CV_FIRST_TEST_YEAR to now,
    train on everything before it and test on that year. The purge is automatic
    - per-window labels can't reach past the train window's end into the test
    year (see the split comment above)."""
    end_year = pd.Timestamp(today).year
    folds = []
    for year in range(CV_FIRST_TEST_YEAR, end_year + 1):
        folds.append(
            {
                "fold": year,
                "train_start": TRAIN_START,
                "train_end": f"{year - 1}-12-31",
                "test_start": f"{year}-01-01",
                "test_end": today if year == end_year else f"{year}-12-31",
            }
        )
    return folds


def _run_cv_fold(fold: dict, model_types: list[str]) -> dict:
    """Blocking: build one fold's train/test data, fit each model, return the
    primary metric and baseline per type. Pushed to a worker thread by the
    caller (TabPFN's client is synchronous)."""
    train_x, train_lab = _window(fold["train_start"], fold["train_end"])
    test_x, test_lab = _window(fold["test_start"], fold["test_end"])
    builders = {"eia": build_eia_model, "returns": build_returns_model}

    out = {}
    for mt in model_types:
        key = PRIMARY_METRIC_KEY[mt]
        x_train, y_train = _align(train_x, train_lab[mt])
        x_test, y_test = _align(test_x, test_lab[mt])
        if x_train.empty or x_test.empty:
            out[mt] = {"test_n": len(x_test), key: None, "baseline": None, "beat": None}
            continue
        _, _, metrics_test = builders[mt](x_train, y_train, x_test, y_test)
        value = metrics_test.get(key)
        baseline = (metrics_test.get("baseline") or {}).get(key)
        out[mt] = {
            "test_n": len(x_test),
            key: value,
            "baseline": baseline,
            "beat": beats_baseline(key, value, baseline),
        }
    return out


def _aggregate_cv(model_type: str, folds: list[dict]) -> dict:
    """Mean/std/min/max of a model's primary metric across folds, plus how many
    folds beat baseline - the point of CV is this distribution, not any one
    number."""
    key = PRIMARY_METRIC_KEY[model_type]
    scored = [f for f in folds if f.get(key) is not None]
    values = [f[key] for f in scored]
    n_beat = sum(1 for f in scored if f.get("beat"))
    return {
        "metric": key,
        "higher_is_better": key in HIGHER_IS_BETTER,
        "n_folds": len(scored),
        "mean": round(statistics.fmean(values), 4) if values else None,
        "std": round(statistics.pstdev(values), 4) if len(values) > 1 else 0.0,
        "min": round(min(values), 4) if values else None,
        "max": round(max(values), 4) if values else None,
        "n_beat_baseline": n_beat,
        "folds": folds,
    }


async def cross_validate(
    model_types: list[str] | None = None,
    on_progress: Callable[[str], Awaitable[None]] | None = None,
    should_cancel: Callable[[], Awaitable[bool]] | None = None,
) -> dict:
    """Walk-forward (expanding-origin) cross-validation - the robust view the
    single train/test split can't give when effective n per year is ~12-20.
    Fits each model on every fold and reports the metric's distribution across
    folds. Deploys nothing. Checks should_cancel between folds so a Stop takes
    effect at the next fold boundary."""
    selected = [t for t in TRAINABLE_MODEL_TYPES if t in (model_types or TRAINABLE_MODEL_TYPES)]
    if not selected:
        raise ValueError(f"No trainable model types in {model_types}.")

    folds = _cv_folds(str(date.today()))
    per_model_folds: dict[str, list[dict]] = {mt: [] for mt in selected}
    cancelled = False

    for fold in folds:
        if should_cancel and await should_cancel():
            cancelled = True
            if on_progress:
                await on_progress(f"Cancelled after {len(per_model_folds[selected[0]])} folds.")
            break
        result = await asyncio.to_thread(_run_cv_fold, fold, selected)
        for mt in selected:
            per_model_folds[mt].append(
                {"fold": fold["fold"], "test_start": fold["test_start"], **result[mt]}
            )
        if on_progress:
            done = ", ".join(
                f"{mt} {result[mt].get(PRIMARY_METRIC_KEY[mt])}" for mt in selected
            )
            await on_progress(f"Fold {fold['fold']} ({fold['test_start'][:4]}): {done}")

    completed = per_model_folds[selected[0]]
    return {
        "models": {mt: _aggregate_cv(mt, per_model_folds[mt]) for mt in selected},
        "n_folds": len(completed),
        "cancelled": cancelled,
        "span": f"{completed[0]['test_start'][:4]}-{completed[-1]['test_start'][:4]}" if completed else "",
    }


async def run_cross_validate_with_log(job_id: str, model_types: list[str] | None = None) -> dict:
    """Wraps cross_validate with per-fold log lines on the TrainJob, for the
    same SSE stream the training run uses."""

    async def log(line: str) -> None:
        async with get_db() as db:
            job = await db.get(TrainJob, job_id)
            if job:
                job.log_lines = (job.log_lines or []) + [f"[{_ts()}] {line}"]
                db.add(job)

    await log("Starting walk-forward cross-validation...")
    result = await cross_validate(
        model_types=model_types, on_progress=log, should_cancel=lambda: _job_cancelled(job_id)
    )
    await log("Cross-validation complete.")
    return result


async def _job_cancelled(job_id: str) -> bool:
    """True once the stop route has set the job to 'cancelled'. Read fresh from
    the DB so a Stop from another request is seen at the next checkpoint."""
    async with get_db() as db:
        job = await db.get(TrainJob, job_id)
        return bool(job and job.status == "cancelled")
