import pytest

import core.postprocess.regime_stats as regime_stats


def test_historical_segment_durations_returns_positive_day_counts():
    durations = regime_stats._historical_segment_durations("R3")

    assert len(durations) >= 3
    assert all(isinstance(d, int) and d > 0 for d in durations)


def test_historical_segment_durations_empty_for_unknown_regime():
    durations = regime_stats._historical_segment_durations("R9")

    assert durations == []


@pytest.mark.asyncio
async def test_switch_probability_falls_back_to_neutral_when_no_comparable_history(monkeypatch):
    async def fake_duration(regime: str) -> int:
        return 100_000  # longer than any historical segment ever observed

    monkeypatch.setattr(regime_stats, "get_regime_duration", fake_duration)

    basis = await regime_stats.estimate_switch_probability("R3")

    assert basis["probability"] == regime_stats.NEUTRAL_SWITCH_PROBABILITY
    # comparable == 0 marks "this is the neutral prior, not an estimate", which
    # is what lets the UI avoid presenting it as a measured probability.
    assert basis["comparable"] == 0


@pytest.mark.asyncio
async def test_switch_probability_uses_empirical_estimate_when_history_available(monkeypatch):
    async def fake_duration(regime: str) -> int:
        return 0

    monkeypatch.setattr(regime_stats, "get_regime_duration", fake_duration)

    basis = await regime_stats.estimate_switch_probability("R3")

    assert 0.0 <= basis["probability"] <= 1.0
    # The ratio must be reconstructible from the counts shipped alongside it.
    assert basis["comparable"] > 0
    assert basis["switched"] <= basis["comparable"]
    assert basis["probability"] == round(basis["switched"] / basis["comparable"], 4)


def test_historical_segment_count_matches_durations():
    assert regime_stats.historical_segment_count("R3") == len(
        regime_stats._historical_segment_durations("R3")
    )
    # R4 (2020 covid) occurs exactly once - any statistic derived from it is n=1.
    assert regime_stats.historical_segment_count("R4") == 1
