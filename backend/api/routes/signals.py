import yaml
from fastapi import APIRouter
from sqlalchemy import desc, select

from api.dependencies import DbSession
from core.config_paths import FEATURES_YAML
from core.postprocess.signal_charts import build_signal_charts
from db.models import ModelVersion, SignalEvaluation

router = APIRouter(prefix="/api/signals", tags=["signals"])

# Signal scanner's scan-quality classification -> frontend's adoption
# recommendation. These are near-synonyms by design (see core/signal_scanner.py
# ::_status) - candidate/watch/rejected literally mean add/watch/reject.
_RECOMMENDATION_BY_SCAN_STATUS = {"candidate": "add", "watch": "watch", "rejected": "reject"}


def _label(name: str) -> str:
    return name.replace("_", " ").title()


@router.get("")
async def get_signals(db: DbSession) -> dict:
    """Combined view for the Signals page: currently-active features plus
    candidates under evaluation, in the single shape the frontend expects."""
    active = await _active_signals(db)
    active_names = {a["name"] for a in active}
    return {"active": active, "candidates": await _candidate_signals(db, active_names)}


@router.get("/candidates")
async def get_candidate_signals(db: DbSession) -> list[dict]:
    active = await _active_signals(db)
    return await _candidate_signals(db, {a["name"] for a in active})


async def _candidate_signals(db: DbSession, active_names: set[str]) -> list[dict]:
    rows = await db.execute(select(SignalEvaluation).order_by(desc(SignalEvaluation.evaluated_at)))

    seen: set[str] = set()
    results = []
    for evaluation in rows.scalars().all():
        if evaluation.signal_name in seen:
            continue  # keep only the most recent evaluation per signal
        seen.add(evaluation.signal_name)
        ic_scores = evaluation.ic_scores or {}
        ic5 = (ic_scores.get("5") or {}).get("val_ic", 0.0)
        ic20 = (ic_scores.get("20") or {}).get("val_ic", 0.0)
        # "active"/"ignored"/"candidate" is the feature's adoption lifecycle
        # (is it live in the model?), distinct from the scanner's scan-quality
        # status (candidate/watch/rejected) - the two get conflated onto one
        # field name by the frontend contract, so derive lifecycle from
        # membership in the real active feature list.
        if evaluation.signal_name in active_names:
            lifecycle_status = "active"
        elif evaluation.status == "rejected":
            lifecycle_status = "ignored"
        else:
            lifecycle_status = "candidate"
        results.append(
            {
                "name": evaluation.signal_name,
                "label": _label(evaluation.signal_name),
                "ic5": ic5,
                "ic20": ic20,
                "decay": evaluation.oos_decay,
                "coverage": evaluation.coverage,
                "status": lifecycle_status,
                "recommendation": _RECOMMENDATION_BY_SCAN_STATUS.get(evaluation.status, "reject"),
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
        "recommendation": _RECOMMENDATION_BY_SCAN_STATUS.get(evaluation.status, "reject"),
    }


@router.get("/active")
async def get_active_signals(db: DbSession) -> list[dict]:
    return await _active_signals(db)


async def _active_signals(db: DbSession) -> list[dict]:
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
