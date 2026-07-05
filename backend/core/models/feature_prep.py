"""Turning the honest feature matrix into a model-ready one.

`FeatureEngine.build()` no longer drops incomplete rows - the persisted matrix
keeps a partial tail whenever a slow weekly source (COT, EIA) has not published
yet, so monitoring can see the real per-feature freshness. But a model cannot be
fit or scored on NaN, so every model-consuming path funnels the matrix through
this one helper first, keeping the transform identical across training and
serving (no train/serve skew).
"""

import pandas as pd


def to_model_matrix(features: pd.DataFrame) -> pd.DataFrame:
    """Complete every row of an honest (possibly NaN-tailed) feature matrix.

    Forward-fills each column so a low-frequency source's last observation
    carries forward until its next release - exactly the value in force
    intraweek (e.g. Tuesday's COT positioning holds until the next print) -
    then drops any remaining leading warmup rows a rolling window never filled.
    """
    return features.ffill().dropna()
