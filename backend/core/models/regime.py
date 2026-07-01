import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline

from core.logging import get_logger
from core.models.common import classifier_metrics

logger = get_logger(__name__)

REGIME_CLASSES = ["R1", "R2", "R3", "R4"]


def encode_regimes(labels) -> np.ndarray:
    return np.array([REGIME_CLASSES.index(value) for value in labels])


def decode_regime_probs(classes: np.ndarray, probs: np.ndarray) -> dict:
    result = {label: 0.0 for label in REGIME_CLASSES}
    for class_id, probability in zip(classes, probs, strict=False):
        result[REGIME_CLASSES[int(class_id)]] = round(float(probability), 4)
    return result


def build_regime_model(train_x, train_y, val_x, val_y):
    from core.models.regime_validation import validate_regime_labels

    model = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            (
                "model",
                RandomForestClassifier(
                    n_estimators=300,
                    max_depth=6,
                    min_samples_leaf=10,
                    random_state=42,
                    class_weight="balanced",
                ),
            ),
        ]
    )
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
    model = artifact["model"]
    probs = model.predict_proba(features.reshape(1, -1))[0]
    return decode_regime_probs(model.classes_, probs)

