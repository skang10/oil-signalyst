import numpy as np
from sklearn.metrics import mean_absolute_error
from tabpfn_client import TabPFNRegressor

from core.models.common import as_named_row
from core.models.tabpfn_setup import ensure_tabpfn_authenticated


def direction_accuracy(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.sign(y_true) == np.sign(y_pred)))


def build_eia_model(train_x, train_y, val_x, val_y):
    ensure_tabpfn_authenticated()
    model = TabPFNRegressor()
    model.fit(train_x, train_y)
    train_pred = model.predict(train_x)
    val_pred = model.predict(val_x)
    consensus = val_y.rolling(4).mean().shift(1).fillna(0.0)
    metrics_train = {
        "mae": round(float(mean_absolute_error(train_y, train_pred)), 4),
        "direction_acc": round(direction_accuracy(train_y, train_pred), 4),
    }
    metrics_val = {
        "mae": round(float(mean_absolute_error(val_y, val_pred)), 4),
        "direction_acc": round(direction_accuracy(val_y, val_pred), 4),
        "mae_vs_consensus": round(
            float(mean_absolute_error(val_y, val_pred) - mean_absolute_error(val_y, consensus)),
            4,
        ),
    }
    return model, metrics_train, metrics_val


def predict_eia(artifact: dict, features, recent_inventory=None) -> dict:
    ensure_tabpfn_authenticated()
    model = artifact["model"]
    x = as_named_row(features, artifact["feature_list"])
    point = float(model.predict(x)[0])
    consensus = 0.0
    if recent_inventory is not None and len(recent_inventory.dropna()) >= 5:
        consensus = float(recent_inventory.dropna().diff().tail(4).mean())
    return {
        "crude": round(point, 2),
        "market_consensus": round(consensus, 2),
        "surprise": round(point - consensus, 2),
    }

