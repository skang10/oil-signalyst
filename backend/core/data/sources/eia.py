from datetime import date, timedelta

import pandas as pd
import requests
from tenacity import retry, stop_after_attempt, wait_exponential
from workalendar.usa import FederalReserveSystem

from core.config import settings
from core.data.sources.base import BaseSource

EIA_BASE = "https://api.eia.gov/v2/seriesid"
_US_CAL = FederalReserveSystem()

# EIA's v2 `seriesid` endpoint ignores the `start`/`end` query params and
# always returns the series' full history (crude stocks go back to 1982).
# We slice to the requested window client-side, keeping a warmup buffer
# before `start` so the registry's weekly->daily resample/ffill still has a
# prior print to carry into the window.
_EIA_WARMUP_DAYS = 60


def get_eia_release_date(reference_date: date) -> date:
    days_since_monday = reference_date.weekday()
    wednesday = reference_date - timedelta(days=days_since_monday - 2)
    release_day = (
        wednesday + timedelta(days=1) if not _US_CAL.is_working_day(wednesday) else wednesday
    )
    if reference_date < release_day:
        return release_day - timedelta(weeks=1)
    return release_day


class EIASource(BaseSource):
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=4, max=60))
    def fetch(self, cfg: dict, start: str, end: str) -> pd.Series:
        if not settings.eia_api_key:
            raise ValueError("EIA_API_KEY is required for EIA data")

        response = requests.get(
            f"{EIA_BASE}/{cfg['series_id']}",
            params={"api_key": settings.eia_api_key, "start": start, "end": end},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()["response"]["data"]
        if not data:
            raise ValueError(f"No EIA data returned for {cfg['series_id']}")

        df = pd.DataFrame(data)
        df["period"] = pd.to_datetime(df["period"]).astype("datetime64[ns]")
        series = df.set_index("period")["value"].astype(float).sort_index()

        # Honor the requested window (the endpoint won't) so downstream
        # alignment - a per-row release-date calc + daily resample in the
        # registry - runs over the caller's range instead of 40+ years.
        lower = pd.Timestamp(start) - pd.Timedelta(days=_EIA_WARMUP_DAYS)
        series = series.loc[lower : pd.Timestamp(end)]

        series.name = cfg["series_id"]
        return series
