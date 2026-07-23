import numpy as np
import pandas as pd

from core.data.registry import DataRegistry
from core.models.regime_labels import build_regime_series


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



