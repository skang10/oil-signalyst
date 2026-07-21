import Card from '@/components/shared/Card';
import TagBadge from '@/components/shared/TagBadge';
import { cn } from '@/lib/utils';
import type { ModelStatus } from '@/types/api';

type Dataset = ModelStatus['training_dataset'];

const GRID = 'grid grid-cols-[180px_1fr_90px_90px_90px] items-center gap-x-3';

function Num({ value, muted }: { value: number; muted?: boolean }) {
  return (
    <span className={cn('font-mono tabular-nums text-right', muted && 'text-text-muted')}>
      {value.toLocaleString()}
    </span>
  );
}

/**
 * What the models are actually fit on: coverage, row counts, split boundaries.
 *
 * The rest of this page reports feed health - whether each source is arriving
 * and drifting - which never answers the first questions a modeller asks. Two
 * things stayed invisible without it: the gap where 2025 should be, and that
 * no calibration set is held out at all.
 */
export default function TrainingDatasetCard({ dataset }: { dataset: Dataset }) {
  if (!dataset.available) {
    return (
      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
          Training Dataset
        </div>
        <div className="text-[12px] text-text-muted">
          No feature matrix on disk yet — run the backfill to build one.
        </div>
      </Card>
    );
  }

  const { matrix, splits } = dataset;
  const weekendPct = ((matrix.weekend_rows / matrix.rows) * 100).toFixed(1);
  // A gap this size means an entire period is absent, which silently produces
  // empty validation windows for any cutoff inside it.
  const gapIsHole = matrix.largest_gap_days > 31;

  return (
    <Card className="mb-3">
      <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
        Training Dataset
      </div>

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[12px] mb-[10px]">
        <span className="text-text-secondary">
          Coverage{' '}
          <span className="font-mono text-text-primary">
            {matrix.start} → {matrix.end}
          </span>
        </span>
        <span className="text-text-secondary">
          <span className="font-mono tabular-nums text-text-primary">
            {matrix.rows.toLocaleString()}
          </span>{' '}
          rows
        </span>
        <span className="text-text-muted">
          <span className="font-mono tabular-nums">{matrix.weekday_rows.toLocaleString()}</span>{' '}
          weekday ·{' '}
          <span className="font-mono tabular-nums">{matrix.weekend_rows.toLocaleString()}</span>{' '}
          weekend ({weekendPct}%, forward-filled)
        </span>
      </div>

      {gapIsHole && (
        <div className="mb-[10px] p-[7px_10px] rounded-default bg-warning-bg border border-warning-border text-[11px] text-warning">
          {matrix.largest_gap_days}-day gap at{' '}
          <span className="font-mono">{matrix.largest_gap_at}</span> — a cutoff date inside it
          yields an empty or near-empty validation window.
        </div>
      )}

      <div className={cn(GRID, 'text-[10px] text-text-muted uppercase tracking-[0.4px] pb-[6px]')}>
        <div>Split</div>
        <div>Window</div>
        <div className="text-right">Rows</div>
        <div className="text-right">Weekday</div>
        {/* Consecutive rows share nearly all of a 20-day forward label, so this
            is the count any metric should actually be read against. */}
        <div className="text-right" title="Non-overlapping 20-trading-day label windows">
          Effective n
        </div>
      </div>

      {splits.map((split) => {
        const declaredDiffers =
          split.declared_start && split.start && split.declared_start !== split.start;
        return (
          <div
            key={split.name}
            className={cn(GRID, 'text-[12px] py-[7px] border-t border-border')}
          >
            <div className="text-text-secondary">
              {split.name}
              {split.warning && (
                <TagBadge kind="yellow">
                  <span className="ml-[6px]">not held out</span>
                </TagBadge>
              )}
            </div>
            <div className="font-mono text-[11px] text-text-muted">
              {split.start ? (
                <>
                  {split.start} → {split.end}
                  {declaredDiffers && (
                    <span className="text-warning ml-2">
                      declared {split.declared_start}
                    </span>
                  )}
                </>
              ) : (
                '—'
              )}
            </div>
            <Num value={split.rows} muted={split.rows === 0} />
            <Num value={split.weekday_rows} muted />
            <Num value={split.effective_n} muted={split.effective_n === 0} />
          </div>
        );
      })}

      {splits
        .filter((s) => s.warning)
        .map((s) => (
          <div key={s.name} className="text-[11px] text-warning mt-[8px]">
            {s.name}: {s.warning}
          </div>
        ))}

      {/* Effective n is the load-bearing number here - it's what every metric
          should be read against - and it's far below the row count, so it
          needs saying rather than hiding in a tooltip. */}
      <div className="text-[11px] text-text-muted leading-[1.5] mt-[10px] pt-[8px] border-t border-border">
        <span className="text-text-secondary">Effective n</span> = independent
        observations, not rows. Labels look 20 trading days ahead, so consecutive
        daily rows share almost all of their outcome window and weekend rows are
        forward-filled duplicates — validation's {' '}
        {splits.find((s) => s.name === 'Validation')?.weekday_rows ?? 0} weekday rows
        are worth only ~{splits.find((s) => s.name === 'Validation')?.effective_n ?? 0}{' '}
        independent samples. Read every accuracy and Brier figure against this, not
        the row count.
      </div>
    </Card>
  );
}
