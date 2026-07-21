from datetime import date

import numpy as np
import pandas as pd

from core.logging import get_logger
from core.models.trainer import TRAIN_END, TRAIN_START, VAL_START, load_features
from db.database import get_db
from db.models import FeatureSnapshot
from features.engine import FeatureEngine

logger = get_logger(__name__)

PSI_BINS = 10
PSI_RECENT_SNAPSHOTS = 90
PSI_RETRAIN_THRESHOLD = 0.20
PSI_MIN_ACTUAL_SAMPLES = 2 * PSI_BINS


# Percentile clip for the bin edges. The reference spans 2012-2023, which
# includes the 2020 negative-oil-price period where pct_change-based features
# blow up (rvol_20d reaches ~12, i.e. 1200% annualised). Left in, those
# outliers stretch the quantile grid so the bulk of the distribution collapses
# into a couple of bins, and any calm recent window then reads as extreme
# drift. Binning on the 1-99 percentile core measures "has recent moved off the
# training core", not "has recent failed to reproduce a once-a-decade tail".
PSI_ROBUST_CLIP = (1, 99)


def population_stability_index(
    reference: np.ndarray, actual: np.ndarray, n_bins: int = PSI_BINS
) -> float:
    """Quantile-binned PSI between a training reference and recent production
    observations for a single feature.

    Two departures from textbook PSI, both to stop it firing on everything when
    the recent window is a calm slice of a multi-regime reference (see
    PSI_ROBUST_CLIP, and the smoothing below):

    - bin edges come from the reference's robust core, not its full range, so a
      once-a-decade outlier doesn't dominate the grid;
    - empty bins are handled with add-one (Laplace) smoothing rather than a
      fixed 1e-4 floor. The old floor made a single empty bin contribute ~0.69
      to PSI regardless of sample size, so a recent window that simply didn't
      reach some training quantiles scored 5-8 mechanically. Smoothing ties the
      empty-bin contribution to how much data there actually is.

    Outer edges are +/-inf so genuinely out-of-range production still registers.
    Returns 0.0 when there aren't enough observations to bin meaningfully.
    """
    reference = reference[~np.isnan(reference)]
    actual = actual[~np.isnan(actual)]
    if len(reference) < n_bins or len(actual) < PSI_MIN_ACTUAL_SAMPLES:
        return 0.0

    lo, hi = np.percentile(reference, PSI_ROBUST_CLIP)
    core = reference[(reference >= lo) & (reference <= hi)]
    if len(core) < n_bins:
        core = reference

    quantiles = np.linspace(0, 1, n_bins + 1)
    bin_edges = np.unique(np.quantile(core, quantiles))
    if len(bin_edges) < 3:
        return 0.0
    bin_edges[0], bin_edges[-1] = -np.inf, np.inf

    ref_counts, _ = np.histogram(reference, bins=bin_edges)
    act_counts, _ = np.histogram(actual, bins=bin_edges)

    # Add-one smoothing: an empty bin costs a share proportional to the sample
    # size, not a fixed floor.
    n_edges = len(bin_edges) - 1
    ref_pct = (ref_counts + 1) / (ref_counts.sum() + n_edges)
    act_pct = (act_counts + 1) / (act_counts.sum() + n_edges)
    return round(float(np.sum((act_pct - ref_pct) * np.log(act_pct / ref_pct))), 4)


def compute_psi_scores(reference_df: pd.DataFrame, recent_df: pd.DataFrame) -> dict[str, float]:
    """PSI per column common to both frames (the active engineered features)."""
    scores = {}
    for name in reference_df.columns:
        if name not in recent_df.columns:
            continue
        scores[name] = population_stability_index(
            reference_df[name].to_numpy(dtype=float),
            recent_df[name].to_numpy(dtype=float),
        )
    return scores


def compute_current_psi() -> dict[str, float]:
    """PSI of the recent feature-matrix tail against the training window.

    Both sides come from the Parquet matrix. This used to read "recent" from
    the FeatureSnapshot DB table, which the daily pipeline appends one row per
    day - in practice it holds only a handful of rows, far below
    PSI_MIN_ACTUAL_SAMPLES, so population_stability_index bailed to 0.0 and
    every feature reported no drift. The matrix already carries thousands of
    business-day rows; its last PSI_RECENT_SNAPSHOTS are the honest "recent
    production" sample. Same architecture fix already made for stress_test,
    the trader fields, and the data monitor.

    Fails soft: returns {} rather than raising into a monitoring caller.
    """
    try:
        feature_names = [f["name"] for f in FeatureEngine().features]
        reference_df = load_features(TRAIN_START, TRAIN_END)[feature_names]
        matrix = load_features(VAL_START, str(date.today()))
        recent_df = matrix[feature_names].tail(PSI_RECENT_SNAPSHOTS)
        if recent_df.empty:
            return {}
        return compute_psi_scores(reference_df, recent_df)
    except Exception as exc:
        logger.warning("PSI computation failed", extra={"error": str(exc)})
        return {}


async def compute_and_store_psi(snapshot_id: int) -> dict[str, float]:
    """Compute current PSI and persist it on the given FeatureSnapshot row, so
    the daily run keeps a per-day historical record. Display reads live via
    compute_current_psi()."""
    scores = compute_current_psi()
    if scores:
        async with get_db() as db:
            snapshot = await db.get(FeatureSnapshot, snapshot_id)
            if snapshot:
                snapshot.psi_scores = scores
                db.add(snapshot)
    return scores
