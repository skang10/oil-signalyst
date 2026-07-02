import type { ToolCall } from './types';
import { cn } from '@/lib/utils';

export default function ToolCallBlock({ name, code, result, resultVariant = 'success', streaming }: ToolCall) {
  return (
    <div className="bg-surface-1 border border-border rounded-default p-[10px_12px] mt-2 text-[11px]">
      <div className="flex items-center gap-[6px] text-[10px] uppercase tracking-[0.6px] text-text-muted font-medium mb-[6px]">
        <span className="w-[14px] h-[14px] bg-pro-bg rounded-[3px] flex items-center justify-center text-[9px]">⚙</span>
        <span>Tool calls</span>
        <span className="font-mono font-medium text-pro">{name}</span>
        {streaming && (
          <>
            <span className="inline-block w-3 h-3 rounded-full border-[1.5px] border-border-strong border-t-accent-fill animate-spin" />
            <span className="text-text-muted italic normal-case tracking-normal">Training...</span>
          </>
        )}
      </div>
      {code && <div className="font-mono text-text-secondary text-[11px] leading-[1.7] bg-surface-0 rounded p-[6px_8px] mt-[6px]">{code}</div>}
      {!streaming && result && (
        <div
          className={cn(
            'mt-[6px] p-[6px_8px] rounded font-mono text-[11px] leading-[1.7] border',
            resultVariant === 'warn' ? 'bg-warning-bg border-warning-border text-warning' : 'bg-success-bg border-success-border text-success'
          )}
        >
          {result}
        </div>
      )}
    </div>
  );
}
