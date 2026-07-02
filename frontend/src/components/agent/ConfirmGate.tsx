import type { ConfirmGateState } from './types';
import { cn } from '@/lib/utils';

interface ConfirmGateProps extends ConfirmGateState {
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmGate({ step, title, detail, confirmLabel, cancelLabel, status, onConfirm, onCancel }: ConfirmGateProps) {
  if (status === 'cancelled') {
    return (
      <div className="mt-2 p-[6px_8px] rounded bg-warning-bg border border-warning-border font-mono text-[11px] text-warning">
        ✗ Action cancelled
      </div>
    );
  }

  if (status === 'confirmed') {
    return (
      <div className="mt-2 p-[6px_8px] rounded bg-success-bg border border-success-border font-mono text-[11px] text-success">✓ Confirmed</div>
    );
  }

  return (
    <div className="bg-surface-2 border border-warning-border rounded-default p-[12px_14px] mt-2">
      <div className="text-[12px] font-medium text-warning mb-[6px] flex items-center gap-[6px]">
        ⚠ Confirm action {step} — {title}
      </div>
      <div className="text-[12px] text-text-secondary mb-[10px] leading-[1.75]">{detail}</div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className={cn('px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-accent-fill text-on-accent border border-accent-fill')}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={cn('px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-danger-bg text-danger border border-danger-border')}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
