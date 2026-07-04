import type { ReactNode } from 'react';
import Card from '@/components/shared/Card';
import TagBadge from '@/components/shared/TagBadge';
import { useStressTest } from '@/hooks/useStressTest';

/**
 * Renders the real GET /api/reports/stress result: for each historical
 * extreme, the actual realized return and whether the *model* actually
 * alerted on it - including honest "Missed" rows (the hardcoded list this
 * replaces claimed "Alerted ✓" on every scenario unconditionally).
 */
export default function StressTestCard({ title, children }: { title: string; children?: ReactNode }) {
  const { data, error } = useStressTest();

  return (
    <Card>
      <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">{title}</div>
      {error || data?.error ? (
        <div className="p-[8px_10px] bg-surface-1 rounded-default text-[12px] text-text-muted">
          Stress test unavailable{data?.error ? ` — ${data.error}` : ''}
        </div>
      ) : !data ? (
        <div className="p-[8px_10px] bg-surface-1 rounded-default text-[12px] text-text-muted">
          Running scenarios…
        </div>
      ) : (
        data.scenarios.map((s) => (
          <div key={s.name} className="flex items-center gap-[10px] p-[8px_10px] bg-surface-1 rounded-default text-[12px] mb-[6px]">
            <span className="flex-1 text-text-secondary">{s.name}</span>
            {s.error != null ? (
              <>
                <span className="text-[11px] text-text-muted">no snapshot</span>
                <TagBadge kind="muted">N/A</TagBadge>
              </>
            ) : (
              <>
                <span className={`font-medium ${(s.actual_return ?? 0) < 0 ? 'text-danger' : 'text-success'}`}>
                  {(s.actual_return ?? 0) > 0 ? '+' : ''}
                  {((s.actual_return ?? 0) * 100).toFixed(1)}%
                </span>
                <TagBadge kind={s.model_alerted ? 'green' : 'yellow'}>
                  {s.model_alerted ? 'Alerted ✓' : 'Missed'}
                </TagBadge>
              </>
            )}
          </div>
        ))
      )}
      {children}
    </Card>
  );
}
