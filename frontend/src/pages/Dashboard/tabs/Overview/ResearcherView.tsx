import type { Dispatch, SetStateAction } from 'react';
import type { DailyReport } from '@/types/api';
import type { DashTab } from '@/types/roles';
import Card from '@/components/shared/Card';
import TagBadge from '@/components/shared/TagBadge';
import SHAPBar from '@/components/shared/SHAPBar';
import RegimeGrid, { type RegimeGridItem } from '@/components/shared/RegimeGrid';
import NoRegimeModelNotice from '@/components/shared/NoRegimeModelNotice';
import DistChart from '@/components/shared/DistChart';
import { IconSatellite, IconShip, IconChartLine } from '@tabler/icons-react';
import { REGIME_IDS, REGIME_LABELS } from '@/lib/regime';

const CANDIDATE_PREVIEW = [
  { icon: IconSatellite, label: 'Satellite Tank Fill Rate (Middle East)', ic: 0.31, tag: 'Recommended' as const },
  { icon: IconShip, label: 'AIS VLCC Vessel Count (Persian Gulf)', ic: 0.28, tag: 'Recommended' as const },
  { icon: IconChartLine, label: 'Natural Gas Price (NG=F)', ic: 0.19, tag: 'Watch' as const },
];

export default function ResearcherView({
  report,
  onNavigateTab,
}: {
  report: DailyReport;
  onNavigateTab: Dispatch<SetStateAction<DashTab>>;
}) {
  const regime = report.regime;
  const regimeAvailable = report.regime_available;
  const eia = report.eia;
  const returns = report.returns;
  const maxAbs = Math.max(...regime.shap_drivers.map((d) => Math.abs(d.contribution)));

  const regimeItems: RegimeGridItem[] = REGIME_IDS
    .map((id) => ({
      id,
      label: REGIME_LABELS[id],
      prob: regime.probabilities[id] ?? 0,
      isDominant: id === regime.dominant,
    }))
    .sort((a, b) => b.prob - a.prob);

  return (
    <>
      <div className="mb-3">
        <Card>
          {regimeAvailable ? <RegimeGrid regimes={regimeItems} /> : <NoRegimeModelNotice compact />}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-[10px] mb-3">
        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
            SHAP Feature Importance (Regime)
          </div>
          {regime.shap_drivers.map((d) => (
            <SHAPBar
              key={d.name}
              name={d.name}
              widthPct={(Math.abs(d.contribution) / maxAbs) * 80}
              displayValue={d.contribution.toFixed(2)}
              color={d.direction === 'bullish' ? 'success' : 'danger'}
              valueColor={d.direction === 'bullish' ? 'success' : 'danger'}
              tag={<TagBadge kind={d.direction === 'bullish' ? 'green' : 'red'}>{d.direction === 'bullish' ? 'Bullish' : 'Bearish'}</TagBadge>}
            />
          ))}
        </Card>

        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
            New Signal Candidates (Signal Scanner)
          </div>
          {CANDIDATE_PREVIEW.map((c) => (
            <div key={c.label} className="flex items-center gap-[10px] p-[7px_10px] bg-surface-1 rounded-default text-[12px] mb-[6px] last:mb-0">
              <c.icon size={15} stroke={1.75} className={c.tag === 'Recommended' ? 'text-accent-text' : 'text-text-muted'} />
              <span className="flex-1 text-text-secondary">{c.label}</span>
              <span className="font-medium font-mono">IC {c.ic.toFixed(2)}</span>
              <TagBadge kind={c.tag === 'Recommended' ? 'green' : 'yellow'}>{c.tag}</TagBadge>
            </div>
          ))}
          <div className="mt-[10px] text-[12px] text-text-muted">
            Full evaluation in{' '}
            <a href="/signals" className="text-accent-text">
              Signals ↗
            </a>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-[10px]">
        <Card>
          <div className="flex items-center justify-between mb-[10px]">
            <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium">EIA Inventory Forecast</div>
            <TagBadge kind="red">Surprise {eia.surprise_mb.toFixed(1)} MB</TagBadge>
          </div>
          <div className="flex items-baseline gap-[10px] mb-[6px]">
            <span className="text-[22px] font-medium text-danger">
              {eia.forecast_mb.toFixed(1)} <span className="text-[14px] font-normal">MB</span>
            </span>
          </div>
          <div className="text-[12px] text-text-secondary mb-2">
            Market consensus {eia.consensus_mb.toFixed(1)} MB · Range {eia.interval_80_low.toFixed(1)}~{eia.interval_80_high.toFixed(1)} MB
          </div>
          <div className="text-[12px] text-text-muted">
            Full SHAP + historical accuracy →{' '}
            <button
              type="button"
              className="px-[10px] py-[2px] text-[11px] border border-border-strong bg-surface-2 rounded-default cursor-pointer hover:bg-surface-1"
              onClick={() => onNavigateTab('eia')}
            >
              EIA Detail ↗
            </button>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-[10px]">
            <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium">
              Return Distribution (Next 20 Days)
            </div>
            <TagBadge kind="red">Downside {Math.round(returns.downside_prob * 100)}%</TagBadge>
          </div>
          <DistChart buckets={returns.buckets} height={60} />
          <div className="mt-[6px] text-[12px] text-text-muted">
            Stats summary + full breakdown →{' '}
            <button
              type="button"
              className="px-[10px] py-[2px] text-[11px] border border-border-strong bg-surface-2 rounded-default cursor-pointer hover:bg-surface-1"
              onClick={() => onNavigateTab('returns')}
            >
              Returns Detail ↗
            </button>
          </div>
        </Card>
      </div>
    </>
  );
}
