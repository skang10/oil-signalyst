import concurrent.futures as cf
import time
from datetime import timedelta
from pathlib import Path

import pandas as pd
import yaml

from core.cache import DataFetchCache
from core.config_paths import DATA_SOURCES_YAML
from core.data.series_store import SeriesStore
from core.data.sources.cftc import CFTCSource
from core.data.sources.eia import _EIA_WARMUP_DAYS, EIASource, get_eia_release_date
from core.data.sources.fred import FREDSource
from core.data.sources.yahoo import YahooSource
from core.logging import get_logger

logger = get_logger(__name__)


class DataRegistry:
    def __init__(
        self,
        config_path: Path | str = DATA_SOURCES_YAML,
        cache: DataFetchCache | None = None,
    ):
        with open(config_path) as file:
            self.config = yaml.safe_load(file)["sources"]
        self._cache = cache or DataFetchCache()
        self._store = SeriesStore()
        self._adapters = {
            "yahoo": YahooSource(),
            "eia": EIASource(),
            "fred": FREDSource(),
            "cftc": CFTCSource(),
        }

    def clear_cache(self) -> None:
        """Drops the in-memory tiers - callers refresh after the daily pipeline
        lands new data (e.g. signal_charts.refresh_signal_charts). Persisted
        per-source history on disk is kept; the next fetch reconciles with it
        and re-fetches only the recent tail."""
        self._cache.clear()
        self._store.clear()

    def fetch(self, name: str, start: str, end: str) -> pd.Series:
        cache_key = f"{name}:{start}:{end}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        cfg = self.config[name]
        adapter = self._adapters[cfg["type"]]
        if adapter.manages_own_persistence:
            # CFTC: its own per-year disk cache, and its fetch() already slices
            # to the window.
            aligned = self._align(adapter.fetch(cfg, start, end), cfg)
        else:
            # Slice the persisted raw to the exact span the adapter's own
            # fetch(start, end) would have returned, then align it - so routing
            # through the store is byte-for-byte what direct fetching produced.
            # This matters for path-dependent transforms: crude_inv_dev's
            # seasonal_dev is an expanding mean, so the warmup EIA prepends
            # before `start` shifts its baseline. Weekly sources get that
            # warmup (also load-bearing for the weekly->daily ffill); daily
            # sources are fetched for exactly [start, end].
            raw_full = self._store.get(name, adapter, cfg, start, end)
            warmup = _EIA_WARMUP_DAYS if cfg.get("freq") == "W" else 0
            lo = pd.Timestamp(start) - pd.Timedelta(days=warmup)
            aligned = self._align(raw_full.loc[lo : pd.Timestamp(end)], cfg)

        self._cache.set(cache_key, aligned)
        logger.info("Fetched source", extra={"source_name": name, "rows": len(aligned)})
        return aligned

    def fetch_all(
        self,
        start: str,
        end: str,
        source_names: list[str] | None = None,
        timeout: float | None = None,
        max_workers: int = 8,
    ) -> pd.DataFrame:
        """Fetch each source's aligned series into one frame.

        Default (`timeout=None`): serial, unbounded - the polite path the daily
        pipeline and other offline callers use, one external call at a time to
        stay off the sources' rate limits.

        With `timeout`: fetch concurrently under a single global wall-clock
        deadline (seconds). A source that doesn't return in time is dropped from
        the frame rather than hanging the caller - used by the interactive
        freshness check so one slow feed (e.g. EIA's ~240s HTTP) can't wedge a
        page. Sources missing at the deadline simply resolve on the next call
        once their abandoned fetch has populated the cache.
        """
        names = source_names or list(self.config)
        if timeout is None:
            return self._fetch_all_serial(names, start, end)
        return self._fetch_all_bounded(names, start, end, timeout, max_workers)

    def _fetch_all_serial(self, names: list[str], start: str, end: str) -> pd.DataFrame:
        frames: dict[str, pd.Series] = {}
        for name in names:
            try:
                frames[name] = self.fetch(name, start, end)
            except Exception as exc:
                logger.warning("Skipping source", extra={"source_name": name, "error": str(exc)})
        return pd.DataFrame(frames)

    def _fetch_all_bounded(
        self, names: list[str], start: str, end: str, timeout: float, max_workers: int
    ) -> pd.DataFrame:
        frames: dict[str, pd.Series] = {}
        pool = cf.ThreadPoolExecutor(max_workers=min(max_workers, len(names)) or 1)
        futures = {pool.submit(self.fetch, name, start, end): name for name in names}
        deadline = time.monotonic() + timeout
        for future, name in futures.items():
            remaining = deadline - time.monotonic()
            try:
                frames[name] = future.result(timeout=max(0.0, remaining))
            except cf.TimeoutError:
                logger.warning("Source fetch exceeded deadline", extra={"source_name": name})
            except Exception as exc:
                logger.warning("Skipping source", extra={"source_name": name, "error": str(exc)})
        # Don't block shutdown on the abandoned slow fetches - let them finish
        # in the background (they warm the cache for the next call).
        pool.shutdown(wait=False, cancel_futures=True)
        return pd.DataFrame(frames)

    def _align(self, series: pd.Series, cfg: dict) -> pd.Series:
        if cfg.get("freq") == "W" and cfg.get("type") == "eia":
            return self._align_eia(series, cfg)

        daily = self._to_business_days(series)

        lag = cfg.get("lag_days", 0)
        if lag > 0:
            daily = daily.shift(lag)

        if cfg.get("freq") == "W":
            release_day = cfg.get("release_day", 2)
            daily.loc[daily.index.dayofweek < release_day] = None
            daily = daily.ffill()

        return daily

    @staticmethod
    def _to_business_days(series: pd.Series) -> pd.Series:
        """Resample onto business days rather than calendar days.

        Every series used to be resampled with "D", so ~29% of every row in the
        feature matrix was a weekend carrying Friday's value forward. Because
        rolling windows count rows, that made every day-count window shorter
        than its name in trading terms: ret_20d spanned 20 calendar days, about
        14 trading days, and build_return_bucket_labels' `horizon_trading_days`
        shifted by 20 calendar days despite the parameter name. It also biased
        rvol_20d low - roughly a third of the returns in its window were zero by
        construction - while still annualising with sqrt(252), a constant that
        assumes 252 observations per year on a series that had 365.

        Market holidays are still forward-filled: "B" is Mon-Fri, not an
        exchange calendar. That leaves ~9 carried rows a year instead of ~104.
        """
        return series.resample("B").last().ffill()

    def _align_eia(self, series: pd.Series, cfg: dict) -> pd.Series:
        released = series.copy()
        released.index = pd.to_datetime(
            [get_eia_release_date(period.date() + timedelta(days=6)) for period in released.index]
        ).astype("datetime64[ns]")
        released = released.sort_index()

        daily = self._to_business_days(released)
        lag = cfg.get("lag_days", 0)
        if lag > 0:
            daily = daily.shift(lag)
        return daily
