import { useEffect, useRef, useState } from 'react';
import { IconRobot, IconArrowsMaximize, IconArrowsMinimize, IconX, IconSend } from '@tabler/icons-react';
import { useAgentStream } from '@/hooks/useAgentStream';
import { useDragResize } from '@/hooks/useDragResize';
import AgentMessage from './AgentMessage';
import { cn } from '@/lib/utils';

const QUICK_ACTIONS = [
  { label: 'Evaluate AIS signal', fill: 'Analyse AIS VLCC signal and evaluate for feature pool' },
  { label: 'Full retrain', fill: 'Retrain all three models with latest data' },
  { label: "Explain today's forecast", fill: "Explain today's Regime forecast drivers" },
];

export default function AgentPanel({
  onClose,
  fullpage,
  onToggleFullpage,
}: {
  onClose: () => void;
  fullpage: boolean;
  onToggleFullpage: () => void;
}) {
  const { messages, sendMessage, confirmGate, cancelGate } = useAgentStream();
  const { width, onMouseDown } = useDragResize(360);
  const [input, setInput] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    sendMessage(text);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  return (
    <div
      className={cn(
        'relative h-full bg-surface-2 border-l border-border flex flex-col shrink-0',
        fullpage && 'flex-1'
      )}
      style={fullpage ? undefined : { width, minWidth: 280, maxWidth: 780 }}
    >
      {!fullpage && (
        <div
          onMouseDown={onMouseDown}
          className="absolute left-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10 hover:bg-accent-border"
        />
      )}

      <div className="p-[10px_14px] border-b border-border flex items-center gap-2 shrink-0">
        <div className="w-[22px] h-[22px] rounded-full bg-pro-bg flex items-center justify-center shrink-0">
          <IconRobot size={13} stroke={1.75} className="text-pro" />
        </div>
        <div>
          <div className="text-[13px] font-medium">DS Agent</div>
          <div className="text-[11px] text-text-muted">{fullpage ? 'Fullpage mode' : 'Online · Ready'}</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title="Fullpage"
            onClick={onToggleFullpage}
            className="w-[26px] h-[26px] rounded-[5px] border-none bg-none cursor-pointer text-text-muted flex items-center justify-center hover:bg-surface-1 hover:text-text-primary"
          >
            {fullpage ? <IconArrowsMinimize size={15} stroke={1.75} /> : <IconArrowsMaximize size={15} stroke={1.75} />}
          </button>
          <button
            type="button"
            title="Close"
            aria-label="Close"
            onClick={onClose}
            className="w-[26px] h-[26px] rounded-[5px] border-none bg-none cursor-pointer text-text-muted flex items-center justify-center hover:bg-surface-1 hover:text-text-primary"
          >
            <IconX size={15} stroke={1.75} />
          </button>
        </div>
      </div>

      <div ref={messagesRef} className="flex-1 overflow-y-auto p-[14px_16px] flex flex-col gap-3">
        {messages.map((m) => (
          <AgentMessage key={m.id} message={m} onConfirmGate={() => confirmGate(m.id)} onCancelGate={() => cancelGate(m.id)} />
        ))}
      </div>

      <div className="border-t border-border p-[10px_12px] shrink-0 bg-surface-1">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            placeholder="Describe what you want to do..."
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            className="flex-1 border border-border-strong rounded-default p-[7px_10px] text-[12px] bg-surface-2 text-text-primary resize-none outline-none"
            style={{ minHeight: 34, maxHeight: 120, lineHeight: 1.5 }}
          />
          <button
            type="button"
            onClick={handleSend}
            className={cn(
              'w-8 h-8 rounded-default bg-accent-fill border-none text-on-accent cursor-pointer flex items-center justify-center shrink-0'
            )}
          >
            <IconSend size={15} stroke={1.75} />
          </button>
        </div>
        <div className="text-[11px] text-text-muted mt-[6px] flex gap-3 flex-wrap items-center">
          <span>Quick actions:</span>
          {QUICK_ACTIONS.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => {
                setInput(q.fill);
                textareaRef.current?.focus();
              }}
              className="bg-none border border-border rounded-[20px] px-[10px] py-[3px] text-[11px] text-text-secondary cursor-pointer hover:bg-surface-2"
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
