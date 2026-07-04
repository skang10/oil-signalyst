import asyncio
import json
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import delete

from api.dependencies import CurrentUser, DbSession
from auth.jwt import JWTError, decode_access_token
from core.agent.client import stream_agent_response
from core.agent.history import load_history, save_turn
from db.database import AsyncSessionLocal
from db.models import AgentTurn, User

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.post("/message")
async def post_message(body: dict, db: DbSession, user: CurrentUser) -> dict:
    """Accepts a user message, persists it, and returns a session_id for
    the client to open the SSE stream against. Does not itself call the
    model - GET /stream/{session_id} does that once opened."""
    session_id = body.get("session_id") or str(uuid.uuid4())
    content = body["content"]
    await save_turn(db, session_id, user.id, role="user", content=content)
    return {"session_id": session_id, "status": "streaming"}


async def _user_from_token(token: str) -> User:
    try:
        payload = decode_access_token(token)
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc
    async with AsyncSessionLocal() as db:
        user = await db.get(User, int(payload["sub"]))
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return user


@router.get("/stream/{session_id}")
async def stream_response(session_id: str, token: str) -> StreamingResponse:
    """
    SSE endpoint. Streams token-by-token agent response for the given
    session.

    Auth note: the browser's native EventSource API cannot attach custom
    headers, so it can't send the Authorization: Bearer token every other
    route uses (api/dependencies.py::CurrentUser). This route alone accepts
    the access token as a query param instead - a well-known, commonly
    accepted tradeoff for JWT+SSE (the token is short-lived, 1h) rather
    than hand-rolling SSE frame parsing over fetch() just to keep one
    route's auth mechanism consistent with the rest of the API.

    Event types:
      text_delta   - {"delta": "..."} - append to current assistant bubble
      tool_pending - {"tool": "...", "input": {...}, "turn_id": 123} - render ConfirmGate
      tool_result  - {"tool": "...", "result": {...}} - render tool call block
      done         - {} - close the stream
    """
    user = await _user_from_token(token)

    async with AsyncSessionLocal() as history_db:
        messages = await load_history(history_db, session_id)

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def on_text(delta: str):
            await queue.put({"event": "text_delta", "data": {"delta": delta}})

        async def on_assistant_turn(content: str, tool_calls: list[dict], turn_session_id: str):
            # Must be saved before any tool_pending/tool_result turn below -
            # load_history() replays turns in created_at order, and OpenAI
            # requires this assistant message to immediately precede the
            # tool messages answering it.
            async with AsyncSessionLocal() as db:
                await save_turn(
                    db,
                    turn_session_id,
                    user.id,
                    role="assistant",
                    content=content or None,
                    tool_calls=tool_calls,
                    status="complete",
                )
                await db.commit()

        async def on_tool_pending(tool_name: str, tool_input: dict, tool_call_id: str, turn_session_id: str):
            async with AsyncSessionLocal() as db:
                turn = await save_turn(
                    db,
                    turn_session_id,
                    user.id,
                    role="tool",
                    tool_name=tool_name,
                    tool_input=tool_input,
                    tool_call_id=tool_call_id,
                    status="pending",
                )
                await db.commit()
                turn_id = turn.id
            await queue.put(
                {"event": "tool_pending", "data": {"tool": tool_name, "input": tool_input, "turn_id": turn_id}}
            )
            await queue.put(None)  # signal stream_agent_response returned (paused for confirm)

        async def on_tool_result(tool_name: str, result: dict, tool_call_id: str):
            async with AsyncSessionLocal() as db:
                await save_turn(
                    db,
                    session_id,
                    user.id,
                    role="tool",
                    tool_name=tool_name,
                    tool_result=result,
                    tool_call_id=tool_call_id,
                    status="complete",
                )
                await db.commit()
            await queue.put({"event": "tool_result", "data": {"tool": tool_name, "result": result}})

        async def on_done():
            await queue.put({"event": "done", "data": {}})
            await queue.put(None)

        task = asyncio.create_task(
            stream_agent_response(
                messages=messages,
                session_id=session_id,
                on_text=on_text,
                on_assistant_turn=on_assistant_turn,
                on_tool_pending=on_tool_pending,
                on_tool_result=on_tool_result,
                on_done=on_done,
            )
        )

        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"event: {item['event']}\ndata: {json.dumps(item['data'])}\n\n"
        finally:
            if not task.done():
                task.cancel()

    # X-Accel-Buffering: same nginx anti-buffering escape hatch as
    # /api/train/log/{job_id} - see that route's comment.
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/confirm/{turn_id}")
async def confirm_tool(turn_id: int, db: DbSession, user: CurrentUser) -> dict:
    """User confirmed a destructive tool. Executes it and persists the
    result; the frontend then reopens the SSE stream (startStream() in
    useAgentStream.ts) to let the model continue from here."""
    del user
    turn = await db.get(AgentTurn, turn_id)
    if not turn or turn.status != "pending":
        return {"error": "turn not found or not pending"}

    from core.agent.tool_handlers import execute_tool

    result = await execute_tool(turn.tool_name, turn.tool_input)
    turn.tool_result = result
    turn.status = "confirmed"
    db.add(turn)

    return {"status": "executed", "tool": turn.tool_name, "result": result}


@router.post("/cancel/{turn_id}")
async def cancel_tool(turn_id: int, db: DbSession, user: CurrentUser) -> dict:
    del user
    turn = await db.get(AgentTurn, turn_id)
    if not turn:
        return {"error": "not found"}
    turn.status = "cancelled"
    db.add(turn)
    return {"status": "cancelled"}


@router.delete("/history")
async def clear_history(session_id: str, db: DbSession, user: CurrentUser) -> dict:
    await db.execute(delete(AgentTurn).where(AgentTurn.session_id == session_id, AgentTurn.user_id == user.id))
    return {"status": "cleared"}
