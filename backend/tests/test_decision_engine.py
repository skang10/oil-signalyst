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
