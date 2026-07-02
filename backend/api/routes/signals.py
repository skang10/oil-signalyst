import yaml
from fastapi import APIRouter
from sqlalchemy import desc, select

from api.dependencies import DbSession
from core.config_paths import FEATURES_YAML
from core.postprocess.signal_charts import build_signal_charts
from db.models import ModelVersion, SignalEvaluation

router = APIRouter(prefix="/api/signals", tags=["signals"])


@router.get("/candidates")
async def get_candidate_signals(db: DbSession) -> list[dict]:
    rows = await db.execute(select(SignalEvaluation).order_by(desc(SignalEvaluation.evaluated_at)))

    seen: set[str] = set()
    results = []
    for evaluation in rows.scalars().all():
        if evaluation.signal_name in seen:
            continue  # keep only the most recent evaluation per signal
        seen.add(evaluation.signal_name)
        results.append(
            {
                "name": evaluation.signal_name,
                "ic_scores": evaluation.ic_scores,
                "oos_decay": evaluation.oos_decay,
                "coverage": evaluation.coverage,
                "correlation": evaluation.correlation,
                "status": evaluation.status,
                "mechanism": evaluation.mechanism,
                "evaluated_at": str(evaluation.evaluated_at),
            }
        )
    return results


@router.get("/evaluate/{signal_name}")
async def get_signal_evaluation(signal_name: str, db: DbSession) -> dict:
    row = await db.execute(
        select(SignalEvaluation)
        .where(SignalEvaluation.signal_name == signal_name)
        .order_by(desc(SignalEvaluation.evaluated_at))
        .limit(1)
    )
    evaluation = row.scalar_one_or_none()
    if not evaluation:
        return {"error": "signal not found"}

    charts = await build_signal_charts(signal_name)
    if charts is None:
        return {"error": "signal not found in candidate config"}

    return {
        "name": signal_name,
        "price_history": charts["price_history"],
        "rolling_ic": charts["rolling_ic"],
        "oos_by_year": charts["oos_by_year"],
        # Richer than a flat Record<string, number>: per-lag train/val IC and
        # both raw and Bonferroni-corrected p-values, from the signal scanner.
        "ic_scores": evaluation.ic_scores,
        "oos_decay": evaluation.oos_decay,
        "coverage": evaluation.coverage,
        "recommendation": evaluation.status,
    }


@router.get("/active")
async def get_active_signals(db: DbSession) -> list[dict]:
    row = await db.execute(
        select(ModelVersion).where(
            ModelVersion.model_type == "regime", ModelVersion.is_active.is_(True)
        )
    )
    version = row.scalar_one_or_none()
    active_names = version.feature_list if version else []

    with open(FEATURES_YAML) as f:
        configs = {fc["name"]: fc for fc in yaml.safe_load(f)["features"]}

    return [
        {
            "name": name,
            "source": configs.get(name, {}).get("meta_source", "Unknown"),
            "frequency": configs.get(name, {}).get("frequency", "Unknown"),
            "category": configs.get(name, {}).get("category", "Other"),
        }
        for name in active_names
    ]
