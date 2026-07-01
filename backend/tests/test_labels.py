import pandas as pd

from core.models.labels import build_eia_labels, build_regime_labels, build_return_bucket_labels


class FakeRegistry:
    def fetch(self, name: str, start: str, end: str) -> pd.Series:
        del start, end
        if name == "wti":
            return pd.Series(
                [100 + i for i in range(30)],
                index=pd.date_range("2024-01-01", periods=30, freq="B"),
            )
        if name == "crude_inventory":
            return pd.Series(
                [100, 100, 105, 105, 102, 102],
                index=pd.date_range("2024-01-01", periods=6, freq="D"),
            )
        raise KeyError(name)


def test_regime_labels_uses_transition_series():
    labels = build_regime_labels("2024-01-01", "2024-01-03")
    assert labels.tolist() == ["R3", "R3", "R3"]


def test_return_bucket_labels_use_trading_observations():
    labels = build_return_bucket_labels("2024-01-01", "2024-02-15", registry=FakeRegistry())
    assert labels.index[0] == pd.Timestamp("2024-01-01")
    assert labels.iloc[0] == 3


def test_eia_labels_are_independent_from_feature_columns():
    labels = build_eia_labels("2024-01-01", "2024-01-06", registry=FakeRegistry())
    assert labels.notna().any()
