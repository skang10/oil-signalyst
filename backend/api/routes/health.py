from datetime import date

from fastapi import APIRouter
from sqlalchemy import text

from api.dependencies import DbSession

router = APIRouter()


@router.get("/health")
async def health(db: DbSession) -> dict:
    checks: dict[str, object] = {}

    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"failed: {exc}"

    try:
        result = await db.execute(text("SELECT COUNT(*) FROM users"))
        checks["users"] = f"{result.scalar() or 0} configured"
    except Exception:
        checks["users"] = "unknown"

    try:
        result = await db.execute(text("SELECT MAX(date) FROM feature_snapshots"))
        latest_raw = result.scalar()
        if latest_raw:
            latest = date.fromisoformat(str(latest_raw))
            checks["latest_snapshot"] = str(latest)
            checks["snapshot_fresh"] = (date.today() - latest).days <= 1
        else:
            checks["latest_snapshot"] = "none"
            checks["snapshot_fresh"] = False
    except Exception:
        checks["latest_snapshot"] = "unknown"
        checks["snapshot_fresh"] = False

    status = "healthy" if checks.get("database") == "ok" else "degraded"
    return {"status": status, "checks": checks}
