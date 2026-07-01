from typing import Any

import numpy as np
from sklearn.metrics import accuracy_score, brier_score_loss


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


def classifier_metrics(model: Any, x_val: np.ndarray, y_val: np.ndarray, n_classes: int) -> dict:
    probs = model.predict_proba(x_val)
    preds = model.predict(x_val)
    return {
        "accuracy": round(float(accuracy_score(y_val, preds)), 4),
        "brier": round(multiclass_brier(y_val, probs, model.classes_, n_classes), 4),
    }
