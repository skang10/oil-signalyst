"""One async function per DS Agent tool. Where a computation the scanner
already performs is available, reuse the real stored result
(SignalEvaluation, populated weekly by core.signal_scanner.run_signal_scan)
rather than recomputing or - worse - fabricating a plausible-looking number.
A signal that hasn't been through a scan yet returns an honest error."""

import uuid

import yaml
from sqlalchemy import desc, select

from core.config_paths import FEATURES_YAML
from core.signal_scanner import CANDIDATE_SIGNALS_YAML


async def execute_tool(name: str, tool_input: dict) -> dict:
    handlers = {
        "fetch_data_sample": _fetch_data_sample,
        "compute_ic": _compute_ic,
        "compute_oos_decay": _compute_oos_decay,
        "compute_feature_correlation": _compute_feature_correlation,
        "check_leakage": _check_leakage,
        "add_to_feature_registry": _add_to_feature_registry,
        "run_training": _run_training,
        "deploy_model": _deploy_model,
    }
    handler = handlers.get(name)
    if not handler:
        return {"error": f"Unknown tool: {name}"}
    try:
        return await handler(**tool_input)
    except Exception as exc:
        return {"error": str(exc)}


async def _fetch_data_sample(signal_name: str, start_date: str | None = None, end_date: str | None = None) -> dict:
    """Computes real values for a *candidate* signal directly from its raw
    data source + transform (core/signal_scanner.py::load_candidates(),
    same pattern core/postprocess/signal_charts.py uses) rather than
    looking it up in FeatureSnapshot. FeatureSnapshot only holds features
    the live daily pipeline has actually computed for *active* production
    features - a candidate isn't active yet by definition, so it will
    never be there; querying it would make every candidate look like
    missing data instead of what it actually is (not promoted yet)."""
    from datetime import datetime, timedelta

    from core.data.registry import DataRegistry
    from core.postprocess.signal_charts import _find_candidate
    from features.engine import FeatureEngine

    candidate = _find_candidate(signal_name)
    if candidate is None:
        return {
            "error": f"'{signal_name}' is not a known candidate or active feature "
            "(not in config/candidate_signals.yaml)"
        }

    start = start_date or str(datetime.today() - timedelta(days=365 * 2))
    end = end_date or str(datetime.today().date())
    registry = DataRegistry()
    engine = FeatureEngine(registry=registry)
    raw = registry.fetch_all(start, end, source_names=[candidate["source"]])
    signal = engine.apply_transform(candidate, raw).dropna().sort_index()

    if signal.empty:
        return {"error": f"No computable values for '{signal_name}' in the requested range"}
    return {
        "signal_name": signal_name,
        "count": len(signal),
        "coverage_pct": round(len(signal) / len(raw) * 100, 1) if len(raw) else 0.0,
        "history_years": round((signal.index.max() - signal.index.min()).days / 365, 1),
        "sample": [round(float(v), 4) for v in signal.tail(5)],
    }


async def _latest_evaluation(signal_name: str):
    """Shared lookup for compute_ic/compute_oos_decay/compute_feature_correlation."""
    from db.database import get_db
    from db.models import SignalEvaluation

    async with get_db() as db:
        row = await db.execute(
            select(SignalEvaluation)
            .where(SignalEvaluation.signal_name == signal_name)
            .order_by(desc(SignalEvaluation.evaluated_at))
            .limit(1)
        )
        return row.scalar_one_or_none()


_NOT_SCANNED_ERROR = "hasn't been through a signal scan yet - no real data exists for it"


async def _compute_ic(signal_name: str, lags: list[int] | None = None, target: str = "regime_label") -> dict:
    del lags, target  # the scanner's own lags/target are what's actually real - see below
    evaluation = await _latest_evaluation(signal_name)
    if evaluation is None:
        return {"error": f"'{signal_name}' {_NOT_SCANNED_ERROR}"}
    # ic_scores is keyed by the scanner's own lags (core/signal_scanner.py::
    # IC_LAGS_DAYS = [5, 20, 60]), not necessarily whatever `lags` was
    # requested here - return what's real rather than interpolate/fabricate
    # values for lags the scanner didn't test.
    return {"signal_name": signal_name, "ic_scores": evaluation.ic_scores, "coverage": evaluation.coverage}


