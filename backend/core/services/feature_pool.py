"""Feature-pool membership, backed by the pool_features DB table.

config/features.yaml is only the first-run seed (ensure_seeded imports it
into the table when the table is empty, including its legacy `removed:`
archive) and is never written at runtime - pool membership is runtime
state like train_jobs/model_versions, so it lives in the DB with a
changed_by/changed_at audit trail instead of dirtying version control on
every UI click.

Two access paths:
- async CRUD (add/remove/definitions) for API routes and the DS Agent tool
- sync reads via a small sync SQLAlchemy engine for pipeline-side callers
  that can't await (FeatureEngine, report_assembler, signal_charts' worker
  thread)
"""

from datetime import UTC, datetime

import yaml
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from core.config import settings
from core.config_paths import FEATURES_YAML
from core.logging import get_logger
from core.signal_scanner import CANDIDATE_SIGNALS_YAML
from db.models import ModelVersion, PoolFeature

logger = get_logger(__name__)

_sync_engine = None


def _get_sync_engine():
    global _sync_engine
    if _sync_engine is None:
        _sync_engine = create_engine(settings.db_url.replace("+aiosqlite", ""), echo=False)
    return _sync_engine


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def ensure_seeded() -> None:
    """Imports config/features.yaml into pool_features when the table is
    empty (first run after the migration, or a fresh install). The yaml's
    legacy `removed:` archive seeds status='removed' rows so previously
    removed features stay restorable."""
    with Session(_get_sync_engine()) as session:
        existing = session.execute(select(PoolFeature.id).limit(1)).first()
        if existing:
            return
        with open(FEATURES_YAML) as f:
            config = yaml.safe_load(f)
        for entry in config.get("features", []):
            session.add(PoolFeature(name=entry["name"], definition=entry, status="active"))
        for entry in config.get("removed", []):
            session.add(PoolFeature(name=entry["name"], definition=entry, status="removed"))
        session.commit()
        logger.info(
            "Feature pool seeded from features.yaml",
            extra={
                "active": len(config.get("features", [])),
                "removed": len(config.get("removed", [])),
            },
        )


def load_pool_sync() -> list[dict]:
    """Active feature definitions, for sync pipeline callers (FeatureEngine,
    report_assembler). Insertion order = original yaml order for seeded rows."""
    ensure_seeded()
    with Session(_get_sync_engine()) as session:
        rows = session.execute(
            select(PoolFeature).where(PoolFeature.status == "active").order_by(PoolFeature.id)
        )
        return [row.definition for row in rows.scalars().all()]


async def pool_definitions(db: AsyncSession, status: str | None = "active") -> list[dict]:
    """Feature definitions for async API callers. status=None returns all
    rows (metadata lookups need removed features' definitions too)."""
    query = select(PoolFeature).order_by(PoolFeature.id)
    if status is not None:
        query = query.where(PoolFeature.status == status)
    rows = await db.execute(query)
    return [row.definition for row in rows.scalars().all()]


def _display_defaults(source_key: str, signal_name: str) -> dict:
    """Best-effort display metadata when the caller doesn't supply it (the
    Signals page's one-click Add, unlike the DS Agent which asks the model
    for these). Purely cosmetic fields - meta_source/frequency/category feed
    UI labels, and bearish_if_positive only orients support-signal arrows in
    the report, not any model math."""
    if "inventory" in source_key:
        return {
            "meta_source": "EIA API",
            "frequency": "Weekly",
            "category": "Inventory",
            # Inventory builds are bearish for crude - matches every
            # existing inventory feature in the pool.
            "bearish_if_positive": True,
        }
    return {
        "meta_source": "Yahoo Finance",
        "frequency": "Daily",
        "category": "Cross-Asset" if "ret" in signal_name else "Other",
        "bearish_if_positive": False,
    }


