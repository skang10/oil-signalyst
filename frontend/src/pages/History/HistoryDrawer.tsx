import { useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useHistoryDetail } from '@/hooks/useHistoryDetail';
import RegimeGrid, { type RegimeGridItem } from '@/components/shared/RegimeGrid';
import TagBadge from '@/components/shared/TagBadge';
import { cn, formatUsd } from '@/lib/utils';
import { REGIME_IDS, REGIME_LABELS, switchProbabilityText } from '@/lib/regime';

type DrawerTab = 'summary' | 'regime' | 'features' | 'outcome';

const TABS: { key: DrawerTab; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'regime', label: 'Regime' },
  { key: 'features', label: 'Features' },
  { key: 'outcome', label: 'Outcome' },
];

function CfgRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px] last:border-b-0">
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export default function HistoryDrawer({ date, onClose }: { date: string | null; onClose: () => void }) {
  const [tab, setTab] = useState<DrawerTab>('summary');
  const { data: detail } = useHistoryDetail(date);

  const regimeItems: RegimeGridItem[] = detail
    ? REGIME_IDS.map((id) => ({
        id,
        label: REGIME_LABELS[id],
        prob: detail.regime.probabilities[id] ?? 0,
        isDominant: id === detail.regime.dominant,
      }))
    : [];

  return (
    <Sheet
      open={!!date}
      onOpenChange={(open) => {
        if (!open) onClose();
        setTab('summary');
      }}
    >
      <SheetContent side="right" showCloseButton={false} className="w-[376px] p-0 gap-0">
        {detail && (
          <>
            <div className="p-[12px_16px] border-b border-border flex items-center gap-[10px]">
              <div>
                <div className="text-[13px] font-medium">{formatDate(detail.date)}</div>
                <div className="text-[11px] text-text-muted mt-[2px]">
                  {formatUsd(detail.wti_price)} · {detail.model_version}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="ml-auto w-7 h-7 rounded-default border border-border bg-none flex items-center justify-center cursor-pointer text-text-secondary hover:bg-surface-1"
              >
                <IconX size={14} stroke={1.75} />
              </button>
            </div>

            <div className="flex border-b border-border">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'flex-1 p-2 text-[12px] bg-none cursor-pointer border-b-2 border-transparent',
                    tab === t.key ? 'text-text-primary font-medium border-accent-fill' : 'text-text-muted'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-[14px_16px]">
              {tab === 'summary' && (
                <div>
                  <CfgRow
                    label="Dominant Regime"
                    value={
                      <TagBadge kind="red">
                        {detail.regime.dominant} · {Math.round((detail.regime.probabilities[detail.regime.dominant] ?? 0) * 100)}%
                      </TagBadge>
                    }
                  />
                  <CfgRow label="Signal" value={<span className="text-text-muted">{detail.summary.signal}</span>} />
                  <CfgRow
                    label="Expected Return (20d)"
                    value={<span className="text-danger">{(detail.summary.expected_return * 100).toFixed(1)}%</span>}
                  />
                  <CfgRow
                    label="Downside Risk"
                    value={<span className="text-danger">{Math.round(detail.summary.downside_prob * 100)}%</span>}
                  />
                  <CfgRow
                    label="EIA Forecast"
                    value={
                      <span className="text-danger">
                        {detail.summary.eia_forecast_mb == null ? '—' : `${detail.summary.eia_forecast_mb.toFixed(1)} MB`}
                      </span>
                    }
                  />
                  <CfgRow label="Risk Recommendations" value={detail.summary.risk_recommendation} />
                </div>
              )}

              {tab === 'regime' && (
                <div>
                  <div className="mb-3">
                    <RegimeGrid regimes={regimeItems} />
                  </div>
                  <CfgRow label="Duration" value={`${detail.regime.duration_weeks} weeks`} />
                  <CfgRow
                    label="Switch outlook"
                    value={
                      <span className="text-text-muted text-[11px]">
                        {switchProbabilityText(detail.regime.switch_probability_basis)}
                      </span>
                    }
                  />
                </div>
              )}

              {tab === 'features' && (
                <div>
                  {detail.features.map((f) => (
                    <div key={f.name} className="flex items-center gap-2 py-[5px] border-b border-border text-[12px] last:border-b-0">
                      <span className="text-text-secondary w-[152px] shrink-0 font-mono text-[11px]">{f.name}</span>
                      <div className="flex-1 h-[5px] bg-surface-1 rounded-[3px] overflow-hidden">
                        <div className="h-full rounded-[3px] opacity-70" style={{ width: `${f.widthPct}%`, background: 'var(--text-danger)' }} />
                      </div>
                      <span className="text-[11px] w-8 text-right text-danger">{f.value.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'outcome' && (
                <div>
                  <CfgRow
                    label="EIA Actual"
                    value={
                      detail.outcome.eia_actual_mb === null ? (
                        <span className="text-[11px] text-text-muted">Published tomorrow</span>
                      ) : (
                        <span className={detail.outcome.eia_actual_mb < 0 ? 'text-danger' : 'text-success'}>
                          {detail.outcome.eia_actual_mb.toFixed(1)} MB
                        </span>
                      )
                    }
                  />
                  <CfgRow
                    label="Actual Return"
                    value={
                      detail.outcome.actual_return === null ? (
                        <span className="text-[11px] text-text-muted">Window closes in 28 days</span>
                      ) : (
                        <span className={detail.outcome.actual_return < 0 ? 'text-danger' : 'text-success'}>
                          {(detail.outcome.actual_return * 100).toFixed(1)}%
                        </span>
                      )
                    }
                  />
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
