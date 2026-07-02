import asyncio
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, status
from fastapi.responses import StreamingResponse

from api.dependencies import CurrentUser, DbSession
from core.models.trainer import run_full_training_with_log
from db.database import get_db
from db.models import TrainJob

router = APIRouter(prefix="/api/train", tags=["training"])

SSE_POLL_INTERVAL_SECONDS = 0.5


@router.post("/start", status_code=status.HTTP_202_ACCEPTED)
async def start_training(
    background_tasks: BackgroundTasks, db: DbSession, user: CurrentUser
) -> dict:
    job_id = str(uuid.uuid4())[:8]
    model_types = ["regime", "eia", "returns"]
    db.add(TrainJob(id=job_id, status="queued", model_types=model_types, triggered_by=user.id))
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
            result = await run_full_training_with_log(job_id=job_id, triggered_by_user_id=user.id)
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


@router.get("/status/{job_id}")
async def get_training_status(job_id: str, db: DbSession) -> dict:
    job = await db.get(TrainJob, job_id)
    if not job:
        return {"error": "not found"}
    return {
        "job_id": job.id,
        "status": job.status,
        "model_types": job.model_types,
        "started_at": str(job.started_at) if job.started_at else None,
        "completed_at": str(job.completed_at) if job.completed_at else None,
        "result": job.result,
    }


@router.get("/log/{job_id}")
async def stream_training_log(job_id: str, user: CurrentUser) -> StreamingResponse:
    """SSE stream of TrainJob.log_lines. Opens a fresh DB session per poll
    rather than reusing one long-lived session across the whole stream -
    SQLAlchemy's identity map would otherwise keep returning the same cached
    row and never observe updates committed by the background training task
    in a different session."""
    del user

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

    return StreamingResponse(event_generator(), media_type="text/event-stream")
