import asyncio
import json

import yfinance as yf
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter()

PRICE_POLL_SECONDS = 30


def _last_price(ticker: str) -> float | None:
    """Current spot price for a single yfinance ticker, or None if the quote
    is unavailable this poll (Brent must not break the WTI ticker)."""
    try:
        return round(float(yf.Ticker(ticker).fast_info.last_price), 2)
    except Exception as exc:
        logger.warning("Spot price fetch failed", extra={"ticker": ticker, "error": str(exc)})
        return None


def _build_price_payload() -> dict:
    """Blocking yfinance work for one poll (runs in a thread, never on the
    event loop). Returns the WTI price + live Brent-WTI spread."""
    info = yf.Ticker("CL=F").fast_info
    # FastInfo has no regular_market_change_percent (that attribute doesn't
    # exist - confirmed live, would have silently never populated). Compute
    # the fraction manually from previous_close, matching this project's
    # existing wti_change_pct convention (a fraction like -0.026, not an
    # already-multiplied percentage - see report_assembler.py).
    price = round(float(info.last_price), 2)
    previous_close = float(info.previous_close)
    change_pct = round((price - previous_close) / previous_close, 4) if previous_close else None
    brent = _last_price("BZ=F")
    spread = round(brent - price, 2) if brent is not None else None
    return {"price": price, "change_pct": change_pct, "brent": brent, "spread": spread}


@router.websocket("/ws/price")
async def price_ticker(ws: WebSocket) -> None:
    """Pushes the current WTI spot price plus the live Brent-WTI spread every
    30s. A single live spot quote polled repeatedly doesn't fit
    DataRegistry's date-ranged historical-series shape, so this hits yfinance
    directly, same as core/market/fetcher.py::fetch_futures_curve()'s
    per-contract lookups.

    Payload: {"price": wti, "change_pct": frac, "brent": brent|null,
    "spread": brent-wti|null}. brent/spread are null when the Brent quote is
    briefly unavailable; the frontend falls back to WTI-only in that case."""
    await ws.accept()
    try:
        while True:
            # yfinance is blocking network I/O - run it in a thread so one
            # slow fetch can't stall the event loop (and every other request,
            # /health included). A fetch error is logged and skipped; the loop
            # keeps polling. A send/transport error, by contrast, means the
            # client is gone - let it propagate to break the loop below rather
            # than spinning forever on a dead socket.
            try:
                payload = await asyncio.to_thread(_build_price_payload)
            except Exception as exc:
                logger.warning("Price ticker fetch failed", extra={"error": str(exc)})
                payload = None
            if payload is not None:
                await ws.send_text(json.dumps(payload))
            await asyncio.sleep(PRICE_POLL_SECONDS)
    except (WebSocketDisconnect, RuntimeError):
        # RuntimeError covers Starlette's "Cannot call send once a close
        # message has been sent" when the client vanished between polls.
        pass
