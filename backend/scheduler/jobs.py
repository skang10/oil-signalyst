import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pandas as pd
from sqlalchemy import desc, select, text

from core.config_paths import FEATURES_DIR
from core.data.registry import DataRegistry
from core.exceptions import ModelNotFoundError
from core.logging import get_logger
from core.models.eia import predict_eia
from core.models.feature_prep import to_model_matrix
from core.models.model_registry import ModelRegistry
from core.models.regime import predict_regime
from core.models.trainer import (
    TRAINABLE_MODEL_TYPES,
    ensure_baseline_models,
    run_full_training_with_log,
)
from core.models.baseline_model import is_baseline_artifact
from core.models.returns import predict_returns
from core.postprocess.decision_engine import generate_decision
from core.postprocess.data_monitor import write_freshness_snapshot
from core.postprocess.drift_monitor import PSI_RETRAIN_THRESHOLD, compute_and_store_psi
from core.postprocess.outcome_backfill import backfill_outcomes
from core.postprocess.shap_explainer import explain_prediction
from core.postprocess.signal_charts import refresh_signal_charts
from db.crud import get_feature_snapshot_by_date, get_or_create_default_user, get_prediction_by_date
from db.database import get_db
from db.models import FeatureSnapshot, Prediction, SystemLog, TrainJob
from features.engine import FeatureEngine

logger = get_logger(__name__)

FEATURE_WARMUP_BUFFER_DAYS = 90


async def run_daily_pipeline(target_date: date | None = None) -> None:
    target_date = target_date or date.today()
    start_time = datetime.now(UTC)

    async with get_db() as db:
        log = SystemLog(
            event_type="pipeline_run",
            status="running",
            payload={"date": str(target_date)},
        )
        db.add(log)
        await db.flush()
        log_id = log.id

    try:
        registry = DataRegistry()
        feature_date, selected_features, feature_dict, snapshot_id = await _ensure_feature_snapshot(
            target_date, registry
        )
        duration_ms = int((datetime.now(UTC) - start_time).total_seconds() * 1000)

        async with get_db() as db:
            await db.execute(
                text("UPDATE system_logs SET status='success', duration_ms=:d WHERE id=:id"),
                {"d": duration_ms, "id": log_id},
            )

        if snapshot_id is not None:
            await compute_and_store_psi(snapshot_id)

        await _ensure_prediction(
            target_date,
            selected_features,
            feature_dict,
            snapshot_id,
            registry,
        )
        await backfill_outcomes(target_date)
        await _maybe_auto_retrain(target_date)
        # New market data landed - rebuild the Evaluate-page chart cache in
        # the background so tomorrow's first page views stay instant.
        asyncio.create_task(refresh_signal_charts())
        # Refresh the on-disk per-source freshness snapshot the Data/Model
        # Monitor pages read, so it tracks each daily run. Blocking fetch, so
        # off-thread; the API process picks it up via the shared file.
        asyncio.create_task(asyncio.to_thread(write_freshness_snapshot, target_date))

        logger.info(
            "Pipeline complete",
            extra={
                "date": str(target_date),
                "feature_date": str(feature_date.date()),
                "features": len(feature_dict),
                "duration_ms": duration_ms,
            },
        )
    except Exception as exc:
        duration_ms = int((datetime.now(UTC) - start_time).total_seconds() * 1000)
        async with get_db() as db:
            await db.execute(
                text(
                    "UPDATE system_logs "
                    "SET status='failed', error=:error, duration_ms=:duration_ms "
                    "WHERE id=:id"
                ),
                {"error": str(exc), "duration_ms": duration_ms, "id": log_id},
            )
        logger.error("Pipeline failed", extra={"date": str(target_date), "error": str(exc)})
        raise


