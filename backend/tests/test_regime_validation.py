import numpy as np
import pandas as pd

from core.models.regime_validation import GMM_FEATURES, validate_regime_labels


def _clustered_frame(n_per_cluster: int, offset: int) -> tuple[pd.DataFrame, pd.Series]:
    rng = np.random.default_rng(42)
    centers = {"R1": -3.0, "R2": -1.0, "R3": 1.0, "R4": 3.0}
    rows, labels = [], []
    for regime, center in centers.items():
        for _ in range(n_per_cluster):
            rows.append([center + rng.normal(scale=0.05) for _ in GMM_FEATURES])
            labels.append(regime)
    index = pd.RangeIndex(offset, offset + len(rows))
    return pd.DataFrame(rows, columns=GMM_FEATURES, index=index), pd.Series(labels, index=index)


def test_gmm_validation_applies_train_fitted_mapping_to_validation():
    train_x, train_y = _clustered_frame(50, offset=0)
    val_x, val_y = _clustered_frame(20, offset=1000)

    result = validate_regime_labels(train_x, train_y, val_x, val_y)

    assert result["agreement_train"] > 0.9
    assert result["agreement_val"] > 0.9
    assert result["review_trigger"] is False


def test_gmm_validation_flags_review_when_agreement_is_low(monkeypatch):
    train_x, train_y = _clustered_frame(50, offset=0)
    val_x, val_y = _clustered_frame(20, offset=1000)
    shuffled_val_y = pd.Series(val_y.sample(frac=1, random_state=1).values, index=val_y.index)

    result = validate_regime_labels(train_x, train_y, val_x, shuffled_val_y)

    assert result["review_trigger"] is True


def test_gmm_validation_reports_missing_features():
    train_x = pd.DataFrame({"ret_20d": [0.1, 0.2]})
    train_y = pd.Series(["R1", "R2"])

    result = validate_regime_labels(train_x, train_y, train_x, train_y)

    assert result["agreement_train"] is None
    assert "error" in result
