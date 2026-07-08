import asyncio

from fastapi import APIRouter, HTTPException

from api.dependencies import CurrentUser
from core.market.series import SERIES

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/{series_id}")
async def get_market_series(series_id: str, user: CurrentUser) -> dict:
    del user
    if series_id not in SERIES:
        raise HTTPException(status_code=404, detail=f"Unknown series: {series_id}")
    # The fetchers do blocking network I/O (yfinance / DataRegistry). Offload to
    # a thread so the Market tab's ~6 concurrent chart requests run in parallel
    # instead of serializing on - and stalling - the event loop (which also
    # serves the WS price ticker and every other route).
    data = await asyncio.to_thread(SERIES[series_id])
    return {"series": series_id, "data": data}
