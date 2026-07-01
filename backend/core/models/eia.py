import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error
from sklearn.pipeline import Pipeline


def direction_accuracy(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.sign(y_true) == np.sign(y_pred)))


def build_eia_model(train_x, train_y, val_x, val_y):
    model = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            (
                "model",
                RandomForestRegressor(
                    n_estimators=300,
                    max_depth=6,
                    min_samples_leaf=10,
                    random_state=42,
                ),
            ),
        ]
    )
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
    model = artifact["model"]
    point = float(model.predict(features.reshape(1, -1))[0])
    consensus = 0.0
    if recent_inventory is not None and len(recent_inventory.dropna()) >= 5:
        consensus = float(recent_inventory.dropna().diff().tail(4).mean())
    return {
        "crude": round(point, 2),
        "market_consensus": round(consensus, 2),
        "surprise": round(point - consensus, 2),
    }

