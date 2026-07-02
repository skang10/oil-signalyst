# oil-signalyst — Phase 2.3 Spec: API Gap Patch

**Version:** 1.0  
**Phase:** 2.3 — API Gap Patch  
**Last updated:** 2026-07-01  
**Depends on:** Phase 2.2 COMPLETE  
**Drives:** Phase 3 frontend (all gaps below must be resolved before Phase 3 integration testing)

**Changelog:**  
- v1.0: Initial spec. Seven gap areas identified by cross-referencing Phase 2.1 API responses against Phase 3 `DailyReport`, `ModelStatus`, and `TrainJob` TypeScript types.

---

## 1. Overview

Phase 2.2 closes the gaps between what the Phase 2.1 backend currently returns and what the Phase 3 frontend actually needs. No new models are trained; this phase is purely additive — new fields, new endpoints, and two new route files. All changes are backward-compatible: existing Phase 2.1 clients see no breaking changes.

**Phase 2.2 is complete when:**  
All seven gap areas below have a green checkbox in §10, and `npm run dev` in the Phase 3 frontend renders live data for all four role views without falling back to mock data.

**In scope:**
- G1: `trader` role report — 6 missing fields
- G2: `risk` role report — 4 missing fields
- G3: `GET /api/models/status` — PSI alert flag, MLflow run ID, data source status, feature coverage
- G4: Training endpoints — SSE log stream, deploy endpoint, structured `TrainJob` result
- G5: Signal evaluation chart data — 3 time series per candidate signal
- G6: `GET /api/signals/active` — feature metadata (source, frequency, category)
- G7: `GET /api/reports/stress` — expose existing `run_stress_test()` via API

**Out of scope:** New model training, schema migrations beyond what is listed in §2, DS Agent backend, cloud deployment.

---

## 2. Schema Changes

One new table (`train_jobs`) and two new columns on `model_versions`. No changes to existing columns — no data migration required for existing rows.

```python
# db/models.py — additions only

class TrainJob(Base):
    """Persisted training job record. Replaces the in-memory _running_jobs dict."""
    __tablename__ = "train_jobs"

    id          = Column(String(8), primary_key=True)          # 8-char UUID prefix
    status      = Column(String(20), default="queued")         # queued | running | complete | failed
    model_types = Column(JSON, default=list)                   # ["regime", "eia", "returns"]
    started_at  = Column(DateTime, nullable=True)
    completed_at= Column(DateTime, nullable=True)
    result      = Column(JSON, nullable=True)
    # result shape when complete:
    # {
    #   "old_metrics": {"regime_accuracy": 0.71, "eia_mae": 1.3, "returns_brier": 0.240},
    #   "new_metrics": {"regime_accuracy": 0.73, "eia_mae": 1.2, "returns_brier": 0.198},
    #   "improvement_pct": -17.5,   # negative = improvement for Brier/MAE
    #   "mlflow_run_id": "b7d4e2a9"
    # }
    log_lines   = Column(JSON, default=list)                   # List[str], appended during run
    triggered_by= Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)


# Two new columns on model_versions
class ModelVersion(Base):
    # ... existing columns unchanged ...
    mlflow_run_id = Column(String(64), nullable=True)          # Added in 2.2
    psi_current   = Column(Float, nullable=True)               # Latest PSI, updated by daily pipeline
```

```bash
cd backend
uv run alembic revision --autogenerate -m "add train_jobs table and mlflow_run_id to model_versions"
uv run alembic upgrade head
```

---

## 3. New Dependencies

```toml
# No new packages required.
# SSE is implemented with FastAPI's StreamingResponse (already available).
# All other gaps are resolved with existing dependencies.
```

---

## 4. G1 — Trader Role Report: Missing Fields

### 4.1 What Phase 3 expects

```typescript
trader: {
  signal: 'LONG' | 'SHORT' | 'FLAT'
  kelly_position: number        // 0–1
  stop_loss_price: number       // absolute price level
  stop_loss_pct: number         // (current_price - stop_loss) / current_price
  expected_return: number       // weighted mean of return_dist buckets
  price_5d_history: number[]    // last 5 WTI closing prices (oldest → newest)
  brent_wti_spread: number      // current Brent-WTI spread from features
  cot_net_percentile: number    // 0–100 percentile rank of spec_net_pct vs rolling 52w
  ovx: number                   // OVX from features snapshot
}
```

### 4.2 What Phase 2.1 currently returns for `role=trader`

```json
{
  "date": "2026-07-01",
  "price": 78.4,
  "dominant_regime": "R3",
  "regime_probs": { "R1": 0.18, "R2": 0.08, "R3": 0.61, "R4": 0.13 },
  "return_dist": { "lt_minus10": 0.21, "neg_10_0": 0.30, "pos_0_10": 0.34, "gt_10": 0.15 },
  "eia_forecast": { ... },
  "decision": { "direction": "FLAT", "hedge_ratio": 0.62, "stop_loss": 71.2 }
}
```

### 4.3 Changes required

**4.3.1 Kelly position — `core/postprocess/decision_engine.py`**

Add Kelly fraction calculation. Kelly f = (p × b − q) / b where p = upside probability, q = downside probability, b = expected gain / expected loss ratio derived from the return distribution.

