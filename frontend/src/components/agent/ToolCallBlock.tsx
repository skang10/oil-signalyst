import type { ToolCall } from './types';

export default function ToolCallBlock({ name, args, result }: ToolCall) {
  return (
    <div className="bg-surface-0 border border-border rounded-[5px] p-[7px_10px] mt-[6px] text-[11px] font-mono">
      <div className="text-[10px] text-pro uppercase tracking-[0.5px] mb-[3px]">
        ⚙ <span className="text-pro font-medium">{name}</span>
      </div>
      {args && <div className="text-text-secondary">{args}</div>}
      <div className="text-success mt-1">{result}</div>
    </div>
  );
}
