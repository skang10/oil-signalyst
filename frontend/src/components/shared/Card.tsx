import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CardProps {
  children: ReactNode;
  className?: string;
  accentTop?: 'danger' | 'warning';
  style?: CSSProperties;
}

export default function Card({ children, className, accentTop, style }: CardProps) {
  const accentStyle: CSSProperties =
    accentTop === 'danger'
      ? { borderTop: '2px solid var(--border-danger)' }
      : accentTop === 'warning'
        ? { borderTop: '2px solid var(--border-warning)' }
        : {};

  return (
    <div
      className={cn('bg-surface-2 border border-border rounded-default p-[14px_16px]', className)}
      style={{ ...accentStyle, ...style }}
    >
      {children}
    </div>
  );
}
