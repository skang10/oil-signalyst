from datetime import date, datetime, timedelta
from typing import Any

import pandas as pd
from sqlalchemy import text

from core.config_paths import FEATURES_DIR
from core.data.registry import DataRegistry
from core.logging import get_logger
from db.crud import get_feature_snapshot_by_date
from db.database import get_db
from db.models import FeatureSnapshot, SystemLog
from features.engine import FeatureEngine

logger = get_logger(__name__)


async def run_daily_pipeline(target_date: date | None = None) -> None:
    target_date = target_date or date.today()
    start_time = datetime.utcnow()

    async with get_db() as db:
        existing = await get_feature_snapshot_by_date(db, target_date)
        if existing:
            logger.info("Snapshot already exists, skipping", extra={"date": str(target_date)})
            return

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
        FEATURES_DIR.mkdir(parents=True, exist_ok=True)
        end = str(target_date + timedelta(days=1))
        start = str(target_date - timedelta(days=730))

        registry = DataRegistry()
        engine = FeatureEngine(registry=registry)
        features_df = engine.build(start, end)

        mask = features_df.index.normalize() == pd.Timestamp(target_date)
        today_features = features_df[mask]
        if today_features.empty:
            raise ValueError(f"No features available for {target_date}")

        feature_dict = {
            key: _to_json_scalar(value) for key, value in today_features.iloc[0].to_dict().items()
        }
        duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        parquet_path = FEATURES_DIR / f"features_{target_date.year}.parquet"
        if parquet_path.exists():
            existing_df = pd.read_parquet(parquet_path)
            existing_df = existing_df[existing_df.index.normalize() != pd.Timestamp(target_date)]
            updated_df = pd.concat([existing_df, today_features])
        else:
            updated_df = today_features
        updated_df.sort_index().to_parquet(parquet_path)

        async with get_db() as db:
            db.add(
                FeatureSnapshot(
                    date=target_date,
                    features=feature_dict,
                    feature_version=engine.feature_version,
                )
            )
            await db.execute(
                text("UPDATE system_logs SET status='success', duration_ms=:d WHERE id=:id"),
                {"d": duration_ms, "id": log_id},
            )

        logger.info(
            "Pipeline complete",
            extra={
                "date": str(target_date),
                "features": len(feature_dict),
                "duration_ms": duration_ms,
            },
        )
    except Exception as exc:
        duration_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
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


def _to_json_scalar(value: Any) -> Any:
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value
