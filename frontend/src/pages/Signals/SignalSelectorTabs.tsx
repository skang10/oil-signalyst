import { IconSatellite, IconShip, IconChartLine, IconCircleDot } from '@tabler/icons-react';
import type { SignalCandidate } from '@/types/api';
import { cn } from '@/lib/utils';

const ICON: Record<string, typeof IconSatellite> = {
  satellite: IconSatellite,
  ais: IconShip,
  natgas: IconChartLine,
  copper: IconCircleDot,
};

export default function SignalSelectorTabs({
  candidates,
  active,
  onSelect,
}: {
  candidates: SignalCandidate[];
  active: string;
  onSelect: (name: string) => void;
}) {
  return (
    <div className="flex gap-2 mb-4 flex-wrap">
      {candidates.map((c) => {
        const Icon = ICON[c.name] ?? IconCircleDot;
        const isActive = c.name === active;
        return (
          <button
            key={c.name}
            type="button"
            onClick={() => onSelect(c.name)}
            className={cn(
              'flex items-center gap-[6px] px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer border',
              isActive ? 'border-accent-border bg-accent-bg text-accent-text font-medium' : 'border-border bg-surface-2 text-text-secondary'
            )}
          >
            <Icon size={14} stroke={1.75} />
            {c.label.replace(/\s*\(.*\)$/, '')}
          </button>
        );
      })}
    </div>
  );
}
