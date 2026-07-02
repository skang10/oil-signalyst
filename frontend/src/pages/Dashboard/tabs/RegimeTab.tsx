import { useRole } from '@/context/RoleContext';
import { useReport } from '@/hooks/useReport';
import Card from '@/components/shared/Card';
import TagBadge, { type TagKind } from '@/components/shared/TagBadge';
import RegimeGrid, { type RegimeGridItem } from '@/components/shared/RegimeGrid';

const REGIME_LABELS: Record<'R1' | 'R2' | 'R3' | 'R4', string> = {
  R1: 'R1 — Supply Squeeze Bull',
  R2: 'R2 — Demand Expansion Bull',
  R3: 'R3 — Oversupply Bear',
  R4: 'R4 — Demand Collapse Bear',
};

const REGIME_TRIGGER: Record<'R1' | 'R2' | 'R3' | 'R4', string> = {
  R1: 'Production cuts / geopolitical disruption',
  R2: 'Strong GDP / China demand',
  R3: 'OPEC production increase / inventory build',
  R4: 'Recession / pandemic shock',
};

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
  const regimeItems: RegimeGridItem[] = (['R1', 'R2', 'R3', 'R4'] as const)
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
        <div className="text-[15px] font-medium">Market Regime Report</div>
        <div className="text-[12px] text-text-muted mt-[2px]">{report.date} · Based on closing data</div>
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
          <div className="text-[11px] text-text-muted mt-1">
            {regime.dominant} historically lasts {regime.historical_avg_duration} weeks avg — currently mid-cycle
          </div>
        </Card>

        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
            Regime Switch Warning
          </div>
          <div className="p-[10px] bg-warning-bg border border-warning-border rounded-default text-[12px] text-warning">
            <div className="font-medium mb-[6px]">
              4-week switch probability: {Math.round(regime.switch_probability_4w * 100)}%
            </div>
            {regime.switch_trigger}
          </div>
        </Card>
      </div>
    </>
  );
}
