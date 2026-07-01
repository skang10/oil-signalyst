import mlflow
import numpy as np
import pandas as pd
import pytest
from sklearn.linear_model import LogisticRegression

from core.models.calibration import calibrate_if_better
from core.models.common import classifier_metrics


@pytest.fixture(autouse=True)
def _mlflow_tmp_run(tmp_path, monkeypatch):
    monkeypatch.setenv("MLFLOW_ALLOW_FILE_STORE", "true")
    mlflow.set_tracking_uri(f"file://{tmp_path}")
    mlflow.set_experiment("test")
    with mlflow.start_run():
        yield


def _fit_frame(n_per_class: int, n_classes: int, seed: int) -> tuple[pd.DataFrame, pd.Series]:
    rng = np.random.default_rng(seed)
    rows, labels = [], []
    for class_id in range(n_classes):
        center = class_id * 3.0
        for _ in range(n_per_class):
            rows.append([center + rng.normal(scale=0.3), center + rng.normal(scale=0.3)])
            labels.append(class_id)
    df = pd.DataFrame(rows, columns=["a", "b"])
    return df, pd.Series(labels)


def test_calibration_applied_when_it_improves_brier():
    train_x, train_y = _fit_frame(60, 3, seed=1)
    val_x, val_y = _fit_frame(20, 3, seed=2)
    model = LogisticRegression(max_iter=1000).fit(train_x, train_y)
    metrics_val = classifier_metrics(model, val_x, val_y, 3)

    final_model, final_metrics = calibrate_if_better(model, val_x, val_y, 3, metrics_val)

    assert "calibration" in final_metrics
    if final_metrics["calibration"]["applied"]:
        assert final_model is not model
        assert final_metrics["brier"] <= metrics_val["brier"]
    else:
        assert final_model is model


def test_calibration_fails_soft_on_degenerate_validation_labels():
    train_x, train_y = _fit_frame(60, 3, seed=1)
    val_x, val_y = _fit_frame(20, 3, seed=2)
    model = LogisticRegression(max_iter=1000).fit(train_x, train_y)
    metrics_val = classifier_metrics(model, val_x, val_y, 3)

    degenerate_val_y = pd.Series([0] * len(val_y))
    final_model, final_metrics = calibrate_if_better(model, val_x, degenerate_val_y, 3, metrics_val)

    assert final_model is model
    assert final_metrics["calibration"]["applied"] is False
