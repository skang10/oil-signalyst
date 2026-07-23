from datetime import timedelta

import pandas as pd

from core.data.registry import DataRegistry
from core.logging import get_logger
from core.models.labels import return_bucket_for_value
from core.models.regime import dominant_regime
from core.models.trainer import load_features
from core.postprocess import return_distribution as rd
from core.postprocess.regime_stats import (
    estimate_switch_probability,
    get_regime_duration,
    historical_avg_duration_weeks,
    historical_segment_count,
)
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
        # The 5% quantile of the return distribution. This used to be
        # lt_minus10 + neg_10_0 - the total downside PROBABILITY - which the
        # risk view then multiplied by the exposure to print a dollar figure,
        # so a 47% base rate became "$4.7M at risk".
        "var_95": round(rd.value_at_risk(prediction.return_dist or {}), 4),
        # {"by_model": {type: {feature: contribution}}, "status": {type: reason}}.
        # Older rows hold a flat {feature: contribution} dict of the regime
        # model's values; _model_shap tolerates both.
        "shap_values": prediction.shap_values or {},
        "feature_signals": _build_signal_list(features),
        "regime_duration_weeks": duration // 5,
        "regime_historical_avg_duration_weeks": historical_avg_duration_weeks(dominant),
        # Sample size travels with the statistic: these are means over a
        # handful of hand-drawn segments (R1 has 5, R4 has 1), and without the
        # count "60.8 weeks" reads like a population parameter.
        "regime_historical_segment_count": historical_segment_count(dominant),
        "switch_prob_4w": switch_prob["probability"],
        "switch_prob_basis": switch_prob,
        "brent_wti_spread": round(features.get("brent_wti_spread", 0.0) or 0.0, 2),
        "ovx": round(features.get("ovx", 0.0) or 0.0, 1),
        "cot_net_percentile": _cot_net_percentile(features.get("spec_net_pct"), prediction.date),
        "price_5d_history": _price_5d_history(prediction.date),
        # Held-out metrics of whatever eia model is live, so the report can state
        # its real accuracy instead of the hardcoded 0.712 / 1.3 / 1.9 it used to
        # print - figures that flattered a model whose true direction accuracy is
        # near a coin flip.
        "eia_metrics": await _active_metrics("eia"),
    }


async def _active_metrics(model_type: str) -> dict:
    """metrics_oos of the currently deployed model of this type, or {}."""
    from core.models.model_registry import ModelRegistry

    version = await ModelRegistry.get_active_version(model_type)
    return (version.metrics_oos or {}) if version else {}


