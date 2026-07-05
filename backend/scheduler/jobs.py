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
from core.models.model_registry import ModelRegistry
from core.models.regime import predict_regime
from core.models.trainer import run_full_training_with_log
from core.models.returns import predict_returns
from core.postprocess.decision_engine import generate_decision
from core.postprocess.drift_monitor import PSI_RETRAIN_THRESHOLD, compute_and_store_psi
from core.postprocess.outcome_backfill import backfill_outcomes
from core.postprocess.shap_explainer import explain_prediction
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
        model_types = ["regime", "eia", "returns"]
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
    lookback_days = engine.required_lookback_days() + FEATURE_WARMUP_BUFFER_DAYS
    start = str(target_date - timedelta(days=lookback_days))
    features_df = engine.build(start, end)
    feature_date, selected_features = _select_feature_row(features_df, target_date)
    feature_dict = {
        key: _to_json_scalar(value)
        for key, value in selected_features.iloc[0].to_dict().items()
    }

    parquet_path = FEATURES_DIR / f"features_{feature_date.year}.parquet"
    if parquet_path.exists():
        existing_df = pd.read_parquet(parquet_path)
        existing_df = existing_df[existing_df.index.normalize() != feature_date]
        updated_df = pd.concat([existing_df, selected_features])
    else:
        updated_df = selected_features
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

    feature_list = regime_artifact.get("feature_list") or list(selected_features.columns)
    feature_values = [feature_dict[name] for name in feature_list]
    vector = pd.Series(feature_values, index=feature_list, dtype=float).to_numpy()
    regime_probs = predict_regime(regime_artifact, vector)
    recent_inventory = registry.fetch(
        "crude_inventory",
        str(target_date - timedelta(days=60)),
        str(target_date),
    )
    eia_forecast = predict_eia(eia_artifact, vector, recent_inventory)
    return_dist = predict_returns(returns_artifact, vector, regime_probs)
    recent_wti = registry.fetch("wti", str(target_date - timedelta(days=7)), str(target_date))
    current_price = float(recent_wti.dropna().iloc[-1])
    async with get_db() as db:
        user = await get_or_create_default_user(db)
        exposure_barrels = user.exposure_barrels
        regime_confidence_threshold = user.alert_regime_threshold
    decision = generate_decision(
        regime_probs,
        return_dist,
        current_price,
        exposure_barrels=exposure_barrels,
        regime_confidence_threshold=regime_confidence_threshold,
    )
    shap_values = explain_prediction(regime_artifact, vector)

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