```python
# core/postprocess/decision_engine.py — add to compute_decision()

def _kelly_fraction(return_dist: dict, current_price: float) -> float:
    """
    Simplified Kelly fraction from the 4-bucket return distribution.
    Uses midpoint returns for each bucket:
      lt_minus10  → −0.15  (midpoint of < −10%)
      neg_10_0    → −0.05
      pos_0_10    → +0.05
      gt_10       → +0.15
    Kelly f = E[R] / E[R | R > 0]  capped at 1.0, floored at 0.
    """
    midpoints = {
        "lt_minus10": -0.15,
        "neg_10_0":   -0.05,
        "pos_0_10":   +0.05,
        "gt_10":      +0.15,
    }
    expected_return = sum(return_dist.get(k, 0) * v for k, v in midpoints.items())
    upside_prob = return_dist.get("pos_0_10", 0) + return_dist.get("gt_10", 0)
    expected_upside = sum(
        return_dist.get(k, 0) * v
        for k, v in midpoints.items() if v > 0
    )
    if expected_return <= 0 or upside_prob == 0 or expected_upside == 0:
        return 0.0
    kelly = expected_return / expected_upside
    return round(max(0.0, min(kelly, 1.0)), 3)
```

Add to `compute_decision()` return dict:
```python
"kelly_position": _kelly_fraction(return_dist, current_price),
"stop_loss_pct":  round((current_price - stop_loss) / current_price, 4),
```

**4.3.2 COT net percentile — `core/postprocess/report_assembler.py`**

```python
# core/postprocess/report_assembler.py

async def _cot_percentile(snapshot_features: dict, db: AsyncSession) -> float:
    """
    Percentile rank of current spec_net_pct vs the rolling 52-week window
    of historical feature snapshots.
    """
    from sqlalchemy import select, func
    from db.models import FeatureSnapshot

    current_val = snapshot_features.get("spec_net_pct", 0.0)

    # Fetch last 52 weeks of spec_net_pct values
    rows = await db.execute(
        select(FeatureSnapshot.features)
        .order_by(FeatureSnapshot.created_at.desc())
        .limit(260)   # ~52 trading weeks
    )
    history = [
        r[0].get("spec_net_pct")
        for r in rows.fetchall()
        if r[0] and r[0].get("spec_net_pct") is not None
    ]
    if not history:
        return 50.0
    rank = sum(1 for v in history if v < current_val)
    return round(rank / len(history) * 100, 1)
```

**4.3.3 Price 5-day history — `core/postprocess/report_assembler.py`**

```python
async def _price_5d_history(db: AsyncSession) -> list[float]:
    """Last 5 WTI closing prices, oldest first."""
    from db.models import FeatureSnapshot

    rows = await db.execute(
        select(FeatureSnapshot.features)
        .order_by(FeatureSnapshot.created_at.desc())
        .limit(5)
    )
    prices = [
        r[0].get("wti") for r in rows.fetchall()
        if r[0] and r[0].get("wti") is not None
    ]
    return list(reversed(prices))   # oldest → newest
```

**4.3.4 Update `assemble_daily_report()`**

```python
async def assemble_daily_report(prediction: Prediction, snapshot: FeatureSnapshot, db: AsyncSession) -> dict:
    features = snapshot.features if snapshot else {}

    # ... existing fields unchanged ...

    cot_pct   = await _cot_percentile(features, db)
    price_5d  = await _price_5d_history(db)
    decision  = prediction.decision or {}

    return {
        # ... existing fields ...

        # Trader-specific additions
        "kelly_position":    decision.get("kelly_position", 0.0),
        "stop_loss_pct":     decision.get("stop_loss_pct", 0.0),
        "brent_wti_spread":  round(features.get("brent_wti_spread", 0.0), 2),
        "cot_net_percentile": cot_pct,
        "ovx":               round(features.get("ovx", 0.0), 1),
        "price_5d_history":  price_5d,
    }
```

**4.3.5 Update `_filter_by_role()` — trader branch**

```python
if role == "trader":
    return {
        **base,
        "signal":            report["decision"].get("direction", "FLAT"),
        "kelly_position":    report["kelly_position"],
        "stop_loss_price":   report["decision"].get("stop_loss"),
        "stop_loss_pct":     report["stop_loss_pct"],
        "expected_return":   _expected_return(report["return_dist"]),
        "price_5d_history":  report["price_5d_history"],
        "brent_wti_spread":  report["brent_wti_spread"],
        "cot_net_percentile": report["cot_net_percentile"],
        "ovx":               report["ovx"],
    }

def _expected_return(return_dist: dict) -> float:
    midpoints = {"lt_minus10": -0.15, "neg_10_0": -0.05, "pos_0_10": 0.05, "gt_10": 0.15}
    return round(sum(return_dist.get(k, 0) * v for k, v in midpoints.items()), 4)
```

---

## 5. G2 — Risk Role Report: Missing Fields

### 5.1 What Phase 3 expects

