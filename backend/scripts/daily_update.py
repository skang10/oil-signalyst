"""Daily data-refresh pipeline.

The raw sources (Yahoo/EIA/FRED/CFTC) are fetched live on demand, but the
engineered feature matrix is a persisted Parquet snapshot that nothing updates
on its own - so without this job it silently drifts stale (the Data Monitor's
original "everything is 264h delayed" symptom). Run once a day, after the US
close and the EIA/COT releases, to append the latest rows and warm the caches.

Invoked in-process by the APScheduler job registered in api/main.py, and
runnable standalone: `python -m scripts.daily_update`.
"""

import asyncio
from datetime import date

import pandas as pd

from core.config_paths import FEATURES_DIR
from core.data.registry import DataRegistry
from core.logging import get_logger
from features.engine import FeatureEngine

logger = get_logger(__name__)

# Two calendar years of lead-in so the longest rolling-window features (e.g.
# the 252-day annualised vol) are warm before the current-year slice we write.
WARMUP_YEARS = 2


def rebuild_current_year_features(as_of: date | None = None) -> pd.Timestamp | None:
    """Rebuilds the current-year feature Parquet from a fresh live fetch and
    returns the newest row's timestamp (None if the build produced nothing)."""
    as_of = as_of or date.today()
    FEATURES_DIR.mkdir(parents=True, exist_ok=True)

    start = f"{as_of.year - WARMUP_YEARS}-01-01"
    engine = FeatureEngine(registry=DataRegistry())
    features = engine.build(start, as_of.isoformat())
    if features.empty:
        logger.warning("Daily update produced an empty feature matrix")
        return None

    current = features[features.index.year == as_of.year]
    if current.empty:
        logger.warning("Daily update produced no current-year rows", extra={"year": as_of.year})
        return None

    path = FEATURES_DIR / f"features_{as_of.year}.parquet"
    current.to_parquet(path)
    latest = current.index.max()
    logger.info(
        "Daily feature update written",
        extra={"path": str(path), "rows": len(current), "latest": str(latest.date())},
    )
    return latest


def _clear_shared_caches() -> None:
    """Drops the 4h TTL caches on the app's shared registries so the Data
    Monitor and Signal Evaluate pages re-fetch the rows this job just landed."""
    from core.postprocess import data_monitor, signal_charts

    data_monitor._REGISTRY.clear_cache()
    signal_charts._REGISTRY.clear_cache()


async def run_daily_update(as_of: date | None = None) -> None:
    """Full daily refresh: rebuild features, drop stale caches, rewarm the
    Signal Evaluate charts. Safe to await from the APScheduler event loop."""
    from core.postprocess.signal_charts import refresh_signal_charts

    logger.info("Daily update starting")
    latest = await asyncio.to_thread(rebuild_current_year_features, as_of)
    await asyncio.to_thread(_clear_shared_caches)
    await refresh_signal_charts()
    logger.info("Daily update complete", extra={"latest": str(latest.date()) if latest else None})


def main() -> None:
    asyncio.run(run_daily_update())


if __name__ == "__main__":
    main()
