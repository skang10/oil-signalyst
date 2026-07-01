from datetime import date

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import desc, select

from api.dependencies import CurrentUser, DbSession
from core.postprocess.report_assembler import assemble_daily_report
from db.crud import get_recent_predictions
from db.models import FeatureSnapshot, Prediction

router = APIRouter(prefix="/api/reports", tags=["reports"])
VALID_ROLES = {"trader", "risk", "researcher", "ds"}


@router.get("/daily/{role}")
async def get_daily_report(role: str, db: DbSession, user: CurrentUser) -> dict:
    del user
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Unknown report role: {role}")

    row = await db.execute(
        select(Prediction)
        .where(Prediction.date == date.today())
        .order_by(desc(Prediction.created_at))
        .limit(1)
    )
    prediction = row.scalar_one_or_none()
    if prediction is None:
        return {"status": "no_prediction", "date": str(date.today())}

    snapshot = await _get_snapshot(db, prediction)
    full = await assemble_daily_report(prediction, snapshot)
    return _filter_by_role(full, role)


@router.get("/history")
async def get_history(
    db: DbSession,
    user: CurrentUser,
    days: int = Query(default=30, le=365),
) -> list[dict]:
    del user
    return [_history_row(prediction) for prediction in await get_recent_predictions(db, days)]


@router.get("/history/{prediction_date}")
async def get_prediction_detail(prediction_date: date, db: DbSession, user: CurrentUser) -> dict:
    del user
    row = await db.execute(
        select(Prediction)
        .where(Prediction.date == prediction_date)
        .order_by(desc(Prediction.created_at))
        .limit(1)
    )
    prediction = row.scalar_one_or_none()
    if prediction is None:
        raise HTTPException(status_code=404, detail="Prediction not found")
    snapshot = await _get_snapshot(db, prediction)
    full = await assemble_daily_report(prediction, snapshot)
    full["actual_return"] = prediction.actual_return
    full["outcome_correct"] = prediction.outcome_correct
    full["feature_snapshot"] = snapshot.features if snapshot else None
    return full


async def _get_snapshot(db: DbSession, prediction: Prediction) -> FeatureSnapshot | None:
    if prediction.feature_snapshot_id is None:
        return None
    row = await db.execute(
        select(FeatureSnapshot).where(FeatureSnapshot.id == prediction.feature_snapshot_id)
    )
    return row.scalar_one_or_none()


def _filter_by_role(report: dict, role: str) -> dict:
    base_keys = [
        "date",
        "price",
        "dominant_regime",
        "regime_probs",
        "return_dist",
        "eia_forecast",
        "decision",
    ]
    base = {key: report[key] for key in base_keys}
    if role == "trader":
        return base
    if role == "risk":
        return {**base, "var_95": report["var_95"]}
    if role == "researcher":
        return {
            **base,
            "feature_signals": report["feature_signals"],
            "regime_duration_weeks": report["regime_duration_weeks"],
            "switch_prob_4w": report["switch_prob_4w"],
        }
    return report


def _history_row(prediction: Prediction) -> dict:
    regime_probs = prediction.regime_probs or {}
    return {
        "date": str(prediction.date),
        "dominant_regime": max(regime_probs, key=regime_probs.get) if regime_probs else None,
        "return_dist": prediction.return_dist,
        "eia_forecast": prediction.eia_forecast.get("crude") if prediction.eia_forecast else None,
        "actual_return": prediction.actual_return,
        "outcome_correct": prediction.outcome_correct,
    }
