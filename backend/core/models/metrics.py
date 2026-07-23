"""Baselines every model metric is judged against, and the deployment gate.

A metric with no baseline is uninterpretable. The regime model reported
`accuracy 0.4548` for months, which reads like "better than a 4-class coin
flip at 0.25" - but its 2024 validation window contained a single class
(R3, 366 days), so the correct reference was "always predict R3" = 1.0, and
the model was 55 points *worse* than a constant. The gate below exists so
that kind of model cannot silently replace a working one.
"""

import numpy as np
import pandas as pd

from core.models.common import multiclass_brier

# Single source of truth - api/routes/models.py and core/models/trainer.py both
# import this rather than keeping their own copies in sync by hand.
PRIMARY_METRIC_KEY = {"eia": "mae", "returns": "brier"}

# Metrics where a larger number is better; everything else improves downward.
HIGHER_IS_BETTER = {"accuracy", "direction_acc"}

# A validation window shorter than this cannot support any honest claim about
# generalization. Overlapping forward-looking labels make the effective sample
# far smaller than the row count (the returns model's 20-trading-day horizon
# means ~250 daily rows carry only ~12 independent observations), so this is a
# floor on obvious degeneracy, not a sufficiency test.
MIN_VAL_ROWS = 60

# The forward-looking label horizon, in trading days. Two rows less than this
# far apart describe overlapping futures, so the count of *independent*
# observations in a window is roughly rows // LABEL_HORIZON_DAYS.
LABEL_HORIZON_DAYS = 20

# Length of the recency diagnostic below.
RECENT_WINDOW_MONTHS = 6


def recent_window_metrics(y_test, score) -> dict | None:
    """Re-score the model on just the last RECENT_WINDOW_MONTHS of the test
    window. A *diagnostic*, never a gate.

    Deliberately not gated on, and the reason is measured rather than assumed.
    Six months is ~110 labeled rows but only ~5 independent observations at a
    20-trading-day horizon, and a block bootstrap of the returns model over
    exactly this window put the model-minus-baseline Brier gap at +0.118 with a
    95% CI of [-0.206, +0.481] - six times wider than the full window's and
    straddling zero, i.e. no evidence of skill either way. On the full test
    window the same model loses to climatology with 96% confidence. Gating on
    six months would therefore have flipped `returns` from correctly blocked to
    deployed, on noise.

    What it is good for: the constant baselines drift with the market, so
    comparing this against the full-window figure shows whether recent
    conditions have moved away from what the model was fit on.

    `score(mask)` returns the metric dict for the masked slice; the caller
    supplies it so this stays model-type agnostic and reuses predictions that
    were already computed, adding no TabPFN calls.
    """
    if len(y_test) == 0 or not isinstance(y_test.index, pd.DatetimeIndex):
        return None
    cutoff = y_test.index.max() - pd.DateOffset(months=RECENT_WINDOW_MONTHS)
    mask = y_test.index >= cutoff
    n_rows = int(mask.sum())
    if n_rows == 0:
        return None
    return {
        **score(mask),
        "window_start": str(cutoff.date()),
        "n_rows": n_rows,
        "effective_n": n_rows // LABEL_HORIZON_DAYS,
    }


def classifier_baselines(y_train, y_val, n_classes: int) -> dict:
    """Majority-class accuracy and climatology Brier for a classification task.

    Climatology = predict the training set's class frequencies, constantly, for
    every validation row. It is the honest "I learned nothing from the features
    but I did learn the base rates" reference. Uses multiclass_brier so the
    one-vs-rest averaging matches classifier_metrics exactly.
    """
    y_val = np.asarray(y_val)
    if len(y_val) == 0:
        return {"accuracy": None, "brier": None}

    train_counts = pd.Series(y_train).value_counts(normalize=True)
    frequencies = np.array([train_counts.get(c, 0.0) for c in range(n_classes)])

    val_counts = pd.Series(y_val).value_counts()
    majority_accuracy = float(val_counts.iloc[0] / len(y_val)) if len(val_counts) else 0.0

    probs = np.tile(frequencies, (len(y_val), 1))
    brier = multiclass_brier(y_val, probs, np.arange(n_classes), n_classes)
    return {"accuracy": round(majority_accuracy, 4), "brier": round(float(brier), 4)}


def regressor_baselines(y_train, y_val) -> dict:
    """MAE of predicting the training mean for every validation row.

    Deliberately train-derived: eia.py's existing `mae_vs_consensus` compares
    against a rolling mean of the validation labels themselves, which is not
    available at prediction time and degrades on short windows (its .fillna(0.0)
    scores the first four rows against a hardcoded zero).
    """
    y_train, y_val = np.asarray(y_train, dtype=float), np.asarray(y_val, dtype=float)
    if len(y_val) == 0 or len(y_train) == 0:
        return {"mae": None}
    return {"mae": round(float(np.mean(np.abs(y_val - float(np.mean(y_train))))), 4)}


def beats_baseline(metric_key: str, value: float | None, baseline: float | None) -> bool | None:
    """None when the comparison cannot be made (either side missing)."""
    if value is None or baseline is None:
        return None
    return value > baseline if metric_key in HIGHER_IS_BETTER else value < baseline


def deployment_gate_criteria() -> list[dict]:
    """Human-readable description of what evaluate_deployment_gate enforces, for
    a read-only UI panel. Kept next to the logic so the two can't drift - the UI
    renders this rather than hardcoding the rules."""
    return [
        {
            "label": "Test window size",
            "rule": f"at least {MIN_VAL_ROWS} rows",
        },
        {
            "label": "Distinct classes",
            "rule": "at least 2 (classifiers only)",
        },
        {
            "label": "Beats baseline",
            "rule": "returns: Brier below climatology · eia: MAE below train-mean",
        },
    ]


def evaluate_deployment_gate(
    model_type: str,
    metrics_val: dict,
    n_val_rows: int,
    n_val_classes: int | None,
) -> dict:
    """Decides whether a freshly trained model may go live automatically.

    Returns {"passed": bool, "reasons": [...]} - stored on ModelVersion.metrics_oos
    (a JSON column, so no migration) and surfaced in the training history UI.
    A blocked model is still persisted, so it can be inspected and, if the
    operator really means it, deployed by hand through deploy_service.
    """
    reasons = []

    if n_val_rows < MIN_VAL_ROWS:
        reasons.append(
            f"Validation window has {n_val_rows} rows, below the {MIN_VAL_ROWS} minimum - "
            "too short to support any claim about generalization."
        )

    if n_val_classes is not None and n_val_classes < 2:
        reasons.append(
            f"Validation set contains only {n_val_classes} distinct class(es) - "
            "accuracy against a single class measures nothing."
        )

    metric_key = PRIMARY_METRIC_KEY.get(model_type)
    if metric_key:
        value = metrics_val.get(metric_key)
        baseline = (metrics_val.get("baseline") or {}).get(metric_key)
        verdict = beats_baseline(metric_key, value, baseline)
        if verdict is False:
            direction = "above" if metric_key in HIGHER_IS_BETTER else "below"
            reasons.append(
                f"{metric_key} {value} did not beat the baseline {baseline} "
                f"(needs to be {direction} it)."
            )

    return {"passed": not reasons, "reasons": reasons}
