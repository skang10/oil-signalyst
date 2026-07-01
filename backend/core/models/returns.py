import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline

from core.models.common import classifier_metrics
from core.models.labels import RETURN_BIN_LABELS


def build_returns_model(train_x, train_y, val_x, val_y):
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
    model.fit(train_x, train_y)
    metrics_train = classifier_metrics(model, train_x, train_y, len(RETURN_BIN_LABELS))
    metrics_val = classifier_metrics(model, val_x, val_y, len(RETURN_BIN_LABELS))
    counts = {
        RETURN_BIN_LABELS[int(k)]: int(v)
        for k, v in train_y.value_counts().sort_index().items()
    }
    metrics_train["bucket_counts"] = counts
    return model, metrics_train, metrics_val


def predict_returns(artifact: dict, features: np.ndarray) -> dict:
    model = artifact["model"]
    probs = model.predict_proba(features.reshape(1, -1))[0]
    result = {label: 0.0 for label in RETURN_BIN_LABELS}
    for class_id, probability in zip(model.classes_, probs, strict=False):
        result[RETURN_BIN_LABELS[int(class_id)]] = round(float(probability), 4)
    return result
