import asyncio
import json

import yfinance as yf
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter()

PRICE_POLL_SECONDS = 30


@router.websocket("/ws/price")
async def price_ticker(ws: WebSocket) -> None:
    """Pushes the current WTI spot price every 30s. A single live spot
    quote polled repeatedly doesn't fit DataRegistry's date-ranged
    historical-series shape, so this hits yfinance directly, same as
    core/market/fetcher.py::fetch_futures_curve()'s per-contract lookups."""
    await ws.accept()
    try:
        while True:
            try:
                info = yf.Ticker("CL=F").fast_info
                # FastInfo has no regular_market_change_percent (that attribute
                # doesn't exist - confirmed live, would have silently never
                # populated). Compute the fraction manually from
                # previous_close, matching this project's existing
                # wti_change_pct convention (a fraction like -0.026, not an
                # already-multiplied percentage - see report_assembler.py).
                price = float(info.last_price)
                previous_close = float(info.previous_close)
                change_pct = round((price - previous_close) / previous_close, 4) if previous_close else None
                await ws.send_text(json.dumps({"price": round(price, 2), "change_pct": change_pct}))
            except Exception as exc:
                logger.warning("Price ticker fetch failed", extra={"error": str(exc)})
            await asyncio.sleep(PRICE_POLL_SECONDS)
    except WebSocketDisconnect:
        pass
