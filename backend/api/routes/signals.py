import yaml
from fastapi import APIRouter, HTTPException
from sqlalchemy import desc, select

from api.dependencies import CurrentUser, DbSession
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


def _lifecycle_status(signal_name: str, scan_status: str, active_names: set[str]) -> str:
    """"active"/"ignored"/"candidate" is the feature's adoption lifecycle (is
    it live in the model?), distinct from the scanner's scan-quality status
    (candidate/watch/rejected) - the two get conflated onto one field name by
    the frontend contract, so derive lifecycle from membership in the real
    active feature list."""
    if signal_name in active_names:
        return "active"
    if scan_status == "rejected":
        return "ignored"
    return "candidate"


@router.get("")
async def get_signals(db: DbSession, user: CurrentUser) -> dict:
    """Combined view for the Signals page: currently-active features plus
    candidates under evaluation, in the single shape the frontend expects."""
    del user
    active = await _active_signals(db)
    active_names = {a["name"] for a in active}
    return {"active": active, "candidates": await _candidate_signals(db, active_names)}


@router.get("/candidates")
async def get_candidate_signals(db: DbSession, user: CurrentUser) -> list[dict]:
    del user
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
        results.append(
            {
                "name": evaluation.signal_name,
                "label": _label(evaluation.signal_name),
                "ic5": ic5,
                "ic20": ic20,
                "decay": evaluation.oos_decay,
                "coverage": evaluation.coverage,
                "status": _lifecycle_status(evaluation.signal_name, evaluation.status, active_names),
                "recommendation": _RECOMMENDATION_BY_SCAN_STATUS.get(evaluation.status, "reject"),
            }
        )
    return results


@router.get("/evaluate/{signal_name}")
async def get_signal_evaluation(signal_name: str, db: DbSession, user: CurrentUser) -> dict:
    del user
    row = await db.execute(
        select(SignalEvaluation)
        .where(SignalEvaluation.signal_name == signal_name)
        .order_by(desc(SignalEvaluation.evaluated_at))
        .limit(1)
    )
    evaluation = row.scalar_one_or_none()
    if not evaluation:
        raise HTTPException(status_code=404, detail="signal not found")

    charts = await build_signal_charts(signal_name)
    if charts is None:
        raise HTTPException(status_code=404, detail="signal not found in candidate config")

    active_names = {a["name"] for a in await _active_signals(db)}
    ic_scores = evaluation.ic_scores or {}
    price_history = charts["price_history"]
    rolling_ic = charts["rolling_ic"]

    return {
        "name": signal_name,
        "label": _label(signal_name),
        "ic5": (ic_scores.get("5") or {}).get("val_ic", 0.0),
        # ic10 has no scanner equivalent (IC_LAGS_DAYS tests 5/20/60, not 10) -
        # see build_signal_charts's own ic10 comment for why it's computed
        # separately rather than stubbed.
        "ic10": charts["ic10"],
        "ic20": (ic_scores.get("20") or {}).get("val_ic", 0.0),
        "decay": evaluation.oos_decay,
        "coverage": evaluation.coverage,
        "status": _lifecycle_status(signal_name, evaluation.status, active_names),
        "recommendation": _RECOMMENDATION_BY_SCAN_STATUS.get(evaluation.status, "reject"),
        "price": [p["price"] for p in price_history],
        "signal": [p["signal"] for p in price_history],
        "dates": [p["date"] for p in price_history],
        "ic5_series": [p["ic_5d"] for p in rolling_ic],
        "ic10_series": [p["ic_10d"] for p in rolling_ic],
        "ic20_series": [p["ic_20d"] for p in rolling_ic],
        "oos_years": charts["oos_by_year"],
    }


@router.get("/active")
async def get_active_signals(db: DbSession, user: CurrentUser) -> list[dict]:
    del user
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
