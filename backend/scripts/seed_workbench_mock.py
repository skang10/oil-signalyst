"""Wipe the experiment tables and re-seed a coherent MOCK dataset for the DS
Workbench, so every workbench page (This week / Sandboxes / Evaluate / Compare /
Publish) renders with rich, self-consistent data while the real daily pipeline
isn't producing any.

Touches exactly three tables — model_versions, predictions, train_jobs — and
nothing else (users, feature snapshots, pool features, etc. are left intact).
The numbers are fabricated but shaped to be internally consistent (skill,
gate, direction hits) so the UI reads as real. NOT for production: guarded to
run only against a local SQLite db.

    cd backend && uv run python -m scripts.seed_workbench_mock

Re-runnable: it wipes the three tables first, so running twice is idempotent.
"""

import asyncio
import statistics
import sys
from datetime import date, datetime, timedelta

from sqlalchemy import delete, select

from core.config import settings
from db.database import AsyncSessionLocal
from db.models import ModelVersion, Prediction, TrainJob, User

# --- the two model versions (the production pointer + what it displaced) --------

ACTIVE_VERSION = "v1.4"
PREV_VERSION = "v1.3"

ACTIVE_OOS = {
    "mae": 1.91,
    "direction_acc": 0.71,
    "mae_vs_consensus": -0.35,  # negative = beats consensus
    "baseline": {"mae": 2.63},
    "residual_p10": -2.4,
    "residual_p90": 2.7,
    "recent": {
        "mae": 1.88,
        "baseline": {"mae": 2.55},
        "window_start": "2026-04-29",
        "n_rows": 130,
        "effective_n": 13,
    },
    "deployment_gate": {"passed": True, "reasons": []},
}
PREV_OOS = {
    "mae": 2.06,
    "direction_acc": 0.67,
    "mae_vs_consensus": -0.12,
    "baseline": {"mae": 2.63},
    "residual_p10": -2.6,
    "residual_p90": 2.9,
    "deployment_gate": {"passed": True, "reasons": []},
}

FEATURE_LIST = [
    "crude_inv_dev", "refinery_util", "crude_imports_4w", "crude_exports_4w",
    "cushing_stocks_dev", "gasoline_demand", "distillate_demand", "spr_release_flag",
    "curve_slope_zscore", "ovx", "ovx_term_slope", "spec_net_pct", "cot_net_change",
    "wti_ret_5d", "wti_ret_20d", "wti_vol_20d", "brent_wti_spread", "copper_ret_20d",
    "dxy_ret_20d", "tanker_arrivals_7d", "tanker_discharge_usgc_3d", "vlcc_count_gulf",
    "rig_count_change", "days_of_supply", "seasonal_week", "holiday_flag",
    "product_crack_321", "gas_storage_dev", "heating_degree_days", "cooling_degree_days",
    "china_pmi", "us_pmi", "recession_prob", "opec_spare_capacity", "geopol_risk_index",
    "usd_oil_corr", "term_structure_m1m3",
]

# --- the weekly forecast/realized history (drives the releases chart) -----------
# (release Wednesday, forecast crude Mb, realized Mb or None, market consensus Mb)
# Same-sign forecast/realized = a directional hit; two deliberate misses so the
# chart shows the miss-highlight. The last row (no realized) is THIS WEEK's
# not-yet-graded forecast — it drives the This-week hero, not the chart.
WEEKLY = [
    ("2026-05-06", -1.8, -2.1, -1.2),
    ("2026-05-13", 0.9, 1.4, 0.6),
    ("2026-05-20", -3.2, -2.8, -2.1),
    ("2026-05-27", -1.1, -0.5, -0.8),
    ("2026-06-03", 2.1, 1.7, 1.3),
    ("2026-06-10", -2.5, -3.1, -1.6),
    ("2026-06-17", -0.8, 0.6, -0.4),   # miss: called a draw, built
    ("2026-06-24", -2.9, -2.4, -1.9),
    ("2026-07-01", 1.2, 3.5, 0.9),
    ("2026-07-08", -4.1, -4.6, -2.7),
    ("2026-07-15", -1.8, 0.9, -1.1),   # miss: called a draw, built
    ("2026-07-22", -3.4, -3.1, -2.2),
    ("2026-07-29", -2.7, None, -1.9),  # THIS WEEK — not yet realized
]

