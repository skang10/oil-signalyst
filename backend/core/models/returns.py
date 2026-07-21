import numpy as np
from tabpfn_client import TabPFNClassifier

from core.models.calibration import calibrate_if_better
from core.models.common import as_named_row, classifier_metrics
from core.models.labels import RETURN_BIN_LABELS
from core.models.metrics import classifier_baselines
from core.models.tabpfn_setup import ensure_tabpfn_authenticated


def build_returns_model(train_x, train_y, val_x, val_y):
    ensure_tabpfn_authenticated()
    model = TabPFNClassifier(balance_probabilities=True)
    model.fit(train_x, train_y)
    metrics_train = classifier_metrics(model, train_x, train_y, len(RETURN_BIN_LABELS))
    metrics_val = classifier_metrics(model, val_x, val_y, len(RETURN_BIN_LABELS))
    n_classes = len(RETURN_BIN_LABELS)
    model, metrics_val = calibrate_if_better(model, val_x, val_y, n_classes, metrics_val)
    # Attached after calibration so the baseline travels with whichever model is
    # actually served, instead of being recomputed by the calibrated pass.
    metrics_val["baseline"] = classifier_baselines(train_y, val_y, n_classes)
    counts = {
        RETURN_BIN_LABELS[int(k)]: int(v)
        for k, v in train_y.value_counts().sort_index().items()
    }
    metrics_train["bucket_counts"] = counts
    return model, metrics_train, metrics_val


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