async def _compute_oos_decay(signal_name: str, train_end: str | None = None, oos_start: str | None = None) -> dict:
    del train_end, oos_start  # the stored oos_decay reflects whatever split the scanner actually used
    evaluation = await _latest_evaluation(signal_name)
    if evaluation is None:
        return {"error": f"'{signal_name}' {_NOT_SCANNED_ERROR}"}
    return {
        "signal_name": signal_name,
        "oos_decay": evaluation.oos_decay,
        "pass": evaluation.oos_decay < 0.30,
    }


async def _compute_feature_correlation(signal_name: str) -> dict:
    evaluation = await _latest_evaluation(signal_name)
    if evaluation is None:
        return {"error": f"'{signal_name}' {_NOT_SCANNED_ERROR}"}
    correlation = evaluation.correlation or {}
    max_corr = correlation.get("value", 0.0)
    return {
        "signal_name": signal_name,
        "most_correlated_feature": correlation.get("most_correlated_feature"),
        "max_correlation": max_corr,
        "pass": max_corr < 0.50,
    }


async def _check_leakage(gap_days: int, n_splits: int = 5) -> dict:
    # Real check, not a hardcoded pass: the deepest forward-looking label in
    # this project is the returns model's 20-trading-day bucket
    # (core/models/labels.py::build_return_bucket_labels) - a gap smaller
    # than that horizon means the validation split's earliest rows are
    # labeled using data that overlaps the training window. n_splits isn't
    # actually used by this pipeline (single train/val split, not real
    # k-fold CV - see api/routes/training.py's TrainStartRequest) - accepted
    # for interface parity only.
    max_label_horizon_days = 20
    leakage = gap_days < max_label_horizon_days
    return {
        "gap_days": gap_days,
        "n_splits": n_splits,
        "leakage": leakage,
        "min_required_gap": max_label_horizon_days,
        "pass": not leakage,
    }


async def _add_to_feature_registry(
    signal_name: str,
    source: str,
    bearish_if_positive: bool,
    frequency: str = "Daily",
    category: str = "Other",
) -> dict:
    """Adds a validated candidate to config/features.yaml. Pulls the real
    technical definition (source data key, transform, window) from the
    candidate's own config rather than fabricating one from this tool's
    simple string params - `source` here is the human-readable display name
    (e.g. "EIA API", matching what GET /api/signals/active shows), not the
    raw data-source key the pipeline needs to actually compute the feature.
    Adding an entry with only display metadata and no transform would look
    registered but never produce real feature values."""
    with open(CANDIDATE_SIGNALS_YAML) as f:
        candidates = {c["name"]: c for c in yaml.safe_load(f)["candidates"]}
    candidate = candidates.get(signal_name)
    if not candidate:
        return {"error": f"'{signal_name}' is not a known candidate signal (not in candidate_signals.yaml)"}

    with open(FEATURES_YAML) as f:
        config = yaml.safe_load(f)

    if any(f["name"] == signal_name for f in config["features"]):
        return {"error": f"'{signal_name}' is already an active feature"}

    entry = {
        "name": signal_name,
        "source": candidate["source"],
        "transform": candidate["transform"],
        "bearish_if_positive": bearish_if_positive,
        "meta_source": source,
        "frequency": frequency,
        "category": category,
    }
    # Copy over whichever transform-specific parameter the candidate used
    # (window for pct_change/zscore, seasons for seasonal_dev, etc.) -
    # transforms take different parameter names, so copy whatever's present
    # rather than assuming one.
    for key in ("window", "seasons"):
        if key in candidate:
            entry[key] = candidate[key]

    config["features"].append(entry)
    with open(FEATURES_YAML, "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)

    return {"status": "added", "signal_name": signal_name, "total_features": len(config["features"])}


async def _run_training(model_types: list[str], gap_days: int = 20, n_splits: int = 5) -> dict:
    del gap_days, n_splits  # accepted but not implemented - see _check_leakage's note on real k-fold CV
    from db.database import get_db
    from db.models import TrainJob

    job_id = str(uuid.uuid4())[:8]
    async with get_db() as db:
        db.add(TrainJob(id=job_id, status="queued", model_types=model_types))

    import asyncio

    from core.models.trainer import run_full_training_with_log

    asyncio.create_task(run_full_training_with_log(job_id=job_id, model_types=model_types))
    return {"job_id": job_id, "status": "queued", "model_types": model_types}


async def _deploy_model(model_type: str, job_id: str) -> dict:
    from core.services.deploy_service import do_deploy
    from db.database import get_db

    async with get_db() as db:
        return await do_deploy(model_type=model_type, job_id=job_id, db=db)
