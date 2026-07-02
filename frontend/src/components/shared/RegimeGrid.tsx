import { cn } from '@/lib/utils';

export interface RegimeGridItem {
  id: 'R1' | 'R2' | 'R3' | 'R4';
  label: string;
  prob: number;
  isDominant: boolean;
  sub?: string;
}

const REGIME_STYLE: Record<RegimeGridItem['id'], { text: string; bar: string }> = {
  R1: { text: 'text-accent-text', bar: 'var(--fill-accent)' },
  R2: { text: 'text-success', bar: '#3B6D11' },
  R3: { text: 'text-danger', bar: '#A32D2D' },
  R4: { text: 'text-warning', bar: '#BA7517' },
};

export default function RegimeGrid({ regimes }: { regimes: RegimeGridItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {regimes.map((r) => {
        const style = REGIME_STYLE[r.id];
        return (
          <div
            key={r.id}
            className={cn(
              'p-[10px_12px] rounded-default border',
              r.isDominant ? 'bg-danger-bg border-danger-border' : 'bg-surface-1 border-border'
            )}
          >
            <div className={cn('text-[11px] mb-1', r.isDominant ? 'text-danger' : 'text-text-muted')}>
              {r.label}
              {r.isDominant ? ' ★' : ''}
            </div>
            <div className={cn('text-[20px] font-medium', style.text)}>{Math.round(r.prob * 100)}%</div>
            <div
              className="h-[3px] rounded-[2px] mt-[6px]"
              style={{ width: `${Math.round(r.prob * 100)}%`, background: style.bar }}
            />
            {r.sub && <div className="text-[11px] text-text-muted mt-[6px]">{r.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}
