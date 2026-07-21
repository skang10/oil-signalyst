import asyncio

from fastapi import APIRouter
from sqlalchemy import select

from api.dependencies import CurrentUser, DbSession, DSOnly
from core.postprocess.data_monitor import (
    data_source_status,
    feature_coverage_7d,
    feature_missing_rates,
    model_input_freshness,
    training_dataset_summary,
)
from core.models.metrics import PRIMARY_METRIC_KEY
from core.postprocess.drift_monitor import PSI_RETRAIN_THRESHOLD, compute_current_psi
from core.services.deploy_service import do_deploy
from db.models import ModelVersion

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("/status")
async def get_model_status(db: DbSession, user: CurrentUser) -> dict:
    del user
    rows = await db.execute(select(ModelVersion).where(ModelVersion.is_active.is_(True)))
    versions = rows.scalars().all()

    # Computed live from the Parquet matrix, not read from the latest
    # FeatureSnapshot row - that row's stored value was all zeros because PSI's
    # "recent" sample came from the sparse snapshot table. PSI is per-feature,
    # not per-model-type (all models share the active feature set), so the same
    # value is reported for every model.
    psi_scores = await asyncio.to_thread(compute_current_psi)
    psi = round(max(psi_scores.values()), 4) if psi_scores else None
    psi_alert = psi > PSI_RETRAIN_THRESHOLD if psi is not None else False

    def _model_entry(version: ModelVersion) -> dict:
        metrics_oos = version.metrics_oos or {}
        # 'regime' has no entry in PRIMARY_METRIC_KEY: it describes the current
        # market state rather than forecasting an observable outcome, so it is
        # reported as a state indicator with no score. is_forecast drives that
        # split in the UI.
        metric_key = PRIMARY_METRIC_KEY.get(version.model_type)
        return {
            "type": version.model_type,
            "version": version.version,
            "deployed_at": str(version.deployed_at) if version.deployed_at else None,
            "mlflow_run_id": version.mlflow_run_id,
            "is_forecast": metric_key is not None,
            "metrics": {
                "primary": metrics_oos.get(metric_key) if metric_key else None,
                "baseline": (metrics_oos.get("baseline") or {}).get(metric_key)
                if metric_key
                else None,
                "psi": psi,
            },
            "psi_alert": psi_alert,
        }

    models_out = [_model_entry(version) for version in versions]

    live_status = await asyncio.to_thread(data_source_status)
    return {
        "models": models_out,
        "data_sources": live_status,
        "model_input_freshness": await asyncio.to_thread(model_input_freshness, live_status),
        "feature_coverage_7d": feature_coverage_7d(),
        # Parquet reads - off the event loop, same as the fetchers above.
        "training_dataset": await asyncio.to_thread(training_dataset_summary),
        "feature_missing_rates": feature_missing_rates(),
        "feature_psi": [
            {"name": name, "psi": round(value, 4)}
            for name, value in sorted(
                (psi_scores or {}).items(), key=lambda item: item[1], reverse=True
            )
        ],
    }


@router.post("/{model_type}/deploy")
async def deploy_model(model_type: str, job_id: str, db: DbSession, user: DSOnly) -> dict:
    """Requires real auth (Phase 4) - the single most destructive route in
    the API (swaps the live production model) had no authentication at all
    before, not even the old X-User-Id header check. Logic lives in
    core/services/deploy_service.py::do_deploy(), shared with the DS
    Agent's deploy_model tool (core/agent/tool_handlers.py)."""
    del user
    return await do_deploy(model_type, job_id, db)
