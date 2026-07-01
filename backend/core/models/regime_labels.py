import pandas as pd

REGIME_TRANSITIONS = {
    "2010-01-01": "R2",
    "2011-03-01": "R1",
    "2012-07-01": "R2",
    "2014-07-01": "R3",
    "2016-02-01": "R2",
    "2017-01-01": "R1",
    "2018-10-01": "R3",
    "2019-06-01": "R1",
    "2020-03-01": "R4",
    "2020-06-01": "R2",
    "2021-07-01": "R1",
    "2022-02-01": "R1",
    "2022-12-01": "R3",
    "2023-06-01": "R1",
    "2024-01-01": "R3",
    "2025-05-01": "R3",
    "2026-01-01": "R3",
}


def build_regime_series(start: str, end: str) -> pd.Series:
    transitions = pd.Series(REGIME_TRANSITIONS)
    transitions.index = pd.to_datetime(transitions.index)
    idx = pd.date_range(start, end, freq="D")
    return transitions.reindex(idx, method="ffill")

