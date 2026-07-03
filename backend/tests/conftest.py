import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app
from core.config import settings


@pytest.fixture
async def auth_headers() -> dict[str, str]:
    """Real login against the seeded default user (db/crud.py::get_or_create_default_user),
    not a mocked token - matches this project's live-verification-over-mocking convention."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/auth/login",
            json={"email": "xuemei@local", "password": settings.default_user_password},
        )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
