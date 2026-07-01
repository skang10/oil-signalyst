from datetime import date

from sqlalchemy import select

from core.models.regime_labels import build_regime_series
from db.database import get_db
from db.models import Prediction

TRADING_DAYS_PER_WEEK = 5
MIN_COMPARABLE_SEGMENTS = 2
NEUTRAL_SWITCH_PROBABILITY = 0.25


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


def _historical_segment_durations(regime: str) -> list[int]:
    """Trading-day durations of every historical segment where the hand-curated
    REGIME_TRANSITIONS series equaled `regime`."""
    series = build_regime_series("2010-01-01", str(date.today()))
    trading_days = series[series.index.dayofweek < 5]
    segment_id = trading_days.ne(trading_days.shift()).cumsum()
    segments = trading_days.groupby(segment_id).agg(["first", "count"])
    return segments.loc[segments["first"] == regime, "count"].tolist()


async def estimate_switch_probability(current_regime: str, horizon_weeks: int = 4) -> float:
    """Empirical probability the regime switches within `horizon_weeks`, given
    how long it has already persisted, estimated from historical segments of
    the same regime type in REGIME_TRANSITIONS. Falls back to a neutral
    probability when there isn't enough comparable history - with only ~17
    hand-curated transitions across 16 years, this is common and expected,
    not an error condition.
    """
    horizon_days = horizon_weeks * TRADING_DAYS_PER_WEEK
    current_duration = await get_regime_duration(current_regime)

    durations = _historical_segment_durations(current_regime)
    survivors = [d for d in durations if d >= current_duration]
    if len(survivors) < MIN_COMPARABLE_SEGMENTS:
        return NEUTRAL_SWITCH_PROBABILITY

    switched_within_horizon = [d for d in survivors if d <= current_duration + horizon_days]
    return round(len(switched_within_horizon) / len(survivors), 4)
