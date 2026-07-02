from core.models.regime import dominant_regime


def test_dominant_regime_picks_highest_probability():
    assert dominant_regime({"R1": 0.1, "R2": 0.6, "R3": 0.2, "R4": 0.1}) == "R2"


def test_dominant_regime_none_for_empty_or_missing():
    assert dominant_regime({}) is None
    assert dominant_regime(None) is None
