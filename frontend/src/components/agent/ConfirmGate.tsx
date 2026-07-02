import type { ConfirmGateState } from './types';
import { cn } from '@/lib/utils';

interface ConfirmGateProps extends ConfirmGateState {
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmGate({ title, detail, confirmLabel, cancelLabel, status, onConfirm, onCancel }: ConfirmGateProps) {
  const disabled = status !== 'pending';

  return (
    <div className="mt-[10px] p-[10px] bg-warning-bg border border-warning-border rounded-default">
      <div className="text-[11px] font-medium text-warning mb-[7px]">⚠ Confirm action — {title}</div>
      <div className="text-[11px] text-text-secondary mb-2 leading-[1.75]">{detail}</div>
      <div className="flex gap-[6px]">
        <button
          type="button"
          disabled={disabled}
          onClick={onConfirm}
          className={cn('px-[14px] py-[5px] text-[12px] rounded-default cursor-pointer bg-accent-fill text-on-accent border-none', disabled && 'opacity-50')}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onCancel}
          className={cn('px-[14px] py-[5px] text-[12px] rounded-default cursor-pointer bg-danger-bg text-danger border border-danger-border', disabled && 'opacity-50')}
        >
          {cancelLabel}
        </button>
      </div>
      {status === 'confirmed' && <div className="text-[11px] text-success mt-[6px] font-mono">✓ Confirmed</div>}
      {status === 'cancelled' && <div className="text-[11px] text-text-muted mt-[6px] font-mono">✗ Cancelled</div>}
    </div>
  );
}