async def _maybe_auto_retrain(target_date: date) -> None:
    """Honors the Training page's auto-trigger mode (users.retrain_mode):
    'psi' retrains when the day's max feature PSI breaches the user's alert
    threshold, 'sunday' retrains on Sundays, 'manual' (default) never does.
    Creates a real TrainJob row so the run shows up in the Training page's
    status/log endpoints exactly like a manually started job. Deploy stays
    manual either way - auto-retrain only produces the old-vs-new comparison.
    Failures are logged, never propagated - a broken retrain must not mark
    the already-successful daily pipeline as failed."""
    try:
        async with get_db() as db:
            user = await get_or_create_default_user(db)
            mode = user.retrain_mode or "manual"
            psi_threshold = user.alert_psi_threshold or PSI_RETRAIN_THRESHOLD
            user_id = user.id

        if mode == "psi":
            async with get_db() as db:
                row = await db.execute(
                    select(FeatureSnapshot).order_by(desc(FeatureSnapshot.date)).limit(1)
                )
                snapshot = row.scalar_one_or_none()
            psi_scores = snapshot.psi_scores if snapshot else None
            max_psi = max(psi_scores.values()) if psi_scores else None
            if max_psi is None or max_psi <= psi_threshold:
                return
            trigger = f"PSI breach ({round(max_psi, 3)} > {psi_threshold})"
        elif mode == "sunday":
            if target_date.weekday() != 6:
                return
            trigger = "Sunday schedule"
        else:
            return

        job_id = str(uuid.uuid4())[:8]
        # regime is no longer trainable (it describes the current state rather
        # than forecasting an outcome) - listing it here made every auto-retrain
        # fail with a 400 the moment PSI/Sunday mode was enabled.
        model_types = list(TRAINABLE_MODEL_TYPES)
        logger.info(
            "Auto-retrain triggered",
            extra={"mode": mode, "trigger": trigger, "job_id": job_id},
        )
        async with get_db() as db:
            db.add(
                TrainJob(
                    id=job_id,
                    status="running",
                    model_types=model_types,
                    triggered_by=user_id,
                    trigger_source=f"auto:{mode}",
                    started_at=datetime.now(UTC).replace(tzinfo=None),
                    log_lines=[f"Auto-retrain: {trigger}"],
                )
            )

        try:
            result = await run_full_training_with_log(
                job_id=job_id, triggered_by_user_id=user_id, model_types=model_types
            )
            status, result_payload = "complete", result
        except Exception as exc:
            status, result_payload = "failed", {"error": str(exc)}
            logger.error("Auto-retrain failed", extra={"job_id": job_id, "error": str(exc)})

        async with get_db() as db:
            job = await db.get(TrainJob, job_id)
            if job:
                job.status = status
                job.completed_at = datetime.now(UTC).replace(tzinfo=None)
                job.result = result_payload
                db.add(job)
    except Exception as exc:
        logger.error("Auto-retrain check failed", extra={"error": str(exc)})


async def _ensure_feature_snapshot(
    target_date: date,
    registry: DataRegistry,
) -> tuple[pd.Timestamp, pd.DataFrame, dict, int | None]:
    async with get_db() as db:
        existing = await get_feature_snapshot_by_date(db, target_date)
        if existing:
            row = pd.DataFrame([existing.features], index=[pd.Timestamp(target_date)])
            return pd.Timestamp(target_date), row, existing.features, existing.id

    FEATURES_DIR.mkdir(parents=True, exist_ok=True)
    engine = FeatureEngine(registry=registry)
    end = str(target_date + timedelta(days=1))
    # Calendar days, because `start` is a date - the engine's windows are
    # counted in business-day rows and must be converted, not subtracted raw.
    lookback_days = engine.required_lookback_calendar_days() + FEATURE_WARMUP_BUFFER_DAYS
    start = str(target_date - timedelta(days=lookback_days))
    features_df = engine.build(start, end)

    # engine.build() now leaves a partial tail whenever a weekly source (COT/
    # EIA) has not printed for the latest days. Complete those rows by carrying
    # the last known print forward before picking the row the models score, so
    # the prediction runs on the freshest date instead of stalling ~a week back
    # on the slowest source. The honest (un-filled) row is what we persist to
    # parquet, so the Data Monitor still reports the true per-feature coverage.
    model_df = to_model_matrix(features_df)
    feature_date, selected_features = _select_feature_row(model_df, target_date)
    feature_dict = {
        key: _to_json_scalar(value)
        for key, value in selected_features.iloc[0].to_dict().items()
    }

    honest_row = features_df.loc[[selected_features.index[0]]]
    parquet_path = FEATURES_DIR / f"features_{feature_date.year}.parquet"
    if parquet_path.exists():
        existing_df = pd.read_parquet(parquet_path)
        existing_df = existing_df[existing_df.index.normalize() != feature_date]
        updated_df = pd.concat([existing_df, honest_row])
    else:
        updated_df = honest_row
    updated_df.sort_index().to_parquet(parquet_path)

    async with get_db() as db:
        snapshot = FeatureSnapshot(
            date=target_date,
            features=feature_dict,
            feature_version=engine.feature_version,
        )
        db.add(snapshot)
        await db.flush()
        snapshot_id = snapshot.id

    return feature_date, selected_features, feature_dict, snapshot_id


