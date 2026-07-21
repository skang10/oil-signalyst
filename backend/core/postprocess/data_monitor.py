import json
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
import yaml

from core.config_paths import DATA_SOURCES_YAML, FRESHNESS_SNAPSHOT
from core.data.registry import DataRegistry
from core.logging import get_logger
from core.models.feature_prep import to_model_matrix
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
# pipeline (scheduler/jobs.py) clears it when new data lands. Mirrors the
# shared _REGISTRY in core/postprocess/signal_charts.py.
_REGISTRY = DataRegistry()

# When the freshest live feed leads the persisted feature matrix by more than
# this many TRADING days, the daily pipeline (scheduler/runner.py) is behind:
# the models are training/scoring on data older than the feeds already offer.
#
# One trading day of slack, not two: the tolerance used to absorb weekends,
# because the lag was counted in calendar days against a calendar-day matrix.
# Now that both sides are business days, a single day of lag is exactly one
# missing trading day - real, not slack - and anything beyond it means a
# pipeline run was skipped.
PIPELINE_LAG_MAX_DAYS = 1

# Freshness lookback: 30 days is enough to catch the most recent print of even
# the weekly sources without refetching full history.
FRESHNESS_LOOKBACK_DAYS = 30

# Hard wall-clock bound (seconds) for the *interactive* fallback fetch used
# only when no snapshot exists yet. Caps a cold page load at seconds instead of
# the ~20min a full serial fetch of all sources would take; slow sources simply
# read as unavailable until the off-path snapshot warm completes.
FRESHNESS_FETCH_TIMEOUT_SECONDS = 30


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


def _load_sources() -> dict:
    with open(DATA_SOURCES_YAML) as f:
        return yaml.safe_load(f).get("sources", {})


def _measure_last_updated(
    as_of: date, sources: dict, timeout: float | None = None
) -> dict[str, str | None]:
    """Live-fetch every source and return the ISO date of its newest
    observation, or None if unavailable.

    This is the expensive part - network I/O across all sources. Callers run it
    off the interactive path (the snapshot warm, `timeout=None`, complete) or
    with a `timeout` bound (the cold-page fallback, seconds, possibly partial).
    """
    start = (as_of - timedelta(days=FRESHNESS_LOOKBACK_DAYS)).isoformat()
    try:
        raw = _REGISTRY.fetch_all(
            start, as_of.isoformat(), source_names=list(sources), timeout=timeout
        )
    except Exception as exc:
        logger.warning("Data source freshness unavailable", extra={"error": str(exc)})
        return {name: None for name in sources}

    measured: dict[str, str | None] = {}
    for name in sources:
        series = raw[name].dropna() if name in raw.columns else pd.Series(dtype=float)
        measured[name] = series.index.max().isoformat() if not series.empty else None
    return measured


def write_freshness_snapshot(as_of: date | None = None) -> dict[str, str | None]:
    """Measure every source's last-updated date live and persist it to disk.

    Runs OFF the interactive request path - fire-and-forget at API startup and
    in the daily pipeline - so the slow full fetch (notably EIA's ~240s HTTP)
    never blocks a page view. `data_source_status` then reads this snapshot in
    milliseconds. Serial/unbounded here so the snapshot is complete.
    """
    as_of = as_of or date.today()
    sources = _load_sources()
    last_updated = _measure_last_updated(as_of, sources)

    # Preserve last-known-good: if a source fails to fetch this round (e.g. the
    # cold startup warm runs before CFTC's first ZIP has cached), don't overwrite
    # a healthy prior timestamp with null - that would flip a fine source to
    # "error" on the page. A genuinely stalled feed still surfaces: its carried
    # timestamp ages against as_of and crosses into "delayed".
    prior = _read_freshness_snapshot() or {}
    for name, value in last_updated.items():
        if value is None and prior.get(name):
            last_updated[name] = prior[name]

    payload = {
        "generated_at": datetime.now().isoformat(),
        "measured_as_of": as_of.isoformat(),
        "last_updated": last_updated,
    }
    try:
        FRESHNESS_SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        FRESHNESS_SNAPSHOT.write_text(json.dumps(payload))
        logger.info(
            "Freshness snapshot written",
            extra={"sources": len(last_updated), "path": str(FRESHNESS_SNAPSHOT)},
        )
    except OSError as exc:
        logger.warning("Could not persist freshness snapshot", extra={"error": str(exc)})
    return last_updated


