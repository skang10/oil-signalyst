"""The constant predictors the deployment gate measures against, packaged so
they can also *serve* production.

The gate blocks a model that loses to these. Before this existed, a blocked
model left production holding whatever was there before - or, if someone reached
for the manual override in deploy_service, the blocked model itself. That is how
`returns` came to be live at -15.3% skill: worse than a predictor that ignores
every feature.

Making the baseline deployable closes the loop. The gate says "must beat the
baseline", this says "and if nothing does, run the baseline" - together they give
production a floor it cannot fall through.

It deliberately implements the same duck-typed surface TabPFN's estimator
exposes (`predict`), so a baseline artifact travels the identical
ModelRegistry -> joblib -> predict_eia path with no special-casing anywhere
downstream. The one place that must know is the SHAP explainer, which skips a
baseline rather than spending a hundred round trips to prove a constant
predictor has no feature contributions.
"""

import numpy as np

from core.models.metrics import PRIMARY_METRIC_KEY, skill_score

# Marks a ModelVersion as baseline-served. Lives in metrics_oos (a JSON column,
# so no migration) alongside deployment_gate, and is echoed by the status route.
BASELINE_FLAG = "is_baseline"



class ConstantRegressor:
    """Predicts the training mean for every row."""

    def __init__(self, value: float):
        self.value_ = float(value)

    def predict(self, x) -> np.ndarray:
        return np.full(len(x), self.value_)


def build_baseline_model(model_type: str, train_y, test_y, n_classes: int | None = None):
    """The baseline for `model_type`, plus its metrics on the test window.

    Its primary metric equals the baseline entry by construction, so skill is
    exactly 0 - which is the point: it is the floor, not an improvement. Storing
    both makes that self-evident in the UI rather than asserted here.
    """
    del n_classes  # only the eia regressor remains
    metric_key = PRIMARY_METRIC_KEY[model_type]

    value = float(np.mean(np.asarray(train_y, dtype=float)))
    model = ConstantRegressor(value)
    y_test = np.asarray(test_y, dtype=float)
    score = round(float(np.mean(np.abs(y_test - value))), 4)
    residuals = y_test - value
    metrics = {
        metric_key: score,
        "baseline": {metric_key: score},
        # Same fields a trained eia model reports, so the report renders a
        # baseline identically instead of special-casing it.
        "direction_acc": round(float(np.mean(np.sign(y_test) == np.sign(value))), 4),
        "residual_p10": round(float(np.percentile(residuals, 10)), 4),
        "residual_p90": round(float(np.percentile(residuals, 90)), 4),
        BASELINE_FLAG: True,
    }
    # Recorded rather than hardcoded so a change to skill_score shows up here too.
    metrics["skill"] = skill_score(metric_key, score, score)
    return model, metrics


def is_baseline_version(metrics_oos: dict | None) -> bool:
    """For a ModelVersion row (the DB side)."""
    return bool((metrics_oos or {}).get(BASELINE_FLAG))


def is_baseline_artifact(artifact: dict | None) -> bool:
    """For a loaded artifact (the serving side).

    Deliberately an isinstance check on the estimator that will actually produce
    the prediction, rather than a flag stored beside it - the two cannot drift
    apart, and a baseline artifact loaded from any path is recognised.
    """
    model = (artifact or {}).get("model")
    return isinstance(model, ConstantRegressor)
