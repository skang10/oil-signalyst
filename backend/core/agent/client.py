"""Streaming OpenAI Chat Completions agent with multi-step tool use.

OpenAI's Chat Completions streaming has no equivalent to Anthropic's
discrete "this tool call is done" event. Each delta.tool_calls[] entry is a
*fragment*, indexed by position in the assistant's tool-call list;
.id/.function.name only appear once (the fragment where that tool call
starts), and .function.arguments arrives as successive raw JSON-string
pieces that must be concatenated and only json.loads()'d once the stream
signals finish_reason == "tool_calls".
"""

import json

from openai import AsyncOpenAI

from core.agent.tool_handlers import execute_tool
from core.agent.tools import DESTRUCTIVE_TOOLS, TOOLS
from core.config import settings

MAX_TOOL_ITERATIONS = 8  # safety cap - stop even if the model keeps requesting tools

_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


SYSTEM_PROMPT = """You are a data science assistant for an oil market ML system called OilSignalyst.
You have access to tools for evaluating signal candidates, managing the feature pool, running model
retraining, and deploying new model versions.

When asked to evaluate a signal, always run all four evaluation gates in order:
fetch_data_sample -> compute_ic -> compute_oos_decay -> compute_feature_correlation.

Before adding a feature to the registry or starting training, summarise the evaluation results
and ask the user to confirm. Destructive actions (add_to_feature_registry, run_training,
deploy_model) will be paused for user confirmation - do not assume confirmation unless you
receive an explicit user message saying "confirmed".

Be concise. Show tool results inline. Format numbers to 3 significant figures."""


async def stream_agent_response(
    messages: list[dict],
    session_id: str,
    on_text,
    on_assistant_turn,
    on_tool_pending,
    on_tool_result,
    on_done,
) -> None:
    """
    Streams an OpenAI Chat Completions response, automatically looping
    after each non-destructive tool result so the model can reason over
    what it just learned and pick its own next action - real multi-step
    behavior, not a single tool-call-then-stop turn. Without this loop, the
    system prompt's instruction to "run all four evaluation gates in order"
    would only work if the model happened to request all four tool calls
    in one completion.

    Destructive tools still pause on tool_pending and wait for
    POST /api/agent/confirm/{turn_id} - the loop never bypasses that gate,
    it only removes the need for a user round-trip between non-destructive
    tool calls.

    Callbacks:
      on_text(delta: str)
      on_assistant_turn(content: str, tool_calls: list[dict], session_id: str)
          Called once per model completion that requested tool calls,
          BEFORE they're executed - the caller persists this as an
          AgentTurn (role='assistant') so load_history() can replay it.
      on_tool_pending(name: str, tool_input: dict, tool_call_id: str, session_id: str)
      on_tool_result(name: str, result: dict, tool_call_id: str)
      on_done()
    """
    chat_messages = [{"role": "system", "content": SYSTEM_PROMPT}, *messages]
    client = get_client()

    for _ in range(MAX_TOOL_ITERATIONS):
        stream = await client.chat.completions.create(
            model=settings.openai_model,
            messages=chat_messages,
            tools=TOOLS,
            stream=True,
        )

        # Accumulate partial tool-call fragments by index - OpenAI can
        # stream more than one tool call per turn (parallel tool calling),
        # each building up independently until finish_reason arrives.
        pending_calls: dict[int, dict] = {}
        assistant_text = ""
        finish_reason = None

        async for chunk in stream:
            choice = chunk.choices[0]
            delta = choice.delta

            if delta.content:
                assistant_text += delta.content
                await on_text(delta.content)

            if delta.tool_calls:
                for tc_delta in delta.tool_calls:
                    entry = pending_calls.setdefault(
                        tc_delta.index, {"id": None, "name": None, "arguments": ""}
                    )
                    if tc_delta.id:
                        entry["id"] = tc_delta.id
                    if tc_delta.function and tc_delta.function.name:
                        entry["name"] = tc_delta.function.name
                    if tc_delta.function and tc_delta.function.arguments:
                        entry["arguments"] += tc_delta.function.arguments

            if choice.finish_reason:
                finish_reason = choice.finish_reason

        if finish_reason != "tool_calls":
            # Model gave a final text answer - nothing more to do. This is
            # always the stream's final chunk when finish_reason is set, so
            # it's safe to fall through to on_done() below.
            break

        # The assistant's own tool-call request must be replayed back on
        # the next completion (and persisted for history) before any
        # "tool" role messages - OpenAI rejects a "tool" message that isn't
        # immediately preceded by the assistant message that requested it.
        tool_calls_payload = [
            {
                "id": entry["id"],
                "type": "function",
                "function": {"name": entry["name"], "arguments": entry["arguments"]},
            }
            for entry in pending_calls.values()
        ]
        chat_messages.append(
            {"role": "assistant", "content": assistant_text or None, "tool_calls": tool_calls_payload}
        )
        await on_assistant_turn(assistant_text, tool_calls_payload, session_id)

        paused = False
        for entry in pending_calls.values():
            tool_name = entry["name"]
            tool_input = json.loads(entry["arguments"] or "{}")

            if tool_name in DESTRUCTIVE_TOOLS:
                # Pause - let frontend render a ConfirmGate. Only the first
                # destructive call in a batch pauses; non-destructive calls
                # before it in `pending_calls` order have already run and
                # already had their results appended to chat_messages below.
                await on_tool_pending(tool_name, tool_input, entry["id"], session_id)
                paused = True
                break
            else:
                result = await execute_tool(tool_name, tool_input)
                await on_tool_result(tool_name, result, entry["id"])
                chat_messages.append(
                    {"role": "tool", "tool_call_id": entry["id"], "content": json.dumps(result)}
                )

        if paused:
            return  # Wait for confirm - deliberately skips on_done(): a pending confirm isn't "done".

        # Otherwise loop back with the tool result(s) now in context, so
        # the model can decide its next step on its own.

    await on_done()
