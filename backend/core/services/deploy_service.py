from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.models.model_registry import ModelRegistry
from db.models import ModelVersion, TrainJob


async def do_deploy(model_type: str, job_id: str, db: AsyncSession) -> dict:
    """Explicitly (re-)promotes the model_type version trained by job_id to
    active.

    Extracted from api/routes/models.py::deploy_model() so both the FastAPI
    route and the DS Agent's deploy_model tool (core/agent/tool_handlers.py)
    share one implementation - the route handler can't be called directly
    from the tool handler (it requires Depends()-injected db/user and can't
    run outside a request context).

    Two things bring a model live: run_full_training() auto-activates a newly
    trained model, but only if it clears the deployment gate
    (core/models/metrics.py::evaluate_deployment_gate). A gated model is saved
    inactive, which makes this route the promotion path for it as well as the
    rollback path to an older version.

    Deploying a gated model is allowed on purpose - this is the human override.
    The response carries a `warning` with the gate's reasons so the caller can
    confirm rather than promote one by accident. Following this function's
    existing convention, that rides in a 200 body rather than an HTTP error.
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
    result = {"status": "deployed", "version": target.version, "model_type": model_type}

    gate = (target.metrics_oos or {}).get("deployment_gate") or {}
    if gate.get("passed") is False:
        result["warning"] = (
            "This version did not pass the deployment gate and was promoted by override: "
            + "; ".join(gate.get("reasons") or [])
        )
    return result
