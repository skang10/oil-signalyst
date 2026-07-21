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


def historical_avg_duration_weeks(regime: str) -> float:
    """Mean trading-day duration of historical segments of `regime` in
    REGIME_TRANSITIONS, in weeks. Same source data as estimate_switch_probability."""
    durations = _historical_segment_durations(regime)
    if not durations:
        return 0.0
    return round(sum(durations) / len(durations) / TRADING_DAYS_PER_WEEK, 1)


def historical_segment_count(regime: str) -> int:
    """How many hand-curated segments back the statistics for `regime`.

    Ships alongside every regime statistic so the UI can show what the number
    rests on. The counts are tiny - R1 has 5 segments, R4 exactly 1 - because
    REGIME_TRANSITIONS is 17 dates typed by hand, and a mean over 5 samples
    rendered as "60.8 weeks" reads far more precise than it is.
    """
    return len(_historical_segment_durations(regime))


async def estimate_switch_probability(current_regime: str, horizon_weeks: int = 4) -> dict:
    """Empirical chance the regime switches within `horizon_weeks`, given how
    long it has already persisted, from historical segments of the same regime
    in REGIME_TRANSITIONS.

    Returns the counts, not just the ratio: with ~17 hand-curated transitions
    across 16 years the denominator is single-digit, so a bare "0%" invites
    being read as a calibrated forecast when it only means "none of the 5
    historical R1 segments ended this early". `comparable` is 0 when the
    fallback applied and the ratio is the neutral prior rather than an estimate.
    """
    horizon_days = horizon_weeks * TRADING_DAYS_PER_WEEK
    current_duration = await get_regime_duration(current_regime)

    durations = _historical_segment_durations(current_regime)
    survivors = [d for d in durations if d >= current_duration]
    if len(survivors) < MIN_COMPARABLE_SEGMENTS:
        return {
            "probability": NEUTRAL_SWITCH_PROBABILITY,
            "switched": 0,
            "comparable": 0,
            "horizon_weeks": horizon_weeks,
        }

    switched_within_horizon = [d for d in survivors if d <= current_duration + horizon_days]
    return {
        "probability": round(len(switched_within_horizon) / len(survivors), 4),
        "switched": len(switched_within_horizon),
        "comparable": len(survivors),
        "horizon_weeks": horizon_weeks,
    }
