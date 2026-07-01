import numpy as np
import pandas as pd
from sqlalchemy import select

from core.logging import get_logger
from core.models.trainer import TRAIN_END, TRAIN_START, load_features
from db.database import get_db
from db.models import FeatureSnapshot
from features.engine import FeatureEngine

logger = get_logger(__name__)

PSI_BINS = 10
PSI_RECENT_SNAPSHOTS = 90
PSI_RETRAIN_THRESHOLD = 0.20
PSI_MIN_ACTUAL_SAMPLES = 2 * PSI_BINS


def population_stability_index(
    reference: np.ndarray, actual: np.ndarray, n_bins: int = PSI_BINS
) -> float:
    """Standard quantile-binned PSI between a training reference and recent
    production observations for a single feature.

    Outer bin edges extend to +/-inf so production values outside the
    training range still count as drift instead of being silently dropped.
    Requires a minimum number of recent observations: with too few actual
    samples, most of the 10 bins are empty by construction and PSI blows up
    to a meaningless, misleadingly large number rather than reflecting real
    drift - this matters most in early production ramp-up, before enough
    daily FeatureSnapshot rows have accumulated.
    """
    reference = reference[~np.isnan(reference)]
    actual = actual[~np.isnan(actual)]
    if len(reference) < n_bins or len(actual) < PSI_MIN_ACTUAL_SAMPLES:
        return 0.0

    quantiles = np.linspace(0, 1, n_bins + 1)
    bin_edges = np.unique(np.quantile(reference, quantiles))
    if len(bin_edges) < 3:
        return 0.0
    bin_edges[0], bin_edges[-1] = -np.inf, np.inf

    ref_counts, _ = np.histogram(reference, bins=bin_edges)
    act_counts, _ = np.histogram(actual, bins=bin_edges)
    ref_pct = ref_counts / ref_counts.sum()
    act_pct = act_counts / act_counts.sum()

    eps = 1e-4
    ref_pct = np.where(ref_pct == 0, eps, ref_pct)
    act_pct = np.where(act_pct == 0, eps, act_pct)
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


async def compute_and_store_psi(snapshot_id: int) -> dict[str, float]:
    """Computes PSI for the active features and persists it on the given
    FeatureSnapshot row. Fails soft: logs and returns {} rather than blocking
    the daily pipeline over a monitoring concern.
    """
    try:
        feature_names = [f["name"] for f in FeatureEngine().features]
        reference_df = load_features(TRAIN_START, TRAIN_END)[feature_names]

        async with get_db() as db:
            rows = (
                await db.execute(
                    select(FeatureSnapshot.features)
                    .order_by(FeatureSnapshot.date.desc())
                    .limit(PSI_RECENT_SNAPSHOTS)
                )
            ).all()
        recent_df = pd.DataFrame([r[0] for r in rows if r[0]])
        if recent_df.empty:
            return {}

        scores = compute_psi_scores(reference_df, recent_df)

        async with get_db() as db:
            snapshot = await db.get(FeatureSnapshot, snapshot_id)
            if snapshot:
                snapshot.psi_scores = scores
                db.add(snapshot)
        return scores
    except Exception as exc:
        logger.warning("PSI computation failed", extra={"error": str(exc)})
        return {}