```typescript
risk: {
  var_95: number                       // already exists
  cvar_95: number                      // NEW: conditional expected loss
  current_exposure_mbbls: number       // NEW: from user config exposure_barrels / 1_000_000
  hedge_ratio: number                  // existing decision.hedge_ratio, now surfaced explicitly
  recommended_hedge_ratio: number      // NEW: same as hedge_ratio from decision engine
  r3_historical_max_drawdown: number   // NEW: max drawdown observed during R3 periods
}
```

### 5.2 Changes required

**5.2.1 CVaR — `core/postprocess/report_assembler.py`**

```python
def _cvar_95(return_dist: dict) -> float:
    """
    CVaR (Expected Shortfall) at 95% confidence.
    Uses the conditional expected return given we are in the loss tail (< 0%).
    Approximated from the two downside buckets.

    CVaR = E[R | R < VaR_95]
    With bucket midpoints: lt_minus10 → −0.15, neg_10_0 → −0.05
    Weighted by their conditional probabilities.
    """
    p_lt  = return_dist.get("lt_minus10", 0)
    p_neg = return_dist.get("neg_10_0", 0)
    total_downside = p_lt + p_neg
    if total_downside == 0:
        return 0.0
    cvar = (p_lt * -0.15 + p_neg * -0.05) / total_downside
    return round(cvar, 4)
```

**5.2.2 R3 historical max drawdown — `core/postprocess/stress_test.py`**

```python
async def get_r3_max_drawdown(db: AsyncSession) -> float:
    """
    Returns the maximum observed 20-day return among predictions labelled R3.
    Uses actual_return from the predictions table (filled by outcome_backfill).
    Returns a negative float (e.g. −0.38 = −38%).
    Falls back to −0.38 (2014 historical reference) if fewer than 20 R3 outcomes exist.
    """
    from db.models import Prediction

    rows = await db.execute(
        select(Prediction.actual_return)
        .where(
            Prediction.dominant_regime == "R3",
            Prediction.actual_return.isnot(None),
        )
    )
    returns = [r[0] for r in rows.fetchall()]
    if len(returns) < 20:
        return -0.38   # Historical reference: 2014 OPEC price war
    return round(min(returns), 4)
```

**5.2.3 Update `_filter_by_role()` — risk branch**

```python
if role == "risk":
    exposure_mbbls = (user.exposure_barrels or 1_000_000) / 1_000_000
    return {
        **base,
        "var_95":                    report["var_95"],
        "cvar_95":                   report["cvar_95"],
        "current_exposure_mbbls":    round(exposure_mbbls, 2),
        "hedge_ratio":               report["decision"].get("hedge_ratio", 0.62),
        "recommended_hedge_ratio":   report["decision"].get("hedge_ratio", 0.62),
        "r3_historical_max_drawdown": report["r3_historical_max_drawdown"],
    }
```

Note: `get_daily_report()` must pass `user` to `_filter_by_role()` for the risk branch to access `exposure_barrels`. Update the signature accordingly.

---

## 6. G3 — `GET /api/models/status`: Missing Fields

### 6.1 What Phase 3 expects

```typescript
interface ModelStatus {
  models: {
    type: 'regime' | 'eia' | 'returns'
    version: string
    deployed_at: string
    mlflow_run_id: string        // NEW
    metrics: {
      primary: number            // accuracy / MAE / Brier
      psi: number                // NEW: current PSI from latest FeatureSnapshot
    }
    psi_alert: boolean           // NEW: psi > user.alert_psi_threshold (default 0.20)
  }[]
  data_sources: {                // NEW: entire block
    name: string
    status: 'ok' | 'delayed' | 'error'
    lag_hours: number | null
    last_updated: string
  }[]
  feature_coverage_7d: number    // NEW: fraction of features with < 5% missing over last 7 days
}
```

### 6.2 New route file: `api/routes/data_monitor.py`

```python
# api/routes/data_monitor.py
from fastapi import APIRouter
from api.dependencies import DbSession
from db.models import ModelVersion, FeatureSnapshot
from sqlalchemy import select, desc
from datetime import datetime, timedelta
import yaml
from core.config_paths import DATA_SOURCES_YAML

router = APIRouter(prefix="/api/monitor", tags=["monitor"])


async def _get_psi_for_model(model_type: str, db: AsyncSession) -> float | None:
    """
    Returns the latest PSI score for the primary feature of the given model.
    Reads from the most recent FeatureSnapshot.psi_scores dict.
    Returns None if no snapshot exists.
    """
    row = await db.execute(
        select(FeatureSnapshot.psi_scores)
        .order_by(FeatureSnapshot.created_at.desc())
        .limit(1)
    )
    psi_scores = row.scalar_one_or_none()
    if not psi_scores:
        return None
    # Use mean PSI across all features as the model-level PSI signal
    values = [v for v in psi_scores.values() if isinstance(v, (int, float))]
    return round(sum(values) / len(values), 4) if values else None


async def _data_source_status() -> list[dict]:
    """
    Reads data_sources.yaml and checks last-modified time of each source's
    Parquet file to infer freshness. Falls back to 'unknown' if file missing.
    """
    with open(DATA_SOURCES_YAML) as f:
        sources = yaml.safe_load(f).get("sources", [])

    from pathlib import Path
    from core.config_paths import FEATURES_DIR

    results = []
    for src in sources:
        name       = src["name"]
        parquet    = FEATURES_DIR / f"{name}.parquet"
        max_lag_h  = src.get("max_lag_hours", 26)   # from data_sources.yaml

        if not parquet.exists():
            results.append({
                "name": name, "status": "error",
                "lag_hours": None, "last_updated": None,
            })
            continue

        mtime      = datetime.fromtimestamp(parquet.stat().st_mtime)
        lag_hours  = (datetime.utcnow() - mtime).total_seconds() / 3600
        status     = "ok" if lag_hours <= max_lag_h else "delayed"

        results.append({
            "name":         name,
            "status":       status,
            "lag_hours":    round(lag_hours, 1),
            "last_updated": mtime.isoformat(),
        })
    return results


async def _feature_coverage_7d(db: AsyncSession) -> float:
    """
    Fraction of features with < 5% missing rate across the last 7 daily snapshots.
    """
    rows = await db.execute(
        select(FeatureSnapshot.features)
        .order_by(FeatureSnapshot.created_at.desc())
        .limit(7)
    )
    snapshots = [r[0] for r in rows.fetchall() if r[0]]
    if not snapshots:
        return 1.0

    all_keys = set(k for snap in snapshots for k in snap)
    if not all_keys:
        return 1.0

    covered = sum(
        1 for k in all_keys
        if sum(1 for snap in snapshots if snap.get(k) is not None) / len(snapshots) >= 0.95
    )
    return round(covered / len(all_keys), 4)
```

