import uuid

from fastapi import APIRouter, BackgroundTasks, status

from api.dependencies import CurrentUser
from core.models.trainer import run_full_training

router = APIRouter(prefix="/api/train", tags=["training"])
_running_jobs: dict[str, str] = {}


@router.post("/start", status_code=status.HTTP_202_ACCEPTED)
async def start_training(background_tasks: BackgroundTasks, user: CurrentUser) -> dict:
    job_id = str(uuid.uuid4())[:8]
    _running_jobs[job_id] = "running"

    async def _run() -> None:
        try:
            await run_full_training(triggered_by_user_id=user.id)
            _running_jobs[job_id] = "success"
        except Exception as exc:
            _running_jobs[job_id] = f"failed: {exc}"

    background_tasks.add_task(_run)
    return {"job_id": job_id, "status": "started"}


@router.get("/status/{job_id}")
async def get_training_status(job_id: str) -> dict:
    return {"job_id": job_id, "status": _running_jobs.get(job_id, "unknown")}

