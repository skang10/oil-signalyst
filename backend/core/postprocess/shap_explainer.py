import numpy as np
import pandas as pd
import shap

from core.logging import get_logger
from core.models.common import as_named_row

logger = get_logger(__name__)

SHAP_NSAMPLES = 100


def _named_predict_proba(model, feature_list: list[str]):
    """Wraps model.predict_proba so SHAP's internal bare-ndarray calls still
    carry fit-time column names (TabPFN Client validates fit/predict columns
    match by name, unlike positional sklearn estimators)."""

    def _call(x):
        if not isinstance(x, pd.DataFrame):
            x = pd.DataFrame(x, columns=feature_list)
        return model.predict_proba(x)

    return _call


def explain_prediction(artifact: dict, feature_vector: np.ndarray) -> dict:
    """Normalized absolute feature contributions for one prediction.

    Uses a small capped background sample and nsamples budget since each
    KernelExplainer evaluation round-trips to the hosted TabPFN model.
    Fails soft (returns {}) on any error - SHAP quality/availability should
    never block report generation.
    """
    background = artifact.get("shap_background")
    model = artifact.get("model")
    feature_list = artifact.get("feature_list")

    if background is None or model is None or not feature_list:
        return {}

    try:
        x = as_named_row(feature_vector, feature_list)
        explainer = shap.KernelExplainer(_named_predict_proba(model, feature_list), background)
        raw_values = explainer.shap_values(x, nsamples=SHAP_NSAMPLES, silent=True)
        # (1, n_features, n_classes) for multiclass predict_proba outputs.
        per_feature = np.abs(raw_values[0]).mean(axis=-1)
        total = per_feature.sum()
        if total <= 0:
            return {}
        normalized = per_feature / total
        return {
            name: round(float(value), 4)
            for name, value in zip(feature_list, normalized, strict=True)
        }
    except Exception as exc:
        logger.warning(
            "SHAP explanation failed, returning empty contributions", extra={"error": str(exc)}
        )
        return {}
