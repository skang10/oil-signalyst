import numpy as np
import pandas as pd
from tabpfn_client import TabPFNClassifier

from core.logging import get_logger
from core.models.common import as_named_row, classifier_metrics
from core.models.tabpfn_setup import ensure_tabpfn_authenticated

logger = get_logger(__name__)

REGIME_CLASSES = ["R1", "R2", "R3", "R4"]
REGIME_PROB_COLUMNS = [f"p_{cls}" for cls in REGIME_CLASSES]


def encode_regimes(labels) -> np.ndarray:
    return np.array([REGIME_CLASSES.index(value) for value in labels])


def decode_regime_probs(classes: np.ndarray, probs: np.ndarray) -> dict:
    result = {label: 0.0 for label in REGIME_CLASSES}
    for class_id, probability in zip(classes, probs, strict=False):
        result[REGIME_CLASSES[int(class_id)]] = round(float(probability), 4)
    return result


def build_regime_model(train_x, train_y, val_x, val_y):
    from core.models.regime_validation import validate_regime_labels

    ensure_tabpfn_authenticated()
    model = TabPFNClassifier(balance_probabilities=True)
    y_train = encode_regimes(train_y)
    y_val = encode_regimes(val_y)
    model.fit(train_x, y_train)
    metrics_train = classifier_metrics(model, train_x, y_train, len(REGIME_CLASSES))
    metrics_val = classifier_metrics(model, val_x, y_val, len(REGIME_CLASSES))
    metrics_train["class_counts"] = {
        str(k): int(v) for k, v in train_y.value_counts().sort_index().items()
    }
    gmm_validation = validate_regime_labels(train_x, train_y, val_x, val_y)
    metrics_train["gmm_validation"] = gmm_validation
    if gmm_validation.get("review_trigger"):
        logger.warning(
            "GMM regime label agreement below review threshold",
            extra={"agreement_val": gmm_validation.get("agreement_val")},
        )
    return model, metrics_train, metrics_val


def predict_regime(artifact: dict, features: np.ndarray) -> dict:
    ensure_tabpfn_authenticated()
    model = artifact["model"]
    x = as_named_row(features, artifact["feature_list"])
    probs = model.predict_proba(x)[0]
    return decode_regime_probs(model.classes_, probs)


def predict_regime_batch(model, x: pd.DataFrame) -> pd.DataFrame:
    """Regime probabilities for every row of x, used to condition the returns model."""
    ensure_tabpfn_authenticated()
    probs = model.predict_proba(x)
    columns = [f"p_{REGIME_CLASSES[int(class_id)]}" for class_id in model.classes_]
    return pd.DataFrame(probs, columns=columns, index=x.index)[REGIME_PROB_COLUMNS]

