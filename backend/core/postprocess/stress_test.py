from datetime import date, timedelta

import pandas as pd
from sqlalchemy import select

from core.config_paths import FEATURES_DIR
from core.data.registry import DataRegistry
from core.exceptions import ModelNotFoundError
from core.logging import get_logger
from core.models.labels import return_bucket_for_value
from core.models.model_registry import ModelRegistry
from core.models.regime import dominant_regime, predict_regime
from core.models.regime_labels import build_regime_series
from core.models.returns import predict_returns
from db.database import get_db
from db.models import Prediction

logger = get_logger(__name__)

R3_DRAWDOWN_FALLBACK = -0.38  # historical reference: 2014 OPEC price war
R3_DRAWDOWN_MIN_OUTCOMES = 20

STRESS_SCENARIOS = {
    "2020_covid": date(2020, 3, 16),
    "2022_ukraine": date(2022, 3, 7),
    "2014_opec": date(2014, 11, 28),
}

SCENARIO_LABELS = {
    "2020_covid": "2020 Covid demand collapse",
    "2022_ukraine": "2022 Russia-Ukraine supply shock",
    "2014_opec": "2014 OPEC price war",
}

FORWARD_HORIZON_DAYS = 20
ALERT_THRESHOLD = 0.25


def _load_historical_feature_row(target_date: date, feature_list: list[str]) -> pd.Series | None:
    """Historical feature vectors live in the backfilled Parquet matrices, not
    FeatureSnapshot (which only holds rows the live daily pipeline has actually
    produced, going forward from whenever it started running - it was never
    backfilled for past dates)."""
    path = FEATURES_DIR / f"features_{target_date.year}.parquet"
    if not path.exists():
        return None
    df = pd.read_parquet(path)
    eligible = df[df.index.normalize() <= pd.Timestamp(target_date)]
    if eligible.empty:
        return None
    row = eligible.loc[eligible.index.max()]
    if any(name not in row.index or pd.isna(row[name]) for name in feature_list):
        return None
    return row[feature_list]


def _actual_forward_return(target_date: date, registry: DataRegistry) -> float | None:
    wti = registry.fetch(
        "wti", str(target_date - timedelta(days=5)), str(target_date + timedelta(days=60))
    ).dropna()
    eligible = wti[wti.index.normalize() <= pd.Timestamp(target_date)]
    if eligible.empty:
        return None
    start_idx = wti.index.get_loc(eligible.index[-1])
    if start_idx + FORWARD_HORIZON_DAYS >= len(wti):
        return None
    start_price = wti.iloc[start_idx]
    end_price = wti.iloc[start_idx + FORWARD_HORIZON_DAYS]
    return float(end_price / start_price - 1)


async def get_r3_max_drawdown() -> float:
    """Worst observed realized return among predictions whose dominant regime
    was R3 (derived from regime_probs at read time - there is no stored
    dominant_regime column). Falls back to a historical reference (the 2014
    OPEC price war) when too few R3 outcomes exist yet, which is expected
    early on since outcome_backfill needs real elapsed time to fill in
    actual_return.
    """
    async with get_db() as db:
        rows = await db.execute(
            select(Prediction.regime_probs, Prediction.actual_return).where(
                Prediction.actual_return.isnot(None)
            )
        )
        records = rows.all()

    r3_returns = [
        actual_return
        for regime_probs, actual_return in records
        if dominant_regime(regime_probs) == "R3"
    ]
    if len(r3_returns) < R3_DRAWDOWN_MIN_OUTCOMES:
        return R3_DRAWDOWN_FALLBACK
    return round(min(r3_returns), 4)


async def run_stress_test() -> dict:
    """Re-runs the active models against known historical extreme scenarios,
    comparing predictions against what actually happened. Returns structured
    per-scenario errors for missing snapshots/features rather than failing
    the whole request.
    """
    try:
        regime_artifact = await ModelRegistry.get_active("regime")
        returns_artifact = await ModelRegistry.get_active("returns")
    except ModelNotFoundError as exc:
        return {"scenarios": [], "error": f"Active models unavailable: {exc}"}

    regime_features = regime_artifact.get("feature_list") or []
    returns_features = returns_artifact.get("feature_list") or []
    # Union, so one Parquet read covers both models; each model is then indexed
    # by its own fit-time order below. The regime artifact is frozen at the old
    # column order while returns retrains against the sorted one, so the two
    # lists agree on membership but not necessarily on order.
    required_features = list(dict.fromkeys([*regime_features, *returns_features]))
    registry = DataRegistry()
    scenarios = []

    for key, scenario_date in STRESS_SCENARIOS.items():
        name = SCENARIO_LABELS[key]
        row = _load_historical_feature_row(scenario_date, required_features)
        if row is None:
            scenarios.append(
                {
                    "name": name,
                    "date": str(scenario_date),
                    "error": "Missing historical feature snapshot for this date",
                }
            )
            continue

        try:
            regime_probs = predict_regime(
                regime_artifact, row[regime_features].to_numpy(dtype=float)
            )
            return_dist = predict_returns(
                returns_artifact, row[returns_features].to_numpy(dtype=float)
            )
        except Exception as exc:
            logger.warning(
                "Stress scenario inference failed", extra={"scenario": key, "error": str(exc)}
            )
            scenarios.append({"name": name, "date": str(scenario_date), "error": str(exc)})
            continue

        dominant_regime_predicted = dominant_regime(regime_probs)
        actual_regime_series = build_regime_series(str(scenario_date), str(scenario_date))
        dominant_regime_actual = (
            actual_regime_series.iloc[0] if not actual_regime_series.empty else None
        )
        actual_return = _actual_forward_return(scenario_date, registry)
        model_alerted = None
        if actual_return is not None:
            actual_bucket = return_bucket_for_value(actual_return)
            model_alerted = return_dist.get(actual_bucket, 0.0) > ALERT_THRESHOLD

        scenarios.append(
            {
                "name": name,
                "date": str(scenario_date),
                "actual_return": round(actual_return, 4) if actual_return is not None else None,
                "model_alerted": model_alerted,
                "dominant_regime_predicted": dominant_regime_predicted,
                "dominant_regime_actual": dominant_regime_actual,
                "regime_probs": regime_probs,
                "return_dist": return_dist,
            }
        )

    return {"scenarios": scenarios}
