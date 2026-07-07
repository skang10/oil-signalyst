import concurrent.futures as cf
import time
from datetime import timedelta
from pathlib import Path

import pandas as pd
import yaml

from core.cache import DataFetchCache
from core.config_paths import DATA_SOURCES_YAML
from core.data.sources.cftc import CFTCSource
from core.data.sources.eia import EIASource, get_eia_release_date
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
        self._adapters = {
            "yahoo": YahooSource(),
            "eia": EIASource(),
            "fred": FREDSource(),
            "cftc": CFTCSource(),
        }

    def clear_cache(self) -> None:
        """Drops all cached raw series - callers refresh after the daily
        pipeline lands new data (e.g. signal_charts.refresh_signal_charts)."""
        self._cache.clear()

    def fetch(self, name: str, start: str, end: str) -> pd.Series:
        cache_key = f"{name}:{start}:{end}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        cfg = self.config[name]
        adapter = self._adapters[cfg["type"]]
        raw = adapter.fetch(cfg, start, end)
        aligned = self._align(raw, cfg)
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

        daily = series.resample("D").last().ffill()

        lag = cfg.get("lag_days", 0)
        if lag > 0:
            daily = daily.shift(lag)

        if cfg.get("freq") == "W":
            release_day = cfg.get("release_day", 2)
            daily.loc[daily.index.dayofweek < release_day] = None
            daily = daily.ffill()

        return daily

    def _align_eia(self, series: pd.Series, cfg: dict) -> pd.Series:
        released = series.copy()
        released.index = pd.to_datetime(
            [get_eia_release_date(period.date() + timedelta(days=6)) for period in released.index]
        ).astype("datetime64[ns]")
        released = released.sort_index()

        daily = released.resample("D").last().ffill()
        lag = cfg.get("lag_days", 0)
        if lag > 0:
            daily = daily.shift(lag)
        return daily