def nest_daily_report(
    raw: dict, role: str, exposure_barrels: float, r3_max_drawdown: float
) -> dict:
    """Wraps the raw assembled report into the frontend's nested DailyReport
    contract (trader/risk/eia/regime/returns sub-objects, per
    frontend/src/types/api.ts). Most fields are real data just reshaped; a
    two still have no model backing - the per-product EIA breakdown (no model,
    no labels) and the switch-trigger narrative - and are null or static,
    marked below. Everything else is computed."""
    decision = raw["decision"] or {}
    return_dist = raw["return_dist"] or {}
    eia_forecast = raw["eia_forecast"] or {}
    price = raw["price"] or 0.0
    price_hist = raw["price_5d_history"] or []
    wti_change_pct = (
        round((price - price_hist[-2]) / price_hist[-2], 4)
        if len(price_hist) >= 2 and price_hist[-2]
        else 0.0
    )
    eia_shap, eia_shap_status = _model_shap(raw["shap_values"], "eia")
    regime_shap, regime_shap_status = _model_shap(raw["shap_values"], "regime")
    eia_drivers = _shap_drivers(eia_shap, raw["feature_signals"])
    regime_drivers = _shap_drivers(regime_shap, raw["feature_signals"])
    eia_metrics = raw.get("eia_metrics") or {}
    crude_mb = eia_forecast.get("crude", 0.0)
    tail_prob = round(return_dist.get("lt_minus10", 0.0) + return_dist.get("gt_10", 0.0), 4)
    upside_prob = round(return_dist.get("pos_0_10", 0.0) + return_dist.get("gt_10", 0.0), 4)

    return {
        "date": raw["date"],
        "role": role,
        "wti_price": price,
        "wti_change_pct": wti_change_pct,
        # Model types served by a constant baseline instead of a trained model.
        # Non-empty means several numbers below are deliberately null - the
        # report page explains it rather than leaving them silently blank.
        "baseline_models": decision.get("baseline_models") or [],
        # False when no regime model is deployed. The regime block below is
        # still populated (its historical statistics are hand-curated and do not
        # come from the model), but `probabilities` is empty and `dominant`
        # carries no evidence - the UI must show an empty state rather than
        # render R3 at 0% as though it were a call.
        "regime_available": bool(raw["regime_probs"]),
        "trader": {
            "signal": decision.get("direction", "FLAT"),
            "kelly_position": decision.get("kelly_position", 0.0),
            "stop_loss_price": decision.get("stop_loss"),
            "stop_loss_pct": decision.get("stop_loss_pct", 0.0),
            "expected_return": decision.get("expected_ret", 0.0),
            "price_5d_history": price_hist,
            "price_5d_high": max(price_hist) if price_hist else price,
            "price_5d_low": min(price_hist) if price_hist else price,
            "brent_wti_spread": raw["brent_wti_spread"],
            "cot_net_percentile": raw["cot_net_percentile"],
            "ovx": raw["ovx"],
        },
        "risk": {
            "var_95": raw["var_95"],
            "cvar_95": decision.get("cvar_95", 0.0),
            "current_exposure_mbbls": round(exposure_barrels / 1_000_000, 4),
            "hedge_ratio": decision.get("hedge_ratio", 0.0),
            "recommended_hedge_ratio": decision.get("hedge_ratio", 0.0),
            "r3_historical_max_drawdown": r3_max_drawdown,
        },
        "eia": {
            "forecast_mb": crude_mb,
            # Empirical 80% interval from the live model's out-of-sample
            # residuals, centred on today's forecast. Null when the deployed
            # version predates residual tracking - the UI omits the band rather
            # than inventing one.
            "interval_80_low": (
                round(crude_mb + eia_metrics["residual_p10"], 2)
                if "residual_p10" in eia_metrics
                else None
            ),
            "interval_80_high": (
                round(crude_mb + eia_metrics["residual_p90"], 2)
                if "residual_p90" in eia_metrics
                else None
            ),
            "consensus_mb": eia_forecast.get("market_consensus", 0.0),
            "surprise_mb": eia_forecast.get("surprise", 0.0),
            # Only crude is forecast. There is no gasoline/distillate/Cushing
            # model and no labels for them, so unlike every other field here
            # these genuinely cannot be computed - null, and the UI says so,
            # rather than the -1.1 / 0.6 / -0.9 constants it used to show
            # alongside the real crude number as though all four were forecasts.
            "breakdown": {
                "crude": crude_mb,
                "gasoline": None,
                "distillate": None,
                "cushing": None,
            },
            "shap_drivers": [
                # A normalised share of total attribution (the set sums to 1),
                # NOT million barrels - it was named contribution_mb and rendered
                # as "+0.2" beside a forecast in MB, which read as a barrel figure.
                {"name": d["name"], "contribution_share": d["contribution"]}
                for d in eia_drivers
            ],
            # Why the list is empty, so the tab can explain itself instead of
            # rendering a blank card.
            "shap_status": eia_shap_status,
            # The live model's own held-out figures.
            "historical_direction_accuracy": eia_metrics.get("direction_acc"),
            "historical_mae": eia_metrics.get("mae"),
            # The model's MAE minus its edge over the rolling-consensus
            # reference, i.e. what that reference itself scored. Null when the
            # model did not record the comparison.
            "consensus_mae": (
                round(eia_metrics["mae"] - eia_metrics["mae_vs_consensus"], 4)
                if "mae" in eia_metrics and "mae_vs_consensus" in eia_metrics
                else None
            ),
        },
        "regime": {
            "probabilities": raw["regime_probs"],
            "dominant": raw["dominant_regime"],
            "duration_weeks": raw["regime_duration_weeks"],
            "historical_avg_duration": raw["regime_historical_avg_duration_weeks"],
            "historical_segment_count": raw["regime_historical_segment_count"],
            "switch_probability_4w": raw["switch_prob_4w"],
            # The counts behind the ratio, so the UI can state what it means
            # rather than rendering a bare percentage.
            "switch_probability_basis": raw["switch_prob_basis"],
            "support_signals": [
                {"name": s["name"], "value": str(s["value"]), "direction": s["direction"]}
                for s in raw["feature_signals"][:5]
            ],
            # Static placeholder: no generated narrative trigger text today.
            "switch_trigger": (
                "Sustained break of key technical support/resistance, or a shift in "
                "OPEC+ supply policy."
            ),
            "shap_drivers": regime_drivers,
            "shap_status": regime_shap_status,
        },
        "returns": {
            # `condition_description` used to sit here, reading "Regime {X}
            # dominant with N% downside probability" - a leftover from when the
            # returns model took regime probabilities as input. It no longer
            # does, so the sentence described a conditioning that does not
            # happen. Dropped rather than reworded: there is no generated
            # narrative to replace it with.
            "buckets": [
                {"label": "< -10%", "pct": return_dist.get("lt_minus10", 0.0), "color": "danger"},
                {
                    "label": "-10% to 0%",
                    "pct": return_dist.get("neg_10_0", 0.0),
                    "color": "warning",
                },
                {
                    "label": "0% to +10%",
                    "pct": return_dist.get("pos_0_10", 0.0),
                    "color": "success",
                },
                {"label": "> +10%", "pct": return_dist.get("gt_10", 0.0), "color": "accent"},
            ],
            "expected_return": decision.get("expected_ret", 0.0),
            # All computed from the bucket distribution the model emits - see
            # core/postprocess/return_distribution.py. These were a hardcoded
            # median and skewness, and a var_95 that was actually the total
            # downside PROBABILITY rendered as a return.
            "median_return": round(rd.median(return_dist), 4),
            "var_95": round(rd.value_at_risk(return_dist), 4),
            "skewness": round(rd.skewness(return_dist), 4),
            # 10th-90th percentile of the return distribution applied to spot,
            # replacing an arbitrary +/-10% band unrelated to the forecast.
            "price_range_low": round(price * (1 + rd.quantile(return_dist, 0.10)), 2),
            "price_range_high": round(price * (1 + rd.quantile(return_dist, 0.90)), 2),
            # True when the outer, unbounded buckets had to stand in for a
            # quantile - VaR and CVaR then coincide and are bucket-limited.
            "tail_resolution_limited": rd.quantile(return_dist, 0.05) == rd.RETURN_MIDPOINTS["lt_minus10"],
            "downside_prob": decision.get("downside_prob", 0.0),
            "tail_prob": tail_prob,
            "upside_prob": upside_prob,
        },
    }


