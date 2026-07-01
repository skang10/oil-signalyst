from abc import ABC, abstractmethod

import pandas as pd


class BaseSource(ABC):
    @abstractmethod
    def fetch(self, cfg: dict, start: str, end: str) -> pd.Series:
        raise NotImplementedError
