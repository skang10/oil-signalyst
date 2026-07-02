import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from api.main import app
from db.database import get_db
from db.models import ModelVersion, TrainJob


@pytest.mark.asyncio
async def test_deploy_reports_error_for_incomplete_job():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/models/regime/deploy",
            params={"job_id": "does-not-exist"},
            headers={"X-User-Id": "1"},
        )
    assert response.status_code == 200
    assert "error" in response.json()


@pytest.fixture
async def seeded_regime_versions():
    """Regression fixture for the deploy endpoint's is_active desync bug:
    a raw bulk-deactivation UPDATE that includes the target's own row
    desyncs from the already-loaded ORM object, silently dropping the
    re-activation and leaving zero active rows for that model_type.

    This runs against the real dev DB (this project's established test
    pattern), so it must capture and restore whatever regime version was
    really active beforehand rather than leaving it deactivated.
    """
    job_id = "testjob-deploy"
    async with get_db() as db:
        previously_active = (
            await db.execute(
                select(ModelVersion).where(
                    ModelVersion.model_type == "regime", ModelVersion.is_active.is_(True)
                )
            )
        ).scalar_one_or_none()
        previously_active_id = previously_active.id if previously_active else None

        db.add(
            ModelVersion(
                model_type="regime", version="v-old", file_path="/tmp/v-old.joblib", is_active=False
            )
        )
        db.add(
            ModelVersion(
                model_type="regime", version="v-new", file_path="/tmp/v-new.joblib", is_active=False
            )
        )
        db.add(TrainJob(id=job_id, status="complete", result={"versions": {"regime": "v-new"}}))

    yield job_id

    async with get_db() as db:
        rows = (
            await db.execute(
                select(ModelVersion).where(
                    ModelVersion.model_type == "regime",
                    ModelVersion.version.in_(["v-old", "v-new"]),
                )
            )
        ).scalars().all()
        for row in rows:
            await db.delete(row)
        job = await db.get(TrainJob, job_id)
        if job:
            await db.delete(job)

    if previously_active_id is not None:
        async with get_db() as db:
            restored = await db.get(ModelVersion, previously_active_id)
            if restored:
                restored.is_active = True
                db.add(restored)


@pytest.mark.asyncio
async def test_deploy_leaves_exactly_one_active_row_per_model_type(seeded_regime_versions):
    job_id = seeded_regime_versions

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/models/regime/deploy",
            params={"job_id": job_id},
            headers={"X-User-Id": "1"},
        )
    assert response.status_code == 200
    assert response.json()["status"] == "deployed"

    async with get_db() as db:
        rows = (
            await db.execute(
                select(ModelVersion).where(
                    ModelVersion.model_type == "regime",
                    ModelVersion.version.in_(["v-old", "v-new"]),
                )
            )
        ).scalars().all()
        active = [r for r in rows if r.is_active]

    assert len(active) == 1
    assert active[0].version == "v-new"
