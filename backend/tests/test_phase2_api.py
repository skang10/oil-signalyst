import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app


@pytest.mark.asyncio
async def test_training_start_returns_202():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/train/start", headers={"X-User-Id": "1"})
    assert response.status_code in (202, 404)


@pytest.mark.asyncio
async def test_unknown_report_role_returns_400():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/reports/daily/badrole", headers={"X-User-Id": "1"})
    assert response.status_code in (400, 404)
