import numpy as np
import pandas as pd

from core.postprocess.drift_monitor import compute_psi_scores, population_stability_index


def test_psi_near_zero_for_identical_distributions():
    rng = np.random.default_rng(0)
    reference = rng.normal(size=1000)
    actual = reference.copy()

    psi = population_stability_index(reference, actual)

    assert psi < 0.01


def test_psi_high_for_shifted_distribution():
    rng = np.random.default_rng(0)
    reference = rng.normal(loc=0.0, scale=1.0, size=1000)
    actual = rng.normal(loc=5.0, scale=1.0, size=200)

    psi = population_stability_index(reference, actual)

    assert psi > 0.25


def test_psi_handles_insufficient_reference_data():
    reference = np.array([1.0, 2.0, 3.0])
    actual = np.random.default_rng(0).normal(size=50)

    psi = population_stability_index(reference, actual)

    assert psi == 0.0


def test_psi_handles_too_few_recent_observations():
    rng = np.random.default_rng(0)
    reference = rng.normal(size=1000)
    actual = rng.normal(loc=10.0, size=2)  # wildly shifted, but too few samples to trust

    psi = population_stability_index(reference, actual)

    assert psi == 0.0


def test_compute_psi_scores_only_over_common_columns():
    reference_df = pd.DataFrame({"a": np.random.default_rng(0).normal(size=200), "b": range(200)})
    recent_df = pd.DataFrame({"a": np.random.default_rng(1).normal(size=30)})

    scores = compute_psi_scores(reference_df, recent_df)

    assert set(scores.keys()) == {"a"}
    assert isinstance(scores["a"], float)