REGIME_PROBS = {"R1": 0.18, "R2": 0.08, "R3": 0.61, "R4": 0.13}
SHAP_VALUES = {
    "by_model": {
        "eia": {
            "refinery_util": 0.31, "crude_imports_4w": 0.22, "curve_slope_zscore": 0.16,
            "spec_net_pct": 0.11, "days_of_supply": 0.09, "tanker_arrivals_7d": 0.07,
        },
        "regime": {
            "curve_slope_zscore": 0.18, "crude_inv_dev": 0.16, "spec_net_pct": 0.11,
            "ovx": 0.09, "copper_ret_20d": -0.07,
        },
    },
    "status": {"eia": "ok", "regime": "ok"},
}


def _cv_folds() -> dict:
    """One walk-forward fold per year, mostly beating the train-mean baseline."""
    data = [
        (2017, 2.15, 2.71, True), (2018, 1.98, 2.60, True), (2019, 1.82, 2.51, True),
        (2020, 2.44, 2.39, False), (2021, 1.71, 2.55, True), (2022, 1.95, 2.60, True),
        (2023, 1.66, 2.44, True), (2024, 2.02, 2.63, True), (2025, 1.80, 2.58, True),
        (2026, 1.74, 2.30, True),
    ]
    folds = [
        {
            "fold": year,
            "test_start": f"{year}-01-01",
            "test_n": 50,
            "mae": mae,
            "baseline": base,
            "beat": beat,
        }
        for (year, mae, base, beat) in data
    ]
    maes = [f["mae"] for f in folds]
    return {
        "metric": "mae",
        "higher_is_better": False,
        "n_folds": len(folds),
        "mean": round(statistics.fmean(maes), 3),
        "std": round(statistics.pstdev(maes), 3),
        "min": min(maes),
        "max": max(maes),
        "n_beat_baseline": sum(1 for f in folds if f["beat"]),
        "folds": folds,
    }


def _dt(day: str, hh: int = 9, mm: int = 0) -> datetime:
    return datetime.fromisoformat(f"{day}T{hh:02d}:{mm:02d}:00")


def _train_jobs(user_id: int | None) -> list[TrainJob]:
    """A spread of run states so every Sandboxes group has something: the live
    run (production), an archived (superseded) run, a failed run, a blocked run,
    a cross-validate run, and one still running."""
    jobs: list[TrainJob] = []

    # produced the live v1.4 -> deploy_state 'live' (shown as the production card)
    jobs.append(TrainJob(
        id="a1b2c3d4", status="complete", model_types=["eia"],
        started_at=_dt("2026-05-20", 9, 0), completed_at=_dt("2026-05-20", 9, 5),
        trigger_source="manual", triggered_by=user_id,
        result={
            "old_metrics": {"eia_mae": 2.06}, "new_metrics": {"eia_mae": 1.91},
            "baselines": {"eia_mae": 2.63}, "old_baselines": {"eia_mae": 2.63},
            "old_versions": {"eia": PREV_VERSION}, "improvement_pct": 7.3,
            "versions": {"eia": ACTIVE_VERSION}, "deployed": {"eia": True},
            "mlflow_run_id": "a3f2c8d1",
        },
        log_lines=["[00:00] loading feature matrix... 37 features x 3,456 samples",
                   "[00:01] data leakage check... passed", "[done:complete]"],
    ))

    # displaced v1.3 -> deploy_state 'superseded' (archived)
    jobs.append(TrainJob(
        id="11223344", status="complete", model_types=["eia"],
        started_at=_dt("2026-01-12", 9, 0), completed_at=_dt("2026-01-12", 9, 3),
        trigger_source="manual", triggered_by=user_id,
        result={
            "old_metrics": {"eia_mae": 2.28}, "new_metrics": {"eia_mae": 2.06},
            "baselines": {"eia_mae": 2.63}, "old_baselines": {"eia_mae": 2.63},
            "old_versions": {"eia": "v1.2"}, "improvement_pct": 9.6,
            "versions": {"eia": PREV_VERSION}, "deployed": {"eia": True},
            "mlflow_run_id": "b7e1d004",
        },
        log_lines=["[done:complete]"],
    ))

    # a candidate that the gate blocked -> deploy_state 'blocked'
    jobs.append(TrainJob(
        id="aa11bb22", status="complete", model_types=["eia"],
        started_at=_dt("2026-07-24", 14, 0), completed_at=_dt("2026-07-24", 14, 6),
        trigger_source="agent", triggered_by=user_id,
        result={
            "old_metrics": {"eia_mae": 1.91}, "new_metrics": {"eia_mae": 2.12},
            "baselines": {"eia_mae": 2.63}, "old_baselines": {"eia_mae": 2.63},
            "old_versions": {"eia": ACTIVE_VERSION}, "improvement_pct": -11.0,
            "versions": {"eia": "v1.5-rc"}, "deployed": {"eia": False},
            "blocked_reasons": {"eia": ["only 41 validation rows (< 60 required)"]},
            "mlflow_run_id": "c1a99f2e",
        },
        log_lines=["[00:05] gate: insufficient validation window", "[done:complete]"],
    ))

    # walk-forward cross-validate -> deploy_state 'none' (idle), has the fold table
    jobs.append(TrainJob(
        id="c9d0e1f2", status="complete", model_types=["eia"],
        started_at=_dt("2026-07-23", 11, 0), completed_at=_dt("2026-07-23", 11, 12),
        trigger_source="cross-validate", triggered_by=user_id,
        result={"models": {"eia": _cv_folds()}, "n_folds": 10, "cancelled": False,
                "span": "2017-2026"},
        log_lines=["[done:complete]"],
    ))

    # a failed run -> archived
    jobs.append(TrainJob(
        id="deadbeef", status="failed", model_types=["eia"],
        started_at=_dt("2026-07-18", 8, 0), completed_at=_dt("2026-07-18", 8, 1),
        trigger_source="auto:sunday", triggered_by=user_id,
        result={"error": "feature matrix missing 3 columns: natural_gas_ret_20d, ..."},
        log_lines=["[00:01] KeyError: natural_gas_ret_20d", "[done:failed]"],
    ))

    # one still running -> idle
    jobs.append(TrainJob(
        id="99887766", status="running", model_types=["eia"],
        started_at=_dt("2026-07-29", 10, 15), completed_at=None,
        trigger_source="manual", triggered_by=user_id,
        result=None, log_lines=["[00:00] loading feature matrix..."],
    ))

    return jobs


