from core.market.fetcher import (
    fetch_brent_wti_spread,
    fetch_cot_net,
    fetch_eia_inventory,
    fetch_futures_curve,
    fetch_ovx_vix,
    fetch_wti_price_history,
)

# No per-series TTL table needed - DataRegistry.fetch() already caches
# in-memory for 4h (core/cache.py::DataFetchCache), keyed by
# f"{source}:{start}:{end}". Since every fetcher below recomputes its date
# range from "now" on each call, the cache key rotates daily on its own.
SERIES: dict[str, callable] = {
    "wti_price": fetch_wti_price_history,
    "brent_spread": fetch_brent_wti_spread,
    "inventory": fetch_eia_inventory,
    "futures_curve": fetch_futures_curve,
    "ovx_vix": fetch_ovx_vix,
    "cot_net": fetch_cot_net,
}
