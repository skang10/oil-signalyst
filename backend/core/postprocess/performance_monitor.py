"""Rolling out-of-sample performance of the live EIA forecast, scored against
the inventory change EIA later publishes.

Everything else in postprocess/ watches the *input* side (PSI drift, feed
freshness, coverage). This is the piece that was missing: once a prediction is
made, nothing re-scored it against reality - `Prediction.outcome_correct` was
added by migration 0002 and never written. This module fills that in.

The target is weekly (build_eia_labels broadcasts each weekly change onto ~5
business-day rows), so all the rolling metrics here are computed over
weekly-distinct prints, not raw daily rows, and change detection uses
Page-Hinkley rather than ADWIN - ~50 independent observations a year is too few
for ADWIN to be stable.
"""

import asyncio
from datetime import date, timedelta

import numpy as np
import pandas as pd
from sqlalchemy import select

from core.data.registry import DataRegistry
from core.logging import get_logger
from core.models.labels import build_eia_labels
from db.database import get_db
from db.models import Prediction

logger = get_logger(__name__)

# How many weekly-distinct prints the rolling metrics span. ~12 weeks ~= one
# quarter, enough to read a trend without reaching back into a stale regime.
ROLLING_WINDOW_PRINTS = 12

# Page-Hinkley run on the *standardized* loss series (abs error / its own std),
# so these thresholds are in std units and scale-free. delta is the drift
# tolerated before accumulating; lambda is how much accumulated upward drift
# trips the alarm. Tuned on a 12-point weekly window (see the scenarios checked
# during development): flat, noisy, and one-off-spike series stay quiet, while a
# sustained ~2x-or-more rise in loss - or a steady ramp - alarms. A single bad
# week is deliberately NOT enough; drift means a sustained shift.
PH_DELTA = 0.5
PH_LAMBDA = 3.0

# Directional hit-rate at or below this is "no better than a coin flip" - the
# performance-drop signal the auto retrain trigger reads.
DIRECTION_FLOOR = 0.5


def page_hinkley(values, delta: float = PH_DELTA, lam: float = PH_LAMBDA) -> dict:
    """Page-Hinkley test for an *increase* in the mean of a loss series.

    Tracks the cumulative deviation of each point from the running mean (less a
    tolerance `delta`) and the running minimum of that cumulative; the test
    statistic is how far the cumulative has climbed above its minimum, and an
    alarm fires when that exceeds `lam`. Pure and side-effect free so it can be
    unit-checked and reused.
    """
    values = np.asarray([v for v in values if v is not None], dtype=float)
    values = values[~np.isnan(values)]
    if len(values) < 3:
        return {"alarm": False, "stat": 0.0}

    running_sum = 0.0
    cumulative = 0.0
    min_cumulative = 0.0
    ph = 0.0
    for i, x in enumerate(values, start=1):
        running_sum += x
        mean = running_sum / i
        cumulative += x - mean - delta
        min_cumulative = min(min_cumulative, cumulative)
        ph = cumulative - min_cumulative
    return {"alarm": bool(ph > lam), "stat": round(float(ph), 4)}


def _weekly_events(rows: list[Prediction]) -> pd.DataFrame:
    """Collapse the scored daily prediction rows to one row per weekly print.

    Consecutive business days inside the same EIA week carry the SAME realized
    label (the change is bfilled onto every day of the week), so a run of equal
    `actual_return` values is one weekly event. The last row of each run is kept
    - it is the prediction made closest to the print, on the freshest features.
    """
    records = []
    for r in rows:
        forecast = (r.eia_forecast or {}).get("crude")
        consensus = (r.eia_forecast or {}).get("market_consensus")
        if forecast is None or r.actual_return is None:
            continue
        records.append(
            {
                "date": r.date,
                "forecast": float(forecast),
                "consensus": float(consensus) if consensus is not None else np.nan,
                "realized": float(r.actual_return),
            }
        )
    if not records:
        return pd.DataFrame(columns=["date", "forecast", "consensus", "realized"])

    df = pd.DataFrame(records).sort_values("date").reset_index(drop=True)
    # New weekly event whenever the realized label changes from the previous row.
    run_id = (df["realized"] != df["realized"].shift()).cumsum()
    return df.groupby(run_id, as_index=False).last()


