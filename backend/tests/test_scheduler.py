from datetime import date, timedelta

import pandas as pd
import pytest


@pytest.mark.asyncio
async def test_daily_pipeline_fetches_through_day_after_target(monkeypatch):
    import scheduler.jobs as jobs

    captured = {}

    class FakeEngine:
        feature_version = "test"

        def __init__(self, registry):
            self.registry = registry

        def required_lookback_days(self):
            # Matrix ROWS, deliberately different from the calendar figure below
            # so this test fails if the fetch window is sized off the wrong one.
            return 520

        def required_lookback_calendar_days(self):
            return 728

        def build(self, start, end):
            captured["start"] = start
            captured["end"] = end
            raise RuntimeError("stop after capturing dates")

    async def fake_get_snapshot(db, target_date):
        return None

    class FakeDb:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def add(self, value):
            value.id = 1

        async def flush(self):
            return None

        async def execute(self, *args, **kwargs):
            return None

    monkeypatch.setattr(jobs, "FeatureEngine", FakeEngine)
    monkeypatch.setattr(jobs, "DataRegistry", lambda: object())
    monkeypatch.setattr(jobs, "get_feature_snapshot_by_date", fake_get_snapshot)
    monkeypatch.setattr(jobs, "get_db", lambda: FakeDb())

    with pytest.raises(RuntimeError, match="stop after capturing dates"):
        await jobs.run_daily_pipeline(date(2024, 6, 28))

    assert captured["end"] == "2024-06-29"
    # Sized off required_lookback_calendar_days (728), not the 520-row figure.
    # Subtracting rows as if they were days under-fetched by ~29%, which left
    # the 104-week spec_net_pct window permanently NaN - and since build() keeps
    # only fully-formed rows, that one column emptied the entire matrix and the
    # pipeline could not produce a prediction at all.
    assert captured["start"] == str(date(2024, 6, 28) - timedelta(days=728 + 90))


def test_select_feature_row_prefers_target_date():
    from scheduler.jobs import _select_feature_row

    df = pd.DataFrame(
        {"ret_5d": [0.1, 0.2]},
        index=pd.to_datetime(["2024-06-27", "2024-06-28"]),
    )

    feature_date, row = _select_feature_row(df, date(2024, 6, 28))

    assert feature_date == pd.Timestamp("2024-06-28")
    assert row.iloc[0]["ret_5d"] == 0.2


def test_select_feature_row_falls_back_to_latest_available_date():
    from scheduler.jobs import _select_feature_row

    df = pd.DataFrame(
        {"ret_5d": [0.1, 0.2]},
        index=pd.to_datetime(["2024-06-27", "2024-06-28"]),
    )

    feature_date, row = _select_feature_row(df, date(2024, 6, 29))

    assert feature_date == pd.Timestamp("2024-06-28")
    assert row.iloc[0]["ret_5d"] == 0.2
