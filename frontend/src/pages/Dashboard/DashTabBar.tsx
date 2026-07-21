import { Fragment } from 'react';
import { useRole } from '@/context/RoleContext';
import { ROLE_PERMISSIONS, type DashTab } from '@/types/roles';
import { cn } from '@/lib/utils';

/**
 * The two tabs that forecast something say so in their own name; Regime and
 * Market Data describe the present and do not.
 *
 * The label carries the distinction directly, so nothing else has to: no group
 * captions taking a second line, and no colour-coding - the accent stays
 * meaning only "selected", which it had briefly shared with "is a forecast".
 * The divider keeps the two kinds visually grouped.
 */
const TABS: { key: DashTab; label: string; startsGroup?: boolean }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'eia', label: 'EIA Inventory Forecast', startsGroup: true },
  { key: 'returns', label: 'Return Dist. Forecast' },
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

  return (
    <div className="flex border-b border-border bg-surface-2 shrink-0 px-[18px]">
      {TABS.map((tab) => {
        const dimmed =
          ROLE_PERMISSIONS.dimmedDashTabs.includes(tab.key) &&
          (role === 'trader' || role === 'risk');
        const active = tab.key === activeTab;
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
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
