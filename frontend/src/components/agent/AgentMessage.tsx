import { IconRobot } from '@tabler/icons-react';
import type { AgentMessage as AgentMessageT } from './types';
import ToolCallBlock from './ToolCallBlock';
import ConfirmGate from './ConfirmGate';

export default function AgentMessage({
  message,
  onConfirmGate,
  onCancelGate,
}: {
  message: AgentMessageT;
  onConfirmGate: () => void;
  onCancelGate: () => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex gap-2 items-start flex-row-reverse">
        <div className="w-[26px] h-[26px] rounded-full bg-accent-bg border border-accent-border flex items-center justify-center shrink-0 mt-[1px] text-[10px] font-medium text-accent-text">
          XM
        </div>
        <div className="flex flex-col items-end max-w-[92%]">
          <div className="text-[11px] text-text-muted mb-1">Xuemei</div>
          <div className="bg-accent-bg border border-accent-border rounded-[10px_3px_10px_10px] p-[10px_13px] text-[12px] leading-[1.75] text-accent-text">
            {message.text}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 items-start">
      <div className="w-[26px] h-[26px] rounded-full bg-pro-bg border border-accent-border flex items-center justify-center shrink-0 mt-[1px]">
        <IconRobot size={14} stroke={1.75} className="text-pro" />
      </div>
      <div className="max-w-[92%]">
        <div className="text-[11px] text-text-muted mb-1">Agent</div>
        <div className="bg-surface-2 border border-border rounded-[3px_10px_10px_10px] p-[10px_13px] text-[12px] leading-[1.75] text-text-secondary">
          {message.typing ? <span className="text-text-muted italic">Thinking...</span> : message.text}
          {message.toolCalls?.map((tc, i) => <ToolCallBlock key={i} {...tc} />)}
          {message.footer && <div className="mt-2">{message.footer}</div>}
          {message.gate && <ConfirmGate {...message.gate} onConfirm={onConfirmGate} onCancel={onCancelGate} />}
        </div>
      </div>
    </div>
  );
}
