import hashlib
from pathlib import Path

import pandas as pd
import yaml

from core.config_paths import FEATURES_YAML
from core.data.registry import DataRegistry
from core.logging import get_logger

logger = get_logger(__name__)


class FeatureEngine:
    def __init__(
        self,
        feature_config: str | Path = FEATURES_YAML,
        registry: DataRegistry | None = None,
    ):
        with open(feature_config) as file:
            self.features = yaml.safe_load(file)["features"]
        self.registry = registry or DataRegistry()
        self.feature_version = self._hash_config(feature_config)

    def build(self, start: str, end: str) -> pd.DataFrame:
        raw = self.registry.fetch_all(start, end, source_names=self._required_sources())
        result: dict[str, pd.Series] = {}
        for feature in self.features:
            try:
                result[feature["name"]] = self._apply(feature, raw)
            except Exception as exc:
                logger.warning(
                    "Feature failed",
                    extra={"feature": feature["name"], "error": str(exc)},
                )

        df = pd.DataFrame(result).dropna()
        logger.info("Feature matrix built", extra={"rows": len(df), "columns": len(df.columns)})
        return df

    def apply_transform(self, feature: dict, raw: pd.DataFrame) -> pd.Series:
        """Public entry point for computing a single feature's transform
        against already-fetched raw source data, reused by the signal
        scanner to evaluate candidate signals with the same vocabulary."""
        return self._apply(feature, raw)

    def _apply(self, feature: dict, raw: pd.DataFrame) -> pd.Series:
        transform = feature["transform"]

        if transform == "raw":
            return raw[feature["source"]]
        if transform == "pct_change":
            return raw[feature["source"]].pct_change(self._window_days(feature, feature["source"]))
        if transform == "rolling_std":
            series = raw[feature["source"]].pct_change().rolling(feature["window"]).std()
            if feature.get("annualize"):
                series = series * (252**0.5)
            return series
        if transform == "seasonal_dev":
            source = raw[feature["source"]]
            week = source.index.isocalendar().week.astype(int)
            average = source.groupby(week).transform(lambda values: values.expanding().mean())
            return source - average
        if transform == "zscore":
            source = raw[feature["source"]]
            mean = source.rolling(feature["window"]).mean()
            std = source.rolling(feature["window"]).std()
            return (source - mean) / std.replace(0, float("nan"))
        if transform == "net_position_pct":
            long = raw[feature["source_a"]]
            short = raw[feature["source_b"]]
            total = (long + short).replace(0, float("nan"))
            ratio = (long - short) / total
            return ratio.rolling(self._window_days(feature, feature["source_a"])).rank(pct=True)
        if transform == "net_position_chg":
            long = raw[feature["source_a"]]
            short = raw[feature["source_b"]]
            return (long - short).diff(self._window_days(feature, feature["source_a"]))
        if transform == "ratio_diff":
            return raw[feature["source_a"]] - raw[feature["source_b"]]

        raise ValueError(f"Unknown transform: {transform}")

    @staticmethod
    def _hash_config(path: str | Path) -> str:
        with open(path) as file:
            return hashlib.md5(file.read().encode()).hexdigest()[:8]

    def required_lookback_days(self) -> int:
        max_days = 0
        for feature in self.features:
            source_name = feature.get("source") or feature.get("source_a")
            max_days = max(max_days, self._window_days(feature, source_name))
        return max_days

    def _window_days(self, feature: dict, source_name: str) -> int:
        window = feature.get("window", 1)
        source_cfg = self.registry.config.get(source_name, {})
        if source_cfg.get("freq") == "W":
            return window * 7
        return window

    def _required_sources(self) -> list[str]:
        source_names: set[str] = set()
        for feature in self.features:
            for key in ("source", "source_a", "source_b"):
                if key in feature:
                    source_names.add(feature[key])
        return sorted(source_names)
