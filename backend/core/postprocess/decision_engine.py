from core.models.regime import dominant_regime

RETURN_MIDPOINTS = {"lt_minus10": -0.15, "neg_10_0": -0.05, "pos_0_10": 0.05, "gt_10": 0.15}


def _cvar_95(return_dist: dict) -> float:
    """Conditional expected loss given the outcome falls in the downside tail
    (the two below-zero return buckets), approximated from bucket midpoints."""
    p_lt = return_dist.get("lt_minus10", 0.0)
    p_neg = return_dist.get("neg_10_0", 0.0)
    total_downside = p_lt + p_neg
    if total_downside == 0:
        return 0.0
    weighted_loss = p_lt * RETURN_MIDPOINTS["lt_minus10"] + p_neg * RETURN_MIDPOINTS["neg_10_0"]
    return round(weighted_loss / total_downside, 4)


def _kelly_position(return_dist: dict, expected_ret: float) -> float:
    """Mean/variance Kelly approximation (f* = |mu| / sigma^2) over the
    discretized return distribution, capped to [0, 1]. Represents position
    sizing magnitude only; `direction` carries the sign."""
    variance = sum(
        return_dist.get(bucket, 0.0) * (midpoint - expected_ret) ** 2
        for bucket, midpoint in RETURN_MIDPOINTS.items()
    )
    if variance <= 0:
        return 0.0
    return round(max(0.0, min(abs(expected_ret) / variance, 1.0)), 4)


def generate_decision(
    regime_probs: dict,
    return_dist: dict,
    current_price: float,
    exposure_barrels: int = 100_000,
    regime_confidence_threshold: float = 0.35,
    baseline_models: list[str] | None = None,
) -> dict:
    """`baseline_models` names the model types currently served by a constant
    baseline artifact rather than a trained model (see core/models/baseline_model).

    When `returns` is among them, the sizing outputs are suppressed to None. The
    direction gate already handles itself - climatology's expected return is
    +0.29%, well inside the +/-2% dead zone, so direction comes out FLAT on its
    own. But hedge_ratio passes through no gate at all: it is downside_prob * 1.5,
    and climatology's downside_prob is just the historical base rate that ~47% of
    20-day windows are negative. That would render as "hedge 70,950 barrels" - an
    actionable recommendation carrying no information. Same for cvar_95 and
    kelly_position, which are pure restatements of the same constant distribution.

    Suppressed as None rather than 0.0 on purpose: 0.0 is itself a recommendation
    ("do not hedge"), and this is an abstention.
    """
    downside_prob = return_dist.get("lt_minus10", 0.0) + return_dist.get("neg_10_0", 0.0)
    upside_prob = return_dist.get("pos_0_10", 0.0) + return_dist.get("gt_10", 0.0)
    expected_ret = sum(
        return_dist.get(bucket, 0.0) * midpoint for bucket, midpoint in RETURN_MIDPOINTS.items()
    )
    dominant = dominant_regime(regime_probs) or "R3"
    confidence = regime_probs.get(dominant, 0.0)

    confident_enough = confidence >= regime_confidence_threshold
    if expected_ret > 0.02 and upside_prob > downside_prob and confident_enough:
        direction = "LONG"
        position_size = min(expected_ret / 0.05, 1.0)
    elif expected_ret < -0.02 and downside_prob > upside_prob:
        direction = "SHORT"
        position_size = min(abs(expected_ret) / 0.05, 1.0)
    else:
        direction = "FLAT"
        position_size = 0.0

    hedge_ratio = min(max(downside_prob * 1.5, 0.0), 0.9)
    stop_loss = current_price * (0.92 if direction != "SHORT" else 1.08)
    stop_loss_pct = round((current_price - stop_loss) / current_price, 4)
    cvar_95 = _cvar_95(return_dist)
    kelly_position = _kelly_position(return_dist, expected_ret)

    baseline_models = baseline_models or []
    on_baseline = "returns" in baseline_models

    if on_baseline:
        rationale = (
            "The returns model in production is the constant baseline - it emits the "
            "2012-2024 bucket frequencies and reads no features. Position sizing, "
            "hedging, CVaR and Kelly are withheld: any number they produced would be "
            "a restatement of the historical base rate, not a forecast. "
            f"Dominant regime {dominant} ({confidence:.0%})."
        )
    else:
        rationale = (
            f"Dominant regime {dominant} ({confidence:.0%}). "
            f"Downside risk {downside_prob:.0%}, expected return {expected_ret:+.1%}, "
            f"CVaR (95%) {cvar_95:+.1%}, Kelly size {kelly_position:.0%}."
        )

    return {
        "direction": direction,
        "position_size": round(position_size, 3),
        "hedge_ratio": None if on_baseline else round(hedge_ratio, 3),
        "hedge_notional_barrels": None if on_baseline else round(exposure_barrels * hedge_ratio),
        "stop_loss": round(stop_loss, 2),
        "stop_loss_pct": stop_loss_pct,
        "current_price": round(current_price, 2),
        "expected_ret": round(expected_ret, 4),
        "downside_prob": round(downside_prob, 4),
        "cvar_95": None if on_baseline else cvar_95,
        "kelly_position": None if on_baseline else kelly_position,
        # Surfaced all the way to the report page so the suppression is explained
        # where it is seen, not silently absent.
        "baseline_models": baseline_models,
        "rationale": rationale,
    }
