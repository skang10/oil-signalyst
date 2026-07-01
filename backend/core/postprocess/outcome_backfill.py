from datetime import date, timedelta

from sqlalchemy import select

from core.data.registry import DataRegistry
from core.models.labels import return_bucket_for_value
from db.database import get_db
from db.models import Prediction


async def backfill_outcomes(today: date | None = None) -> None:
    today = today or date.today()
    start = today - timedelta(days=90)
    registry = DataRegistry()
    wti = registry.fetch("wti", str(start), str(today)).dropna().sort_index()
    if len(wti) < 21:
        return

    async with get_db() as db:
        rows = await db.execute(
            select(Prediction)
            .where(
                Prediction.actual_return.is_(None),
                Prediction.date >= start,
                Prediction.date <= today,
            )
            .order_by(Prediction.date)
        )
        predictions = rows.scalars().all()
        for prediction in predictions:
            if prediction.date.isoformat() not in wti.index.strftime("%Y-%m-%d"):
                continue
            position = wti.index.get_indexer([str(prediction.date)], method="nearest")[0]
            outcome_position = position + 20
            if outcome_position >= len(wti):
                continue
            actual_return = float(wti.iloc[outcome_position] / wti.iloc[position] - 1)
            actual_bucket = return_bucket_for_value(actual_return)
            return_dist = prediction.return_dist or {}
            predicted_bucket = max(return_dist, key=return_dist.get, default=None)
            prediction.actual_return = round(actual_return, 6)
            prediction.outcome_correct = predicted_bucket == actual_bucket
            db.add(prediction)
