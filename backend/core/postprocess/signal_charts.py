import asyncio

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from core.cache import DataFetchCache
from core.data.registry import DataRegistry
from core.logging import get_logger
from core.models.trainer import TRAIN_END, TRAIN_START, VAL_END
from core.signal_scanner import load_candidates
from features.engine import FeatureEngine

logger = get_logger(__name__)

CHART_HISTORY_MONTHS = 18
ROLLING_IC_WINDOW_DAYS = 52 * 5  # ~52 trading weeks
ROLLING_IC_STEP_DAYS = 5  # weekly steps - the 52-week window barely moves day to day
ROLLING_IC_MIN_OBSERVATIONS = 10
TRAIN_END_YEAR = pd.Timestamp(TRAIN_END).year

# Shared across requests. A per-request DataRegistry() started with an empty
# cache, so every Evaluate page view re-downloaded ~15 years of raw source
# data (~2.7s of the measured ~4.4s page time); the registry's own 4h TTL
# cache makes repeat fetches free once the instance is shared.
_REGISTRY = DataRegistry()

# Built chart payloads keyed by signal name. The 24h TTL is a backstop -
# refresh_signal_charts() proactively rebuilds at API startup and after each
# daily pipeline run (the only time the underlying data changes), so even
# the first-ever page view of a candidate is served warm.
_CHART_CACHE = DataFetchCache(ttl_seconds=24 * 3600)


def _find_candidate(signal_name: str) -> dict | None:
    for candidate in load_candidates():
        if candidate["name"] == signal_name:
            return candidate
    return None


def _ic_mean(signal: pd.Series, target: pd.Series) -> float | None:
    aligned = pd.concat([signal, target], axis=1).dropna()
    if len(aligned) < ROLLING_IC_MIN_OBSERVATIONS:
        return None
    correlation, _ = spearmanr(aligned.iloc[:, 0], aligned.iloc[:, 1])
    return None if np.isnan(correlation) else round(float(correlation), 4)


async def build_signal_charts(signal_name: str) -> dict | None:
    """Builds (or serves cached) Signal Evaluate page datasets for a
    candidate signal.

    Sources history from the backfilled (and daily-pipeline-appended)
    feature Parquet matrix / live DataRegistry fetches rather than
    FeatureSnapshot, consistent with every other historical lookup fixed
    this phase - FeatureSnapshot only holds rows the live pipeline has
    actually produced, not backfilled history.

    Cold builds run in a worker thread: the registry's fetches are
    synchronous network calls that previously froze the whole event loop
    (including the /ws/price ticker) for seconds per page view.
    """
    cached = _CHART_CACHE.get(signal_name)
    if cached is not None:
        return cached

    result = await asyncio.to_thread(_build_signal_charts_sync, signal_name)
    if result is not None:
        _CHART_CACHE.set(signal_name, result)
    return result


def _build_signal_charts_sync(signal_name: str) -> dict | None:
    candidate = _find_candidate(signal_name)
    if candidate is None:
        return None

    engine = FeatureEngine(registry=_REGISTRY)
    raw = _REGISTRY.fetch_all(TRAIN_START, VAL_END, source_names=[candidate["source"]])
    signal = engine.apply_transform(candidate, raw).dropna().sort_index()
    wti = _REGISTRY.fetch("wti", TRAIN_START, VAL_END).dropna().sort_index()

    df = pd.concat([signal.rename("signal"), wti.rename("price")], axis=1).dropna()
    if df.empty:
        return {"price_history": [], "rolling_ic": [], "oos_by_year": [], "ic10": 0.0}

    return {
        "price_history": _price_history(df),
        "rolling_ic": _rolling_ic(df),
        "oos_by_year": _oos_by_year(df),
        # Full-history 10-day IC. The signal scanner's official Bonferroni
        # run only tests lags [5, 20, 60] (core/signal_scanner.py::IC_LAGS_DAYS)
        # - this is a separate, single-candidate ad-hoc calc for the Evaluate
        # page's headline stat, not part of that corrected family of tests.
        "ic10": _ic_mean(df["signal"], df["price"].pct_change(10).shift(-10)) or 0.0,
    }


async def refresh_signal_charts() -> None:
    """Rebuilds every candidate's charts in the background so first-ever
    Evaluate page views are served from cache. Called fire-and-forget at API
    startup and after each daily pipeline run; builds sequentially (one
    worker thread at a time) to stay off the external APIs' rate limits.
    Failures skip the one candidate - the page then just builds it lazily."""
    _CHART_CACHE.clear()
    # Data changed (or unknown at startup): drop stale raw-series caches too,
    # otherwise rebuilt charts would reuse up-to-4h-old source data.
    _REGISTRY.clear_cache()
    for candidate in load_candidates():
        name = candidate["name"]
        try:
            await build_signal_charts(name)
        except Exception as exc:
            logger.error("Chart prewarm failed", extra={"signal": name, "error": str(exc)})
    logger.info("Signal charts prewarmed", extra={"candidates": len(load_candidates())})


def _price_history(df: pd.DataFrame) -> list[dict]:
    cutoff = df.index.max() - pd.DateOffset(months=CHART_HISTORY_MONTHS)
    recent = df[df.index >= cutoff]
    return [
        {
            "date": str(idx.date()),
            "price": round(float(row.price), 2),
            "signal": round(float(row.signal), 4),
        }
        for idx, row in recent.iterrows()
    ]


def _rolling_ic(df: pd.DataFrame) -> list[dict]:
    target_5d = df["price"].pct_change(5).shift(-5)
    target_10d = df["price"].pct_change(10).shift(-10)
    target_20d = df["price"].pct_change(20).shift(-20)
    window = ROLLING_IC_WINDOW_DAYS
    points = []
    for end in range(window, len(df), ROLLING_IC_STEP_DAYS):
        sig_window = df["signal"].iloc[end - window : end]
        ic_5d = _ic_mean(sig_window, target_5d.iloc[end - window : end])
        ic_10d = _ic_mean(sig_window, target_10d.iloc[end - window : end])
        ic_20d = _ic_mean(sig_window, target_20d.iloc[end - window : end])
        points.append(
            {
                "date": str(df.index[end - 1].date()),
                "ic_5d": ic_5d,
                "ic_10d": ic_10d,
                "ic_20d": ic_20d,
            }
        )
    return points


def _oos_by_year(df: pd.DataFrame) -> list[dict]:
    target_5d = df["price"].pct_change(5).shift(-5)
    train_mask = df.index.year <= TRAIN_END_YEAR
    train_ic = _ic_mean(df["signal"][train_mask], target_5d[train_mask])
    if train_ic is None:
        return []

    results = []
    for year in range(TRAIN_END_YEAR + 1, df.index.year.max() + 1):
        year_mask = df.index.year == year
        oos_ic = _ic_mean(df["signal"][year_mask], target_5d[year_mask])
        if oos_ic is None:
            continue
        results.append({"year": year, "train_ic": train_ic, "oos_ic": oos_ic})
    return results
