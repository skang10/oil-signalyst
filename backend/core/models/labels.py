import numpy as np
import pandas as pd

from core.data.registry import DataRegistry
from core.models.regime_labels import build_regime_series

RETURN_BIN_LABELS = ["lt_minus10", "neg_10_0", "pos_0_10", "gt_10"]
RETURN_BINS = [-np.inf, -0.10, 0.0, 0.10, np.inf]


def build_regime_labels(start: str, end: str) -> pd.Series:
    return build_regime_series(start, end)


def build_eia_labels(
    start: str,
    end: str,
    registry: DataRegistry | None = None,
) -> pd.Series:
    registry = registry or DataRegistry()
    crude = registry.fetch("crude_inventory", start, end).dropna().sort_index()
    if crude.empty:
        return pd.Series(dtype=float)

    published = crude[crude.ne(crude.shift())]
    # EIA reports crude_inventory (PET.WCRSTUS1.W) in thousand barrels; divide
    # by 1000 so the model trains/predicts directly in million barrels, the
    # unit every consumer (report, UI, MAE metric) expects.
    changes = published.diff() / 1000
    next_change = changes.shift(-1).dropna()
    # Business days, matching the index DataRegistry now aligns every source
    # onto - a calendar-day index here would put labels on rows the feature
    # matrix no longer has.
    daily_index = pd.date_range(start, end, freq="B")
    return next_change.reindex(daily_index, method="bfill").rename("eia_change")


def build_return_bucket_labels(
    start: str,
    end: str,
    horizon_trading_days: int = 20,
    registry: DataRegistry | None = None,
) -> pd.Series:
    registry = registry or DataRegistry()
    wti = registry.fetch("wti", start, end).dropna().sort_index()
    if len(wti) <= horizon_trading_days:
        return pd.Series(dtype=int)

    forward = wti.shift(-horizon_trading_days) / wti - 1
    binned = pd.cut(forward, bins=RETURN_BINS, labels=range(len(RETURN_BIN_LABELS)))
    return binned.dropna().astype(int).rename("return_bucket")


def return_bucket_for_value(actual_return: float) -> str:
    if actual_return < -0.10:
        return "lt_minus10"
    if actual_return < 0.0:
        return "neg_10_0"
    if actual_return < 0.10:
        return "pos_0_10"
    return "gt_10"

