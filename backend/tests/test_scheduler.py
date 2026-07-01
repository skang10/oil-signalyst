from datetime import date

import pytest


@pytest.mark.asyncio
async def test_daily_pipeline_fetches_through_day_after_target(monkeypatch):
    import scheduler.jobs as jobs

    captured = {}

    class FakeEngine:
        feature_version = "test"

        def __init__(self, registry):
            self.registry = registry

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
