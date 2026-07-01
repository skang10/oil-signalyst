import numpy as np
from tabpfn_client import TabPFNClassifier

from core.models.common import as_named_row, classifier_metrics
from core.models.labels import RETURN_BIN_LABELS
from core.models.regime import REGIME_CLASSES
from core.models.tabpfn_setup import ensure_tabpfn_authenticated


def append_regime_probs_to_vector(feature_vector: np.ndarray, regime_probs: dict) -> np.ndarray:
    """Appends p_R1..p_R4 (in REGIME_CLASSES order) to a single raw feature vector.

    Mirrors the column augmentation trainer.py applies to training/validation
    frames, so daily inference and stress tests see the same feature layout
    the returns model was actually trained on.
    """
    extra = np.array([regime_probs.get(cls, 0.0) for cls in REGIME_CLASSES])
    return np.concatenate([feature_vector, extra])


def build_returns_model(train_x, train_y, val_x, val_y):
    ensure_tabpfn_authenticated()
    model = TabPFNClassifier(balance_probabilities=True)
    model.fit(train_x, train_y)
    metrics_train = classifier_metrics(model, train_x, train_y, len(RETURN_BIN_LABELS))
    metrics_val = classifier_metrics(model, val_x, val_y, len(RETURN_BIN_LABELS))
    counts = {
        RETURN_BIN_LABELS[int(k)]: int(v)
        for k, v in train_y.value_counts().sort_index().items()
    }
    metrics_train["bucket_counts"] = counts
    return model, metrics_train, metrics_val


def predict_returns(artifact: dict, features: np.ndarray, regime_probs: dict) -> dict:
    ensure_tabpfn_authenticated()
    model = artifact["model"]
    augmented = append_regime_probs_to_vector(features, regime_probs)
    x = as_named_row(augmented, artifact["feature_list"])
    probs = model.predict_proba(x)[0]
    result = {label: 0.0 for label in RETURN_BIN_LABELS}
    for class_id, probability in zip(model.classes_, probs, strict=False):
        result[RETURN_BIN_LABELS[int(class_id)]] = round(float(probability), 4)
    return result
