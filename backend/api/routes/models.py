from fastapi import APIRouter
from sqlalchemy import desc, select

from api.dependencies import DbSession
from core.postprocess.data_monitor import data_source_status, feature_coverage_7d
from core.postprocess.drift_monitor import PSI_RETRAIN_THRESHOLD
from db.models import FeatureSnapshot, ModelVersion

router = APIRouter(prefix="/api/models", tags=["models"])

PRIMARY_METRIC_KEY = {"regime": "accuracy", "eia": "mae", "returns": "brier"}


@router.get("/status")
async def get_model_status(db: DbSession) -> dict:
    rows = await db.execute(select(ModelVersion).where(ModelVersion.is_active.is_(True)))
    versions = rows.scalars().all()

    snapshot_row = await db.execute(
        select(FeatureSnapshot).order_by(desc(FeatureSnapshot.date)).limit(1)
    )
    latest_snapshot = snapshot_row.scalar_one_or_none()
    psi_scores = latest_snapshot.psi_scores if latest_snapshot else None

    # Only derive an alert once scores have actually been persisted, per
    # spec - absence of data is not the same as "no drift detected". PSI is
    # computed per-feature, not per-model-type (all three models draw on the
    # same active feature set), so the same value is reported for every model.
    psi = round(max(psi_scores.values()), 4) if psi_scores else None
    psi_alert = psi > PSI_RETRAIN_THRESHOLD if psi is not None else False

    models_out = [
        {
            "type": version.model_type,
            "version": version.version,
            "deployed_at": str(version.deployed_at) if version.deployed_at else None,
            "mlflow_run_id": version.mlflow_run_id,
            "metrics": {
                "primary": (version.metrics_oos or {}).get(
                    PRIMARY_METRIC_KEY.get(version.model_type, "accuracy")
                ),
                "psi": psi,
            },
            "psi_alert": psi_alert,
        }
        for version in versions
    ]

    return {
        "models": models_out,
        "data_sources": data_source_status(),
        "feature_coverage_7d": feature_coverage_7d(),
    }