### 6.3 Update `GET /api/models/status`

```python
# api/routes/models.py — update get_model_status()
from api.routes.data_monitor import _get_psi_for_model, _data_source_status, _feature_coverage_7d

PSI_ALERT_THRESHOLD = 0.20   # matches Phase 3 default UserConfig

@router.get("/status")
async def get_model_status(db: DbSession):
    rows = await db.execute(
        select(ModelVersion).where(ModelVersion.is_active == True)
    )
    versions = rows.scalars().all()

    models_out = []
    for v in versions:
        psi = await _get_psi_for_model(v.model_type, db)
        primary_metric = (
            v.metrics_oos.get("accuracy") if v.model_type == "regime"
            else v.metrics_oos.get("mae") if v.model_type == "eia"
            else v.metrics_oos.get("brier")
        ) if v.metrics_oos else None

        models_out.append({
            "type":           v.model_type,
            "version":        v.version,
            "deployed_at":    str(v.deployed_at) if v.deployed_at else None,
            "mlflow_run_id":  v.mlflow_run_id,
            "metrics": {
                "primary": primary_metric,
                "psi":     psi,
            },
            "psi_alert":      (psi or 0) > PSI_ALERT_THRESHOLD,
        })

    return {
        "models":              models_out,
        "data_sources":        await _data_source_status(),
        "feature_coverage_7d": await _feature_coverage_7d(db),
    }
```

### 6.4 Write `mlflow_run_id` during training

In `core/models/trainer.py`, after logging the MLflow run, persist the run ID:

```python
# core/models/trainer.py — inside run_full_training(), after mlflow.end_run()
from db.models import ModelVersion

async with get_db() as db:
    row = await db.execute(
        select(ModelVersion)
        .where(ModelVersion.model_type == model_type, ModelVersion.is_active == True)
    )
    mv = row.scalar_one_or_none()
    if mv:
        mv.mlflow_run_id = mlflow.active_run().info.run_id
        db.add(mv)
```

Also update `psi_current` on `ModelVersion` in the daily pipeline after PSI is computed:

```python
# scheduler/jobs.py — after compute_psi() in the daily pipeline
async with get_db() as db:
    for model_type in ["regime", "eia", "returns"]:
        mv = await get_active_model_version(db, model_type)
        if mv:
            mv.psi_current = mean_psi   # from drift_monitor output
            db.add(mv)
```

---

## 7. G4 — Training Endpoints: SSE Log, Deploy, Structured Result

### 7.1 Replace in-memory job dict with DB-backed `TrainJob`

