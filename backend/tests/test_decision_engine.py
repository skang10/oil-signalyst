from core.postprocess.decision_engine import generate_decision


def test_decision_preserves_existing_contract_keys():
    regime_probs = {"R1": 0.6, "R2": 0.1, "R3": 0.2, "R4": 0.1}
    return_dist = {"lt_minus10": 0.1, "neg_10_0": 0.2, "pos_0_10": 0.3, "gt_10": 0.4}

    decision = generate_decision(regime_probs, return_dist, current_price=70.0)

    for key in (
        "direction",
        "position_size",
        "hedge_ratio",
        "stop_loss",
        "current_price",
        "expected_ret",
        "downside_prob",
        "rationale",
    ):
        assert key in decision


def test_cvar_95_is_negative_and_worse_than_var_downside_prob():
    regime_probs = {"R1": 0.6, "R2": 0.1, "R3": 0.2, "R4": 0.1}
    return_dist = {"lt_minus10": 0.3, "neg_10_0": 0.1, "pos_0_10": 0.3, "gt_10": 0.3}

    decision = generate_decision(regime_probs, return_dist, current_price=70.0)

    assert decision["cvar_95"] < 0
    # Weighted toward the worse bucket (lt_minus10 dominates neg_10_0 3:1).
    assert decision["cvar_95"] < -0.05


def test_cvar_95_is_zero_with_no_downside_probability():
    regime_probs = {"R1": 0.6, "R2": 0.1, "R3": 0.2, "R4": 0.1}
    return_dist = {"lt_minus10": 0.0, "neg_10_0": 0.0, "pos_0_10": 0.5, "gt_10": 0.5}

    decision = generate_decision(regime_probs, return_dist, current_price=70.0)

    assert decision["cvar_95"] == 0.0


def test_kelly_position_bounded_between_zero_and_one():
    regime_probs = {"R1": 0.9, "R2": 0.03, "R3": 0.03, "R4": 0.04}
    return_dist = {"lt_minus10": 0.0, "neg_10_0": 0.0, "pos_0_10": 0.0, "gt_10": 1.0}

    decision = generate_decision(regime_probs, return_dist, current_price=70.0)

    assert 0.0 <= decision["kelly_position"] <= 1.0


def test_hedge_notional_barrels_scales_with_exposure():
    regime_probs = {"R1": 0.2, "R2": 0.2, "R3": 0.2, "R4": 0.4}
    return_dist = {"lt_minus10": 0.4, "neg_10_0": 0.3, "pos_0_10": 0.2, "gt_10": 0.1}

    small = generate_decision(
        regime_probs, return_dist, current_price=70.0, exposure_barrels=1000
    )
    large = generate_decision(
        regime_probs, return_dist, current_price=70.0, exposure_barrels=100_000
    )

    assert large["hedge_notional_barrels"] == small["hedge_notional_barrels"] * 100


def test_regime_confidence_threshold_gates_long_signal():
    regime_probs = {"R1": 0.32, "R2": 0.1, "R3": 0.1, "R4": 0.48}
    return_dist = {"lt_minus10": 0.05, "neg_10_0": 0.1, "pos_0_10": 0.3, "gt_10": 0.55}

    strict = generate_decision(
        regime_probs, return_dist, current_price=70.0, regime_confidence_threshold=0.9
    )
    assert strict["direction"] != "LONG"


def test_no_regime_model_holds_direction_flat():
    """Empty regime_probs means no regime model is deployed at all.

    It is a frozen state descriptor with no observable outcome, so it is not
    trainable and has no baseline - a fresh system simply has none, and the
    eia/returns forecasts should still be served. But a directional position
    needs a regime call, so the absence must read as no confidence.
    """
    strongly_bearish = {"lt_minus10": 0.6, "neg_10_0": 0.3, "pos_0_10": 0.05, "gt_10": 0.05}
    decision = generate_decision({}, strongly_bearish, current_price=70.0)

    assert decision["regime_available"] is False
    assert decision["direction"] == "FLAT"
    assert decision["position_size"] == 0.0
    assert "No regime model deployed" in decision["rationale"]


def test_short_requires_regime_confidence_like_long():
    """SHORT used to skip the confidence gate that LONG had to clear.

    The gate asks whether the regime signal can be trusted at all, which is
    direction-agnostic; with the asymmetry, a low-confidence regime forbade
    going long while still permitting a short.
    """
    strongly_bearish = {"lt_minus10": 0.6, "neg_10_0": 0.3, "pos_0_10": 0.05, "gt_10": 0.05}
    unconfident = {"R1": 0.26, "R2": 0.25, "R3": 0.25, "R4": 0.24}

    assert generate_decision(unconfident, strongly_bearish, 70.0)["direction"] == "FLAT"
    # Same distribution, a confident regime call - now the short is allowed.
    confident = {"R1": 0.7, "R2": 0.1, "R3": 0.1, "R4": 0.1}
    assert generate_decision(confident, strongly_bearish, 70.0)["direction"] == "SHORT"


def test_baseline_returns_model_withholds_sizing():
    """A constant baseline restates the historical base rate; sizing derived
    from it would be an actionable recommendation carrying no information.
    Withheld as None, never 0.0 - zero is itself a recommendation."""
    climatology = {"lt_minus10": 0.127, "neg_10_0": 0.346, "pos_0_10": 0.398, "gt_10": 0.129}
    confident = {"R1": 0.7, "R2": 0.1, "R3": 0.1, "R4": 0.1}
    decision = generate_decision(confident, climatology, 68.0, baseline_models=["returns"])

    for field in ("hedge_ratio", "hedge_notional_barrels", "cvar_95", "kelly_position"):
        assert decision[field] is None, field
    assert decision["baseline_models"] == ["returns"]
