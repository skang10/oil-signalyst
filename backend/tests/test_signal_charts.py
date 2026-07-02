import numpy as np
import pandas as pd
import pytest

import core.postprocess.signal_charts as signal_charts


def _correlated_df(n: int, seed: int = 0) -> pd.DataFrame:
    idx = pd.date_range("2015-01-01", periods=n, freq="B")
    rng = np.random.default_rng(seed)
    price = 50 + np.cumsum(rng.normal(scale=0.3, size=n))
    signal = price + rng.normal(scale=0.5, size=n)  # correlated with price level
    return pd.DataFrame({"price": price, "signal": signal}, index=idx)


def test_find_candidate_returns_none_for_unknown_signal(monkeypatch):
    monkeypatch.setattr(signal_charts, "load_candidates", lambda: [{"name": "known_signal"}])

    assert signal_charts._find_candidate("unknown_signal") is None
    assert signal_charts._find_candidate("known_signal") == {"name": "known_signal"}


def test_ic_mean_returns_none_with_too_few_observations():
    signal = pd.Series([1.0, 2.0, 3.0])
    target = pd.Series([1.0, 2.0, 3.0])

    assert signal_charts._ic_mean(signal, target) is None


def test_price_history_limits_to_recent_window():
    df = _correlated_df(500)

    history = signal_charts._price_history(df)

    assert len(history) < len(df)
    assert all({"date", "price", "signal"} <= set(row.keys()) for row in history)
    assert history[0]["date"] < history[-1]["date"]


def test_rolling_ic_produces_points_after_warmup():
    df = _correlated_df(signal_charts.ROLLING_IC_WINDOW_DAYS + 100)

    points = signal_charts._rolling_ic(df)

    assert len(points) > 0
    assert all("ic_5d" in p and "ic_20d" in p for p in points)


def test_oos_by_year_empty_when_train_ic_unavailable():
    # All dates after TRAIN_END_YEAR - no train-period rows to compute a
    # baseline train_ic from.
    idx = pd.date_range(f"{signal_charts.TRAIN_END_YEAR + 1}-01-01", periods=50, freq="B")
    values = np.arange(50, dtype=float)
    df = pd.DataFrame({"price": values, "signal": values}, index=idx)

    assert signal_charts._oos_by_year(df) == []


@pytest.mark.asyncio
async def test_build_signal_charts_returns_none_for_unknown_signal(monkeypatch):
    monkeypatch.setattr(signal_charts, "load_candidates", lambda: [])

    result = await signal_charts.build_signal_charts("not_a_real_signal")

    assert result is None