def _read_freshness_snapshot() -> dict[str, str | None] | None:
    """The persisted `{source: last_updated_iso}` map, or None if no readable
    snapshot exists yet."""
    if not FRESHNESS_SNAPSHOT.exists():
        return None
    try:
        payload = json.loads(FRESHNESS_SNAPSHOT.read_text())
    except (OSError, ValueError) as exc:
        logger.warning("Could not read freshness snapshot", extra={"error": str(exc)})
        return None
    return payload.get("last_updated")


def data_source_status(as_of: date | None = None) -> list[dict]:
    """Per-source freshness status, measured against each source's own expected
    update cadence.

    Reads the persisted freshness snapshot (written off the request path by the
    daily pipeline / startup warm) rather than live-fetching every source on
    each page view - the earlier design put ~20min of cold serial network I/O
    directly on the interactive path. Only the cheap lag/cadence classification
    runs here, recomputed against the caller's `as_of`.

    Each source is judged against its own cadence (see `_max_lag_days`) rather
    than one shared feature-matrix timestamp, so weekly releases and
    closed-market weekends no longer read as false anomalies. When no snapshot
    exists yet, a time-bounded live fetch fills in so the page still answers in
    seconds; the complete snapshot lands shortly after, off the request path.
    """
    as_of = as_of or date.today()
    sources = _load_sources()

    last_updated = _read_freshness_snapshot()
    if last_updated is None:
        last_updated = _measure_last_updated(
            as_of, sources, timeout=FRESHNESS_FETCH_TIMEOUT_SECONDS
        )

    as_of_midnight = datetime.combine(as_of, datetime.min.time())
    statuses = []
    for name, cfg in sources.items():
        iso = last_updated.get(name)
        if not iso:
            statuses.append(
                {"name": name, "status": "error", "lag_hours": None, "last_updated": None}
            )
            continue
        last = datetime.fromisoformat(iso)
        lag_hours = round((as_of_midnight - last).total_seconds() / 3600, 1)
        status = "ok" if lag_hours <= _max_lag_days(cfg) * 24 else "delayed"
        statuses.append(
            {
                "name": name,
                "status": status,
                "lag_hours": lag_hours,
                "last_updated": last.isoformat(),
            }
        )
    return statuses


def model_input_freshness(
    live_status: list[dict] | None = None,
    as_of: date | None = None,
) -> dict:
    """Freshness of the persisted feature matrix the models actually train and
    score on (the Parquet), versus the live feeds.

    Complements `data_source_status` (live feed health) by answering the other
    question - "is the model's input current, and consistent with what training
    saw?" - with a single honest signal: the matrix's as-of date plus how far
    the freshest live feed leads it. When the daily pipeline has not run, the
    feeds stay green while the matrix rots; that gap surfaces as
    `pipeline_behind`. `live_status` is the already-computed
    `data_source_status()` result, reused so the page does not re-fetch.

    Deliberately NOT reported per-source: `DataRegistry._align` forward-fills a
    lagged source within its range, so an engineered feature carries a value on
    dates past the source's true last print - the Parquet cannot recover raw
    per-source freshness (that is precisely what the live panel is for).
    """
    as_of = as_of or date.today()
    matrix = _latest_feature_matrix(as_of)
    if matrix is None or matrix.empty:
        return {"matrix_as_of": None, "pipeline_lag_days": None, "pipeline_behind": False}

    matrix_as_of = matrix.index.max()
    live_dates = [
        pd.Timestamp(row["last_updated"])
        for row in (live_status or [])
        if row.get("last_updated")
    ]
    freshest_live = max(live_dates) if live_dates else None
    # Counted in TRADING days, not calendar days. The matrix is indexed on
    # business days, so a Friday matrix beside a Monday feed is 3 calendar days
    # apart but exactly one trading day behind - measured in calendar days this
    # reported "Behind 3d" every Monday.
    lag_days = (
        int(
            np.busday_count(
                matrix_as_of.date(),
                freshest_live.normalize().date(),
            )
        )
        if freshest_live is not None
        else None
    )
    return {
        "matrix_as_of": matrix_as_of.date().isoformat(),
        "pipeline_lag_days": lag_days,
        "pipeline_behind": lag_days is not None and lag_days > PIPELINE_LAG_MAX_DAYS,
    }