async def add_to_pool(
    db: AsyncSession,
    signal_name: str,
    changed_by: int | None = None,
    bearish_if_positive: bool | None = None,
    meta_source: str | None = None,
    frequency: str | None = None,
    category: str | None = None,
) -> dict:
    """Adds a known candidate to the pool, or restores a removed entry
    verbatim (the only recovery path for original features, which have no
    candidate definition to rebuild from). Returns {"error": ...} instead of
    raising so the DS Agent tool can hand the message straight back."""
    ensure_seeded()
    row = (
        await db.execute(select(PoolFeature).where(PoolFeature.name == signal_name))
    ).scalar_one_or_none()

    if row and row.status == "active":
        return {"error": f"'{signal_name}' is already in the feature pool"}

    if row:  # previously removed - restore its stored definition verbatim
        row.status = "active"
        row.changed_by = changed_by
        row.changed_at = _now()
        db.add(row)
        total = await _active_count(db)
        return {"status": "restored", "signal_name": signal_name, "total_features": total}

    with open(CANDIDATE_SIGNALS_YAML) as f:
        candidates = {c["name"]: c for c in yaml.safe_load(f)["candidates"]}
    candidate = candidates.get(signal_name)
    if not candidate:
        return {"error": f"'{signal_name}' is not a known candidate signal (not in candidate_signals.yaml)"}

    defaults = _display_defaults(candidate["source"], signal_name)
    definition = {
        "name": signal_name,
        "source": candidate["source"],
        "transform": candidate["transform"],
        "bearish_if_positive": (
            bearish_if_positive if bearish_if_positive is not None else defaults["bearish_if_positive"]
        ),
        "meta_source": meta_source or defaults["meta_source"],
        "frequency": frequency or defaults["frequency"],
        "category": category or defaults["category"],
    }
    # Copy whichever transform-specific parameter the candidate uses (window
    # for pct_change/zscore, seasons for seasonal_dev).
    for key in ("window", "seasons"):
        if key in candidate:
            definition[key] = candidate[key]

    db.add(
        PoolFeature(
            name=signal_name, definition=definition, status="active", changed_by=changed_by
        )
    )
    total = await _active_count(db) + 1  # +1: the new row isn't flushed yet
    return {"status": "added", "signal_name": signal_name, "total_features": total}


async def remove_from_pool(
    db: AsyncSession, signal_name: str, changed_by: int | None = None
) -> dict:
    """Flips an entry to status='removed' - never deletes, so removal is
    always reversible via add_to_pool."""
    ensure_seeded()
    row = (
        await db.execute(
            select(PoolFeature).where(
                PoolFeature.name == signal_name, PoolFeature.status == "active"
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return {"error": f"'{signal_name}' is not in the feature pool"}
    row.status = "removed"
    row.changed_by = changed_by
    row.changed_at = _now()
    db.add(row)
    total = await _active_count(db) - 1  # -1: the status flip isn't flushed yet
    return {"status": "removed", "signal_name": signal_name, "total_features": total}


async def _active_count(db: AsyncSession) -> int:
    rows = await db.execute(select(PoolFeature).where(PoolFeature.status == "active"))
    return len(rows.scalars().all())


async def live_feature_lists(db: AsyncSession) -> dict[str, list[str]]:
    """feature_list of every currently active model version, keyed by model
    type. The pool page derives 'live' vs 'pending retrain' from this, and
    removal guards check it: a feature removed from the pool but still in an
    active model's feature_list breaks the daily pipeline at predict time
    (the input vector is built by looking each name up in the day's
    snapshot) until that model is retrained."""
    rows = await db.execute(select(ModelVersion).where(ModelVersion.is_active.is_(True)))
    return {v.model_type: (v.feature_list or []) for v in rows.scalars().all()}


async def models_using(db: AsyncSession, feature_name: str) -> list[str]:
    return sorted(
        model_type
        for model_type, feature_list in (await live_feature_lists(db)).items()
        if feature_name in feature_list
    )
