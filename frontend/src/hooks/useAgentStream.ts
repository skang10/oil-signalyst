import { useCallback, useRef, useState } from 'react';
import { api, BASE, getAccessToken } from '@/lib/api';
import type { AgentMessage, ConfirmGateState, GateAction, ToolCall } from '@/components/agent/types';

const GATE_CONTENT: Record<GateAction, { step: string; title: string; confirmLabel: string }> = {
  add_to_feature_registry: { step: '1', title: 'Add to Feature Registry', confirmLabel: 'Confirm & Add' },
  run_training: { step: '2', title: 'Start Model Training', confirmLabel: 'Confirm & Train' },
  deploy_model: { step: '3', title: 'Deploy Model', confirmLabel: 'Confirm & Deploy' },
};

function formatDetail(input: Record<string, unknown>) {
  return Object.entries(input)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
}

function isErrorResult(result: Record<string, unknown>) {
  return 'error' in result || result.pass === false || result.leakage === true;
}

function formatResult(result: Record<string, unknown>) {
  return JSON.stringify(result, null, 2);
}

function newId() {
  return crypto.randomUUID();
}

/**
 * Real SSE-backed replacement for agent-mock-engine.tsx. One agent message
 * bubble accumulates everything (text + tool call blocks) produced by a
 * single user turn, including whatever happens after a confirm/cancel
 * round-trip re-opens the stream - matches the mock engine's bubble
 * granularity so AgentPanel/AgentMessage need no layout changes.
 */
export function useAgentStream() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const sessionIdRef = useRef(newId());
  const esRef = useRef<EventSource | null>(null);

  const updateMessage = useCallback((id: string, updater: (m: AgentMessage) => AgentMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  }, []);

  const startStream = useCallback(
    (agentMsgId: string) => {
      esRef.current?.close();
      const token = getAccessToken();
      const url = `${BASE}/api/agent/stream/${sessionIdRef.current}?token=${encodeURIComponent(token ?? '')}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener('text_delta', (e) => {
        const { delta } = JSON.parse((e as MessageEvent).data);
        updateMessage(agentMsgId, (m) => ({ ...m, typing: false, text: `${m.text ?? ''}${delta}` }));
      });

      es.addEventListener('tool_pending', (e) => {
        const { tool, input, turn_id } = JSON.parse((e as MessageEvent).data);
        const content = GATE_CONTENT[tool as GateAction] ?? { step: '?', title: tool, confirmLabel: 'Confirm' };
        const gate: ConfirmGateState = {
          step: content.step,
          title: content.title,
          detail: formatDetail(input),
          confirmLabel: content.confirmLabel,
          cancelLabel: 'Cancel',
          actionId: tool,
          status: 'pending',
          turnId: turn_id,
        };
        updateMessage(agentMsgId, (m) => ({ ...m, typing: false, gate }));
        es.close();
      });

      es.addEventListener('tool_result', (e) => {
        const { tool, result } = JSON.parse((e as MessageEvent).data);
        const toolCall: ToolCall = {
          name: tool,
          result: formatResult(result),
          resultVariant: isErrorResult(result) ? 'warn' : 'success',
        };
        updateMessage(agentMsgId, (m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), toolCall] }));
      });

      es.addEventListener('done', () => {
        updateMessage(agentMsgId, (m) => ({ ...m, typing: false }));
        es.close();
      });

      es.onerror = () => {
        updateMessage(agentMsgId, (m) => ({ ...m, typing: false }));
        es.close();
      };
    },
    [updateMessage]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const userMsg: AgentMessage = { id: newId(), role: 'user', text };
      const agentMsgId = newId();
      const agentMsg: AgentMessage = { id: agentMsgId, role: 'agent', text: '', toolCalls: [], typing: true };
      setMessages((prev) => [...prev, userMsg, agentMsg]);

      const token = getAccessToken();
      await fetch(`${BASE}/api/agent/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ session_id: sessionIdRef.current, content: text }),
      });

      startStream(agentMsgId);
    },
    [startStream]
  );

  const confirmGate = useCallback(
    async (agentMsgId: string) => {
      const message = messages.find((m) => m.id === agentMsgId);
      const gate = message?.gate;
      if (!gate) return;

      updateMessage(agentMsgId, (m) => ({ ...m, gate: m.gate ? { ...m.gate, status: 'confirmed' } : m.gate, typing: true }));

      const token = getAccessToken();
      const res = await fetch(`${BASE}/api/agent/confirm/${gate.turnId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      const data = await res.json();
      if (data.result) {
        const toolCall: ToolCall = {
          name: data.tool,
          result: formatResult(data.result),
          resultVariant: isErrorResult(data.result) ? 'warn' : 'success',
        };
        updateMessage(agentMsgId, (m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), toolCall] }));
      }

      startStream(agentMsgId);
    },
    [messages, startStream, updateMessage]
  );

  const cancelGate = useCallback(
    async (agentMsgId: string) => {
      const message = messages.find((m) => m.id === agentMsgId);
      const turnId = message?.gate?.turnId;
      if (turnId == null) return;

      updateMessage(agentMsgId, (m) => ({
        ...m,
        gate: m.gate ? { ...m.gate, status: 'cancelled' } : m.gate,
        typing: false,
      }));

      const token = getAccessToken();
      await fetch(`${BASE}/api/agent/cancel/${turnId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
    },
    [messages, updateMessage]
  );

  const clearConversation = useCallback(async () => {
    esRef.current?.close();
    // Delete the server-side turns for this session (they'd otherwise
    // accumulate forever - DELETE /api/agent/history existed but nothing
    // called it), then start a fresh session locally.
    await api
      .del(`/api/agent/history?session_id=${encodeURIComponent(sessionIdRef.current)}`)
      .catch(console.error);
    sessionIdRef.current = newId();
    setMessages([]);
  }, []);

  return { messages, sendMessage, confirmGate, cancelGate, clearConversation };
}
