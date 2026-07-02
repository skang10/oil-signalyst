from fastapi import APIRouter
from sqlalchemy import desc, select

from api.dependencies import DbSession
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


@router.get("/active")
async def get_active_signals(db: DbSession) -> list[dict]:
    row = await db.execute(
        select(ModelVersion).where(
            ModelVersion.model_type == "regime", ModelVersion.is_active.is_(True)
        )
    )
    version = row.scalar_one_or_none()
    return [{"name": name} for name in (version.feature_list if version else [])]
