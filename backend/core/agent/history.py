from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AgentTurn


async def load_history(db: AsyncSession, session_id: str) -> list[dict]:
    """Reconstructs the OpenAI messages list for a session from persisted
    AgentTurn rows, in order. An assistant turn that requested tool calls
    must be immediately followed by the tool result(s) answering it - the
    OpenAI API rejects a "tool" role message otherwise - which holds here
    because rows are replayed in the same created_at order they were
    written in core/agent/client.py's loop."""
    rows = await db.execute(
        select(AgentTurn).where(AgentTurn.session_id == session_id).order_by(AgentTurn.created_at.asc())
    )
    turns = rows.scalars().all()

    messages: list[dict] = []
    for turn in turns:
        if turn.role == "user":
            messages.append({"role": "user", "content": turn.content})
        elif turn.role == "assistant":
            messages.append(
                {"role": "assistant", "content": turn.content, "tool_calls": turn.tool_calls or []}
            )
        elif turn.role == "tool" and turn.status in ("complete", "confirmed"):
            # A 'pending' tool turn has no result yet - can't be replayed as
            # a tool message (nothing to answer with). If the session is
            # reloaded while still pending, the pending turn is simply
            # omitted; POST /api/agent/confirm/{turn_id} handles resuming
            # that specific gate.
            import json

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": turn.tool_call_id,
                    "content": json.dumps(turn.tool_result),
                }
            )
    return messages


async def save_turn(
    db: AsyncSession,
    session_id: str,
    user_id: int | None,
    role: str,
    content: str | None = None,
    tool_calls: list[dict] | None = None,
    tool_call_id: str | None = None,
    tool_name: str | None = None,
    tool_input: dict | None = None,
    tool_result: dict | None = None,
    status: str = "complete",
) -> AgentTurn:
    turn = AgentTurn(
        session_id=session_id,
        user_id=user_id,
        role=role,
        content=content,
        tool_calls=tool_calls,
        tool_call_id=tool_call_id,
        tool_name=tool_name,
        tool_input=tool_input,
        tool_result=tool_result,
        status=status,
    )
    db.add(turn)
    await db.flush()
    return turn