# The returns model's label horizon, in trading days. Used to derive how many
# genuinely independent observations a window holds - mirrors
# build_return_bucket_labels' horizon_trading_days default.
LABEL_HORIZON_TRADING_DAYS = 20


def _split_stats(matrix: pd.DataFrame, start: str, end: str) -> dict:
    window = matrix.loc[start:end]
    if window.empty:
        return {"start": None, "end": None, "rows": 0, "weekday_rows": 0, "effective_n": 0}
    weekday_rows = int((window.index.dayofweek < 5).sum())
    return {
        "start": window.index.min().date().isoformat(),
        "end": window.index.max().date().isoformat(),
        "rows": len(window),
        "weekday_rows": weekday_rows,
        # Overlapping forward-looking labels mean consecutive rows share almost
        # all of their outcome window, so the count that matters for reading any
        # metric is how many NON-overlapping windows fit - and weekend rows are
        # forward-filled duplicates that cannot contribute one.
        "effective_n": weekday_rows // LABEL_HORIZON_TRADING_DAYS,
    }


def training_dataset_summary() -> dict:
    """Shape of the dataset the models are actually fit on.

    The rest of this module reports feed health - is each source arriving, is
    it drifting. None of it answers the questions a modeller asks first: what
    period does the matrix cover, how many rows are there really, and where do
    train/calibration/validation fall. Those gaps hid two things worth seeing:
    a 540-day hole where 2025 should be (which is why a cutoff_date in 2026
    yields a 2-row validation window), and the fact that no calibration set is
    held out at all - calibrate_if_better fits on the validation set it then
    reports against.
    """
    from core.models.trainer import TRAIN_END, TRAIN_START, VAL_END, VAL_START

    try:
        matrix = to_model_matrix(load_features("1990-01-01", "2100-01-01"))
    except FileNotFoundError:
        return {"available": False}
    if matrix.empty:
        return {"available": False}

    gaps = matrix.index.to_series().diff().dt.days
    largest_gap = int(gaps.max()) if gaps.notna().any() else 0
    weekday_rows = int((matrix.index.dayofweek < 5).sum())

    train = _split_stats(matrix, TRAIN_START, TRAIN_END)
    validation = _split_stats(matrix, VAL_START, VAL_END)
    after_val = _split_stats(matrix, str(pd.Timestamp(VAL_END) + pd.Timedelta(days=1)), "2100-01-01")

    return {
        "available": True,
        "matrix": {
            "start": matrix.index.min().date().isoformat(),
            "end": matrix.index.max().date().isoformat(),
            "rows": len(matrix),
            "weekday_rows": weekday_rows,
            # Sources are aligned to a calendar-day index and forward-filled, so
            # weekends are carried-forward duplicates rather than observations.
            "weekend_rows": len(matrix) - weekday_rows,
            "largest_gap_days": largest_gap,
            "largest_gap_at": gaps.idxmax().date().isoformat() if largest_gap else None,
        },
        "splits": [
            {
                "name": "Train",
                # Declared vs actual: TRAIN_START predates the first row, so the
                # window the config claims is not the window that was used.
                "declared_start": TRAIN_START,
                **train,
            },
            {
                "name": "Calibration",
                "declared_start": None,
                "start": None,
                "end": None,
                "rows": 0,
                "weekday_rows": 0,
                "effective_n": 0,
                "warning": "Not held out - the calibrator is fit on the validation set it is then scored against.",
            },
            {"name": "Validation", "declared_start": VAL_START, **validation},
            {"name": "Unused (after validation)", "declared_start": None, **after_val},
        ],
    }