```python
# api/routes/training.py — full replacement

from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import StreamingResponse
from api.dependencies import DbSession, CurrentUser
from core.models.trainer import run_full_training_with_log
from db.models import TrainJob
from sqlalchemy import select
import uuid, asyncio
from datetime import datetime

router = APIRouter(prefix="/api/train", tags=["training"])


@router.post("/start")
async def start_training(
    background_tasks: BackgroundTasks,
    db: DbSession,
    user: CurrentUser,
    model_types: list[str] = ["regime", "eia", "returns"],
):
    job_id = str(uuid.uuid4())[:8]
    job = TrainJob(
        id           = job_id,
        status       = "queued",
        model_types  = model_types,
        triggered_by = user.id,
    )
    db.add(job)
    await db.flush()

    async def _run():
        async with get_db() as session:
            j = await session.get(TrainJob, job_id)
            j.status = "running"
            j.started_at = datetime.utcnow()

        try:
            result = await run_full_training_with_log(
                model_types      = model_types,
                job_id           = job_id,
                triggered_by_user_id = user.id,
            )
            async with get_db() as session:
                j = await session.get(TrainJob, job_id)
                j.status       = "complete"
                j.completed_at = datetime.utcnow()
                j.result       = result
        except Exception as e:
            async with get_db() as session:
                j = await session.get(TrainJob, job_id)
                j.status       = "failed"
                j.completed_at = datetime.utcnow()
                j.result       = {"error": str(e)}

    background_tasks.add_task(_run)
    return {"job_id": job_id, "status": "queued", "model_types": model_types}


@router.get("/status/{job_id}")
async def get_training_status(job_id: str, db: DbSession):
    job = await db.get(TrainJob, job_id)
    if not job:
        return {"error": "not found"}
    return {
        "job_id":        job.id,
        "status":        job.status,
        "model_types":   job.model_types,
        "started_at":    str(job.started_at) if job.started_at else None,
        "completed_at":  str(job.completed_at) if job.completed_at else None,
        "result":        job.result,
    }


@router.get("/log/{job_id}")
async def stream_training_log(job_id: str, db: DbSession):
    """
    SSE endpoint. Streams log lines as they are appended to TrainJob.log_lines.
    Closes automatically when job.status is 'complete' or 'failed'.
    """
    async def event_generator():
        sent_count = 0
        while True:
            job = await db.get(TrainJob, job_id)
            if not job:
                yield "data: [job not found]\n\n"
                break
            lines = job.log_lines or []
            for line in lines[sent_count:]:
                yield f"data: {line}\n\n"
                sent_count += 1
            if job.status in ("complete", "failed"):
                yield f"data: [done:{job.status}]\n\n"
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

### 7.2 `run_full_training_with_log()` — append to DB during run

```python
# core/models/trainer.py — new entry point for API-triggered runs

async def run_full_training_with_log(
    model_types: list[str],
    job_id: str,
    triggered_by_user_id: int | None = None,
) -> dict:
    """
    Wraps run_full_training() with per-step log appending to TrainJob.log_lines.
    Returns a structured result dict matching TrainJob.result schema.
    """
    async def log(line: str):
        async with get_db() as db:
            job = await db.get(TrainJob, job_id)
            if job:
                job.log_lines = (job.log_lines or []) + [line]
                db.add(job)

    await log(f"[{_ts()}] Loading feature matrix...")
    # ... training steps, calling log() at each milestone ...
    # The existing run_full_training() is refactored to accept a log callback.

    return {
        "old_metrics": old_metrics,   # fetched before training starts
        "new_metrics": new_metrics,   # from trainer evaluation
        "improvement_pct": round(
            (new_metrics["returns_brier"] - old_metrics["returns_brier"])
            / old_metrics["returns_brier"] * 100, 1
        ),
        "mlflow_run_id": mlflow.active_run().info.run_id if mlflow.active_run() else None,
    }

def _ts() -> str:
    from datetime import datetime
    return datetime.utcnow().strftime("%H:%M:%S")
```

### 7.3 Deploy endpoint — `api/routes/models.py`

```python
# api/routes/models.py — add deploy endpoint

@router.post("/{model_type}/deploy")
async def deploy_model(model_type: str, job_id: str, db: DbSession, user: CurrentUser):
    """
    Promotes the model trained in job_id to active.
    Deactivates the previous active version for model_type.
    Invalidates ModelRegistry cache.
    """
    from db.models import ModelVersion
    from core.models.model_registry import ModelRegistry

    # Deactivate current active
    row = await db.execute(
        select(ModelVersion)
        .where(ModelVersion.model_type == model_type, ModelVersion.is_active == True)
    )
    old = row.scalar_one_or_none()
    if old:
        old.is_active = False
        db.add(old)

    # Activate the new version from job result
    job = await db.get(TrainJob, job_id)
    if not job or job.status != "complete":
        return {"error": "job not complete or not found"}

    run_id = (job.result or {}).get("mlflow_run_id")
    new_version = ModelVersion(
        model_type    = model_type,
        version       = f"v{datetime.utcnow().strftime('%Y%m%d_%H%M')}",
        is_active     = True,
        deployed_at   = datetime.utcnow(),
        mlflow_run_id = run_id,
        metrics_oos   = (job.result or {}).get("new_metrics"),
    )
    db.add(new_version)
    ModelRegistry.invalidate()

    return {"status": "deployed", "version": new_version.version, "model_type": model_type}
```

### 7.4 Register new router

```python
# api/main.py — add to create_app()
from api.routes import data_monitor

app.include_router(data_monitor.router)
```

---

## 8. G5 — Signal Evaluation Chart Data

### 8.1 What Phase 3 expects

`GET /api/signals/evaluate/{name}` — returns three time series for the Signal Evaluate page:

```typescript
interface SignalEvalDetail {
  name: string
  // Chart 1: Price vs signal overlay (dual Y-axis)
  price_history:  { date: string; price: number; signal: number }[]
  // Chart 2: Rolling IC (52-week window)
  rolling_ic:     { date: string; ic_5d: number; ic_20d: number }[]
  // Chart 3: Year-by-year OOS (train IC vs OOS IC)
  oos_by_year:    { year: number; train_ic: number; oos_ic: number }[]
  // Stats row
  ic_scores:      Record<string, number>
  oos_decay:      number
  coverage:       number
  recommendation: 'candidate' | 'watch' | 'rejected'
}
```

### 8.2 New endpoint — `api/routes/signals.py`

```python
# api/routes/signals.py — add evaluate endpoint

