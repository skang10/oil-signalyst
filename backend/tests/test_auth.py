import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app
from core.config import settings


@pytest.mark.asyncio
async def test_login_returns_token():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/api/auth/login",
            json={"email": "xuemei@local", "password": settings.default_user_password},
        )
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body
    assert body["role"] in ["trader", "risk", "researcher", "ds"]


@pytest.mark.asyncio
async def test_login_rejects_wrong_password():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/api/auth/login",
            json={"email": "xuemei@local", "password": "definitely-wrong"},
        )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_login_rejects_unknown_email():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/api/auth/login",
            json={"email": "nobody@local", "password": "whatever"},
        )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/reports/daily/trader")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_rejects_garbage_token():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/reports/daily/trader", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_accepts_valid_token(auth_headers):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/reports/daily/trader", headers=auth_headers)
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_refresh_without_cookie_returns_401():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/auth/refresh")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_refresh_flow_issues_new_access_token():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        login = await c.post(
            "/api/auth/login",
            json={"email": "xuemei@local", "password": settings.default_user_password},
        )
        assert login.status_code == 200
        refreshed = await c.post("/api/auth/refresh")
    assert refreshed.status_code == 200
    assert "access_token" in refreshed.json()


@pytest.mark.asyncio
async def test_logout_clears_refresh_token(auth_headers):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        login = await c.post(
            "/api/auth/login",
            json={"email": "xuemei@local", "password": settings.default_user_password},
        )
        assert login.status_code == 200
        logout = await c.post("/api/auth/logout", headers=auth_headers)
        assert logout.status_code == 200
        refreshed = await c.post("/api/auth/refresh")
    assert refreshed.status_code == 401
