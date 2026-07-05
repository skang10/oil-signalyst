from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from api.dependencies import CurrentUser, DbSession

router = APIRouter(prefix="/api/users", tags=["users"])


class UserConfigUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    email: str | None = None
    instruments: list[str] | None = None
    horizon_days: int | None = None
    exposure_barrels: int | None = None
    alert_downside_threshold: float | None = None
    alert_regime_threshold: float | None = None
    alert_eia_threshold: float | None = None
    alert_psi_threshold: float | None = None
    alert_channel: str | None = None
    retrain_mode: Literal["manual", "psi", "sunday"] | None = None


@router.get("/me")
async def get_me(user: CurrentUser) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "role": user.role,
        "email": user.email,
        "instruments": user.instruments,
        "horizon_days": user.horizon_days,
        "exposure_barrels": user.exposure_barrels,
        "alert_downside_threshold": user.alert_downside_threshold,
        "alert_regime_threshold": user.alert_regime_threshold,
        "alert_eia_threshold": user.alert_eia_threshold,
        "alert_psi_threshold": user.alert_psi_threshold,
        "alert_channel": user.alert_channel,
        "retrain_mode": user.retrain_mode,
    }


@router.put("/me/config")
async def update_config(body: UserConfigUpdate, db: DbSession, user: CurrentUser) -> dict:
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    db.add(user)
    return {"status": "updated"}

