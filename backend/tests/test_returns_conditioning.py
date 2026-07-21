import numpy as np
import pandas as pd

from core.models.regime import REGIME_CLASSES, REGIME_PROB_COLUMNS, predict_regime_batch
from core.models.returns import append_regime_probs_to_vector


class FakeRegimeModel:
    classes_ = np.array([0, 1, 2, 3])

    def predict_proba(self, x: pd.DataFrame) -> np.ndarray:
        n = len(x)
        return np.tile([0.1, 0.2, 0.3, 0.4], (n, 1))


def test_predict_regime_batch_uses_regime_class_column_order():
    x = pd.DataFrame({"ret_20d": [0.1, 0.2]}, index=[10, 20])

    result = predict_regime_batch(FakeRegimeModel(), x, ["ret_20d"])

    assert list(result.columns) == REGIME_PROB_COLUMNS
    assert list(result.index) == [10, 20]
    assert result.iloc[0].tolist() == [0.1, 0.2, 0.3, 0.4]


def test_append_regime_probs_to_vector_preserves_regime_class_order():
    feature_vector = np.array([1.0, 2.0, 3.0])
    regime_probs = {"R4": 0.4, "R1": 0.1, "R3": 0.3, "R2": 0.2}

    augmented = append_regime_probs_to_vector(feature_vector, regime_probs)

    assert augmented.tolist() == [1.0, 2.0, 3.0, 0.1, 0.2, 0.3, 0.4]
    assert REGIME_CLASSES == ["R1", "R2", "R3", "R4"]
