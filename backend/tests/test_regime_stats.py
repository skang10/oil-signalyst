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

    probability = await regime_stats.estimate_switch_probability("R3")

    assert probability == regime_stats.NEUTRAL_SWITCH_PROBABILITY


@pytest.mark.asyncio
async def test_switch_probability_uses_empirical_estimate_when_history_available(monkeypatch):
    async def fake_duration(regime: str) -> int:
        return 0

    monkeypatch.setattr(regime_stats, "get_regime_duration", fake_duration)

    probability = await regime_stats.estimate_switch_probability("R3")

    assert 0.0 <= probability <= 1.0