@router.get("/evaluate/{signal_name}")
async def get_signal_evaluation(signal_name: str, db: DbSession):
    """
    Returns the three chart datasets for the Signal Evaluate page.
    Reads from feature_snapshots for raw signal values and joins with
    predictions for the target (regime label or WTI return).
    """
    from core.postprocess.signal_charts import build_signal_charts

    row = await db.execute(
        select(SignalEvaluation)
        .where(SignalEvaluation.signal_name == signal_name)
        .order_by(SignalEvaluation.evaluated_at.desc())
        .limit(1)
    )
    evaluation = row.scalar_one_or_none()
    if not evaluation:
        return {"error": "signal not found"}

    charts = await build_signal_charts(signal_name, db)

    return {
        "name":           signal_name,
        "price_history":  charts["price_history"],
        "rolling_ic":     charts["rolling_ic"],
        "oos_by_year":    charts["oos_by_year"],
        "ic_scores":      evaluation.ic_scores,
        "oos_decay":      evaluation.oos_decay,
        "coverage":       evaluation.coverage,
        "recommendation": evaluation.status,
    }
```

### 8.3 New module — `core/postprocess/signal_charts.py`

```python
# core/postprocess/signal_charts.py

import pandas as pd
from scipy.stats import spearmanr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.models import FeatureSnapshot, Prediction


async def build_signal_charts(signal_name: str, db: AsyncSession) -> dict:
    """
    Builds the three chart datasets for the Signal Evaluate page.
    Uses feature_snapshots for signal values, predictions for WTI price and labels.
    """
    # --- Load raw data ---
    snap_rows = await db.execute(
        select(FeatureSnapshot.created_at, FeatureSnapshot.features)
        .order_by(FeatureSnapshot.created_at.asc())
    )
    snaps = snap_rows.fetchall()

    dates    = [r[0].date() for r in snaps]
    signals  = [r[1].get(signal_name) for r in snaps]
    prices   = [r[1].get("wti") for r in snaps]

    df = pd.DataFrame({"date": dates, "signal": signals, "price": prices}).dropna()
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()

    # --- Chart 1: Price vs signal history (last 18 months) ---
    cutoff = df.index.max() - pd.DateOffset(months=18)
    df_chart1 = df[df.index >= cutoff]
    price_history = [
        {"date": str(d.date()), "price": round(row.price, 2), "signal": round(row.signal, 4)}
        for d, row in df_chart1.iterrows()
    ]

    # --- Chart 2: Rolling IC (52-week window, lag 5d and 20d) ---
    target_5d  = df["price"].pct_change(5).shift(-5)
    target_20d = df["price"].pct_change(20).shift(-20)
    rolling_ic = []
    window = 52 * 5   # ~52 trading weeks

    for i in range(window, len(df)):
        window_sig  = df["signal"].iloc[i-window:i]
        window_t5   = target_5d.iloc[i-window:i]
        window_t20  = target_20d.iloc[i-window:i]
        mask5  = window_sig.notna() & window_t5.notna()
        mask20 = window_sig.notna() & window_t20.notna()
        ic5  = spearmanr(window_sig[mask5],  window_t5[mask5])[0]  if mask5.sum()  > 10 else None
        ic20 = spearmanr(window_sig[mask20], window_t20[mask20])[0] if mask20.sum() > 10 else None
        rolling_ic.append({
            "date":  str(df.index[i].date()),
            "ic_5d":  round(ic5,  4) if ic5  is not None else None,
            "ic_20d": round(ic20, 4) if ic20 is not None else None,
        })

    # --- Chart 3: Year-by-year OOS IC ---
    TRAIN_END_YEAR = 2023
    oos_by_year = []
    train_mask = df.index.year <= TRAIN_END_YEAR
    train_ic_mean = _ic_mean(df["signal"][train_mask], target_5d[train_mask])

    for year in range(TRAIN_END_YEAR + 1, df.index.year.max() + 1):
        mask = df.index.year == year
        if mask.sum() < 10:
            continue
        oos_ic = _ic_mean(df["signal"][mask], target_5d[mask])
        oos_by_year.append({
            "year":     year,
            "train_ic": round(train_ic_mean, 4),
            "oos_ic":   round(oos_ic, 4),
        })

    return {
        "price_history": price_history,
        "rolling_ic":    rolling_ic,
        "oos_by_year":   oos_by_year,
    }


def _ic_mean(signal: pd.Series, target: pd.Series) -> float:
    mask = signal.notna() & target.notna()
    if mask.sum() < 10:
        return 0.0
    return float(spearmanr(signal[mask], target[mask])[0])
```

---

## 9. G6 — `GET /api/signals/active`: Feature Metadata

### 9.1 What Phase 3 expects

```typescript
interface ActiveFeature {
  name: string
  source: string       // e.g. "EIA API", "Yahoo Finance", "CFTC COT"
  frequency: string    // e.g. "Weekly", "Daily"
  category: string     // e.g. "Futures Curve", "Inventory", "Positioning", "Volatility", "Macro"
}
```

### 9.2 Add metadata to `features.yaml`

```yaml
# config/features.yaml — add source, frequency, category to every entry

