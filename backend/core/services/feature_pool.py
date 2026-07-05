"""Shared mutations for the active feature pool (config/features.yaml).

Extracted so the signals API routes (api/routes/signals.py) and the DS
Agent's add_to_feature_registry tool (core/agent/tool_handlers.py) share one
implementation - same pattern as core/services/deploy_service.py::do_deploy.
"""

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config_paths import FEATURES_YAML
from core.signal_scanner import CANDIDATE_SIGNALS_YAML
from db.models import ModelVersion


def _load_config() -> dict:
    with open(FEATURES_YAML) as f:
        return yaml.safe_load(f)


def _write_config(config: dict) -> None:
    with open(FEATURES_YAML, "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)


def load_pool() -> list[dict]:
    return _load_config()["features"]


def load_removed() -> list[dict]:
    """Removed entries are archived under a `removed:` sibling key in
    features.yaml rather than deleted - every yaml consumer reads only
    `features:` (features/engine.py etc.), so the archive is invisible to
    the pipeline but lets add_to_pool restore an entry verbatim. Without
    this, removing an *original* feature (one with no candidate_signals.yaml
    definition) was unrecoverable from the product."""
    return _load_config().get("removed", [])


def _display_defaults(source_key: str, signal_name: str) -> dict:
    """Best-effort display metadata when the caller doesn't supply it (the
    Signals page's one-click Add, unlike the DS Agent which asks the model
    for these). Purely cosmetic fields - meta_source/frequency/category feed
    UI labels, and bearish_if_positive only orients support-signal arrows in
    the report, not any model math. All editable in features.yaml."""
    if "inventory" in source_key:
        return {
            "meta_source": "EIA API",
            "frequency": "Weekly",
            "category": "Inventory",
            # Inventory builds are bearish for crude - matches every
            # existing inventory feature in features.yaml.
            "bearish_if_positive": True,
        }
    return {
        "meta_source": "Yahoo Finance",
        "frequency": "Daily",
        "category": "Cross-Asset" if "ret" in signal_name else "Other",
        "bearish_if_positive": False,
    }


def add_to_pool(
    signal_name: str,
    bearish_if_positive: bool | None = None,
    meta_source: str | None = None,
    frequency: str | None = None,
    category: str | None = None,
) -> dict:
    """Adds a known candidate to features.yaml, pulling its real technical
    definition (source key, transform, window/seasons) from
    candidate_signals.yaml. Returns {"error": ...} instead of raising so the
    DS Agent tool can hand the message straight back to the model."""
    config = _load_config()
    features = config["features"]
    if any(f["name"] == signal_name for f in features):
        return {"error": f"'{signal_name}' is already in the feature pool"}

    # A previously removed entry restores verbatim from the archive - the
    # only recovery path for original features, which have no candidate
    # definition to rebuild from.
    removed = config.get("removed", [])
    archived = next((e for e in removed if e["name"] == signal_name), None)
    if archived:
        config["removed"] = [e for e in removed if e["name"] != signal_name]
        if not config["removed"]:
            del config["removed"]
        features.append(archived)
        _write_config(config)
        return {"status": "restored", "signal_name": signal_name, "total_features": len(features)}

    with open(CANDIDATE_SIGNALS_YAML) as f:
        candidates = {c["name"]: c for c in yaml.safe_load(f)["candidates"]}
    candidate = candidates.get(signal_name)
    if not candidate:
        return {"error": f"'{signal_name}' is not a known candidate signal (not in candidate_signals.yaml)"}

    defaults = _display_defaults(candidate["source"], signal_name)
    entry = {
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
    # for pct_change/zscore, seasons for seasonal_dev) - transforms take
    # different parameter names, so copy whatever's present.
    for key in ("window", "seasons"):
        if key in candidate:
            entry[key] = candidate[key]

    features.append(entry)
    _write_config(config)
    return {"status": "added", "signal_name": signal_name, "total_features": len(features)}


def remove_from_pool(signal_name: str) -> dict:
    """Moves an entry from `features:` to the `removed:` archive - never
    deletes, so removal is always reversible via add_to_pool."""
    config = _load_config()
    features = config["features"]
    entry = next((f for f in features if f["name"] == signal_name), None)
    if entry is None:
        return {"error": f"'{signal_name}' is not in the feature pool"}
    config["features"] = [f for f in features if f["name"] != signal_name]
    # Replace any stale same-name archive entry rather than accumulating.
    config["removed"] = [e for e in config.get("removed", []) if e["name"] != signal_name]
    config["removed"].append(entry)
    _write_config(config)
    return {
        "status": "removed",
        "signal_name": signal_name,
        "total_features": len(config["features"]),
    }


async def live_feature_lists(db: AsyncSession) -> dict[str, list[str]]:
    """feature_list of every currently active model version, keyed by model
    type. The pool page derives 'live' vs 'pending retrain' from this, and
    removal guards check it: a feature removed from features.yaml but still
    in an active model's feature_list breaks the daily pipeline at predict
    time (the input vector is built by looking each name up in the day's
    snapshot) until that model is retrained."""
    rows = await db.execute(select(ModelVersion).where(ModelVersion.is_active.is_(True)))
    return {v.model_type: (v.feature_list or []) for v in rows.scalars().all()}


async def models_using(db: AsyncSession, feature_name: str) -> list[str]:
    return sorted(
        model_type
        for model_type, feature_list in (await live_feature_lists(db)).items()
        if feature_name in feature_list
    )
