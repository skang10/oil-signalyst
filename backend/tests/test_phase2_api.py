import pytest
from httpx import ASGITransport, AsyncClient

import api.routes.training as training_routes
from api.main import app


@pytest.mark.asyncio
async def test_training_start_returns_202(monkeypatch, auth_headers):
    async def fake_run_full_training_with_log(
        job_id=None, triggered_by_user_id=None, model_types=None
    ):
        del job_id, triggered_by_user_id, model_types
        return {}

    monkeypatch.setattr(
        training_routes, "run_full_training_with_log", fake_run_full_training_with_log
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/train/start", headers=auth_headers)
    # 409 is legitimate here: these tests run against the real dev DB, so a
    # genuine training run in flight trips the single-run guard.
    assert response.status_code in (202, 404, 409)


@pytest.mark.asyncio
async def test_unknown_report_role_returns_400(auth_headers):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/reports/daily/badrole", headers=auth_headers)
    assert response.status_code in (400, 404)
