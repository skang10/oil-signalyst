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
# always returns the series' full history (crude stocks go back to 1982:
# ~2,280 weekly rows / ~600KB). It DOES honor `length`, returning the N
# most-recent observations newest-first. So we ask for only enough rows to
# cover the caller's window (see `_window_length`) and still slice client-side
# as a backstop. This is the real fix for the slow EIA reads: a freshness
# check drops from ~600KB to ~2KB, the server assembles a handful of rows
# instead of 40+ years, and the smaller response shrinks the window for the
# occasional multi-minute EIA-side latency spike. The warmup buffer keeps a
# prior print before `start` so the registry's weekly->daily resample/ffill
# has a value to carry into the window.
_EIA_WARMUP_DAYS = 60
_EIA_FREQ_DAYS = {"D": 1, "W": 7, "M": 31}
_EIA_LENGTH_BUFFER = 8  # extra periods for publication lag / safety margin


def _window_length(cfg: dict, start: str, end: str) -> int:
    """Rows to request so the newest-first response reaches from the latest
    print (~today) back past `start - warmup`, covering the caller's window."""
    period_days = _EIA_FREQ_DAYS.get(cfg.get("freq", "W"), 7)
    span_start = pd.Timestamp(start) - pd.Timedelta(days=_EIA_WARMUP_DAYS)
    newest = max(pd.Timestamp(end), pd.Timestamp.now().normalize())
    periods = int((newest - span_start).days // period_days) + _EIA_LENGTH_BUFFER
    return max(periods, 1)


def get_eia_release_date(reference_date: date) -> date:
    days_since_monday = reference_date.weekday()
    wednesday = reference_date - timedelta(days=days_since_monday - 2)
    release_day = (
        wednesday + timedelta(days=1) if not _US_CAL.is_working_day(wednesday) else wednesday
    )
    if reference_date < release_day:
        return release_day - timedelta(weeks=1)
    return release_day


def get_next_eia_release_date(reference_date: date) -> date:
    """The upcoming weekly EIA petroleum-status release (Wednesday, shifted to
    Thursday when the Wednesday is a federal holiday) on or after
    `reference_date` — i.e. the print the current forecast is for. Same calendar
    as `get_eia_release_date`; walks forward a few weeks so a holiday week never
    lands before the reference."""
    monday = reference_date - timedelta(days=reference_date.weekday())
    for _ in range(4):
        wednesday = monday + timedelta(days=2)
        release_day = (
            wednesday + timedelta(days=1)
            if not _US_CAL.is_working_day(wednesday)
            else wednesday
        )
        if release_day >= reference_date:
            return release_day
        monday += timedelta(weeks=1)
    return release_day


class EIASource(BaseSource):
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=4, max=60))
    def fetch(self, cfg: dict, start: str, end: str) -> pd.Series:
        if not settings.eia_api_key:
            raise ValueError("EIA_API_KEY is required for EIA data")

        response = requests.get(
            f"{EIA_BASE}/{cfg['series_id']}",
            params={
                "api_key": settings.eia_api_key,
                "length": _window_length(cfg, start, end),
            },
            # (connect, read) rather than one 30s value: cap connection setup
            # tightly, and bound each read gap so a stalled EIA response fails
            # fast into the retry/backoff instead of hanging on a slow trickle.
            timeout=(5, 30),
        )
        response.raise_for_status()
        data = response.json()["response"]["data"]
        if not data:
            raise ValueError(f"No EIA data returned for {cfg['series_id']}")

        df = pd.DataFrame(data)
        df["period"] = pd.to_datetime(df["period"]).astype("datetime64[ns]")
        series = df.set_index("period")["value"].astype(float).sort_index()

        # Trim the length-bounded response to exactly the caller's window (plus
        # warmup): `length` is sized from now, so for a past `end` it returns
        # rows newer than the window that downstream alignment shouldn't see.
        lower = pd.Timestamp(start) - pd.Timedelta(days=_EIA_WARMUP_DAYS)
        series = series.loc[lower : pd.Timestamp(end)]

        series.name = cfg["series_id"]
        return series
