import numpy as np
import pandas as pd

from core.signal_scanner import (
    BONFERRONI_ALPHA,
    IC_LAGS_DAYS,
    _coverage,
    _ic,
    _load_candidates,
    _max_correlation_with_active_features,
    _status,
)


def test_load_candidates_returns_explicit_config_not_every_column():
    candidates = _load_candidates()

    assert len(candidates) > 0
    names = {c["name"] for c in candidates}
    sources = {c["source"] for c in candidates}
    assert sources.issubset(
        {"cushing_inventory", "gasoline_inventory", "distillate_inventory", "natural_gas"}
    )
    for candidate in candidates:
        assert "mechanism" in candidate and candidate["mechanism"].strip()
    assert len(names) == len(candidates)  # unique names


def test_ic_detects_strong_correlation():
    idx = pd.date_range("2020-01-01", periods=200, freq="D")
    signal = pd.Series(np.arange(200), index=idx, dtype=float)
    forward_return = pd.Series(np.arange(200) * 0.001, index=idx, dtype=float)

    correlation, p_value = _ic(signal, forward_return)

    assert correlation > 0.99
    assert p_value < BONFERRONI_ALPHA


def test_ic_returns_neutral_with_too_few_observations():
    idx = pd.date_range("2020-01-01", periods=10, freq="D")
    signal = pd.Series(range(10), index=idx, dtype=float)
    forward_return = pd.Series(range(10), index=idx, dtype=float)

    correlation, p_value = _ic(signal, forward_return)

    assert correlation == 0.0
    assert p_value == 1.0


def test_coverage_reflects_missing_observations():
    idx = pd.date_range("2020-01-01", periods=10, freq="B")
    full = pd.Series(1.0, index=idx)
    half = pd.Series(1.0, index=idx[:5])

    assert _coverage(full, "2020-01-01", str(idx[-1].date())) == 1.0
    assert _coverage(half, "2020-01-01", str(idx[-1].date())) == 0.5


def test_status_requires_both_significance_and_coverage():
    assert _status(corrected_p=0.01, raw_p=0.001, coverage=0.9) == "candidate"
    assert _status(corrected_p=0.5, raw_p=0.01, coverage=0.9) == "watch"
    assert _status(corrected_p=0.01, raw_p=0.001, coverage=0.5) == "watch"
    assert _status(corrected_p=0.9, raw_p=0.9, coverage=0.9) == "rejected"


def test_max_correlation_with_active_features_picks_strongest_match():
    idx = pd.date_range("2020-01-01", periods=100, freq="D")
    signal = pd.Series(np.arange(100), index=idx, dtype=float)
    active_features = pd.DataFrame(
        {
            "weak": np.random.default_rng(0).normal(size=100),
            "strong": np.arange(100) + np.random.default_rng(1).normal(scale=0.01, size=100),
        },
        index=idx,
    )

    name, value = _max_correlation_with_active_features(signal, active_features)

    assert name == "strong"
    assert value > 0.9


def test_bonferroni_correction_scales_with_total_tests():
    candidates = _load_candidates()
    n_tests = len(candidates) * len(IC_LAGS_DAYS)
    raw_p = 0.01

    corrected = min(raw_p * n_tests, 1.0)

    assert corrected == round(raw_p * n_tests, 10)
    assert n_tests == len(candidates) * 3
