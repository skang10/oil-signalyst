from datetime import UTC, datetime

import yaml
from fastapi import APIRouter, HTTPException
from sqlalchemy import desc, select

from api.dependencies import CurrentUser, DbSession
from core.config_paths import FEATURES_YAML
from core.postprocess.signal_charts import build_signal_charts
from core.services import feature_pool
from db.models import ModelVersion, SignalEvaluation

router = APIRouter(prefix="/api/signals", tags=["signals"])

# Ignoring a candidate is a snooze, not a verdict: after this many days the
# ignore expires (read-time check, nothing deleted) and the signal shows up
# as a fresh candidate again, so a signal dismissed in one market regime
# gets reconsidered in the next.
IGNORE_SNOOZE_DAYS = 30

# Signal scanner's scan-quality classification -> frontend's adoption
# recommendation. These are near-synonyms by design (see core/signal_scanner.py
# ::_status) - candidate/watch/rejected literally mean add/watch/reject.
_RECOMMENDATION_BY_SCAN_STATUS = {"candidate": "add", "watch": "watch", "rejected": "reject"}


def _label(name: str) -> str:
    return name.replace("_", " ").title()


def _ignore_days_left(ignored_at: datetime | None) -> int | None:
    """Days until an ignore snooze expires; None when not ignored or already
    expired (expired = candidate again, enforced here at read time rather
    than by any deletion job)."""
    if not ignored_at:
        return None
    elapsed_days = (datetime.now(UTC).replace(tzinfo=None) - ignored_at).days
    left = IGNORE_SNOOZE_DAYS - elapsed_days
    return left if left > 0 else None


def _lifecycle_status(
    signal_name: str,
    scan_status: str,
    pool_names: set[str],
    ignore_days_left: int | None,
) -> str:
    """"active"/"ignored"/"candidate" is the feature's adoption lifecycle,
    distinct from the scanner's scan-quality status (candidate/watch/
    rejected) - the two get conflated onto one field name by the frontend
    contract. "active" means membership in the features.yaml pool (the DS's
    adoption decision, effective immediately) rather than the live model's
    feature_list, which lags until the next retrain."""
    if signal_name in pool_names:
        return "active"
    if ignore_days_left is not None:
        return "ignored"
    if scan_status == "rejected":
        return "ignored"
    return "candidate"


@router.get("")
async def get_signals(db: DbSession, user: CurrentUser) -> dict:
    """Combined view for the Signals page: the managed feature pool
    (features.yaml + live-model membership), the live-model feature list
    (legacy `active` shape), and candidates under evaluation."""
    del user
    active = await _active_signals(db)
    pool = await _pool_signals(db)
    pool_names = {p["name"] for p in pool if p["pool_status"] != "removed_pending_retrain"}
    return {
        "active": active,
        "pool": pool,
        "candidates": await _candidate_signals(db, pool_names),
    }


@router.get("/candidates")
async def get_candidate_signals(db: DbSession, user: CurrentUser) -> list[dict]:
    del user
    pool_names = {f["name"] for f in feature_pool.load_pool()}
    return await _candidate_signals(db, pool_names)


async def _pool_signals(db: DbSession) -> list[dict]:
    """The managed feature pool: every features.yaml entry, badged with
    which live models actually use it ('live' vs 'pending_retrain'), plus
    ghost rows for features a live model still depends on but that were
    removed from the yaml ('removed_pending_retrain') - those break the
    daily pipeline at predict time until the model is retrained, so they
    must stay visible rather than silently disappearing from the page."""
    entries = feature_pool.load_pool()
    live_lists = await feature_pool.live_feature_lists(db)

    pool = []
    for entry in entries:
        name = entry["name"]
        used_by = sorted(mt for mt, fl in live_lists.items() if name in fl)
        pool.append(
            {
                "name": name,
                "label": _label(name),
                "category": entry.get("category", "Other"),
                "source": entry.get("meta_source", "Unknown"),
                "frequency": entry.get("frequency", "Unknown"),
                "transform": entry.get("transform"),
                "used_by": used_by,
                "pool_status": "live" if used_by else "pending_retrain",
            }
        )

    # Regime-probability columns (p_R1..p_R4) are synthesized at training
    # time for the returns model (trainer.py::predict_regime_batch concat),
    # not features.yaml entries - they'd otherwise show up as scary
    # "removed" ghosts on every install.
    from core.models.regime import REGIME_PROB_COLUMNS

    pool_names = {p["name"] for p in pool} | set(REGIME_PROB_COLUMNS)
    ghost_used_by: dict[str, list[str]] = {}
    for model_type, feature_list in live_lists.items():
        for name in feature_list:
            if name not in pool_names:
                ghost_used_by.setdefault(name, []).append(model_type)
    for name, used_by in sorted(ghost_used_by.items()):
        pool.append(
            {
                "name": name,
                "label": _label(name),
                "category": "—",
                "source": "removed from pool",
                "frequency": "—",
                "transform": None,
                "used_by": sorted(used_by),
                "pool_status": "removed_pending_retrain",
            }
        )
    return pool


