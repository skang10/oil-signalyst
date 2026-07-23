"""Summary statistics of the 4-bucket return distribution.

Single implementation, because these were previously either duplicated or
faked. The report shipped a hardcoded median (0.02), skewness (-0.3) and a
price range of +/-10%, and labelled the total downside probability as VaR - so
"VaR 47.3%" was a probability rendered as a return, and the risk view multiplied
it by the exposure to produce a dollar figure.

None of that was necessary: every one of these is a property of the bucket
distribution the model already emits.

RESOLUTION CAVEAT. The outer buckets are unbounded (< -10%, > +10%), so any
quantile falling inside one cannot be located - there is no distributional
detail past the edge. Those collapse to the bucket's representative value, the
same midpoints the expected return is built from. With a typical distribution
the entire 5% tail sits inside the lowest bucket, which is why VaR and CVaR come
out equal: at four buckets they are the same number, and presenting them as
distinct precision would be false. Callers should label them as bucket-limited.
"""

import numpy as np

# Must match core/models/labels.py::RETURN_BINS.
RETURN_EDGES = [-np.inf, -0.10, 0.0, 0.10, np.inf]
BUCKET_ORDER = ["lt_minus10", "neg_10_0", "pos_0_10", "gt_10"]

# Representative value of each bucket. The inner two are true midpoints; the
# outer two are conventional stand-ins for an unbounded tail.
RETURN_MIDPOINTS = {"lt_minus10": -0.15, "neg_10_0": -0.05, "pos_0_10": 0.05, "gt_10": 0.15}

VAR_CONFIDENCE = 0.05


def _weights(dist: dict) -> list[float]:
    return [dist.get(name, 0.0) for name in BUCKET_ORDER]


def quantile(dist: dict, q: float) -> float:
    """The q-quantile, interpolating linearly inside a bounded bucket.

    Falls back to the bucket's representative value when the quantile lands in
    an unbounded outer bucket - see the resolution caveat above.
    """
    cumulative = 0.0
    weights = _weights(dist)
    for index, weight in enumerate(weights):
        if weight <= 0:
            continue
        if cumulative + weight >= q:
            low, high = RETURN_EDGES[index], RETURN_EDGES[index + 1]
            if not np.isfinite(low) or not np.isfinite(high):
                return RETURN_MIDPOINTS[BUCKET_ORDER[index]]
            return low + (q - cumulative) / weight * (high - low)
        cumulative += weight
    return RETURN_MIDPOINTS[BUCKET_ORDER[-1]]


def is_bucket_limited(dist: dict, q: float) -> bool:
    """True when the q-quantile lands in an unbounded outer bucket.

    Callers must surface this. The value returned for such a quantile is the
    bucket's representative midpoint, not a located quantile - and with a
    typical distribution BOTH the 10th and 90th land outside, which makes the
    "80% interval" a constant +/-15% rather than anything read off the forecast.
    Presenting that as a resolved confidence interval repeats the mistake of the
    arbitrary +/-10% band it replaced.
    """
    cumulative = 0.0
    for index, name in enumerate(BUCKET_ORDER):
        weight = dist.get(name, 0.0)
        if weight <= 0:
            continue
        if cumulative + weight >= q:
            return not (
                np.isfinite(RETURN_EDGES[index]) and np.isfinite(RETURN_EDGES[index + 1])
            )
        cumulative += weight
    return True


def mean(dist: dict) -> float:
    return sum(dist.get(name, 0.0) * RETURN_MIDPOINTS[name] for name in BUCKET_ORDER)


def median(dist: dict) -> float:
    return quantile(dist, 0.5)


def value_at_risk(dist: dict) -> float:
    """The 5% quantile: the loss the outcome should only breach 5% of the time.

    Negative, and a return - not the downside probability the report used to
    show here.
    """
    return quantile(dist, VAR_CONFIDENCE)


def conditional_value_at_risk(dist: dict) -> float:
    """Expected return conditional on landing in the worst VAR_CONFIDENCE tail.

    Distinct from the old implementation, which averaged over *every* negative
    bucket - that is E[r | r < 0], a much milder quantity that was still
    labelled CVaR 95%.
    """
    remaining = VAR_CONFIDENCE
    total = 0.0
    for name in BUCKET_ORDER:
        weight = min(dist.get(name, 0.0), remaining)
        if weight <= 0:
            continue
        total += weight * RETURN_MIDPOINTS[name]
        remaining -= weight
        if remaining <= 0:
            break
    used = VAR_CONFIDENCE - remaining
    return total / used if used > 0 else 0.0


def variance(dist: dict) -> float:
    average = mean(dist)
    return sum(
        dist.get(name, 0.0) * (RETURN_MIDPOINTS[name] - average) ** 2 for name in BUCKET_ORDER
    )


def skewness(dist: dict) -> float:
    """Third standardised moment over the discretised distribution."""
    average = mean(dist)
    var = variance(dist)
    if var <= 0:
        return 0.0
    third = sum(
        dist.get(name, 0.0) * (RETURN_MIDPOINTS[name] - average) ** 3 for name in BUCKET_ORDER
    )
    return third / var**1.5
