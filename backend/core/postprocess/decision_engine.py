def generate_decision(
    regime_probs: dict,
    return_dist: dict,
    current_price: float,
    exposure_barrels: int = 100_000,
) -> dict:
    del exposure_barrels
    downside_prob = return_dist.get("lt_minus10", 0.0) + return_dist.get("neg_10_0", 0.0)
    upside_prob = return_dist.get("pos_0_10", 0.0) + return_dist.get("gt_10", 0.0)
    expected_ret = (
        return_dist.get("lt_minus10", 0.0) * -0.15
        + return_dist.get("neg_10_0", 0.0) * -0.05
        + return_dist.get("pos_0_10", 0.0) * 0.05
        + return_dist.get("gt_10", 0.0) * 0.15
    )
    dominant = max(regime_probs, key=regime_probs.get) if regime_probs else "R3"
    confidence = regime_probs.get(dominant, 0.0)

    if expected_ret > 0.02 and upside_prob > downside_prob and confidence >= 0.35:
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
    return {
        "direction": direction,
        "position_size": round(position_size, 3),
        "hedge_ratio": round(hedge_ratio, 3),
        "stop_loss": round(stop_loss, 2),
        "current_price": round(current_price, 2),
        "expected_ret": round(expected_ret, 4),
        "downside_prob": round(downside_prob, 4),
        "rationale": (
            f"Dominant regime {dominant} ({confidence:.0%}). "
            f"Downside risk {downside_prob:.0%}, expected return {expected_ret:+.1%}."
        ),
    }