async def _latest_evaluation(db: DbSession, signal_name: str) -> SignalEvaluation | None:
    row = await db.execute(
        select(SignalEvaluation)
        .where(SignalEvaluation.signal_name == signal_name)
        .order_by(desc(SignalEvaluation.evaluated_at))
        .limit(1)
    )
    return row.scalar_one_or_none()


async def _candidate_signals(db: DbSession, pool_names: set[str]) -> list[dict]:
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
        days_left = _ignore_days_left(evaluation.ignored_at)
        results.append(
            {
                "name": evaluation.signal_name,
                "label": _label(evaluation.signal_name),
                "ic5": ic5,
                "ic20": ic20,
                "decay": evaluation.oos_decay,
                "coverage": evaluation.coverage,
                "status": _lifecycle_status(
                    evaluation.signal_name, evaluation.status, pool_names, days_left
                ),
                "recommendation": _RECOMMENDATION_BY_SCAN_STATUS.get(evaluation.status, "reject"),
                "ignored_days_left": days_left,
            }
        )
    return results


@router.post("/{signal_name}/pool")
async def add_signal_to_pool(signal_name: str, db: DbSession, user: CurrentUser) -> dict:
    """Adds a candidate to config/features.yaml (shared logic with the DS
    Agent's add_to_feature_registry tool). Takes effect on the next feature
    build; live models are untouched until retrained."""
    del user
    result = feature_pool.add_to_pool(signal_name)
    if "error" in result:
        raise HTTPException(status_code=409, detail=result["error"])
    # Adding is the strongest possible un-ignore.
    evaluation = await _latest_evaluation(db, signal_name)
    if evaluation and evaluation.ignored_at:
        evaluation.ignored_at = None
        db.add(evaluation)
    return result


@router.delete("/{signal_name}/pool")
async def remove_signal_from_pool(
    signal_name: str, db: DbSession, user: CurrentUser, force: bool = False
) -> dict:
    """Reverts an add. Guarded: a feature still in a live model's
    feature_list breaks the daily pipeline at predict time once it stops
    being computed, so removal of an in-use feature requires force=true
    (frontend shows a confirm dialog) and a retrain afterwards."""
    del user
    used_by = await feature_pool.models_using(db, signal_name)
    if used_by and not force:
        raise HTTPException(
            status_code=409,
            detail={
                "used_by": used_by,
                "message": (
                    f"'{signal_name}' is used by the live {', '.join(used_by)} "
                    "model(s). Removing it will break daily predictions until "
                    "those models are retrained."
                ),
            },
        )
    result = feature_pool.remove_from_pool(signal_name)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    result["was_used_by"] = used_by
    return result


@router.post("/{signal_name}/ignore")
async def ignore_signal(signal_name: str, db: DbSession, user: CurrentUser) -> dict:
    """Snoozes a candidate for IGNORE_SNOOZE_DAYS. Nothing is deleted - the
    ignore expires at read time and the signal returns to the candidate list."""
    del user
    evaluation = await _latest_evaluation(db, signal_name)
    if not evaluation:
        raise HTTPException(status_code=404, detail="signal not found")
    evaluation.ignored_at = datetime.now(UTC).replace(tzinfo=None)
    db.add(evaluation)
    return {"status": "ignored", "expires_in_days": IGNORE_SNOOZE_DAYS}


@router.post("/{signal_name}/restore")
async def restore_signal(signal_name: str, db: DbSession, user: CurrentUser) -> dict:
    """Ends an ignore snooze early - the candidate is immediately back."""
    del user
    evaluation = await _latest_evaluation(db, signal_name)
    if not evaluation:
        raise HTTPException(status_code=404, detail="signal not found")
    evaluation.ignored_at = None
    db.add(evaluation)
    return {"status": "restored"}


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

    pool_names = {f["name"] for f in feature_pool.load_pool()}
    days_left = _ignore_days_left(evaluation.ignored_at)
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
        "status": _lifecycle_status(signal_name, evaluation.status, pool_names, days_left),
        "recommendation": _RECOMMENDATION_BY_SCAN_STATUS.get(evaluation.status, "reject"),
        "ignored_days_left": days_left,
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
