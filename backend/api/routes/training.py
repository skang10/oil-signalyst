import asyncio
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc, func, select

from api.dependencies import CurrentUser, DbSession, DSOnly
from auth.jwt import JWTError, decode_access_token
from core.models.trainer import TRAINABLE_MODEL_TYPES, run_full_training_with_log
from db.database import AsyncSessionLocal, get_db
from db.models import ModelVersion, TrainJob, User

router = APIRouter(prefix="/api/train", tags=["training"])

SSE_POLL_INTERVAL_SECONDS = 0.5

# A job in one of these states is considered to still hold the trainer.
ACTIVE_JOB_STATUSES = ("queued", "running")


async def fail_orphaned_jobs() -> int:
    """Mark jobs left mid-flight by a process restart as failed.

    Training runs inside this process as a BackgroundTask, so any restart -
    uvicorn --reload in dev, a redeploy in prod - kills the run with nobody
    left to update its row, and it sits in 'running' forever. Called once at
    startup: without it the single-run guard below would see those ghosts and
    refuse every subsequent run.
    """
    async with get_db() as db:
        orphaned = (
            await db.execute(select(TrainJob).where(TrainJob.status.in_(ACTIVE_JOB_STATUSES)))
        ).scalars().all()
        for job in orphaned:
            job.status = "failed"
            job.completed_at = datetime.now(UTC).replace(tzinfo=None)
            job.result = {"error": "Interrupted by an API restart before completion."}
            db.add(job)
    return len(orphaned)


class TrainStartRequest(BaseModel):
    model_types: list[str] = list(TRAINABLE_MODEL_TYPES)
    cutoff_date: str | None = None
    # Not yet implemented - this project trains a single train/val split, not
    # real k-fold cross-validation. Accepted so the frontend's config form
    # doesn't 422; silently ignored rather than silently wrong.
    cv_folds: int | None = None
    gap_days: int | None = None


@router.post("/start", status_code=status.HTTP_202_ACCEPTED)
async def start_training(
    background_tasks: BackgroundTasks,
    db: DbSession,
    user: DSOnly,
    body: TrainStartRequest = TrainStartRequest(),
) -> dict:
    job_id = str(uuid.uuid4())[:8]
    model_types = body.model_types or list(TRAINABLE_MODEL_TYPES)

    unknown = [t for t in model_types if t not in TRAINABLE_MODEL_TYPES]
    if unknown:
        detail = f"Not trainable: {', '.join(unknown)}."
        if "regime" in unknown:
            detail += (
                " The regime model describes the current market state rather than "
                "forecasting an observable outcome - its only reference was a hardcoded "
                "table of transition dates, so there is nothing to score it against. "
                "It now serves predictions from a frozen artifact and is not retrained."
            )
        detail += f" Trainable types: {', '.join(TRAINABLE_MODEL_TYPES)}."
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    # One run at a time. Until the trainer was moved off the event loop the
    # blocking work serialized concurrent runs by accident; now that they can
    # truly overlap, two runs would interleave their _save_model writes and
    # race on the single is_active row per model type - last writer wins, and
    # the losing run's model stays active with the winner's metrics on screen.
    in_flight = (
        await db.execute(select(TrainJob).where(TrainJob.status.in_(ACTIVE_JOB_STATUSES)).limit(1))
    ).scalar_one_or_none()
    if in_flight:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Training job {in_flight.id} is already {in_flight.status}. Wait for it to finish.",
        )
    db.add(
        TrainJob(
            id=job_id,
            status="queued",
            model_types=model_types,
            triggered_by=user.id,
            trigger_source="manual",
        )
    )
    # Must actually commit (not just flush) before the background task
    # starts: BackgroundTasks run before this request's own DbSession
    # dependency commits (FastAPI only closes yield-based dependencies after
    # background tasks finish), so a bare flush() leaves this row in an
    # uncommitted, lock-holding transaction - the background task's own
    # session then blocks indefinitely trying to read the same row,
    # deadlocking against a commit that's waiting for the background task
    # to finish first.
    await db.commit()

    async def _run() -> None:
        async with get_db() as session:
            job = await session.get(TrainJob, job_id)
            if job:
                job.status = "running"
                job.started_at = datetime.now(UTC).replace(tzinfo=None)
                session.add(job)

        try:
            result = await run_full_training_with_log(
                job_id=job_id,
                triggered_by_user_id=user.id,
                model_types=model_types,
                cutoff_date=body.cutoff_date,
            )
            async with get_db() as session:
                job = await session.get(TrainJob, job_id)
                if job:
                    job.status = "complete"
                    job.completed_at = datetime.now(UTC).replace(tzinfo=None)
                    job.result = result
                    session.add(job)
        except Exception as exc:
            async with get_db() as session:
                job = await session.get(TrainJob, job_id)
                if job:
                    job.status = "failed"
                    job.completed_at = datetime.now(UTC).replace(tzinfo=None)
                    job.result = {"error": str(exc)}
                    session.add(job)

    background_tasks.add_task(_run)
    return {"job_id": job_id, "status": "queued", "model_types": model_types}


# Higher-is-better metrics; everything else (mae, brier) improves downward.
# Keys in result.old_metrics/new_metrics are f"{model_type}_{metric}".
_HIGHER_IS_BETTER_SUFFIXES = ("_accuracy",)


