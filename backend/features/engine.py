import hashlib
import json
from pathlib import Path

import pandas as pd
import yaml

from core.data.registry import DataRegistry
from core.logging import get_logger

logger = get_logger(__name__)


class FeatureEngine:
    def __init__(
        self,
        feature_config: str | Path | None = None,
        registry: DataRegistry | None = None,
    ):
        if feature_config is not None:
            # Explicit file path kept for tests/ad-hoc runs against a fixed
            # feature set; production reads the DB-backed pool.
            with open(feature_config) as file:
                self.features = yaml.safe_load(file)["features"]
        else:
            from core.services.feature_pool import load_pool_sync

            self.features = load_pool_sync()
        self.registry = registry or DataRegistry()
        self.feature_version = self._hash_features(self.features)

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

        # Keep the matrix from the first fully-formed row onward, INCLUDING any
        # ragged tail where a slow weekly source (COT/EIA) has not printed for
        # the latest days. This trims the long leading warmup (sources have very
        # different history depths, so a plain dropna(how="all") would resurrect
        # decades of single-column rows) while preserving the fresh tail, so the
        # matrix stays as current as the fastest source and the Data Monitor can
        # report honest per-feature coverage. Model consumers complete every row
        # themselves via core.models.feature_prep.to_model_matrix.
        df = pd.DataFrame(result).sort_index()
        complete = df.dropna().index
        df = df.loc[complete.min():] if len(complete) else df.iloc[0:0]
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
    def _hash_features(features: list[dict]) -> str:
        # Hash the definitions themselves, not a file - the pool lives in
        # the DB now, and the version must change exactly when the effective
        # feature set does.
        return hashlib.md5(json.dumps(features, sort_keys=True).encode()).hexdigest()[:8]

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
