import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app


@pytest.mark.asyncio
async def test_agent_message_creates_session(auth_headers):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/agent/message", json={"content": "What is the current PSI?"}, headers=auth_headers)
    assert r.status_code == 200
    assert "session_id" in r.json()


@pytest.mark.asyncio
async def test_agent_stream_requires_token():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/agent/stream/some-session")
    # token is a required query param (not header - EventSource can't set
    # custom headers, see api/routes/agent.py) - FastAPI 422s if it's
    # missing entirely, distinct from 401 for an invalid one
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_agent_stream_rejects_bad_token():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/agent/stream/some-session", params={"token": "not-a-real-token"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_non_destructive_tool_executes_for_real():
    from core.agent.tool_handlers import execute_tool

    result = await execute_tool("check_leakage", {"gap_days": 20})
    assert result == {
        "gap_days": 20,
        "n_splits": 5,
        "leakage": False,
        "min_required_gap": 20,
        "pass": True,
    }


@pytest.mark.asyncio
async def test_check_leakage_flags_too_small_gap():
    from core.agent.tool_handlers import execute_tool

    result = await execute_tool("check_leakage", {"gap_days": 5})
    assert result["leakage"] is True
    assert result["pass"] is False


@pytest.mark.asyncio
async def test_compute_ic_errors_for_unscanned_signal():
    from core.agent.tool_handlers import execute_tool

    result = await execute_tool("compute_ic", {"signal_name": "definitely_not_a_real_signal"})
    assert "error" in result


@pytest.mark.asyncio
async def test_confirm_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/agent/confirm/1")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_confirm_reports_error_for_unknown_turn(auth_headers):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/agent/confirm/999999", headers=auth_headers)
    assert r.status_code == 200
    assert "error" in r.json()