async def main() -> None:
    if "sqlite" not in settings.db_url:
        raise SystemExit(
            f"Refusing to seed: db_url is not local sqlite ({settings.db_url!r}). "
            "This script only mocks a local dev database."
        )

    clear_only = "--clear" in sys.argv

    async with AsyncSessionLocal() as session:
        # child rows first (predictions FK -> model_versions)
        await session.execute(delete(Prediction))
        await session.execute(delete(ModelVersion))
        await session.execute(delete(TrainJob))
        await session.flush()

        if clear_only:
            await session.commit()
            print("Cleared: model_versions, predictions, train_jobs (no reseed). "
                  "The backend now serves the real — currently empty — state.")
            return

        active = ModelVersion(
            model_type="eia", version=ACTIVE_VERSION,
            file_path="models/eia/v1.4.skops",
            train_config={"train_start": "2012-01-01", "train_end": "2024-12-31",
                          "model": "TabPFN", "ensemble": 12},
            metrics_train={"mae": 1.42, "direction_acc": 0.74},
            metrics_oos=ACTIVE_OOS, feature_list=FEATURE_LIST,
            is_active=True, deployed_at=_dt("2026-05-20", 9, 6), mlflow_run_id="a3f2c8d1",
        )
        prev = ModelVersion(
            model_type="eia", version=PREV_VERSION,
            file_path="models/eia/v1.3.skops",
            train_config={"train_start": "2012-01-01", "train_end": "2023-12-31",
                          "model": "TabPFN", "ensemble": 12},
            metrics_train={"mae": 1.55, "direction_acc": 0.70},
            metrics_oos=PREV_OOS, feature_list=FEATURE_LIST[:34],
            is_active=False, deployed_at=_dt("2026-01-12", 9, 4), mlflow_run_id="b7e1d004",
        )
        session.add_all([active, prev])
        await session.flush()  # assign ids

        # attribute the runs to the local user so triggered_by_name renders
        user_id = (
            await session.execute(select(User.id).order_by(User.id).limit(1))
        ).scalar_one_or_none()

        for day, forecast, realized, consensus in WEEKLY:
            surprise = round(forecast - consensus, 2)
            correct = None if realized is None else (forecast < 0) == (realized < 0)
            session.add(Prediction(
                date=date.fromisoformat(day),
                regime_probs=REGIME_PROBS,
                eia_forecast={"crude": forecast, "market_consensus": consensus,
                              "surprise": surprise},
                shap_values=SHAP_VALUES,
                decision={"current_price": 78.4, "baseline_models": [],
                          "regime_available": True},
                actual_return=realized,
                outcome_correct=correct,
                model_version_id=active.id,
                created_at=_dt(day, 22, 0),
            ))

        for job in _train_jobs(user_id):
            session.add(job)

        await session.commit()

    print("Seeded: 2 model versions, "
          f"{len(WEEKLY)} predictions ({sum(1 for w in WEEKLY if w[2] is not None)} scored), "
          "6 train jobs.")


if __name__ == "__main__":
    asyncio.run(main())
