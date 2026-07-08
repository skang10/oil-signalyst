from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf

from core.cache import DataFetchCache
from core.data.registry import DataRegistry
from core.logging import get_logger

logger = get_logger(__name__)

# futures_curve doesn't go through DataRegistry (see its docstring below),
# so it gets its own small cache to keep its two batched yfinance downloads
# off every request.
_futures_cache = DataFetchCache(ttl_seconds=1800)

CHART_HISTORY_DAYS = 548  # ~18 months


def _date_range() -> tuple[str, str]:
    start = (datetime.today() - timedelta(days=CHART_HISTORY_DAYS)).strftime("%Y-%m-%d")
    end = datetime.today().strftime("%Y-%m-%d")
    return start, end


def _aligned(*series: pd.Series) -> pd.DataFrame:
    """Inner-join named Series on their shared date index, dropping rows where any side is missing."""
    return pd.concat(series, axis=1).dropna()


def fetch_wti_price_history() -> list[dict]:
    """Daily WTI closing price, last 18 months."""
    start, end = _date_range()
    series = DataRegistry().fetch("wti", start, end).dropna()
    return [{"date": str(d.date()), "price": round(float(v), 2)} for d, v in series.items()]


def fetch_brent_wti_spread() -> list[dict]:
    """Brent - WTI daily spread, last 18 months."""
    start, end = _date_range()
    registry = DataRegistry()
    brent = registry.fetch("brent", start, end)
    wti = registry.fetch("wti", start, end)
    df = _aligned(brent.rename("brent"), wti.rename("wti"))
    return [
        {"date": str(d.date()), "spread": round(float(row.brent - row.wti), 2)} for d, row in df.iterrows()
    ]


def fetch_eia_inventory() -> list[dict]:
    """
    US crude oil weekly inventory, last 18 months, in million barrels
    (crude_inventory is EIA series PET.WCRSTUS1.W, reported in thousand
    barrels - convert here, same /1000 convention as
    core/models/labels.py::build_eia_labels()).

    Rolling 5yr avg +/- 1 std band is computed from the raw series itself
    over a 5-year lookback, not the engineered crude_inv_dev feature - that
    feature is a seasonal *deviation* (config/features.yaml: transform:
    seasonal_dev), a different unit/semantic than an absolute
    million-barrel level band.
    """
    _, end = _date_range()
    five_year_start = (datetime.today() - timedelta(days=365 * 5 + 30)).strftime("%Y-%m-%d")
    history = (DataRegistry().fetch("crude_inventory", five_year_start, end).dropna() / 1000).sort_index()
    if history.empty:
        return []
    avg, std = float(history.mean()), float(history.std())

    cutoff = pd.Timestamp(history.index.max()) - pd.DateOffset(days=CHART_HISTORY_DAYS)
    recent = history[history.index >= cutoff]
    return [
        {
            "date": str(d.date()),
            "value": round(float(v), 2),
            "avg": round(avg, 2),
            "upper": round(avg + std, 2),
            "lower": round(avg - std, 2),
        }
        for d, v in recent.items()
    ]


def fetch_futures_curve() -> dict:
    """
    WTI futures curve: the next 10 sequential delivery-month contracts,
    each one's current price vs. its own price ~3 months ago (same 10
    contracts both times, showing how the curve shape/level evolved - not
    a different set of maturities, which is what naively reusing the same
    ticker-construction logic for "now" and "3 months ago" produced before:
    contract month codes are CME futures codes (F=Jan, G=Feb, ... but only
    F-V, i.e. Jan-Oct, were listed), so for any date past October that list
    is already-expired contracts, and "3 months ago" only gets a different
    year suffix when it actually crosses a year boundary - most of the
    year, both endpoints resolved to the exact same tickers.

    Uses yfinance directly since there's no DataRegistry-configured source
    for a multi-contract point-in-time snapshot (config/data_sources.yaml
    only has single continuous series).
    """
    cache_key = f"futures_curve:{datetime.today().date()}"
    cached = _futures_cache.get(cache_key)
    if cached is not None:
        return cached

    month_codes = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"]
    today = datetime.today()
    tickers = []
    for i in range(10):
        month_index = today.month - 1 + i
        year = today.year + month_index // 12
        code = month_codes[month_index % 12]
        tickers.append(f"CL{code}{str(year)[-2:]}.NYM")

    def _last_closes(start: str, end: str) -> dict[str, float | None]:
        """One batched multi-ticker download (yfinance fetches the contracts
        concurrently) -> each ticker's last daily close in the window, or None
        if it has no quote (e.g. an expired front month). Replaces 20 sequential
        per-ticker calls (~9s -> ~3s); crucially, one delisted contract's 404
        retries no longer serialize in front of the other nine. "Today" is the
        latest close rather than the intraday last price - consistent with the
        3m-ago basis, and the live WTI price is served separately by the ticker.
        """
        try:
            data = yf.download(
                tickers, start=start, end=end,
                progress=False, auto_adjust=True, threads=True,
            )
        except Exception as exc:
            logger.warning("Futures curve download failed", extra={"error": str(exc)})
            return {t: None for t in tickers}
        if data is None or data.empty:
            return {t: None for t in tickers}
        close = data["Close"] if isinstance(data.columns, pd.MultiIndex) else data[["Close"]]
        prices: dict[str, float | None] = {}
        for ticker in tickers:
            try:
                col = close[ticker].dropna() if ticker in close.columns else pd.Series(dtype=float)
                prices[ticker] = round(float(col.iloc[-1]), 2) if not col.empty else None
            except Exception:
                prices[ticker] = None
        return prices

    target = today - timedelta(days=90)
    current = _last_closes(
        (today - timedelta(days=10)).strftime("%Y-%m-%d"),
        (today + timedelta(days=1)).strftime("%Y-%m-%d"),
    )
    ago = _last_closes(
        (target - timedelta(days=5)).strftime("%Y-%m-%d"),
        (target + timedelta(days=5)).strftime("%Y-%m-%d"),
    )
    labels = [f"M{i + 1}" for i in range(len(tickers))]
    result = {
        "labels": labels,
        "today": [current[t] for t in tickers],
        "ago_3m": [ago[t] for t in tickers],
    }
    _futures_cache.set(cache_key, result)
    return result


def fetch_ovx_vix() -> list[dict]:
    """OVX and VIX daily, last 18 months."""
    start, end = _date_range()
    registry = DataRegistry()
    ovx = registry.fetch("ovx", start, end)
    vix = registry.fetch("vix", start, end)
    df = _aligned(ovx.rename("ovx"), vix.rename("vix"))
    return [
        {"date": str(d.date()), "ovx": round(float(row.ovx), 1), "vix": round(float(row.vix), 1)}
        for d, row in df.iterrows()
    ]


def fetch_cot_net() -> list[dict]:
    """
    Real CFTC speculative net position (managed-money long minus short),
    weekly. This project already ingests both legs
    (cot_wti_spec_long/cot_wti_spec_short, config/data_sources.yaml,
    type: cftc) for the ML pipeline - reuse them here rather than
    fabricating a proxy from price momentum, which would render as if it
    were real positioning data when it isn't.
    """
    start, end = _date_range()
    registry = DataRegistry()
    long_pos = registry.fetch("cot_wti_spec_long", start, end)
    short_pos = registry.fetch("cot_wti_spec_short", start, end)
    df = _aligned(long_pos.rename("long"), short_pos.rename("short"))
    return [
        {"date": str(d.date()), "net_k": round(float(row.long - row.short) / 1000, 1)}
        for d, row in df.iterrows()
    ]