async def _ensure_prediction(
    target_date: date,
    selected_features: pd.DataFrame,
    feature_dict: dict,
    snapshot_id: int | None,
    registry: DataRegistry,
) -> None:
    async with get_db() as db:
        existing = await get_prediction_by_date(db, target_date)
        if existing:
            return

    # Cold start: with an empty model table there is nothing to predict with and
    # nothing that would react - the gate-driven floor only fires after a
    # training run. Baselines need no fitting, so install them rather than
    # sitting idle until someone trains by hand.
    try:
        installed = await ensure_baseline_models()
        if installed:
            logger.info("Installed baseline models", extra={"model_types": installed})
    except Exception as exc:
        # Never fail the day's pipeline over the bootstrap - the get_active
        # below still reports the real problem if models are genuinely absent.
        logger.warning("Baseline bootstrap failed", extra={"error": str(exc)})

    try:
        regime_artifact = await ModelRegistry.get_active("regime")
        eia_artifact = await ModelRegistry.get_active("eia")
        returns_artifact = await ModelRegistry.get_active("returns")
    except ModelNotFoundError as exc:
        logger.info(
            "Prediction skipped: no active models",
            extra={"date": str(target_date), "error": str(exc)},
        )
        return

    def _vector_for(artifact: dict):
        """Feature vector ordered by THIS model's own fit-time feature_list.

        One shared vector used to be built from the regime model's list and fed
        to all three, which held only while every model was trained in the same
        run off identically-ordered columns. The regime model is now frozen at
        its old column order while eia/returns retrain against the sorted order
        load_features() produces, so a shared vector would silently hand each
        model another model's values under its own column names.
        """
        names = artifact.get("feature_list") or list(selected_features.columns)
        return pd.Series(
            [feature_dict[name] for name in names], index=names, dtype=float
        ).to_numpy()

    regime_probs = predict_regime(regime_artifact, _vector_for(regime_artifact))
    recent_inventory = registry.fetch(
        "crude_inventory",
        str(target_date - timedelta(days=60)),
        str(target_date),
    )
    eia_forecast = predict_eia(eia_artifact, _vector_for(eia_artifact), recent_inventory)
    return_dist = predict_returns(returns_artifact, _vector_for(returns_artifact))
    recent_wti = registry.fetch("wti", str(target_date - timedelta(days=7)), str(target_date))
    current_price = float(recent_wti.dropna().iloc[-1])
    async with get_db() as db:
        user = await get_or_create_default_user(db)
        exposure_barrels = user.exposure_barrels
        regime_confidence_threshold = user.alert_regime_threshold
    # Which model types are being served by a constant baseline rather than a
    # trained model. Drives the suppression of sizing outputs in the decision and
    # the notice on the report page.
    baseline_models = [
        model_type
        for model_type, artifact in (("eia", eia_artifact), ("returns", returns_artifact))
        if is_baseline_artifact(artifact)
    ]
    decision = generate_decision(
        regime_probs,
        return_dist,
        current_price,
        exposure_barrels=exposure_barrels,
        regime_confidence_threshold=regime_confidence_threshold,
        baseline_models=baseline_models,
    )
    shap_values = explain_prediction(regime_artifact, _vector_for(regime_artifact))

    async with get_db() as db:
        db.add(
            Prediction(
                date=target_date,
                regime_probs=regime_probs,
                return_dist=return_dist,
                eia_forecast=eia_forecast,
                decision=decision,
                shap_values=shap_values,
                model_version_id=await ModelRegistry.get_active_version_id("regime"),
                feature_snapshot_id=snapshot_id,
            )
        )


def _to_json_scalar(value: Any) -> Any:
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def _select_feature_row(
    features_df: pd.DataFrame,
    target_date: date,
) -> tuple[pd.Timestamp, pd.DataFrame]:
    if features_df.empty:
        raise ValueError(f"No features available on or before {target_date}")

    target = pd.Timestamp(target_date)
    normalized = features_df.index.normalize()
    eligible = features_df[normalized <= target]
    if eligible.empty:
        raise ValueError(f"No features available on or before {target_date}")

    feature_timestamp = eligible.index.max()
    feature_date = feature_timestamp.normalize()
    return feature_date, features_df.loc[[feature_timestamp]]
