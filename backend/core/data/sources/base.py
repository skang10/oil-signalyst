from abc import ABC, abstractmethod

import pandas as pd


class BaseSource(ABC):
    # When True, the adapter persists its own raw data to disk and the registry
    # leaves it alone (CFTC caches whole-year ZIP parses per year). When False,
    # the registry fronts the adapter with a per-source SeriesStore so history
    # is not re-downloaded on every backfill or restart.
    manages_own_persistence: bool = False

    @abstractmethod
    def fetch(self, cfg: dict, start: str, end: str) -> pd.Series:
        raise NotImplementedError
