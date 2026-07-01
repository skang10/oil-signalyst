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

    def fetch_all(self, start: str, end: str) -> pd.DataFrame:
        frames: dict[str, pd.Series] = {}
        for name in self.config:
            try:
                frames[name] = self.fetch(name, start, end)
            except Exception as exc:
                logger.warning("Skipping source", extra={"source_name": name, "error": str(exc)})
        return pd.DataFrame(frames)

    def _align(self, series: pd.Series, cfg: dict) -> pd.Series:
        daily = series.resample("D").last().ffill()

        lag = cfg.get("lag_days", 0)
        if lag > 0:
            daily = daily.shift(lag)

        if cfg.get("freq") == "W" and cfg.get("type") == "eia":
            availability = pd.Series(daily.index, index=daily.index).map(
                lambda ts: ts.date() >= get_eia_release_date(ts.date())
            )
            daily.loc[~availability] = None
            daily = daily.ffill()
        elif cfg.get("freq") == "W":
            release_day = cfg.get("release_day", 2)
            daily.loc[daily.index.dayofweek < release_day] = None
            daily = daily.ffill()

        return daily
