import { Fragment } from 'react';
import { useRole } from '@/context/RoleContext';
import { useModelStatus } from '@/hooks/useModelStatus';
import { ROLE_PERMISSIONS, type DashTab } from '@/types/roles';
import { compactMetric } from '@/lib/model-metrics';
import { cn } from '@/lib/utils';

/**
 * Tabs are ordered forecasts-then-state, and the forecast tabs wear their
 * current score.
 *
 * The distinction between these two kinds is not a category to be announced -
 * it is that EIA and Return Dist. predict something with an observable outcome
 * and are scored against it, while Regime and Market Data describe the
 * present. So the score itself carries the distinction and the *absence* of
 * one on Regime is the honest signal, which a "Forecast" / "Current state"
 * caption pair could only assert. It also keeps the bar one line high, and
 * leaves the accent colour meaning only "selected" - it had briefly meant both
 * "selected" and "is a forecast", so blue no longer told you which.
 */
const TABS: { key: DashTab; label: string; modelType?: 'eia' | 'returns'; startsGroup?: boolean }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'eia', label: 'EIA Inventory', modelType: 'eia', startsGroup: true },
  { key: 'returns', label: 'Return Dist.', modelType: 'returns' },
  { key: 'regime', label: 'Regime', startsGroup: true },
  { key: 'charts', label: 'Market Data' },
];

export default function DashTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: DashTab;
  onTabChange: (tab: DashTab) => void;
}) {
  const { role } = useRole();
  const { data: modelStatus } = useModelStatus();

  const scoreFor = (modelType?: 'eia' | 'returns'): string | null => {
    if (!modelType || !modelStatus) return null;
    const model = modelStatus.models.find((m) => m.type === modelType);
    return model ? compactMetric(model) : null;
  };

  return (
    <div className="flex border-b border-border bg-surface-2 shrink-0 px-[18px]">
      {TABS.map((tab) => {
        const dimmed =
          ROLE_PERMISSIONS.dimmedDashTabs.includes(tab.key) &&
          (role === 'trader' || role === 'risk');
        const active = tab.key === activeTab;
        const score = scoreFor(tab.modelType);
        return (
          <Fragment key={tab.key}>
            {tab.startsGroup && <div className="self-center h-[14px] w-px bg-border mx-[8px]" />}
            <button
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={cn(
                'px-[14px] py-[9px] text-[12px] bg-none cursor-pointer whitespace-nowrap -mb-px border-b-2 border-transparent transition-colors',
                active
                  ? 'text-text-primary font-medium border-accent-fill'
                  : 'text-text-muted hover:text-text-primary',
                dimmed && 'opacity-50'
              )}
            >
              {tab.label}
              {score && (
                // tabular-nums so the tab keeps its width as the score changes.
                <span className="ml-[7px] text-[11px] font-mono tabular-nums text-text-muted">
                  {score}
                </span>
              )}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
