import pandas as pd


class FakeRegistry:
    config = {
        "wti": {"freq": "D"},
        "brent": {"freq": "D"},
        "crude_inventory": {"freq": "W"},
    }

    def __init__(self):
        self.source_names = None

    def fetch_all(self, start, end, source_names=None):
        self.source_names = source_names
        index = pd.date_range(start, end, freq="D")
        return pd.DataFrame(
            {
                "wti": range(len(index)),
                "brent": [value + 5 for value in range(len(index))],
                "crude_inventory": [100 + (value // 7) for value in range(len(index))],
            },
            index=index,
        )


def test_feature_engine_uses_only_required_sources(tmp_path):
    from features.engine import FeatureEngine

    feature_config = tmp_path / "features.yaml"
    feature_config.write_text(
        """
features:
  - name: ret_5d
    source: wti
    transform: pct_change
    window: 5
  - name: brent_wti_spread
    source_a: brent
    source_b: wti
    transform: ratio_diff
""".strip()
    )
    registry = FakeRegistry()

    engine = FeatureEngine(feature_config=feature_config, registry=registry)
    df = engine.build("2024-01-01", "2024-01-31")

    assert registry.source_names == ["brent", "wti"]
    assert list(df.columns) == ["ret_5d", "brent_wti_spread"]
    assert len(df) > 0


def test_feature_engine_returns_no_nan_rows(tmp_path):
    from features.engine import FeatureEngine

    feature_config = tmp_path / "features.yaml"
    feature_config.write_text(
        """
features:
  - name: ret_5d
    source: wti
    transform: pct_change
    window: 5
  - name: crude_inv_chg_1w
    source: crude_inventory
    transform: pct_change
    window: 1
""".strip()
    )

    engine = FeatureEngine(feature_config=feature_config, registry=FakeRegistry())
    df = engine.build("2024-01-01", "2024-02-29")

    assert len(df) > 0
    assert df.isnull().all(axis=1).sum() == 0
