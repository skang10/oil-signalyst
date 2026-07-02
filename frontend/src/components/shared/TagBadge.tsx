import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type TagKind = 'red' | 'green' | 'yellow' | 'blue' | 'purple' | 'muted';

const KIND_CLASS: Record<TagKind, string> = {
  red: 'bg-danger-bg text-danger',
  green: 'bg-success-bg text-success',
  yellow: 'bg-warning-bg text-warning',
  blue: 'bg-accent-bg text-accent-text',
  purple: 'bg-pro-bg text-pro',
  muted: 'bg-surface-1 text-text-muted border border-border',
};

export default function TagBadge({ kind, children }: { kind: TagKind; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[3px] px-2 py-[2px] rounded-[20px] text-[11px] font-medium',
        KIND_CLASS[kind]
      )}
    >
      {children}
    </span>
  );
}
