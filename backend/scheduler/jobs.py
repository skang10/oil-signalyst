from datetime import UTC, date, datetime, timedelta
from typing import Any

import pandas as pd
from sqlalchemy import text

from core.config_paths import FEATURES_DIR
from core.data.registry import DataRegistry
from core.exceptions import ModelNotFoundError
from core.logging import get_logger
from core.models.eia import predict_eia
from core.models.model_registry import ModelRegistry
from core.models.regime import predict_regime
from core.models.returns import predict_returns
from core.postprocess.decision_engine import generate_decision
from core.postprocess.outcome_backfill import backfill_outcomes
from db.crud import get_feature_snapshot_by_date, get_prediction_by_date
from db.database import get_db
from db.models import FeatureSnapshot, Prediction, SystemLog
from features.engine import FeatureEngine

logger = get_logger(__name__)


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

        await _ensure_prediction(
            target_date,
            selected_features,
            feature_dict,
            snapshot_id,
            registry,
        )
        await backfill_outcomes(target_date)

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
    end = str(target_date + timedelta(days=1))
    start = str(target_date - timedelta(days=730))
    engine = FeatureEngine(registry=registry)
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
    return_dist = predict_returns(returns_artifact, vector)
    recent_wti = registry.fetch("wti", str(target_date - timedelta(days=7)), str(target_date))
    current_price = float(recent_wti.dropna().iloc[-1])
    decision = generate_decision(regime_probs, return_dist, current_price)

    async with get_db() as db:
        db.add(
            Prediction(
                date=target_date,
                regime_probs=regime_probs,
                return_dist=return_dist,
                eia_forecast=eia_forecast,
                decision=decision,
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
