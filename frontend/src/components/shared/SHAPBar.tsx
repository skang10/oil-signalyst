import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SHAPBarProps {
  name: string;
  widthPct: number;
  displayValue: string;
  color?: 'danger' | 'success' | 'accent';
  valueColor?: 'danger' | 'success';
  tag?: ReactNode;
}

const FILL_COLOR: Record<NonNullable<SHAPBarProps['color']>, string> = {
  danger: 'var(--text-danger)',
  success: 'var(--text-success)',
  accent: 'var(--fill-accent)',
};

export default function SHAPBar({ name, widthPct, displayValue, color = 'danger', valueColor, tag }: SHAPBarProps) {
  return (
    <div className="flex items-center gap-2 py-[5px] border-b border-border text-[12px] last:border-b-0">
      <span className="text-text-secondary w-[152px] shrink-0 font-mono text-[11px]">{name}</span>
      <div className="flex-1 h-[5px] bg-surface-1 rounded-[3px] overflow-hidden">
        <div
          className="h-full rounded-[3px] opacity-70"
          style={{ width: `${Math.min(100, Math.max(0, widthPct))}%`, background: FILL_COLOR[color] }}
        />
      </div>
      <span className={cn('text-[11px] w-8 text-right', valueColor === 'success' ? 'text-success' : valueColor === 'danger' ? 'text-danger' : undefined)}>
        {displayValue}
      </span>
      {tag}
    </div>
  );
}
