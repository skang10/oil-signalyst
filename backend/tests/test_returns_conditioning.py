"""The returns model no longer takes regime probabilities as input.

This file used to assert the opposite - that p_R1..p_R4 were appended in
REGIME_CLASSES order. That conditioning was removed because the regime model
was fit on hand-drawn hindsight labels and TabPFN memorizes its training rows,
so the returns model trained on near-perfect regime one-hots and then met
~45%-accurate ones in production.
"""

import numpy as np
import pandas as pd

from core.models.labels import RETURN_BIN_LABELS
from core.models.metrics import classifier_baselines
from core.models.returns import predict_returns


class FakeReturnsModel:
    classes_ = np.array([0, 1, 2, 3])

    def __init__(self):
        self.seen_columns = None

    def predict_proba(self, x: pd.DataFrame) -> np.ndarray:
        self.seen_columns = list(x.columns)
        return np.tile([0.1, 0.2, 0.6, 0.1], (len(x), 1))


def test_predict_returns_scores_on_the_artifacts_own_feature_list():
    model = FakeReturnsModel()
    artifact = {"model": model, "feature_list": ["ret_20d", "vix", "ovx"]}

    result = predict_returns(artifact, np.array([0.1, 20.0, 30.0]))

    # No p_R* columns are synthesized any more.
    assert model.seen_columns == ["ret_20d", "vix", "ovx"]
    assert set(result) == set(RETURN_BIN_LABELS)
    assert result["pos_0_10"] == 0.6


def test_classifier_baseline_uses_majority_class_and_train_frequencies():
    # Validation is 80% class 2, so a constant predictor scores 0.8 - the number
    # a model has to beat before its accuracy means anything.
    y_train = pd.Series([0, 1, 2, 2, 2, 3])
    y_val = pd.Series([2, 2, 2, 2, 1])

    baseline = classifier_baselines(y_train, y_val, n_classes=4)

    assert baseline["accuracy"] == 0.8
    assert 0.0 < baseline["brier"] < 1.0


def test_classifier_baseline_on_a_single_class_validation_window():
    """The regime model's 2024 window was 366 rows of one class, which makes
    'always predict that class' score a perfect 1.0."""
    baseline = classifier_baselines(pd.Series([0, 1, 2, 3]), pd.Series([2] * 50), n_classes=4)

    assert baseline["accuracy"] == 1.0
