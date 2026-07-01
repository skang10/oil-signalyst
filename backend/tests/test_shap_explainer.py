import numpy as np
import pandas as pd

from core.postprocess.shap_explainer import explain_prediction


class FakeModel:
    def predict_proba(self, x: pd.DataFrame) -> np.ndarray:
        # Deterministic, feature-0-dominant probabilities so SHAP attributes
        # most of the contribution to the first feature.
        n = len(x)
        base = np.tile([0.7, 0.1, 0.1, 0.1], (n, 1))
        shift = (x.iloc[:, 0].to_numpy() * 0.2).reshape(-1, 1)
        return np.clip(base + np.hstack([shift, -shift / 3, -shift / 3, -shift / 3]), 0, 1)


class BrokenModel:
    def predict_proba(self, x: pd.DataFrame) -> np.ndarray:
        raise RuntimeError("hosted API unavailable")


def _background() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    return pd.DataFrame(rng.random((15, 3)), columns=["a", "b", "c"])


def test_explain_prediction_returns_normalized_contributions():
    artifact = {
        "model": FakeModel(),
        "feature_list": ["a", "b", "c"],
        "shap_background": _background(),
    }

    result = explain_prediction(artifact, np.array([1.0, 0.5, 0.2]))

    assert set(result.keys()) == {"a", "b", "c"}
    assert abs(sum(result.values()) - 1.0) < 1e-6
    assert result["a"] == max(result.values())


def test_explain_prediction_fails_soft_on_model_error():
    artifact = {
        "model": BrokenModel(),
        "feature_list": ["a", "b", "c"],
        "shap_background": _background(),
    }

    result = explain_prediction(artifact, np.array([1.0, 0.5, 0.2]))

    assert result == {}


def test_explain_prediction_fails_soft_when_background_missing():
    artifact = {"model": FakeModel(), "feature_list": ["a", "b", "c"]}

    result = explain_prediction(artifact, np.array([1.0, 0.5, 0.2]))

    assert result == {}
