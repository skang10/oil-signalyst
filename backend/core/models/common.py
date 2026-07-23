import numpy as np
import pandas as pd


def as_named_row(features: np.ndarray, feature_list: list[str]) -> pd.DataFrame:
    """Wraps a single raw feature vector in a DataFrame with fit-time column names.

    TabPFN Client validates that predict-time columns match fit-time columns by
    name, unlike sklearn estimators which are positional; a bare reshaped array
    fails with a 422 "columns differ" error.
    """
    return pd.DataFrame([features], columns=feature_list)
