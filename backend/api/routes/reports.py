from datetime import date, timedelta

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import selectinload

from api.dependencies import CurrentUser, DbSession
from core.logging import get_logger
from core.models.labels import build_eia_labels
from core.models.regime import dominant_regime
from core.postprocess.regime_stats import estimate_switch_probability, get_regime_duration
from core.postprocess.report_assembler import (
    assemble_daily_report,
    build_history_detail,
    build_history_response,
    nest_daily_report,
)
from core.postprocess.stress_test import get_r3_max_drawdown, run_stress_test
from db.crud import get_recent_predictions
from db.models import FeatureSnapshot, Prediction

logger = get_logger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])
VALID_ROLES = {"trader", "risk", "researcher", "ds"}


@router.get("/daily/{role}")
async def get_daily_report(role: str, db: DbSession, user: CurrentUser) -> dict:
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Unknown report role: {role}")

    # Serve the most recent prediction regardless of whether it's dated
    # exactly today - the daily pipeline may not have run yet (weekends, a
    # missed cron tick), and the frontend has no representation for an
    # empty/no-prediction state. Its own "date" field tells the UI how stale
    # this is.
    row = await db.execute(
        select(Prediction)
        .options(selectinload(Prediction.model_version))
        .order_by(desc(Prediction.date), desc(Prediction.created_at))
        .limit(1)
    )
    prediction = row.scalar_one_or_none()
    if prediction is None:
        raise HTTPException(status_code=503, detail="No predictions available yet")

    snapshot = await _get_snapshot(db, prediction)
    raw = await assemble_daily_report(prediction, snapshot)
    exposure_barrels = user.exposure_barrels or 100_000
    r3_max_drawdown = await get_r3_max_drawdown()
    return nest_daily_report(raw, role, exposure_barrels, r3_max_drawdown)


@router.get("/stress")
async def get_stress_test(user: CurrentUser) -> dict:
    del user
    return await run_stress_test()


@router.get("/history")
async def get_history(
    db: DbSession,
    user: CurrentUser,
    days: int = Query(default=30, le=365),
) -> dict:
    del user
    predictions = await get_recent_predictions(db, days)
    return build_history_response(predictions)


@router.get("/history/{prediction_date}")
async def get_prediction_detail(prediction_date: date, db: DbSession, user: CurrentUser) -> dict:
    del user
    row = await db.execute(
        select(Prediction)
        .options(selectinload(Prediction.model_version))
        .where(Prediction.date == prediction_date)
        .order_by(desc(Prediction.created_at))
        .limit(1)
    )
    prediction = row.scalar_one_or_none()
    if prediction is None:
        raise HTTPException(status_code=404, detail="Prediction not found")
    snapshot = await _get_snapshot(db, prediction)
    regime_probs = prediction.regime_probs or {}
    dominant = dominant_regime(regime_probs)
    duration_weeks = (await get_regime_duration(dominant)) // 5
    switch_probability_4w = await estimate_switch_probability(dominant)
    eia_actual_mb = _lookup_eia_actual(prediction_date)
    return build_history_detail(
        prediction, snapshot, duration_weeks, switch_probability_4w, eia_actual_mb
    )


def _lookup_eia_actual(prediction_date: date) -> float | None:
    """Real realized EIA change for this prediction's date, using the same
    next-published-change alignment build_eia_labels trains on. None if the
    outcome hasn't published yet (too recent) or history doesn't reach back
    that far."""
    try:
        window_start = prediction_date - timedelta(days=21)
        window_end = prediction_date + timedelta(days=21)
        series = build_eia_labels(str(window_start), str(window_end))
        value = series.get(pd.Timestamp(prediction_date))
    except Exception as exc:
        logger.warning("History EIA actual lookup failed", extra={"error": str(exc)})
        return None
    return round(float(value), 2) if value is not None and pd.notna(value) else None


async def _get_snapshot(db: DbSession, prediction: Prediction) -> FeatureSnapshot | None:
    if prediction.feature_snapshot_id is None:
        return None
    row = await db.execute(
        select(FeatureSnapshot).where(FeatureSnapshot.id == prediction.feature_snapshot_id)
    )
    return row.scalar_one_or_none()


