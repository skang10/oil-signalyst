import { IconRobot } from '@tabler/icons-react';
import type { AgentMessage as AgentMessageT } from './types';
import ToolCallBlock from './ToolCallBlock';
import ConfirmGate from './ConfirmGate';
import { cn } from '@/lib/utils';

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
      <div className="flex justify-end">
        <div className="bg-accent-bg border border-accent-border rounded-[10px_3px_10px_10px] p-[8px_12px] text-[12px] leading-[1.75] text-accent-text max-w-[92%]">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 items-start">
      <div
        className={cn(
          'w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 mt-[1px]',
          message.variant === 'success' ? 'bg-success-bg' : 'bg-pro-bg'
        )}
      >
        <IconRobot size={13} stroke={1.75} className={message.variant === 'success' ? 'text-success' : 'text-pro'} />
      </div>
      <div
        className={cn(
          'rounded-[3px_10px_10px_10px] p-[8px_12px] text-[12px] leading-[1.75] max-w-[92%] border',
          message.variant === 'success' ? 'bg-success-bg border-success-border' : 'bg-surface-1 border-border text-text-secondary'
        )}
      >
        {message.typing ? <span className="text-text-muted italic">Thinking...</span> : message.text}
        {message.toolCalls?.map((tc, i) => <ToolCallBlock key={i} {...tc} />)}
        {message.gate && <ConfirmGate {...message.gate} onConfirm={onConfirmGate} onCancel={onCancelGate} />}
      </div>
    </div>
  );
}
