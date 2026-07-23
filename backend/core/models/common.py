from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, brier_score_loss


def as_named_row(features: np.ndarray, feature_list: list[str]) -> pd.DataFrame:
    """Wraps a single raw feature vector in a DataFrame with fit-time column names.

    TabPFN Client validates that predict-time columns match fit-time columns by
    name, unlike sklearn estimators which are positional; a bare reshaped array
    fails with a 422 "columns differ" error.
    """
    return pd.DataFrame([features], columns=feature_list)


def multiclass_brier(
    y_true: np.ndarray,
    probs: np.ndarray,
    classes: np.ndarray,
    n_classes: int,
) -> float:
    scores = []
    for class_id in range(n_classes):
        if class_id in classes:
            col = int(np.where(classes == class_id)[0][0])
            pred = probs[:, col]
        else:
            pred = np.zeros(len(y_true))
        scores.append(brier_score_loss((y_true == class_id).astype(int), pred))
    return float(np.mean(scores))


def classifier_scores(
    y_val: np.ndarray,
    probs: np.ndarray,
    preds: np.ndarray,
    classes: np.ndarray,
    n_classes: int,
) -> dict:
    """The metric half of classifier_metrics, split out so a caller holding
    already-computed predictions can score a subset of them (e.g. the recency
    diagnostic's trailing slice) without a second round trip to TabPFN."""
    return {
        "accuracy": round(float(accuracy_score(y_val, preds)), 4),
        "brier": round(multiclass_brier(y_val, probs, classes, n_classes), 4),
    }


def classifier_metrics(model: Any, x_val: np.ndarray, y_val: np.ndarray, n_classes: int) -> dict:
    return classifier_scores(
        y_val, model.predict_proba(x_val), model.predict(x_val), model.classes_, n_classes
    )
