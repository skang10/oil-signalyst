from fastapi import APIRouter
from sqlalchemy import select

from api.dependencies import DbSession
from db.models import ModelVersion

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("/status")
async def get_model_status(db: DbSession) -> list[dict]:
    rows = await db.execute(select(ModelVersion).where(ModelVersion.is_active.is_(True)))
    return [
        {
            "model_type": version.model_type,
            "version": version.version,
            "metrics_oos": version.metrics_oos,
            "deployed_at": str(version.deployed_at) if version.deployed_at else None,
            "feature_count": len(version.feature_list or []),
        }
        for version in rows.scalars().all()
    ]

