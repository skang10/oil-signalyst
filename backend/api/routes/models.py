from fastapi import APIRouter
from sqlalchemy import desc, select

from api.dependencies import DbSession
from core.postprocess.drift_monitor import PSI_RETRAIN_THRESHOLD
from db.models import FeatureSnapshot, ModelVersion

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("/status")
async def get_model_status(db: DbSession) -> list[dict]:
    rows = await db.execute(select(ModelVersion).where(ModelVersion.is_active.is_(True)))
    versions = rows.scalars().all()

    snapshot_row = await db.execute(
        select(FeatureSnapshot).order_by(desc(FeatureSnapshot.date)).limit(1)
    )
    latest_snapshot = snapshot_row.scalar_one_or_none()
    psi_scores = latest_snapshot.psi_scores if latest_snapshot else None

    # Only derive a recommendation once scores have actually been persisted,
    # per spec - absence of data is not the same as "no drift detected".
    psi_max = round(max(psi_scores.values()), 4) if psi_scores else None
    retrain_recommended = psi_max > PSI_RETRAIN_THRESHOLD if psi_max is not None else None

    return [
        {
            "model_type": version.model_type,
            "version": version.version,
            "metrics_oos": version.metrics_oos,
            "deployed_at": str(version.deployed_at) if version.deployed_at else None,
            "feature_count": len(version.feature_list or []),
            "psi_max": psi_max,
            "retrain_recommended": retrain_recommended,
        }
        for version in versions
    ]

