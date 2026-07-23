"""Regime is a market-state description, not a forecast.

It is deliberately NOT trained alongside eia/returns any more. The dividing
line is whether a thing has an observable future outcome to be scored against:
eia is checked against the inventory change EIA later publishes, returns
against the realized 20-day return - regime was only ever checked against
regime_labels.py's REGIME_TRANSITIONS, a hand-typed table of 17 dates. Scoring
a model against a hardcoded lookup table is not accuracy, so the training
path, its metrics, and its GMM cross-check have been removed.

What remains is inference from the frozen artifact, which still supplies the
dashboard's probability distribution and the SHAP drivers card.
"""

import numpy as np

from core.logging import get_logger
from core.models.common import as_named_row
from core.models.tabpfn_setup import ensure_tabpfn_authenticated

logger = get_logger(__name__)

REGIME_CLASSES = ["R1", "R2", "R3", "R4"]


def decode_regime_probs(classes: np.ndarray, probs: np.ndarray) -> dict:
    result = {label: 0.0 for label in REGIME_CLASSES}
    for class_id, probability in zip(classes, probs, strict=False):
        result[REGIME_CLASSES[int(class_id)]] = round(float(probability), 4)
    return result


def dominant_regime(regime_probs: dict | None) -> str | None:
    """The regime with the highest probability, derived at read time from a
    Prediction's regime_probs JSON. There is no stored dominant_regime column
    - this is the single canonical place that derivation logic lives."""
    if not regime_probs:
        return None
    return max(regime_probs, key=regime_probs.get)


def predict_regime(artifact: dict, features: np.ndarray) -> dict:
    ensure_tabpfn_authenticated()
    model = artifact["model"]
    x = as_named_row(features, artifact["feature_list"])
    probs = model.predict_proba(x)[0]
    return decode_regime_probs(model.classes_, probs)
