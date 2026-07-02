import numpy as np
import pandas as pd
import yaml
from scipy.stats import spearmanr

from core.config_paths import CONFIG_DIR
from core.data.registry import DataRegistry
from core.logging import get_logger
from core.models.trainer import TRAIN_END, TRAIN_START, VAL_END, VAL_START, load_features
from db.database import get_db
from db.models import SignalEvaluation
from features.engine import FeatureEngine

logger = get_logger(__name__)

CANDIDATE_SIGNALS_YAML = CONFIG_DIR / "candidate_signals.yaml"

# IC target is the forward WTI simple return (numeric, continuous) at each
# lag in trading days - not the 4-bucket categorical label the returns model
# trains on. Spearman rank correlation against this numeric target is what
# "IC" (information coefficient) means throughout this module.
IC_LAGS_DAYS = [5, 20, 60]

BONFERRONI_ALPHA = 0.05
MIN_COVERAGE_FOR_CANDIDATE = 0.80


def _load_candidates() -> list[dict]:
    with open(CANDIDATE_SIGNALS_YAML) as f:
        return yaml.safe_load(f)["candidates"]


def _forward_return(wti: pd.Series, lag_days: int) -> pd.Series:
    return wti.shift(-lag_days) / wti - 1


def _ic(signal: pd.Series, forward_return: pd.Series) -> tuple[float, float]:
    aligned = pd.concat([signal, forward_return], axis=1).dropna()
    if len(aligned) < 30:
        return 0.0, 1.0
    correlation, p_value = spearmanr(aligned.iloc[:, 0], aligned.iloc[:, 1])
    if np.isnan(correlation):
        return 0.0, 1.0
    return float(correlation), float(p_value)


def _coverage(raw_series: pd.Series, start: str, end: str) -> float:
    expected = pd.date_range(start, end, freq="B")
    observed = raw_series.reindex(expected).notna().sum()
    return round(float(observed / len(expected)), 4) if len(expected) else 0.0


def _max_correlation_with_active_features(
    signal: pd.Series, active_features: pd.DataFrame
) -> tuple[str | None, float]:
    best_name, best_abs_corr = None, 0.0
    for name in active_features.columns:
        aligned = pd.concat([signal, active_features[name]], axis=1).dropna()
        if len(aligned) < 30:
            continue
        correlation, _ = spearmanr(aligned.iloc[:, 0], aligned.iloc[:, 1])
        if np.isnan(correlation):
            continue
        if abs(correlation) > best_abs_corr:
            best_name, best_abs_corr = name, abs(float(correlation))
    return best_name, round(best_abs_corr, 4)


def _status(corrected_p: float, raw_p: float, coverage: float) -> str:
    if corrected_p < BONFERRONI_ALPHA and coverage >= MIN_COVERAGE_FOR_CANDIDATE:
        return "candidate"
    if raw_p < BONFERRONI_ALPHA:
        return "watch"
    return "rejected"


async def run_signal_scan() -> list[dict]:
    """Evaluates each configured candidate signal's IC against forward WTI
    returns at several lags, applying a Bonferroni correction across
    number_of_candidates * number_of_lags total tests, then writes results
    to signal_evaluations. Runs weekly (see scheduler/runner.py) since
    candidate evaluation reuses years of history and doesn't need daily
    re-evaluation.
    """
    candidates = _load_candidates()
    n_tests = len(candidates) * len(IC_LAGS_DAYS)

    registry = DataRegistry()
    wti = registry.fetch("wti", TRAIN_START, VAL_END).sort_index()
    active_features = load_features(TRAIN_START, VAL_END)

    engine = FeatureEngine(registry=registry)
    results = []

    for candidate in candidates:
        name = candidate["name"]
        try:
            raw = registry.fetch_all(TRAIN_START, VAL_END, source_names=[candidate["source"]])
            signal = engine.apply_transform(candidate, raw).sort_index()

            per_lag = {}
            best_lag, best_abs_train_ic = None, -1.0
            for lag_days in IC_LAGS_DAYS:
                forward = _forward_return(wti, lag_days)
                train_ic, _ = _ic(
                    signal[TRAIN_START:TRAIN_END], forward[TRAIN_START:TRAIN_END]
                )
                val_ic, val_p = _ic(signal[VAL_START:VAL_END], forward[VAL_START:VAL_END])
                corrected_p = round(min(val_p * n_tests, 1.0), 6)
                per_lag[str(lag_days)] = {
                    "train_ic": round(train_ic, 4),
                    "val_ic": round(val_ic, 4),
                    "p_raw": round(val_p, 6),
                    "p_corrected": corrected_p,
                }
                if abs(train_ic) > best_abs_train_ic:
                    best_lag, best_abs_train_ic = str(lag_days), abs(train_ic)

            best = per_lag[best_lag]
            oos_decay = round(best["train_ic"] - best["val_ic"], 4)
            coverage = _coverage(raw[candidate["source"]], TRAIN_START, VAL_END)
            corr_feature, corr_value = _max_correlation_with_active_features(
                signal, active_features
            )
            status = _status(best["p_corrected"], best["p_raw"], coverage)

            results.append(
                {
                    "signal_name": name,
                    "source_config": candidate,
                    "ic_scores": per_lag,
                    "oos_decay": oos_decay,
                    "correlation": {"most_correlated_feature": corr_feature, "value": corr_value},
                    "coverage": coverage,
                    "status": status,
                    "mechanism": candidate.get("mechanism", ""),
                }
            )
        except Exception as exc:
            logger.warning(
                "Signal scan failed for candidate", extra={"signal": name, "error": str(exc)}
            )

    async with get_db() as db:
        for result in results:
            db.add(SignalEvaluation(**result))

    logger.info(
        "Signal scan complete",
        extra={"n_candidates": len(candidates), "n_tests": n_tests, "n_results": len(results)},
    )
    return results
