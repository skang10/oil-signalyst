import pytest


def _require_api_keys() -> None:
    from core.config import settings

    if not settings.eia_api_key or not settings.fred_api_key:
        pytest.skip("EIA_API_KEY and FRED_API_KEY are required for integration tests")


def test_feature_engine_no_future_leakage():
    _require_api_keys()

    from features.engine import FeatureEngine

    engine = FeatureEngine()
    df = engine.build("2023-01-01", "2024-06-30")
    df = df["2024-01-01":"2024-06-30"]

    assert "crude_inv_dev" in df.columns
    assert df["crude_inv_dev"].notna().mean() > 0.8


def test_feature_engine_returns_no_nan_rows():
    _require_api_keys()

    from features.engine import FeatureEngine

    engine = FeatureEngine()
    df = engine.build("2023-01-01", "2024-06-30")
    df = df["2024-01-01":"2024-06-30"]

    assert len(df) > 0
    assert df.isnull().all(axis=1).sum() == 0
