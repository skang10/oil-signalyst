import { Fragment } from 'react';
import Card from '@/components/shared/Card';
import { cn } from '@/lib/utils';
import type { CrossValidateModel, TrainJob } from '@/types/api';

const MODEL_LABEL: Record<string, string> = {
  eia: 'EIA Inventory',
  returns: '20-Day Return',
};

function fmt(v: number | null, digits: number): string {
  return v == null ? '—' : v.toFixed(digits);
}

function ModelBlock({ type, m }: { type: string; m: CrossValidateModel }) {
  const digits = m.metric === 'mae' ? 2 : 3;
  const beatsAll = m.n_beat_baseline === m.n_folds && m.n_folds > 0;
  return (
    <div className="mb-[14px] last:mb-0">
      <div className="flex items-baseline justify-between mb-[8px]">
        <div className="text-[12px] font-medium">
          {MODEL_LABEL[type] ?? type}{' '}
          <span className="text-text-muted font-normal uppercase text-[10px] tracking-[0.5px]">
            {m.metric}
          </span>
        </div>
        {/* The headline: mean over folds, with the spread. Lower is better for
            both metrics here (MAE, Brier). */}
        <div className="font-mono tabular-nums text-[12px]">
          <span className="text-text-primary font-semibold">{fmt(m.mean, digits)}</span>
          <span className="text-text-muted"> ± {fmt(m.std, digits)}</span>
          <span className="text-text-muted text-[11px]">
            {' '}
            [{fmt(m.min, digits)}–{fmt(m.max, digits)}]
          </span>
        </div>
      </div>

      {/* Beats baseline in how many folds - the honest headline about skill. */}
      <div
        className={cn(
          'text-[11px] mb-[8px]',
          beatsAll ? 'text-success' : m.n_beat_baseline === 0 ? 'text-danger' : 'text-warning'
        )}
      >
        Beat the baseline in {m.n_beat_baseline} of {m.n_folds} folds
        {m.n_beat_baseline === 0 && ' — no skill on this feature set'}.
      </div>

      <div className="grid grid-cols-[60px_1fr_1fr_60px] text-[10px] text-text-muted uppercase tracking-[0.4px] pb-[4px]">
        <div>Test yr</div>
        <div className="text-right">{m.metric}</div>
        <div className="text-right">Baseline</div>
        <div className="text-right">Beat</div>
      </div>
      {m.folds.map((f) => {
        const value = f[m.metric] as number | null;
        return (
          <div
            key={f.fold}
            className="grid grid-cols-[60px_1fr_1fr_60px] text-[11px] py-[3px] border-t border-border font-mono tabular-nums"
          >
            <div className="text-text-secondary">{f.fold}</div>
            <div className={cn('text-right', f.beat ? 'text-success' : 'text-text-primary')}>
              {fmt(value, digits)}
            </div>
            <div className="text-right text-text-muted">{fmt(f.baseline, digits)}</div>
            <div className={cn('text-right', f.beat ? 'text-success' : 'text-danger')}>
              {f.beat == null ? '—' : f.beat ? '✓' : '✗'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Walk-forward cross-validation result: each model's metric distribution across
 * expanding-origin folds. This is the trustworthy read the single train/test
 * split can't give when a year is only ~12-20 independent observations - one
 * fold can look good or bad by luck; the spread across 8 folds cannot.
 */
export default function CrossValidateCard({ job }: { job: TrainJob }) {
  const models = job.result?.models;
  if (!models) return null;
  return (
    <Card className="mb-3">
      <div className="flex items-baseline justify-between mb-[4px]">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium">
          Walk-Forward Cross-Validation
        </div>
        <div className="text-[11px] text-text-muted">
          {job.result?.n_folds} folds · {job.result?.span}
        </div>
      </div>
      <div className="text-[11px] text-text-muted mb-[12px] leading-[1.5]">
        Each fold trains on all data before a year and tests on that year. Reported as
        mean ± std across folds — deploys nothing.
      </div>
      {Object.entries(models).map(([type, m], i) => (
        <Fragment key={type}>
          {i > 0 && <div className="border-t border-border my-[10px]" />}
          <ModelBlock type={type} m={m} />
        </Fragment>
      ))}
    </Card>
  );
}
