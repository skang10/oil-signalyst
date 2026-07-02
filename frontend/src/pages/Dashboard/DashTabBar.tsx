import { useRole } from '@/context/RoleContext';
import { ROLE_PERMISSIONS, type DashTab } from '@/types/roles';
import { cn } from '@/lib/utils';

const TABS: { key: DashTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'eia', label: 'EIA Forecast' },
  { key: 'regime', label: 'Regime' },
  { key: 'returns', label: 'Return Dist.' },
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
        const dimmed = ROLE_PERMISSIONS.dimmedDashTabs.includes(tab.key) &&
          (role === 'trader' || role === 'risk');
        const active = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={cn(
              'px-[14px] py-[9px] text-[12px] bg-none cursor-pointer whitespace-nowrap -mb-px border-b-2 border-transparent transition-colors',
              active ? 'text-text-primary font-medium border-accent-fill' : 'text-text-muted hover:text-text-primary',
              dimmed && 'opacity-50'
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
