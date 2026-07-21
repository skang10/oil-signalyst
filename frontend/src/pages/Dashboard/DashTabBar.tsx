import { useRole } from '@/context/RoleContext';
import { ROLE_PERMISSIONS, type DashTab } from '@/types/roles';
import { cn } from '@/lib/utils';

/**
 * Tabs are grouped and colour-coded by what kind of claim they make, because
 * sitting side by side in one undifferentiated row implied they were all the
 * same sort of thing.
 *
 * "Forecast" tabs predict something with an observable outcome and are scored
 * against it - the inventory change EIA later publishes, the realized 20-day
 * return. They carry the accent colour, the same one used for model output
 * throughout the app.
 *
 * "Current state" tabs describe the present. Regime's four buckets are an
 * analyst framework whose boundaries were typed by hand, and Market Data is
 * raw series - neither has a future outcome to be right or wrong about, so
 * they stay neutral rather than borrowing the accent that signals a scored
 * model.
 */
type TabGroup = {
  caption: string | null;
  kind: 'plain' | 'forecast' | 'state';
  tabs: { key: DashTab; label: string }[];
};

const TAB_GROUPS: TabGroup[] = [
  { caption: null, kind: 'plain', tabs: [{ key: 'overview', label: 'Overview' }] },
  {
    caption: 'Forecast',
    kind: 'forecast',
    tabs: [
      { key: 'eia', label: 'EIA Inventory' },
      { key: 'returns', label: 'Return Dist.' },
    ],
  },
  {
    caption: 'Current state',
    kind: 'state',
    tabs: [
      { key: 'regime', label: 'Regime' },
      { key: 'charts', label: 'Market Data' },
    ],
  },
];

// Active tab underline + text. Forecast keeps the accent fill; state uses a
// neutral rule so the colour itself carries the distinction rather than only
// the caption.
const ACTIVE_STYLE: Record<TabGroup['kind'], string> = {
  plain: 'text-text-primary font-medium border-text-muted',
  forecast: 'text-accent-text font-medium border-accent-fill',
  state: 'text-text-primary font-medium border-text-muted',
};

const IDLE_STYLE: Record<TabGroup['kind'], string> = {
  plain: 'text-text-muted hover:text-text-primary',
  forecast: 'text-text-muted hover:text-accent-text',
  state: 'text-text-muted hover:text-text-primary',
};

export default function DashTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: DashTab;
  onTabChange: (tab: DashTab) => void;
}) {
  const { role } = useRole();

  return (
    <div className="flex items-stretch border-b border-border bg-surface-2 shrink-0 px-[18px]">
      {TAB_GROUPS.map((group, groupIndex) => (
        <div key={group.caption ?? 'plain'} className="flex items-stretch">
          {groupIndex > 0 && <div className="self-center h-[16px] w-px bg-border mx-[10px]" />}
          <div className="flex flex-col justify-end">
            {group.caption && (
              <span
                className={cn(
                  'px-[14px] text-[9px] uppercase tracking-[0.7px] leading-none pt-[6px]',
                  group.kind === 'forecast' ? 'text-accent-text/70' : 'text-text-muted/70'
                )}
              >
                {group.caption}
              </span>
            )}
            <div className="flex">
              {group.tabs.map((tab) => {
                const dimmed =
                  ROLE_PERMISSIONS.dimmedDashTabs.includes(tab.key) &&
                  (role === 'trader' || role === 'risk');
                const active = tab.key === activeTab;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => onTabChange(tab.key)}
                    className={cn(
                      'px-[14px] pt-[5px] pb-[9px] text-[12px] bg-none cursor-pointer whitespace-nowrap -mb-px border-b-2 border-transparent transition-colors',
                      // Groups without a caption lose that line's height, so
                      // pad them to keep every tab's baseline aligned.
                      !group.caption && 'pt-[calc(5px+9px)]',
                      active ? ACTIVE_STYLE[group.kind] : IDLE_STYLE[group.kind],
                      dimmed && 'opacity-50'
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
