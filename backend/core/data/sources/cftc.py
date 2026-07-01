import io
import zipfile

import pandas as pd
import requests
from tenacity import retry, stop_after_attempt, wait_exponential

from core.config_paths import CFTC_RAW_DIR
from core.data.sources.base import BaseSource

CFTC_URL = "https://www.cftc.gov/files/dea/history/fut_disagg_txt_{year}.zip"
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
        if cache_path.exists() and year < pd.Timestamp.now().year:
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
