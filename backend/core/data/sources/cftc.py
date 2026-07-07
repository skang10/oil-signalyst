import io
import threading
import time
import zipfile

import pandas as pd
import requests
from tenacity import retry, stop_after_attempt, wait_exponential

from core.config_paths import CFTC_RAW_DIR
from core.data.sources.base import BaseSource

CFTC_URL = "https://www.cftc.gov/files/dea/history/fut_disagg_txt_{year}.zip"
# The current-year ZIP is a multi-MB download that takes ~100s. COT prints
# weekly (Friday), so re-downloading it on every cold page load - twice, since
# the long and short legs are separate sources - is pure waste. Cache it to
# disk like past years, but re-fetch once the cached copy ages past this TTL.
_CURRENT_YEAR_TTL_SECONDS = 12 * 3600
CFTC_COLUMNS = {
    "Market_and_Exchange_Names": "market_name",
    "As_of_Date_In_Form_YYMMDD": "date",
    "M_Money_Positions_Long_All": "M_Money_Positions_Long_All",
    "M_Money_Positions_Short_All": "M_Money_Positions_Short_All",
    "Prod_Merc_Positions_Long_All": "Prod_Merc_Positions_Long_All",
    "Prod_Merc_Positions_Short_All": "Prod_Merc_Positions_Short_All",
}


class CFTCSource(BaseSource):
    def __init__(self) -> None:
        CFTC_RAW_DIR.mkdir(parents=True, exist_ok=True)
        # The long and short legs share this one adapter instance and both
        # resolve to the same current-year ZIP. Under the bounded concurrent
        # fetch_all they'd otherwise download and to_parquet() the same file at
        # once - a corrupt-write race. Serialize per-year fetches: the second
        # leg blocks, then reads the cache the first leg just wrote.
        self._year_lock = threading.Lock()

    def fetch(self, cfg: dict, start: str, end: str) -> pd.Series:
        start_year = pd.to_datetime(start).year
        end_year = pd.to_datetime(end).year
        frames = [self._fetch_year(year) for year in range(start_year, end_year + 1)]
        df = pd.concat(frames)
        market_mask = df["market_name"].str.upper().str.contains(cfg["market_name"].upper())
        series = df.loc[market_mask].set_index("date")[cfg["field"]].sort_index()
        series = series[start:end]
        series.name = cfg["field"]
        return series

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=4, max=60))
    def _fetch_year(self, year: int) -> pd.DataFrame:
        cache_path = CFTC_RAW_DIR / f"fut_disagg_{year}.parquet"
        with self._year_lock:
            if cache_path.exists() and self._cache_is_valid(cache_path, year):
                return pd.read_parquet(cache_path)

            response = requests.get(CFTC_URL.format(year=year), timeout=60)
            response.raise_for_status()
            with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                txt_name = [name for name in archive.namelist() if name.endswith(".txt")][0]
                with archive.open(txt_name) as file:
                    raw = pd.read_csv(file, usecols=list(CFTC_COLUMNS.keys()))

            raw = raw.rename(columns=CFTC_COLUMNS)
            raw["date"] = pd.to_datetime(raw["date"], format="%y%m%d").astype("datetime64[ns]")
            for column in list(CFTC_COLUMNS.values())[2:]:
                raw[column] = pd.to_numeric(raw[column], errors="coerce")

            raw.to_parquet(cache_path)
            return raw

    @staticmethod
    def _cache_is_valid(cache_path, year: int) -> bool:
        # Past years are immutable once published - the cache never expires.
        # The current year is re-fetched once its cached copy ages past the TTL.
        if year < pd.Timestamp.now().year:
            return True
        return (time.time() - cache_path.stat().st_mtime) < _CURRENT_YEAR_TTL_SECONDS
