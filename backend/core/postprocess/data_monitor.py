from datetime import date, datetime, timedelta

import pandas as pd
import yaml

from core.config_paths import DATA_SOURCES_YAML
from core.logging import get_logger
from core.models.trainer import load_features

logger = get_logger(__name__)

FEATURE_COVERAGE_WINDOW = 7
FEATURE_COVERAGE_MIN_RATE = 0.95
MAX_LAG_HOURS_DEFAULT = 26


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


def data_source_status(as_of: date | None = None) -> list[dict]:
    """Per-source freshness status.

    This project doesn't persist a per-source raw cache (DataRegistry only
    holds an in-memory TTL cache; there's no data/raw/{source}.parquet file
    per source the way the original spec sketch assumed). The only real,
    cheap freshness signal available is the engineered feature matrix's most
    recent row, which every active source feeds into - so every source is
    reported against that single shared pipeline-freshness signal rather
    than genuinely independent per-source timestamps.
    """
    as_of = as_of or date.today()
    with open(DATA_SOURCES_YAML) as f:
        sources = yaml.safe_load(f).get("sources", {})

    matrix = _latest_feature_matrix(as_of)
    if matrix is None or matrix.empty:
        return [
            {"name": name, "status": "error", "lag_hours": None, "last_updated": None}
            for name in sources
        ]

    last_updated = matrix.index.max().to_pydatetime()
    as_of_midnight = datetime.combine(as_of, datetime.min.time())
    lag_hours = round((as_of_midnight - last_updated).total_seconds() / 3600, 1)
    status = "ok" if lag_hours <= MAX_LAG_HOURS_DEFAULT else "delayed"

    return [
        {
            "name": name,
            "status": status,
            "lag_hours": lag_hours,
            "last_updated": last_updated.isoformat(),
        }
        for name in sources
    ]
