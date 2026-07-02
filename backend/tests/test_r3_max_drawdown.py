import pytest

from core.postprocess.stress_test import (
    R3_DRAWDOWN_FALLBACK,
    R3_DRAWDOWN_MIN_OUTCOMES,
    get_r3_max_drawdown,
)


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeDb:
    def __init__(self, rows):
        self._rows = rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def execute(self, *args, **kwargs):
        return _FakeResult(self._rows)


@pytest.mark.asyncio
async def test_falls_back_when_too_few_r3_outcomes(monkeypatch):
    import core.postprocess.stress_test as stress_test_module

    rows = [({"R1": 0.1, "R2": 0.1, "R3": 0.7, "R4": 0.1}, -0.1)] * (R3_DRAWDOWN_MIN_OUTCOMES - 1)
    monkeypatch.setattr(stress_test_module, "get_db", lambda: _FakeDb(rows))

    result = await get_r3_max_drawdown()

    assert result == R3_DRAWDOWN_FALLBACK


@pytest.mark.asyncio
async def test_uses_worst_r3_outcome_when_enough_history(monkeypatch):
    import core.postprocess.stress_test as stress_test_module

    r3_probs = {"R1": 0.1, "R2": 0.1, "R3": 0.7, "R4": 0.1}
    other_probs = {"R1": 0.7, "R2": 0.1, "R3": 0.1, "R4": 0.1}
    rows = [(r3_probs, -0.1)] * R3_DRAWDOWN_MIN_OUTCOMES
    rows.append((r3_probs, -0.55))  # the worst R3 outcome
    rows.append((other_probs, -0.99))  # not R3, must be excluded

    monkeypatch.setattr(stress_test_module, "get_db", lambda: _FakeDb(rows))

    result = await get_r3_max_drawdown()

    assert result == -0.55
