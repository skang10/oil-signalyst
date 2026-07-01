import yaml

from core.config_paths import FEATURES_YAML
from core.postprocess.regime_stats import estimate_switch_probability, get_regime_duration
from db.models import FeatureSnapshot, Prediction


async def assemble_daily_report(prediction: Prediction, snapshot: FeatureSnapshot | None) -> dict:
    regime_probs = prediction.regime_probs or {}
    dominant = max(regime_probs, key=regime_probs.get) if regime_probs else "R3"
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
    }


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