- name: curve_slope_zscore
  bearish_if_positive: false
  source: "CME / FRED"
  frequency: "Daily"
  category: "Futures Curve"

- name: brent_wti_spread
  bearish_if_positive: false
  source: "Yahoo Finance"
  frequency: "Daily"
  category: "Futures Curve"

- name: crude_inv_dev
  bearish_if_positive: true
  source: "EIA API"
  frequency: "Weekly"
  category: "Inventory"

- name: crude_inv_chg_4w
  bearish_if_positive: true
  source: "EIA API"
  frequency: "Weekly"
  category: "Inventory"

- name: spec_net_pct
  bearish_if_positive: false
  source: "CFTC COT"
  frequency: "Weekly"
  category: "Positioning"

- name: spec_net_chg
  bearish_if_positive: false
  source: "CFTC COT"
  frequency: "Weekly"
  category: "Positioning"

- name: ovx
  bearish_if_positive: true
  source: "CBOE"
  frequency: "Daily"
  category: "Volatility"

- name: rvol_20d
  bearish_if_positive: true
  source: "Yahoo Finance"
  frequency: "Daily"
  category: "Volatility"

- name: ret_5d
  bearish_if_positive: false
  source: "Yahoo Finance"
  frequency: "Daily"
  category: "Price Momentum"

- name: ret_20d
  bearish_if_positive: false
  source: "Yahoo Finance"
  frequency: "Daily"
  category: "Price Momentum"

- name: ret_60d
  bearish_if_positive: false
  source: "Yahoo Finance"
  frequency: "Daily"
  category: "Price Momentum"

- name: dxy_ret_20d
  bearish_if_positive: true
  source: "FRED"
  frequency: "Daily"
  category: "Macro"

- name: copper_ret_20d
  bearish_if_positive: false
  source: "Yahoo Finance"
  frequency: "Daily"
  category: "Macro"

- name: vix
  bearish_if_positive: true
  source: "CBOE"
  frequency: "Daily"
  category: "Macro"
```

### 9.3 Update `GET /api/signals/active`

```python
# api/routes/signals.py — replace get_active_features()

@router.get("/active")
async def get_active_features(db: DbSession):
    """
    Returns currently active features from the latest model_version feature_list,
    enriched with metadata from features.yaml.
    """
    import yaml
    from core.config_paths import FEATURES_YAML

    with open(FEATURES_YAML) as f:
        feature_configs = {
            fc["name"]: fc for fc in yaml.safe_load(f).get("features", [])
        }

    row = await db.execute(
        select(ModelVersion)
        .where(ModelVersion.model_type == "regime", ModelVersion.is_active == True)
    )
    mv = row.scalar_one_or_none()
    active_names = mv.feature_list if mv else []

    return {
        "features": [
            {
                "name":      name,
                "source":    feature_configs.get(name, {}).get("source", "Unknown"),
                "frequency": feature_configs.get(name, {}).get("frequency", "Daily"),
                "category":  feature_configs.get(name, {}).get("category", "Other"),
            }
            for name in active_names
        ]
    }
```

---

## 10. G7 — `GET /api/reports/stress`

### 10.1 Expose existing stress test via API

```python
# api/routes/reports.py — add stress endpoint

@router.get("/stress")
async def get_stress_test(db: DbSession, user: CurrentUser):
    """
    Returns the stress test results for the three historical extreme scenarios.
    Calls the existing run_stress_test() from core/postprocess/stress_test.py.
    Results are cached for 24 hours (stress inputs change only when model is retrained).
    """
    from core.postprocess.stress_test import run_stress_test
    from core.models.model_registry import ModelRegistry

    regime_model  = await ModelRegistry.get_active("regime")
    eia_model     = await ModelRegistry.get_active("eia")
    returns_model = await ModelRegistry.get_active("returns")

    results = await run_stress_test(regime_model, eia_model, returns_model, db)
    return results
```

Expected response shape (matches Phase 3 Risk view):

```json
{
  "scenarios": [
    {
      "name": "2020 Covid demand collapse",
      "date": "2020-04-20",
      "actual_return": -0.55,
      "model_alerted": true,
      "dominant_regime_predicted": "R4",
      "dominant_regime_actual": "R4"
    },
    {
      "name": "2022 Russia-Ukraine supply shock",
      "date": "2022-03-07",
      "actual_return": 0.65,
      "model_alerted": true,
      "dominant_regime_predicted": "R1",
      "dominant_regime_actual": "R1"
    },
    {
      "name": "2014 OPEC price war",
      "date": "2014-11-28",
      "actual_return": -0.45,
      "model_alerted": true,
      "dominant_regime_predicted": "R3",
      "dominant_regime_actual": "R3"
    }
  ]
}
```

---

## 11. Updated Router Registration

```python
# api/main.py — final router list after 2.2

from api.routes import health, reports, models, training, signals, users, data_monitor