async def rolling_performance(db) -> dict:
    """Rolling MAE, directional hit-rate and model-vs-consensus differential over
    the last ROLLING_WINDOW_PRINTS weekly prints, plus a Page-Hinkley alarm on
    the residual loss. Returns null-ish placeholders (never raises) when there
    is not yet any scored history."""
    empty = {
        "n_prints": 0,
        "rolling_mae": None,
        "directional_acc": None,
        "model_vs_consensus": None,
        "series": [],
        "page_hinkley": {"alarm": False, "stat": 0.0},
    }
    try:
        result = await db.execute(
            select(Prediction)
            .where(Prediction.actual_return.is_not(None))
            .order_by(Prediction.date)
        )
        rows = list(result.scalars().all())
        events = _weekly_events(rows)
        if events.empty:
            return empty

        window = events.tail(ROLLING_WINDOW_PRINTS).copy()
        window["abs_error"] = (window["realized"] - window["forecast"]).abs()
        window["hit"] = np.sign(window["forecast"]) == np.sign(window["realized"])

        mae = float(window["abs_error"].mean())
        direction = float(window["hit"].mean())

        has_consensus = window["consensus"].notna()
        if has_consensus.any():
            model_err = window.loc[has_consensus, "abs_error"].mean()
            cons_err = (
                (window.loc[has_consensus, "realized"] - window.loc[has_consensus, "consensus"])
                .abs()
                .mean()
            )
            # Negative => the model beats the market consensus (matches eia.py's
            # mae_vs_consensus sign convention).
            model_vs_consensus = round(float(model_err - cons_err), 4)
        else:
            model_vs_consensus = None

        std = window["abs_error"].std(ddof=0)
        standardized_loss = window["abs_error"] / std if std and std > 0 else window["abs_error"]
        ph = page_hinkley(standardized_loss.to_list())

        series = [
            {
                "date": row["date"].isoformat(),
                "forecast": round(row["forecast"], 2),
                "realized": round(row["realized"], 2),
                "consensus": None if pd.isna(row["consensus"]) else round(row["consensus"], 2),
                "abs_error": round(row["abs_error"], 2),
                "hit": bool(row["hit"]),
            }
            for _, row in window.iterrows()
        ]
        return {
            "n_prints": int(len(window)),
            "rolling_mae": round(mae, 4),
            "directional_acc": round(direction, 4),
            "model_vs_consensus": model_vs_consensus,
            "series": series,
            "page_hinkley": ph,
        }
    except Exception as exc:
        logger.warning("Rolling performance computation failed", extra={"error": str(exc)})
        return empty


async def backfill_prediction_outcomes(registry: DataRegistry | None = None) -> int:
    """Score every stored prediction whose outcome is now known.

    Reads the realized label from `build_eia_labels` - the exact function
    training uses to build the target - so "realized" here is identical to what
    the model was trained to hit. A prediction is only scorable once the next
    weekly print it forecast has landed; build_eia_labels leaves trailing dates
    NaN until then, so recent unresolved predictions are naturally skipped.

    Writes `actual_return` (the realized change, MB) and `outcome_correct` (did
    the forecast get the sign right). Fails soft - a monitoring backfill must
    never break the daily pipeline.
    """
    registry = registry or DataRegistry()
    try:
        async with get_db() as db:
            result = await db.execute(
                select(Prediction.id, Prediction.date)
                .where(Prediction.actual_return.is_(None))
                .order_by(Prediction.date)
            )
            pending = result.all()
        if not pending:
            return 0

        earliest = min(row.date for row in pending)
        labels = await asyncio.to_thread(
            build_eia_labels,
            str(earliest - timedelta(days=10)),
            str(date.today()),
            registry,
        )
        label_map = {ts.date(): val for ts, val in labels.items()}

        scored = 0
        async with get_db() as db:
            for row in pending:
                realized = label_map.get(row.date)
                if realized is None or (isinstance(realized, float) and np.isnan(realized)):
                    continue
                pred = await db.get(Prediction, row.id)
                forecast = (pred.eia_forecast or {}).get("crude") if pred else None
                if pred is None or forecast is None:
                    continue
                pred.actual_return = round(float(realized), 4)
                pred.outcome_correct = bool(np.sign(forecast) == np.sign(realized))
                db.add(pred)
                scored += 1
        if scored:
            logger.info("Scored prediction outcomes", extra={"count": scored})
        return scored
    except Exception as exc:
        logger.warning("Outcome backfill failed", extra={"error": str(exc)})
        return 0
