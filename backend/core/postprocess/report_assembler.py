from datetime import timedelta

import yaml

from core.config_paths import FEATURES_YAML
from core.data.registry import DataRegistry
from core.logging import get_logger
from core.models.regime import dominant_regime
from core.models.trainer import load_features
from core.postprocess.regime_stats import estimate_switch_probability, get_regime_duration
from db.models import FeatureSnapshot, Prediction

logger = get_logger(__name__)

COT_PERCENTILE_LOOKBACK_DAYS = 365 + 7  # ~52 weeks, with a small buffer
COT_PERCENTILE_MIN_SAMPLES = 20
PRICE_HISTORY_DAYS = 5


async def assemble_daily_report(prediction: Prediction, snapshot: FeatureSnapshot | None) -> dict:
    regime_probs = prediction.regime_probs or {}
    dominant = dominant_regime(regime_probs) or "R3"
    duration = await get_regime_duration(dominant)
    switch_prob = await estimate_switch_probability(dominant)
    features = snapshot.features if snapshot else {}
    decision = prediction.decision or {}
    return {
        "date": str(prediction.date),
        "price": features.get("wti") or decision.get("current_price"),
        "dominant_regime": dominant,
        "regime_probs": regime_probs,
        "return_dist": prediction.return_dist,
        "eia_forecast": prediction.eia_forecast,
        "decision": decision,
        "model_version": prediction.model_version.version if prediction.model_version else None,
        "var_95": round(
            (prediction.return_dist or {}).get("lt_minus10", 0.0)
            + (prediction.return_dist or {}).get("neg_10_0", 0.0),
            4,
        ),
        "shap_values": prediction.shap_values or {},
        "feature_signals": _build_signal_list(features),
        "regime_duration_weeks": duration // 5,
        "switch_prob_4w": switch_prob,
        "brent_wti_spread": round(features.get("brent_wti_spread", 0.0) or 0.0, 2),
        "ovx": round(features.get("ovx", 0.0) or 0.0, 1),
        "cot_net_percentile": _cot_net_percentile(features.get("spec_net_pct"), prediction.date),
        "price_5d_history": _price_5d_history(prediction.date),
    }


def _cot_net_percentile(current_value, as_of) -> float:
    """Percentile rank of the current spec_net_pct vs the trailing ~52-week
    window. Reads the backfilled (and daily-pipeline-appended) feature
    Parquet matrix rather than FeatureSnapshot - the latter only holds rows
    the live pipeline has actually produced going forward and is too sparse
    for a meaningful historical percentile (the same issue stress_test.py
    hit with FeatureSnapshot for historical scenario dates)."""
    if current_value is None:
        return 50.0
    try:
        start = as_of - timedelta(days=COT_PERCENTILE_LOOKBACK_DAYS)
        history = load_features(str(start), str(as_of))["spec_net_pct"].dropna()
    except Exception as exc:
        logger.warning(
            "COT percentile lookup failed, using neutral 50.0", extra={"error": str(exc)}
        )
        return 50.0
    if len(history) < COT_PERCENTILE_MIN_SAMPLES:
        # Too few historical observations for a meaningful rank - e.g. there's
        # a real calendar gap in this project's data between the backfill's
        # 2024-12-31 cutoff and whenever live daily pipeline runs began -
        # rather than a genuinely extreme reading, return neutral instead of
        # a mathematically-valid-but-meaningless 0th/100th percentile.
        return 50.0
    rank = (history < current_value).sum()
    return round(float(rank / len(history) * 100), 1)


def _price_5d_history(as_of) -> list[float]:
    """Last 5 WTI closing prices (oldest to newest), fetched directly rather
    than from FeatureSnapshot for the same sparsity reason as above."""
    try:
        wti = DataRegistry().fetch("wti", str(as_of - timedelta(days=14)), str(as_of)).dropna()
    except Exception as exc:
        logger.warning("Price history lookup failed", extra={"error": str(exc)})
        return []
    return [round(float(v), 2) for v in wti.tail(PRICE_HISTORY_DAYS).tolist()]


def _build_signal_list(features: dict) -> list[dict]:
    with open(FEATURES_YAML) as file:
        configs = yaml.safe_load(file)["features"]
    direction_map = {item["name"]: item.get("bearish_if_positive") for item in configs}
    signals = []
    for name, value in features.items():
        if value is None or not isinstance(value, int | float):
            continue
        bearish_if_positive = direction_map.get(name)
        if bearish_if_positive is None or value == 0:
            direction = "neutral"
        elif bearish_if_positive:
            direction = "bearish" if value > 0 else "bullish"
        else:
            direction = "bullish" if value > 0 else "bearish"
        signals.append({"name": name, "value": round(float(value), 4), "direction": direction})
    return sorted(signals, key=lambda item: abs(item["value"]), reverse=True)
