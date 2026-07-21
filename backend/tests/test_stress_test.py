from datetime import date

import numpy as np
import pandas as pd
import pytest

import core.postprocess.stress_test as stress_test_module
from core.exceptions import ModelNotFoundError


class FakeRegimeModel:
    classes_ = np.array([0, 1, 2, 3])

    def predict_proba(self, x) -> np.ndarray:
        return np.tile([0.7, 0.1, 0.1, 0.1], (len(x), 1))


class FakeReturnsModel:
    classes_ = np.array([0, 1, 2, 3])

    def predict_proba(self, x) -> np.ndarray:
        # Weighted toward bucket 0 (lt_minus10) - simulates a model that
        # correctly flags the covid-crash-style downside scenario.
        return np.tile([0.6, 0.2, 0.1, 0.1], (len(x), 1))


FEATURE_LIST = ["ret_20d", "rvol_20d", "brent_wti_spread"]


@pytest.fixture
def fake_active_models(monkeypatch):
    regime_artifact = {"model": FakeRegimeModel(), "feature_list": FEATURE_LIST}
    # Reversed order on purpose: the regime artifact is frozen at its old column
    # order while returns retrains against the sorted one, so stress_test must
    # index each model by its own feature_list rather than sharing one vector.
    returns_artifact = {
        "model": FakeReturnsModel(),
        "feature_list": list(reversed(FEATURE_LIST)),
    }

    async def fake_get_active(model_type: str):
        return {"regime": regime_artifact, "returns": returns_artifact}[model_type]

    monkeypatch.setattr(stress_test_module.ModelRegistry, "get_active", fake_get_active)


def test_stress_test_reports_structured_error_when_models_unavailable(monkeypatch):
    async def fake_get_active(model_type: str):
        raise ModelNotFoundError(f"No active model for '{model_type}'")

    monkeypatch.setattr(stress_test_module.ModelRegistry, "get_active", fake_get_active)

    import asyncio

    result = asyncio.run(stress_test_module.run_stress_test())

    assert result["scenarios"] == []
    assert "error" in result


def test_stress_test_reports_structured_error_for_missing_feature_row(
    fake_active_models, monkeypatch
):
    monkeypatch.setattr(stress_test_module, "_load_historical_feature_row", lambda *a, **k: None)

    import asyncio

    result = asyncio.run(stress_test_module.run_stress_test())

    assert len(result["scenarios"]) == 3
    for scenario in result["scenarios"]:
        assert "error" in scenario


def test_stress_test_scenario_includes_actual_outcome_comparison(fake_active_models, monkeypatch):
    row = pd.Series({"ret_20d": -0.3, "rvol_20d": 0.5, "brent_wti_spread": 2.0})
    monkeypatch.setattr(stress_test_module, "_load_historical_feature_row", lambda *a, **k: row)
    monkeypatch.setattr(stress_test_module, "_actual_forward_return", lambda *a, **k: -0.4)

    import asyncio

    result = asyncio.run(stress_test_module.run_stress_test())

    assert len(result["scenarios"]) == 3
    scenario = result["scenarios"][0]
    assert scenario["date"] == str(date(2020, 3, 16))
    assert scenario["actual_return"] == -0.4
    assert scenario["dominant_regime_predicted"] == "R1"
    assert scenario["model_alerted"] is True  # lt_minus10 prob 0.6 > 0.25 threshold
