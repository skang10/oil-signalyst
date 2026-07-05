from datetime import date, datetime, timedelta

import pandas as pd
import yaml

from core.config_paths import DATA_SOURCES_YAML
from core.data.registry import DataRegistry
from core.logging import get_logger
from core.models.trainer import load_features

logger = get_logger(__name__)

FEATURE_COVERAGE_WINDOW = 7
FEATURE_COVERAGE_MIN_RATE = 0.95

# Per-source freshness tolerance (calendar days). A source is "delayed" only
# when its newest observation is older than the cadence it is *expected* to
# update on - a daily market series should carry through the last completed
# trading day (a few days covers a weekend plus a market holiday), while
# weekly EIA/CFTC releases legitimately trail by up to their cadence plus a
# release delay, so a week-old COT print is current, not delayed. Individual
# sources override via `max_lag_days` in data_sources.yaml (e.g. FRED's broad
# dollar index publishes on a lagged weekly H.10 schedule despite freq: D).
DAILY_MAX_LAG_DAYS = 4
WEEKLY_MAX_LAG_DAYS = 14

# Shared across requests so the registry's 4h TTL cache spares the Data
# Monitor page a full live re-fetch of every source on each view; the daily
# pipeline (scripts/daily_update.py) clears it when new data lands. Mirrors
# the shared _REGISTRY in core/postprocess/signal_charts.py.
_REGISTRY = DataRegistry()


def _max_lag_days(cfg: dict) -> int:
    override = cfg.get("max_lag_days")
    if override is not None:
        return int(override)
    return WEEKLY_MAX_LAG_DAYS if cfg.get("freq") == "W" else DAILY_MAX_LAG_DAYS


def _latest_feature_matrix(as_of: date | None = None) -> pd.DataFrame | None:
    """Loads the trailing window of the feature Parquet matrix (backfilled
    and kept current by the daily pipeline appending each day's row) rather
    than FeatureSnapshot, which is too sparse in practice - the same
    architecture mismatch found and fixed for stress_test.py and the G1
    trader fields.
    """
    as_of = as_of or date.today()
    try:
        start = as_of - timedelta(days=365)
        return load_features(str(start), str(as_of))
    except Exception as exc:
        logger.warning("Feature matrix unavailable for monitoring", extra={"error": str(exc)})
        return None


def feature_coverage_7d(as_of: date | None = None) -> float:
    """Fraction of active features with < 5% missing over the last 7 rows
    of the feature matrix."""
    matrix = _latest_feature_matrix(as_of)
    if matrix is None or matrix.empty:
        return 1.0
    recent = matrix.tail(FEATURE_COVERAGE_WINDOW)
    if recent.empty:
        return 1.0
    covered = (recent.notna().mean() >= FEATURE_COVERAGE_MIN_RATE).sum()
    return round(float(covered / len(recent.columns)), 4)


def feature_missing_rates(as_of: date | None = None) -> list[dict]:
    """Per-feature missing rate (%) over the trailing coverage window, for
    the Data Monitor page's per-feature bar list."""
    matrix = _latest_feature_matrix(as_of)
    if matrix is None or matrix.empty:
        return []
    recent = matrix.tail(FEATURE_COVERAGE_WINDOW)
    if recent.empty:
        return []
    missing = (1 - recent.notna().mean()) * 100
    return [
        {"name": name, "pct": round(float(pct), 1)}
        for name, pct in missing.sort_values(ascending=False).items()
    ]


def data_source_status(as_of: date | None = None) -> list[dict]:
    """Per-source freshness status, measured against each source's own
    expected update cadence.

    Reads the live DataRegistry (shared 4h TTL cache) rather than the single
    engineered feature-matrix timestamp: the matrix tail is gated by whichever
    source lags most - a weekly, holiday-delayed CFTC/COT print would drag
    every daily market source into a false "delayed" state even while WTI,
    inventories and vol are current. Each source is now judged against its own
    cadence (see `_max_lag_days`), so weekly releases and closed-market
    weekends no longer read as anomalies.
    """
    as_of = as_of or date.today()
    with open(DATA_SOURCES_YAML) as f:
        sources = yaml.safe_load(f).get("sources", {})

    as_of_midnight = datetime.combine(as_of, datetime.min.time())
    # 30 days is enough to see the most recent print of even the weekly
    # sources without refetching full history on every page view.
    start = (as_of - timedelta(days=30)).isoformat()
    try:
        raw = _REGISTRY.fetch_all(start, as_of.isoformat(), source_names=list(sources))
    except Exception as exc:
        logger.warning("Data source freshness unavailable", extra={"error": str(exc)})
        return [
            {"name": name, "status": "error", "lag_hours": None, "last_updated": None}
            for name in sources
        ]

    statuses = []
    for name, cfg in sources.items():
        series = raw[name].dropna() if name in raw.columns else pd.Series(dtype=float)
        if series.empty:
            statuses.append(
                {"name": name, "status": "error", "lag_hours": None, "last_updated": None}
            )
            continue
        last_updated = series.index.max().to_pydatetime()
        lag_hours = round((as_of_midnight - last_updated).total_seconds() / 3600, 1)
        status = "ok" if lag_hours <= _max_lag_days(cfg) * 24 else "delayed"
        statuses.append(
            {
                "name": name,
                "status": status,
                "lag_hours": lag_hours,
                "last_updated": last_updated.isoformat(),
            }
        )
    return statuses
