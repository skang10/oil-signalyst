import pytest


def test_eia_weekly_values_start_on_release_date():
    import pandas as pd

    from core.data.registry import DataRegistry

    registry = DataRegistry.__new__(DataRegistry)
    series = pd.Series(
        [100.0, 110.0],
        index=pd.to_datetime(["2024-06-07", "2024-06-14"]),
    )

    aligned = registry._align(series, {"type": "eia", "freq": "W", "lag_days": 0})

    assert aligned.loc["2024-06-12"] == 100.0
    assert aligned.loc["2024-06-14"] == 100.0
    assert aligned.loc["2024-06-18"] == 100.0
    assert aligned.loc["2024-06-20"] == 110.0


def _require_api_keys() -> None:
    from core.config import settings

    if not settings.eia_api_key or not settings.fred_api_key:
        pytest.skip("EIA_API_KEY and FRED_API_KEY are required for integration tests")


def test_yahoo_source_returns_series():
    from core.data.sources.yahoo import YahooSource

    source = YahooSource()
    result = source.fetch({"ticker": "CL=F", "field": "Close"}, "2024-01-01", "2024-01-31")

    assert len(result) > 0
    assert str(result.index.dtype) == "datetime64[ns]"


def test_registry_fetch_all_returns_dataframe():
    _require_api_keys()

    from core.data.registry import DataRegistry

    registry = DataRegistry()
    df = registry.fetch_all("2024-06-01", "2024-06-30")

    assert "wti" in df.columns
    assert "crude_inventory" in df.columns
    assert len(df) > 0