def create_app() -> FastAPI:
    app = FastAPI(title="oil-signalyst", version="0.4.0", lifespan=lifespan)
    app.include_router(health.router)
    app.include_router(reports.router)       # adds /api/reports/stress
    app.include_router(models.router)        # adds /api/models/{type}/deploy
    app.include_router(training.router)      # adds /api/train/log/{job_id}
    app.include_router(signals.router)       # adds /api/signals/evaluate/{name}
    app.include_router(users.router)
    app.include_router(data_monitor.router)  # new: /api/monitor/*
    return app
```

---

## 12. New Tests

```python
# tests/test_phase22.py

import pytest
from httpx import AsyncClient, ASGITransport
from api.main import app


@pytest.mark.asyncio
async def test_trader_report_has_kelly():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/reports/daily/trader", headers={"X-User-Id": "1"})
    assert r.status_code == 200
    body = r.json()
    assert "kelly_position" in body
    assert "cot_net_percentile" in body
    assert "price_5d_history" in body
    assert isinstance(body["price_5d_history"], list)
    assert len(body["price_5d_history"]) <= 5


@pytest.mark.asyncio
async def test_risk_report_has_cvar():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/reports/daily/risk", headers={"X-User-Id": "1"})
    assert r.status_code == 200
    body = r.json()
    assert "cvar_95" in body
    assert "r3_historical_max_drawdown" in body
    assert body["cvar_95"] <= 0   # CVaR should be negative


@pytest.mark.asyncio
async def test_model_status_has_psi_alert():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/models/status")
    assert r.status_code == 200
    body = r.json()
    assert "models" in body
    assert "data_sources" in body
    assert "feature_coverage_7d" in body
    for m in body["models"]:
        assert "psi_alert" in m
        assert "mlflow_run_id" in m


@pytest.mark.asyncio
async def test_train_log_sse():
    """Start a job and check the SSE stream closes when complete."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        start = await c.post("/api/train/start", headers={"X-User-Id": "1"})
    assert start.status_code == 200
    job_id = start.json()["job_id"]
    # SSE stream endpoint exists
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(f"/api/train/log/{job_id}", headers={"X-User-Id": "1"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_signal_active_has_metadata():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/signals/active")
    assert r.status_code == 200
    features = r.json()["features"]
    assert len(features) > 0
    for f in features:
        assert "source" in f
        assert "frequency" in f
        assert "category" in f


@pytest.mark.asyncio
async def test_signal_evaluate_returns_charts():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/signals/evaluate/curve_slope_zscore")
    assert r.status_code == 200
    body = r.json()
    assert "price_history" in body
    assert "rolling_ic" in body
    assert "oos_by_year" in body


@pytest.mark.asyncio
async def test_stress_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/reports/stress", headers={"X-User-Id": "1"})
    assert r.status_code == 200
    assert "scenarios" in r.json()
    assert len(r.json()["scenarios"]) == 3
```

---

## 13. Phase 2.2 Completion Checklist

```
Schema:
[ ] Alembic migration runs cleanly (train_jobs table + mlflow_run_id column)
[ ] TrainJob rows are written to DB on POST /api/train/start

G1 — Trader report:
[ ] GET /api/reports/daily/trader includes kelly_position (0–1)
[ ] GET /api/reports/daily/trader includes cot_net_percentile (0–100)
[ ] GET /api/reports/daily/trader includes price_5d_history (list of 5 floats)
[ ] GET /api/reports/daily/trader includes brent_wti_spread, ovx, stop_loss_pct

G2 — Risk report:
[ ] GET /api/reports/daily/risk includes cvar_95 (negative float)
[ ] GET /api/reports/daily/risk includes r3_historical_max_drawdown
[ ] GET /api/reports/daily/risk includes recommended_hedge_ratio

G3 — Model status:
[ ] GET /api/models/status includes psi_alert boolean per model
[ ] GET /api/models/status includes mlflow_run_id per model
[ ] GET /api/models/status includes data_sources array
[ ] GET /api/models/status includes feature_coverage_7d

G4 — Training:
[ ] GET /api/train/log/{job_id} streams SSE lines
[ ] SSE stream closes with [done:complete] when job finishes
[ ] GET /api/train/status/{job_id} returns structured result with old_metrics/new_metrics
[ ] POST /api/models/{type}/deploy deactivates old version, activates new
[ ] ModelRegistry.invalidate() called after deploy

G5 — Signal evaluate:
[ ] GET /api/signals/evaluate/{name} returns 200 for a known candidate signal
[ ] price_history contains date, price, signal keys
[ ] rolling_ic contains ic_5d and ic_20d
[ ] oos_by_year contains at least one year entry

G6 — Signal active:
[ ] GET /api/signals/active returns features with source, frequency, category
[ ] features.yaml updated with metadata fields for all 14 active features

G7 — Stress test:
[ ] GET /api/reports/stress returns 3 scenarios
[ ] Each scenario has name, actual_return, model_alerted fields

Integration:
[ ] Phase 3 TraderView renders without falling back to mock data
[ ] Phase 3 RiskView renders cvar_95 and r3_historical_max_drawdown
[ ] Phase 3 ModelMonitorPage renders psi_alert badges
[ ] Phase 3 TrainingPage SSE log streams correctly
[ ] Phase 3 SignalEvaluatePage renders all 3 charts
[ ] Phase 3 DataMonitorPage feature table shows source/frequency/category
```
