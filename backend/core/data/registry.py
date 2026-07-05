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
    ) -> pd.DataFrame:
        frames: dict[str, pd.Series] = {}
        names = source_names or list(self.config)
        for name in names:
            try:
                frames[name] = self.fetch(name, start, end)
            except Exception as exc:
                logger.warning("Skipping source", extra={"source_name": name, "error": str(exc)})
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
