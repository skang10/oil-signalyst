from datetime import timedelta

import pandas as pd

from core.data.registry import DataRegistry
from core.logging import get_logger
from core.models.labels import return_bucket_for_value
from core.models.regime import dominant_regime
from core.models.regime_labels import build_regime_series
from core.models.trainer import load_features
from core.postprocess.regime_stats import (
    estimate_switch_probability,
    get_regime_duration,
    historical_avg_duration_weeks,
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
        "var_95": round(
            (prediction.return_dist or {}).get("lt_minus10", 0.0)
            + (prediction.return_dist or {}).get("neg_10_0", 0.0),
            4,
        ),
        "shap_values": prediction.shap_values or {},
        "feature_signals": _build_signal_list(features),
        "regime_duration_weeks": duration // 5,
        "regime_historical_avg_duration_weeks": historical_avg_duration_weeks(dominant),
        "switch_prob_4w": switch_prob,
        "brent_wti_spread": round(features.get("brent_wti_spread", 0.0) or 0.0, 2),
        "ovx": round(features.get("ovx", 0.0) or 0.0, 1),
        "cot_net_percentile": _cot_net_percentile(features.get("spec_net_pct"), prediction.date),
        "price_5d_history": _price_5d_history(prediction.date),
    }


def nest_daily_report(
    raw: dict, role: str, exposure_barrels: float, r3_max_drawdown: float
) -> dict:
    """Wraps the raw assembled report into the frontend's nested DailyReport
    contract (trader/risk/eia/regime/returns sub-objects, per
    frontend/src/types/api.ts). Most fields are real data just reshaped; a
    handful have no model backing today (EIA breakdown beyond crude, a
    switch-trigger narrative, return-distribution moments beyond the 4-bucket
    categorical) and are static placeholders, marked below - see the Phase
    2.4 backend/frontend gap analysis."""
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
    shap_drivers = _shap_drivers(raw["shap_values"], raw["feature_signals"])
    crude_mb = eia_forecast.get("crude", 0.0)
    tail_prob = round(return_dist.get("lt_minus10", 0.0) + return_dist.get("gt_10", 0.0), 4)
    upside_prob = round(return_dist.get("pos_0_10", 0.0) + return_dist.get("gt_10", 0.0), 4)

    return {
        "date": raw["date"],
        "role": role,
        "wti_price": price,
        "wti_change_pct": wti_change_pct,
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
            # Static placeholder: no confidence-interval output from the model today.
            "interval_80_low": round(crude_mb - 1.7, 2),
            "interval_80_high": round(crude_mb + 1.7, 2),
            "consensus_mb": eia_forecast.get("market_consensus", 0.0),
            "surprise_mb": eia_forecast.get("surprise", 0.0),
            "breakdown": {
                "crude": crude_mb,
                # Static placeholders: model forecasts crude only, not per-product.
                "gasoline": -1.1,
                "distillate": 0.6,
                "cushing": -0.9,
            },
            "shap_drivers": [
                {"name": d["name"], "contribution_mb": d["contribution"]} for d in shap_drivers
            ],
            # Static placeholders: no rolling EIA accuracy tracking today.
            "historical_direction_accuracy": 0.712,
            "historical_mae": 1.3,
            "consensus_mae": 1.9,
        },
        "regime": {
            "probabilities": raw["regime_probs"],
            "dominant": raw["dominant_regime"],
            "duration_weeks": raw["regime_duration_weeks"],
            "historical_avg_duration": raw["regime_historical_avg_duration_weeks"],
            "switch_probability_4w": raw["switch_prob_4w"],
            "support_signals": [
                {"name": s["name"], "value": str(s["value"]), "direction": s["direction"]}
                for s in raw["feature_signals"][:5]
            ],
            # Static placeholder: no generated narrative trigger text today.
            "switch_trigger": (
                "Sustained break of key technical support/resistance, or a shift in "
                "OPEC+ supply policy."
            ),
            "shap_drivers": shap_drivers,
        },
        "returns": {
            # Static placeholder: no generated narrative summary today.
            "condition_description": (
                f"Regime {raw['dominant_regime']} dominant with "
                f"{round(decision.get('downside_prob', 0.0) * 100)}% downside probability."
            ),
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
            # Static placeholders: the 4-bucket categorical distribution has no
            # resolution for a continuous median/skewness.
            "median_return": 0.02,
            "var_95": raw["var_95"],
            "skewness": -0.3,
            "price_range_low": round(price * 0.9, 2),
            "price_range_high": round(price * 1.1, 2),
            "downside_prob": decision.get("downside_prob", 0.0),
            "tail_prob": tail_prob,
            "upside_prob": upside_prob,
        },
    }


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
    Accuracy is computed for real against actual outcomes where available
    (the hand-curated regime series and real crude_inventory changes - the
    same sources regime_stats.py/labels.py already use), not against a
    backfilled column - only the returns model has one (outcome_correct)."""
    empty_accuracy = {
        "regime_directional_acc": 0.0,
        "eia_directional_acc": 0.0,
        "returns_brier": 0.0,
    }
    if not predictions:
        return {"predictions": [], "rolling_accuracy": empty_accuracy}

    dates = [p.date for p in predictions]
    start, end = str(min(dates)), str(max(dates))

    true_regime_series = build_regime_series(start, end)
    try:
        crude = DataRegistry().fetch("crude_inventory", start, end).dropna().sort_index()
        actual_eia_change = crude[crude.ne(crude.shift())].diff() / 1000
    except Exception as exc:
        logger.warning("History EIA actual lookup failed", extra={"error": str(exc)})
        actual_eia_change = pd.Series(dtype=float)

    rows = []
    regime_hits, regime_total = 0, 0
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
        if ts in true_regime_series.index:
            regime_total += 1
            if true_regime_series.loc[ts] == dominant:
                regime_hits += 1

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
            "regime_directional_acc": round(regime_hits / regime_total, 4)
            if regime_total
            else 0.0,
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
    switch_probability_4w: float,
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
            "switch_probability_4w": switch_probability_4w,
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
