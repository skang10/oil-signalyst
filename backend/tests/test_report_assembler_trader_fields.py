from datetime import date

import pandas as pd
import pytest

import core.postprocess.report_assembler as report_assembler
from api.routes.reports import _filter_by_role


def test_cot_net_percentile_returns_neutral_when_value_missing():
    assert report_assembler._cot_net_percentile(None, date(2024, 6, 1)) == 50.0


def test_cot_net_percentile_ranks_against_history(monkeypatch):
    values = [i / 100 for i in range(20)]  # 0.00, 0.01, ..., 0.19
    history_df = pd.DataFrame({"spec_net_pct": values})
    monkeypatch.setattr(report_assembler, "load_features", lambda start, end: history_df)

    percentile = report_assembler._cot_net_percentile(0.155, date(2024, 6, 1))

    assert percentile == 80.0  # 16 of 20 historical values are below 0.155


def test_cot_net_percentile_fails_soft_on_missing_data(monkeypatch):
    def broken_load(start, end):
        raise FileNotFoundError("no parquet files")

    monkeypatch.setattr(report_assembler, "load_features", broken_load)

    assert report_assembler._cot_net_percentile(0.3, date(2024, 6, 1)) == 50.0


def test_cot_net_percentile_neutral_with_too_few_samples(monkeypatch):
    history_df = pd.DataFrame({"spec_net_pct": [0.1, 0.2, 0.3, 0.4, 0.5]})
    monkeypatch.setattr(report_assembler, "load_features", lambda start, end: history_df)

    percentile = report_assembler._cot_net_percentile(0.99, date(2024, 6, 1))

    assert percentile == 50.0  # only 5 samples, below the 20-sample minimum


def test_price_5d_history_returns_last_5_rounded(monkeypatch):
    idx = pd.date_range("2024-05-20", periods=10, freq="D")
    fake_series = pd.Series(range(10), index=idx, dtype=float)

    class FakeRegistry:
        def fetch(self, name, start, end):
            return fake_series

    monkeypatch.setattr(report_assembler, "DataRegistry", FakeRegistry)

    prices = report_assembler._price_5d_history(date(2024, 5, 29))

    assert prices == [5.0, 6.0, 7.0, 8.0, 9.0]


def test_price_5d_history_fails_soft(monkeypatch):
    class BrokenRegistry:
        def fetch(self, name, start, end):
            raise RuntimeError("network down")

    monkeypatch.setattr(report_assembler, "DataRegistry", BrokenRegistry)

    assert report_assembler._price_5d_history(date(2024, 5, 29)) == []


@pytest.fixture
def sample_report() -> dict:
    return {
        "date": "2024-06-01",
        "price": 75.0,
        "dominant_regime": "R1",
        "regime_probs": {"R1": 0.6, "R2": 0.1, "R3": 0.2, "R4": 0.1},
        "return_dist": {"lt_minus10": 0.1, "neg_10_0": 0.2, "pos_0_10": 0.3, "gt_10": 0.4},
        "eia_forecast": {"crude": -100},
        "decision": {
            "direction": "LONG",
            "kelly_position": 0.3,
            "stop_loss": 70.0,
            "stop_loss_pct": 0.0667,
            "expected_ret": 0.05,
            "cvar_95": -0.09,
            "hedge_ratio": 0.4,
        },
        "brent_wti_spread": 3.5,
        "ovx": 20.0,
        "cot_net_percentile": 60.0,
        "price_5d_history": [70.0, 71.0, 72.0, 73.0, 75.0],
        "var_95": 0.3,
    }


class _FakeUser:
    exposure_barrels = 250_000


@pytest.mark.asyncio
async def test_trader_role_exposes_all_new_fields(sample_report):
    result = await _filter_by_role(sample_report, "trader", _FakeUser())

    assert result["signal"] == "LONG"
    assert result["kelly_position"] == 0.3
    assert result["stop_loss_price"] == 70.0
    assert result["stop_loss_pct"] == 0.0667
    assert result["expected_return"] == 0.05
    assert result["price_5d_history"] == [70.0, 71.0, 72.0, 73.0, 75.0]
    assert result["brent_wti_spread"] == 3.5
    assert result["cot_net_percentile"] == 60.0
    assert result["ovx"] == 20.0


@pytest.mark.asyncio
async def test_risk_role_exposes_all_new_fields(sample_report, monkeypatch):
    import api.routes.reports as reports_module

    async def fake_r3_drawdown():
        return -0.42

    monkeypatch.setattr(reports_module, "get_r3_max_drawdown", fake_r3_drawdown)

    result = await _filter_by_role(sample_report, "risk", _FakeUser())

    assert result["var_95"] == 0.3
    assert result["cvar_95"] == -0.09
    assert result["current_exposure_mbbls"] == 0.25
    assert result["hedge_ratio"] == 0.4
    assert result["recommended_hedge_ratio"] == 0.4
    assert result["r3_historical_max_drawdown"] == -0.42
