import type { ReactNode } from 'react';
import Card from './Card';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  valueColor?: 'danger' | 'warning' | 'success' | 'muted' | 'primary';
  sub?: ReactNode;
  subColor?: 'danger' | 'warning' | 'muted';
  accentTop?: 'danger' | 'warning';
}

const VALUE_COLOR: Record<NonNullable<MetricCardProps['valueColor']>, string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  success: 'text-success',
  muted: 'text-text-muted',
  primary: 'text-text-primary',
};

const SUB_COLOR: Record<NonNullable<MetricCardProps['subColor']>, string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  muted: 'text-text-muted',
};

export default function MetricCard({ label, value, valueColor, sub, subColor, accentTop }: MetricCardProps) {
  return (
    <Card accentTop={accentTop}>
      <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-2">{label}</div>
      <div className={cn('text-[22px] font-medium tracking-[-0.3px]', valueColor ? VALUE_COLOR[valueColor] : 'text-text-primary')}>
        {value}
      </div>
      {sub && <div className={cn('text-[11px] mt-[3px]', subColor ? SUB_COLOR[subColor] : 'text-text-muted')}>{sub}</div>}
    </Card>
  );
}
