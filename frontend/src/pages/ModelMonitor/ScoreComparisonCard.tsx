import Card from '@/components/shared/Card';
import { cn } from '@/lib/utils';
import { MODEL_LABEL, fmt, fmtSkill, metricUnit } from '@/lib/model-metrics';
import type { ModelStatus } from '@/types/api';

type Model = ModelStatus['models'][number];

/**
 * The three references that make a live model's score mean something: what it
 * scores, what a no-features constant predictor scores on the same window, and
 * what the version it replaced scored.
 *
 * Skill is the column to read across rows, not the raw metric. Every version is
 * evaluated on its own test window (2025 -> that version's training date), and
 * those windows differ in difficulty, so raw numbers are not comparable between
 * the live and previous rows. Skill divides by the baseline, which is rescored
 * on the same window, cancelling most of that out - the eia model's raw MAE
 * improved 0.8% across its last two versions while its skill improved only
 * 0.24pp, the rest being an easier window.
 */
function skillTone(skill: number | null): string {
  if (skill === null) return 'text-text-muted';
  if (skill < 0) return 'text-danger';
  return skill < 0.02 ? 'text-warning' : 'text-success';
}

function Row({
  label,
  version,
  primary,
  baseline,
  skill,
  unit,
  digits,
  note,
  muted,
}: {
  label: string;
  version?: string | null;
  primary: number | null;
  baseline?: number | null;
  skill: number | null;
  unit: string;
  digits: number;
  note?: string | null;
  muted?: boolean;
}) {
  return (
    <>
      <div className={cn('p-[6px_9px] border-t border-border', muted && 'text-text-muted')}>
        <div className="text-text-secondary">{label}</div>
        {version && <div className="text-[10px] text-text-muted font-mono">{version}</div>}
        {note && <div className="text-[10px] text-warning">{note}</div>}
      </div>
      <div className="p-[6px_9px] border-t border-border text-right tabular-nums">
        {fmt(primary, digits)}
        {primary === null ? '' : unit}
      </div>
      <div className="p-[6px_9px] border-t border-border text-right tabular-nums text-text-muted">
        {baseline === undefined ? '—' : fmt(baseline, digits)}
        {baseline === null || baseline === undefined ? '' : unit}
      </div>
      <div
        className={cn(
          'p-[6px_9px] border-t border-border text-right tabular-nums font-medium',
          skillTone(skill)
        )}
      >
        {fmtSkill(skill)}
      </div>
    </>
  );
}

export default function ScoreComparisonCard({ models }: { models: Model[] }) {
  const forecasts = models.filter((m) => m.is_forecast);
  if (forecasts.length === 0) return null;

  return (
    <Card className="mb-3">
      <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[8px]">
        Live Model vs Baseline vs Previous
      </div>
      <div className="text-[11px] text-text-muted mb-[12px]">
        Skill is the share of the baseline&apos;s error the model removed — 0 means no better than a
        constant predictor that ignores every feature. Read <em>skill</em> across rows, not the raw
        metric: each version is scored on its own test window, and the baseline absorbs how hard
        that window was.
      </div>

      <div className="flex flex-col gap-[14px]">
        {forecasts.map((m) => {
          const digits = m.type === 'eia' ? 2 : 4;
          const unit = metricUnit(m.type);
          const delta =
            m.metrics.skill !== null && m.previous?.skill != null
              ? m.metrics.skill - m.previous.skill
              : null;
          return (
            <div key={m.type}>
              <div className="text-[11.5px] font-medium mb-[5px]">
                {MODEL_LABEL[m.type]}
                <span className="text-text-muted font-normal"> · {m.metric_key}</span>
              </div>
              <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] border border-border rounded-default overflow-hidden text-[11.5px] bg-surface-2">
                {['', m.metric_key ?? 'metric', 'Baseline', 'Skill'].map((h, i) => (
                  <div
                    key={h || i}
                    className={cn(
                      'p-[5px_9px] bg-surface-1 text-[10px] font-medium text-text-muted uppercase tracking-[0.4px]',
                      i > 0 && 'text-right'
                    )}
                  >
                    {h}
                  </div>
                ))}
                <Row
                  label="Live now"
                  version={m.version}
                  primary={m.metrics.primary}
                  baseline={m.metrics.baseline}
                  skill={m.metrics.skill}
                  unit={unit}
                  digits={digits}
                  // A live model that failed the gate got there by hand. That is
                  // a supported override, but it should never be silent.
                  note={m.gate_passed === false ? 'failed the gate — deployed by hand' : null}
                />
                {m.previous ? (
                  <Row
                    label="Previously live"
                    version={m.previous.version}
                    primary={m.previous.primary}
                    baseline={m.previous.baseline}
                    skill={m.previous.skill}
                    unit={unit}
                    digits={digits}
                    muted
                  />
                ) : (
                  <div className="col-span-4 p-[6px_9px] border-t border-border text-[11px] text-text-muted">
                    No earlier deployed version — this is the first model of its type in production.
                  </div>
                )}
              </div>
              <div className="text-[10.5px] mt-[5px]">
                {m.metrics.skill !== null && m.metrics.skill < 0 ? (
                  <span className="text-danger">
                    Live model is worse than the baseline. A constant predictor built from the
                    training base rates would score better on the same window.
                  </span>
                ) : delta !== null ? (
                  <span className="text-text-muted">
                    Skill change vs the version it replaced: {fmtSkill(delta, true)}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
