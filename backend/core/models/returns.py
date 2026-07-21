import numpy as np
from tabpfn_client import TabPFNClassifier

from core.models.common import as_named_row, classifier_metrics
from core.models.labels import RETURN_BIN_LABELS
from core.models.metrics import classifier_baselines
from core.models.tabpfn_setup import ensure_tabpfn_authenticated


def build_returns_model(train_x, train_y, test_x, test_y):
    """Fit on train, report on the held-out test window.

    No probability calibration: with ~12 independent observations a year, a
    held-out calibration set can't fit a sigmoid that generalizes, and TabPFN's
    native probabilities (with balance_probabilities) are a reasonable base.
    Removing it also means the reported Brier is a genuine held-out figure, not
    one scored on the same set a calibrator was tuned against.
    """
    ensure_tabpfn_authenticated()
    n_classes = len(RETURN_BIN_LABELS)
    model = TabPFNClassifier(balance_probabilities=True)
    model.fit(train_x, train_y)
    metrics_train = classifier_metrics(model, train_x, train_y, n_classes)
    metrics_test = classifier_metrics(model, test_x, test_y, n_classes)
    metrics_test["baseline"] = classifier_baselines(train_y, test_y, n_classes)

    metrics_train["bucket_counts"] = {
        RETURN_BIN_LABELS[int(k)]: int(v)
        for k, v in train_y.value_counts().sort_index().items()
    }
    return model, metrics_train, metrics_test


def predict_returns(artifact: dict, features: np.ndarray) -> dict:
    """Return-bucket distribution for one raw feature vector.

    No longer takes regime probabilities. They used to be appended as
    p_R1..p_R4, but the regime model was fit on hand-drawn hindsight labels and
    TabPFN memorizes its training rows - so training saw near-perfect regime
    one-hots while production served ~45%-accurate guesses. A train/serve
    mismatch on a feature that leaked the future.
    """
    ensure_tabpfn_authenticated()
    model = artifact["model"]
    x = as_named_row(features, artifact["feature_list"])
    probs = model.predict_proba(x)[0]
    result = {label: 0.0 for label in RETURN_BIN_LABELS}
    for class_id, probability in zip(model.classes_, probs, strict=False):
        result[RETURN_BIN_LABELS[int(class_id)]] = round(float(probability), 4)
    return result