def _model_shap(shap_values: dict, model_type: str) -> tuple[dict, str]:
    """One model's contributions plus the reason there may be none.

    Accepts the flat legacy shape (the regime model's values, stored before
    contributions were tracked per model) so old predictions still render.
    """
    if not shap_values:
        return {}, "unavailable"
    if "by_model" in shap_values:
        values = (shap_values.get("by_model") or {}).get(model_type) or {}
        status = (shap_values.get("status") or {}).get(model_type) or "unavailable"
        return values, status
    legacy = shap_values if model_type == "regime" else {}
    return legacy, "ok" if legacy else "unavailable"


def _shap_drivers(shap_values: dict, feature_signals: list[dict], top_n: int = 6) -> list[dict]:
    """Reshapes the raw SHAP contribution dict into a ranked {name,
    contribution, direction} list. Direction reuses feature_signals'
    bearish_if_positive convention (intrinsic to the feature) rather than
    the contribution's own sign."""
    direction_by_name = {item["name"]: item["direction"] for item in feature_signals}
    items = [
        {
            "name": name,
            "contribution": round(float(value), 4),
            "direction": direction_by_name.get(name, "bullish" if value > 0 else "bearish"),
        }
        for name, value in (shap_values or {}).items()
        if isinstance(value, int | float)
    ]
    return sorted(items, key=lambda item: abs(item["contribution"]), reverse=True)[:top_n]