def _improvement_summary(result: dict | None) -> dict | None:
    """Counts how many primary metrics improved old -> new. None when the
    job has nothing comparable (failed, still running, or first-ever
    training where every old metric is null)."""
    if not result:
        return None
    old_metrics = result.get("old_metrics") or {}
    new_metrics = result.get("new_metrics") or {}
    improved = comparable = 0
    for key, new_value in new_metrics.items():
        old_value = old_metrics.get(key)
        if new_value is None or old_value is None:
            continue
        comparable += 1
        higher_better = key.endswith(_HIGHER_IS_BETTER_SUFFIXES)
        if (new_value > old_value) if higher_better else (new_value < old_value):
            improved += 1
    return {"improved": improved, "of": comparable} if comparable else None


def _deploy_state(job: TrainJob, active_versions: dict[str, str]) -> str:
    """'live' when every version this job trained is still the active one,
    'superseded' when none are, 'partial' for a mix. 'blocked' when the
    deployment gate stopped every model this job produced from going live at
    all - distinct from 'superseded', which means it *was* live and a later run
    replaced it. 'none' for jobs that never produced versions."""
    result = job.result or {}
    versions = result.get("versions") or {}
    if job.status != "complete" or not versions:
        return "none"
    live = sum(1 for t, v in versions.items() if active_versions.get(t) == v)
    if live == len(versions):
        return "live"
    if live:
        return "partial"
    deployed = result.get("deployed") or {}
    if deployed and not any(deployed.values()):
        return "blocked"
    return "superseded"


@router.get("/jobs")
async def list_training_jobs(
    db: DbSession,
    user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    trigger: str | None = Query(default=None, pattern="^(manual|auto|agent)$"),
) -> dict:
    """Paginated history over train_jobs, newest first - list counterpart to
    the by-id /status/{job_id} route. `trigger=auto` matches both auto:psi
    and auto:sunday."""
    del user
    query = select(TrainJob)
    if trigger == "auto":
        query = query.where(TrainJob.trigger_source.like("auto%"))
    elif trigger:
        query = query.where(TrainJob.trigger_source == trigger)

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    rows = await db.execute(query.order_by(desc(TrainJob.created_at)).limit(limit).offset(offset))
    jobs = rows.scalars().all()

    active_rows = await db.execute(select(ModelVersion).where(ModelVersion.is_active.is_(True)))
    active_versions = {v.model_type: v.version for v in active_rows.scalars().all()}

    user_ids = {j.triggered_by for j in jobs if j.triggered_by is not None}
    names: dict[int, str] = {}
    if user_ids:
        user_rows = await db.execute(select(User).where(User.id.in_(user_ids)))
        names = {u.id: u.name for u in user_rows.scalars().all()}

    def _duration_seconds(job: TrainJob) -> int | None:
        if not job.started_at or not job.completed_at:
            return None
        return int((job.completed_at - job.started_at).total_seconds())

    return {
        "total": total,
        "jobs": [
            {
                "job_id": j.id,
                "status": j.status,
                "model_types": j.model_types or [],
                "trigger_source": j.trigger_source or "manual",
                "triggered_by_name": names.get(j.triggered_by),
                "started_at": str(j.started_at) if j.started_at else None,
                "completed_at": str(j.completed_at) if j.completed_at else None,
                "duration_seconds": _duration_seconds(j),
                "summary": _improvement_summary(j.result),
                "deploy_state": _deploy_state(j, active_versions),
                "error": (j.result or {}).get("error"),
                # Flattened per-model gate reasons, so the history row can say
                # *why* a run was blocked without fetching the full detail.
                "blocked_reasons": [
                    f"{model_type}: {reason}"
                    for model_type, reasons in ((j.result or {}).get("blocked_reasons") or {}).items()
                    for reason in (reasons or [])
                ],
                # Tail only: enough for the dashboard's "Last Training Run"
                # card without shipping every job's full log in a list.
                "log_tail": (j.log_lines or [])[-3:],
            }
            for j in jobs
        ],
    }


@router.get("/status/{job_id}")
async def get_training_status(job_id: str, db: DbSession, include_log: bool = False) -> dict:
    job = await db.get(TrainJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Train job not found")
    payload = {
        "job_id": job.id,
        "status": job.status,
        "model_types": job.model_types,
        "started_at": str(job.started_at) if job.started_at else None,
        "completed_at": str(job.completed_at) if job.completed_at else None,
        "result": job.result,
    }
    if include_log:
        # For the history detail panel (finished runs); live runs stream
        # incrementally via GET /log/{job_id} instead.
        payload["log_lines"] = job.log_lines or []
    return payload


@router.get("/log/{job_id}")
async def stream_training_log(job_id: str, token: str) -> StreamingResponse:
    """SSE stream of TrainJob.log_lines. Opens a fresh DB session per poll
    rather than reusing one long-lived session across the whole stream -
    SQLAlchemy's identity map would otherwise keep returning the same cached
    row and never observe updates committed by the background training task
    in a different session.

    Auth via query param, not the Authorization header CurrentUser expects:
    the browser's native EventSource API (frontend/src/hooks/useTraining.ts's
    useTrainLog) can't attach custom headers, so it can't send a Bearer
    token. Same tradeoff as GET /api/agent/stream/{session_id} - see that
    route's docstring."""
    try:
        payload = decode_access_token(token)
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc
    async with AsyncSessionLocal() as db:
        if await db.get(User, int(payload["sub"])) is None:
            raise HTTPException(status_code=401, detail="User not found")

    async def event_generator():
        sent_count = 0
        while True:
            async with get_db() as db:
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
            await asyncio.sleep(SSE_POLL_INTERVAL_SECONDS)

    # X-Accel-Buffering tells nginx (the Docker stack's reverse proxy,
    # frontend/nginx.conf) not to buffer this response - with default
    # proxy_buffering, SSE frames only reach the browser when a proxy buffer
    # fills, which freezes the live log view.
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
