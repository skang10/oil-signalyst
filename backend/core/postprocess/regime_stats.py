from sqlalchemy import select

from db.database import get_db
from db.models import Prediction


async def get_regime_duration(dominant_regime: str) -> int:
    async with get_db() as db:
        rows = await db.execute(
            select(Prediction.regime_probs).order_by(Prediction.date.desc()).limit(365)
        )
        records = rows.scalars().all()

    count = 0
    for probs in records:
        if not probs:
            break
        if max(probs, key=probs.get) != dominant_regime:
            break
        count += 1
    return count


async def estimate_switch_probability(current_regime: str, horizon_weeks: int = 4) -> float:
    del current_regime, horizon_weeks
    return 0.25
