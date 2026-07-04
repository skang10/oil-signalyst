from fastapi import APIRouter, HTTPException

from api.dependencies import CurrentUser
from core.market.series import SERIES

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/{series_id}")
async def get_market_series(series_id: str, user: CurrentUser) -> dict:
    del user
    if series_id not in SERIES:
        raise HTTPException(status_code=404, detail=f"Unknown series: {series_id}")
    return {"series": series_id, "data": SERIES[series_id]()}
