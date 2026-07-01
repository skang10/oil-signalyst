import pandas as pd
from fredapi import Fred
from tenacity import retry, stop_after_attempt, wait_exponential

from core.config import settings
from core.data.sources.base import BaseSource


class FREDSource(BaseSource):
    def __init__(self) -> None:
        if settings.fred_api_key:
            self._fred = Fred(api_key=settings.fred_api_key)
        else:
            self._fred = None

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=4, max=60))
    def fetch(self, cfg: dict, start: str, end: str) -> pd.Series:
        if self._fred is None:
            raise ValueError("FRED_API_KEY is required for FRED data")
        series = self._fred.get_series(cfg["series_id"], start, end)
        series = pd.Series(series).sort_index()
        series.index = pd.to_datetime(series.index).astype("datetime64[ns]")
        series.name = cfg["series_id"]
        return series
