import numpy as np
from sklearn.metrics import mean_absolute_error
from tabpfn_client import TabPFNRegressor

from core.models.common import as_named_row
from core.models.metrics import recent_window_metrics, regressor_baselines
from core.models.tabpfn_setup import ensure_tabpfn_authenticated


def direction_accuracy(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.sign(y_true) == np.sign(y_pred)))


def build_eia_model(train_x, train_y, test_x, test_y):
    """Fit on train (2012-2024), report on the held-out test window."""
    ensure_tabpfn_authenticated()
    model = TabPFNRegressor()
    model.fit(train_x, train_y)
    train_pred = model.predict(train_x)
    test_pred = model.predict(test_x)
    consensus = test_y.rolling(4).mean().shift(1).fillna(0.0)
    metrics_train = {
        "mae": round(float(mean_absolute_error(train_y, train_pred)), 4),
        "direction_acc": round(direction_accuracy(train_y, train_pred), 4),
    }
    metrics_test = {
        "mae": round(float(mean_absolute_error(test_y, test_pred)), 4),
        "direction_acc": round(direction_accuracy(test_y, test_pred), 4),
        # Signed model-minus-consensus, so NEGATIVE means the model wins. Note
        # `consensus` is a rolling mean of the test labels themselves and is not
        # available at prediction time; metrics_test["baseline"] below is the
        # train-derived reference the deployment gate actually uses.
        "mae_vs_consensus": round(
            float(mean_absolute_error(test_y, test_pred) - mean_absolute_error(test_y, consensus)),
            4,
        ),
        "baseline": regressor_baselines(train_y, test_y),
        # Empirical 80% predictive interval, as offsets from the point forecast.
        # Out-of-sample residuals deliberately: the report used to draw a
        # hardcoded +/-1.7 band, roughly four times tighter than this model
        # actually is, which made every forecast look far more precise than it
        # was. Stored as offsets so the report can centre them on the day's
        # forecast without recomputing anything.
        "residual_p10": round(float(np.percentile(test_y - test_pred, 10)), 4),
        "residual_p90": round(float(np.percentile(test_y - test_pred, 90)), 4),
    }
    # Recency diagnostic on the same predictions - reported, never gated on.
    metrics_test["recent"] = recent_window_metrics(
        test_y,
        lambda m: {
            "mae": round(float(mean_absolute_error(test_y[m], test_pred[m])), 4),
            "baseline": regressor_baselines(train_y, test_y[m]),
        },
    )
    return model, metrics_train, metrics_test


def predict_eia(artifact: dict, features, recent_inventory=None) -> dict:
    ensure_tabpfn_authenticated()
    model = artifact["model"]
    x = as_named_row(features, artifact["feature_list"])
    point = float(model.predict(x)[0])
    consensus = 0.0
    if recent_inventory is not None and len(recent_inventory.dropna()) >= 5:
        # recent_inventory is raw EIA thousand-barrel data; divide by 1000 to
        # match the model's million-barrel scale (see build_eia_labels).
        consensus = float(recent_inventory.dropna().diff().tail(4).mean() / 1000)
    return {
        "crude": round(point, 2),
        "market_consensus": round(consensus, 2),
        "surprise": round(point - consensus, 2),
    }

