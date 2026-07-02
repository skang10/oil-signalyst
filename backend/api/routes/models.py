from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import desc, select, text

from api.dependencies import DbSession
from core.models.model_registry import ModelRegistry
from core.postprocess.data_monitor import (
    data_source_status,
    feature_coverage_7d,
    feature_missing_rates,
)
from core.postprocess.drift_monitor import PSI_RETRAIN_THRESHOLD
from db.models import FeatureSnapshot, ModelVersion, TrainJob

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
        "feature_missing_rates": feature_missing_rates(),
        "feature_psi": [
            {"name": name, "psi": round(value, 4)}
            for name, value in sorted(
                (psi_scores or {}).items(), key=lambda item: item[1], reverse=True
            )
        ],
    }


@router.post("/{model_type}/deploy")
async def deploy_model(model_type: str, job_id: str, db: DbSession) -> dict:
    """Explicitly (re-)promotes the model_type version trained by job_id to
    active.

    Note: run_full_training() already auto-activates each newly trained
    model as soon as it finishes (see trainer.py::_save_model) - there is no
    staged "candidate, not yet live" state in this system. So under normal
    operation this endpoint is a no-op confirmation for the most recent job.
    Its real utility is rollback: promoting a specific *older* completed
    job's version back to active after a later training run has since
    superseded it, and re-invalidating the ModelRegistry cache.
    """
    job = await db.get(TrainJob, job_id)
    if not job or job.status != "complete":
        return {"error": "job not complete or not found"}

    version = (job.result or {}).get("versions", {}).get(model_type)
    if not version:
        return {"error": f"no trained version for model_type '{model_type}' in this job"}

    row = await db.execute(
        select(ModelVersion).where(
            ModelVersion.model_type == model_type, ModelVersion.version == version
        )
    )
    target = row.scalar_one_or_none()
    if not target:
        return {"error": "target model version not found"}

    # Exclude target's own row from the bulk deactivation: a raw UPDATE
    # doesn't refresh the already-loaded `target` ORM object's in-memory
    # state, so if it touched target's row too, the *next* line
    # (target.is_active = True) would look like a no-op change (still True
    # in Python's view) and never get flushed, leaving zero active rows for
    # this model_type.
    await db.execute(
        text(
            "UPDATE model_versions SET is_active = 0 "
            "WHERE model_type = :model_type AND id != :target_id"
        ),
        {"model_type": model_type, "target_id": target.id},
    )
    target.is_active = True
    target.deployed_at = datetime.now(UTC).replace(tzinfo=None)
    db.add(target)

    ModelRegistry.invalidate(model_type)
    return {"status": "deployed", "version": target.version, "model_type": model_type}
