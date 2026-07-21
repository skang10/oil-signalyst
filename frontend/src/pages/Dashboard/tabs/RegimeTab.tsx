import { useRole } from '@/context/RoleContext';
import { useReport } from '@/hooks/useReport';
import Card from '@/components/shared/Card';
import TagBadge, { type TagKind } from '@/components/shared/TagBadge';
import RegimeGrid, { type RegimeGridItem } from '@/components/shared/RegimeGrid';

import {
  REGIME_IDS,
  REGIME_LABELS,
  REGIME_PROVENANCE,
  REGIME_TRIGGER,
  sampleNote,
  switchProbabilityText,
} from '@/lib/regime';

const DIRECTION_TAG: Record<'bullish' | 'bearish' | 'neutral', TagKind> = {
  bullish: 'green',
  bearish: 'red',
  neutral: 'muted',
};

const DIRECTION_LABEL: Record<'bullish' | 'bearish' | 'neutral', string> = {
  bullish: 'Bullish',
  bearish: 'Bearish',
  neutral: 'Neutral',
};

export default function RegimeTab() {
  const { role } = useRole();
  const { data: report } = useReport(role);
  if (!report) return <div className="text-text-muted text-[12px]">Loading...</div>;

  const regime = report.regime;
  const regimeItems: RegimeGridItem[] = REGIME_IDS
    .map((id) => ({
      id,
      label: REGIME_LABELS[id],
      prob: regime.probabilities[id],
      isDominant: id === regime.dominant,
      sub: REGIME_TRIGGER[id],
    }))
    .sort((a, b) => b.prob - a.prob);

  const durationPct = Math.min(100, Math.round((regime.duration_weeks / regime.historical_avg_duration) * 100));

  return (
    <>
      <div className="mb-[14px]">
        <div className="flex items-baseline gap-[10px]">
          <div className="text-[15px] font-medium">Market Regime</div>
          <span className="text-[10px] uppercase tracking-[0.5px] px-[7px] py-[2px] rounded-default bg-surface-2 border border-border text-text-muted">
            State indicator · not a forecast
          </span>
        </div>
        <div className="text-[12px] text-text-muted mt-[2px]">{report.date} · Based on closing data</div>
      </div>

      {/* Provenance up front, not as a footnote: every number below traces to
          17 hand-typed transition dates, and the tab sits beside two genuine
          forecast tabs. */}
      <div className="mb-3 p-[10px_12px] rounded-default bg-surface-1 border border-border text-[11px] text-text-muted leading-[1.5]">
        {REGIME_PROVENANCE}
      </div>

      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-3">
          Current Regime Probability Distribution
        </div>
        <RegimeGrid regimes={regimeItems} />
      </Card>

      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">Supporting Signals</div>
        {regime.support_signals.map((s) => (
          <div key={s.name} className="flex items-center gap-[10px] py-[6px] border-b border-border text-[12px] last:border-b-0">
            <span className="flex-1 text-text-secondary">{s.name}</span>
            <span className="font-medium">{s.value}</span>
            <TagBadge kind={DIRECTION_TAG[s.direction]}>{DIRECTION_LABEL[s.direction]}</TagBadge>
          </div>
        ))}
      </Card>

      <div className="grid grid-cols-2 gap-[10px]">
        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
            Current Regime Duration
          </div>
          <div className="flex items-center gap-2 text-[11px] my-[6px]">
            <span className="w-12 text-text-secondary">Running</span>
            <div className="flex-1 h-2 bg-surface-1 rounded-full overflow-hidden">
              <div className="h-full bg-accent-fill rounded-full" style={{ width: `${durationPct}%` }} />
            </div>
            <span className="font-medium">{regime.duration_weeks} weeks</span>
          </div>
          {/* "currently mid-cycle" used to be printed unconditionally, so a
              regime running 0 weeks was still described as mid-cycle. */}
          <div className="text-[11px] text-text-muted mt-1">
            {regime.dominant} historically lasts {regime.historical_avg_duration} weeks on average
            {sampleNote(regime.historical_segment_count)}
          </div>
        </Card>

        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
            Regime Switch Outlook
          </div>
          {/* Was "4-week switch probability: 0%", which reads as a calibrated
              forecast. It is a ratio over a handful of hand-drawn periods, so
              state the count instead. */}
          <div className="p-[10px] bg-surface-1 border border-border rounded-default text-[12px] text-text-secondary">
            <div className="font-medium mb-[6px] text-text-primary">
              {switchProbabilityText(regime.switch_probability_basis)}
            </div>
            {regime.switch_trigger}
          </div>
        </Card>
      </div>
    </>
  );
}