def build_history_response(predictions: list[Prediction]) -> dict:
    """Reshapes recent Prediction rows into the frontend's HistoryResponse
    contract: a per-day prediction list plus rolling accuracy metrics.
    Accuracy is scored only against genuinely observed outcomes: real
    crude_inventory changes for eia, realized forward returns for the return
    distribution. Regime is deliberately absent - it has no observable outcome
    to be scored against."""
    empty_accuracy = {
        "eia_directional_acc": 0.0,
        "returns_brier": 0.0,
    }
    if not predictions:
        return {"predictions": [], "rolling_accuracy": empty_accuracy}

    dates = [p.date for p in predictions]
    start, end = str(min(dates)), str(max(dates))

    try:
        crude = DataRegistry().fetch("crude_inventory", start, end).dropna().sort_index()
        actual_eia_change = crude[crude.ne(crude.shift())].diff() / 1000
    except Exception as exc:
        logger.warning("History EIA actual lookup failed", extra={"error": str(exc)})
        actual_eia_change = pd.Series(dtype=float)

    rows = []
    eia_hits, eia_total = 0, 0
    brier_scores = []
    bucket_order = ["lt_minus10", "neg_10_0", "pos_0_10", "gt_10"]

    for p in predictions:
        regime_probs = p.regime_probs or {}
        dominant = dominant_regime(regime_probs)
        decision = p.decision or {}
        eia_forecast = p.eia_forecast or {}
        rows.append(
            {
                "date": str(p.date),
                "wti_price": decision.get("current_price"),
                "regime_dominant": dominant,
                "signal": decision.get("direction", "FLAT"),
                "expected_return": decision.get("expected_ret", 0.0),
                "downside_prob": decision.get("downside_prob", 0.0),
                "eia_forecast_mb": eia_forecast.get("crude"),
                "actual_return": p.actual_return,
            }
        )

        ts = pd.Timestamp(p.date)
        if ts in actual_eia_change.index and eia_forecast.get("crude") is not None:
            actual_chg = actual_eia_change.loc[ts]
            if pd.notna(actual_chg):
                eia_total += 1
                if (actual_chg > 0) == (eia_forecast["crude"] > 0):
                    eia_hits += 1

        if p.actual_return is not None and p.return_dist:
            actual_bucket = return_bucket_for_value(p.actual_return)
            brier_scores.append(
                sum(
                    (p.return_dist.get(b, 0.0) - (1.0 if b == actual_bucket else 0.0)) ** 2
                    for b in bucket_order
                )
            )

    return {
        "predictions": rows,
        "rolling_accuracy": {
            # No regime entry: it used to compare the model's dominant regime
            # against build_regime_series(), i.e. a hardcoded table of 17 dates.
            # That measures agreement with a constant, not accuracy - unlike the
            # two below, which score against observed inventory and realized
            # returns.
            "eia_directional_acc": round(eia_hits / eia_total, 4) if eia_total else 0.0,
            "returns_brier": round(sum(brier_scores) / len(brier_scores), 4)
            if brier_scores
            else 0.0,
        },
    }


def build_history_detail(
    prediction: Prediction,
    snapshot: FeatureSnapshot | None,
    duration_weeks: int,
    switch_probability_basis: dict,
    eia_actual_mb: float | None,
) -> dict:
    """Reshapes a single Prediction (+ its async-derived regime/outcome stats)
    into the frontend's HistoryDetail contract for the History drawer."""
    regime_probs = prediction.regime_probs or {}
    dominant = dominant_regime(regime_probs)
    decision = prediction.decision or {}
    eia_forecast = prediction.eia_forecast or {}
    features = snapshot.features if snapshot else {}
    signal_list = _build_signal_list(features)[:8]
    max_abs = max((abs(s["value"]) for s in signal_list), default=1.0) or 1.0

    return {
        "date": str(prediction.date),
        "wti_price": decision.get("current_price"),
        "model_version": prediction.model_version.version if prediction.model_version else None,
        "summary": {
            "signal": decision.get("direction", "FLAT"),
            "expected_return": decision.get("expected_ret", 0.0),
            "downside_prob": decision.get("downside_prob", 0.0),
            "eia_forecast_mb": eia_forecast.get("crude"),
            "risk_recommendation": decision.get("rationale", ""),
        },
        "regime": {
            "probabilities": regime_probs,
            "dominant": dominant,
            "duration_weeks": duration_weeks,
            "switch_probability_4w": switch_probability_basis["probability"],
            "switch_probability_basis": switch_probability_basis,
        },
        "features": [
            {
                "name": s["name"],
                "widthPct": round(abs(s["value"]) / max_abs * 100, 1),
                "value": s["value"],
            }
            for s in signal_list
        ],
        "outcome": {
            "eia_actual_mb": eia_actual_mb,
            "actual_return": prediction.actual_return,
        },
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
    from core.services.feature_pool import load_pool_sync

    direction_map = {item["name"]: item.get("bearish_if_positive") for item in load_pool_sync()}
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
