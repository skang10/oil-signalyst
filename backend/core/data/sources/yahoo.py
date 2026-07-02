import pandas as pd
import yfinance as yf
from tenacity import retry, stop_after_attempt, wait_exponential

from core.data.sources.base import BaseSource


class YahooSource(BaseSource):
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=4, max=60))
    def fetch(self, cfg: dict, start: str, end: str) -> pd.Series:
        data = yf.download(
            cfg["ticker"],
            start=start,
            end=end,
            progress=False,
            auto_adjust=True,
            threads=False,
        )
        if data.empty:
            raise ValueError(f"No data returned for {cfg['ticker']}")

        field = cfg["field"]
        if isinstance(data.columns, pd.MultiIndex):
            series = data[field][cfg["ticker"]]
        else:
            series = data[field]
        # Both branches above already select a single column, i.e. a Series -
        # unconditional .squeeze() used to collapse a single-row *Series*
        # (a narrow date range, e.g. a recent cutoff_date) down to a bare
        # scalar, which has no .index. Only squeeze if it's still a
        # DataFrame (defensive fallback for shapes not covered above).
        if isinstance(series, pd.DataFrame):
            series = series.squeeze()
        series.index = pd.to_datetime(series.index).astype("datetime64[ns]")
        series.name = cfg["ticker"]
        return series
