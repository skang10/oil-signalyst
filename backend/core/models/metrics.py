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


# Single source of truth - api/routes/models.py and core/models/trainer.py both
# import this rather than keeping their own copies in sync by hand.
PRIMARY_METRIC_KEY = {"eia": "mae"}

# Metrics where a larger number is better; everything else improves downward.
HIGHER_IS_BETTER = {"accuracy", "direction_acc"}

# A validation window shorter than this cannot support any honest claim about
# generalization. It is a floor on obvious degeneracy, not a sufficiency test -
# see ROWS_PER_INDEPENDENT_OBSERVATION for why the row count overstates things.
MIN_VAL_ROWS = 60

# Daily rows per genuinely independent observation.
#
# EIA publishes weekly, and build_eia_labels broadcasts each week's change onto
# every business day of that week - so five consecutive rows carry the SAME
# label and only differ in their features. A 400-row test window is really ~80
# weekly events. (This was 20 while the 20-trading-day returns model existed,
# which is the wrong divisor for a weekly target.)
ROWS_PER_INDEPENDENT_OBSERVATION = 5

# Length of the recency diagnostic below.
RECENT_WINDOW_MONTHS = 6


def recent_window_metrics(y_test, score) -> dict | None:
    """Re-score the model on just the last RECENT_WINDOW_MONTHS of the test
    window. A *diagnostic*, never a gate.

    Deliberately not gated on, and the reason was measured rather than assumed.
    Six months of daily rows is only ~26 independent weekly EIA prints, and a
    block bootstrap over exactly this window (on the returns model, when it
    existed) produced a model-minus-baseline interval six times wider than the
    full window's and straddling zero - no evidence of skill either way, while
    the full window was decisive. Gating on a short window flips verdicts on
    noise.

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
        "effective_n": n_rows // ROWS_PER_INDEPENDENT_OBSERVATION,
    }




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


def skill_score(metric_key: str, value: float | None, baseline: float | None) -> float | None:
    """How much of the baseline's error the model actually removed.

    0 = no better than the constant baseline, 1 = perfect, negative = worse than
    predicting the base rates. The point of expressing it this way is that it is
    comparable ACROSS evaluation windows, which the raw metric is not: every
    model version is scored on its own test window (2025 -> its training date),
    and those windows differ in difficulty. The baseline absorbs that difficulty,
    because it is rescored on the same window - so dividing by it cancels most of
    the window effect out.

    Concretely, the eia model went from MAE 5.1461 to 5.1038 across two versions,
    which reads as a 0.8% improvement. But its baseline fell from 5.1704 to
    5.1402 over the same pair, i.e. the newer window was simply easier. In skill
    terms the gain is +0.47% -> +0.71%, so roughly two thirds of the apparent
    improvement was the window, not the model.
    """
    if value is None or baseline is None:
        return None
    if metric_key in HIGHER_IS_BETTER:
        # Bounded-[0,1] metrics (accuracy): the share of the achievable headroom.
        return None if baseline >= 1 else round((value - baseline) / (1 - baseline), 4)
    return None if baseline == 0 else round(1 - value / baseline, 4)


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
            "label": "Beats baseline",
            "rule": "eia: MAE below the train-mean constant",
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
