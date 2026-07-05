import { IconSatellite, IconShip, IconChartLine, IconCircleDot, IconCircleCheck } from '@tabler/icons-react';
import type { SignalCandidate } from '@/types/api';
import TagBadge from '@/components/shared/TagBadge';
import { cn } from '@/lib/utils';

const ICON: Record<string, typeof IconSatellite> = {
  satellite: IconSatellite,
  ais: IconShip,
  natgas: IconChartLine,
  copper: IconCircleDot,
};

export default function SignalRow({
  candidate,
  onEvaluate,
  active,
  onClick,
}: {
  candidate: SignalCandidate;
  onEvaluate: () => void;
  active?: boolean;
  onClick?: () => void;
}) {
  const recommended = candidate.recommendation === 'add';
  // Adoption state trumps scan recommendation in the visuals: once a signal
  // is in the pool (green) or snoozed (greyed), "Recommended"/"Watch" has
  // already served its purpose.
  const inPool = candidate.status === 'active';
  const snoozed = candidate.ignored_days_left != null;
  const Icon = inPool ? IconCircleCheck : (ICON[candidate.name] ?? IconCircleDot);

  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-center gap-[10px] p-[8px_10px] bg-surface-1 rounded-default text-[12px] mb-[6px] last:mb-0 border border-transparent',
        onClick && 'cursor-pointer hover:border-accent-border hover:bg-accent-bg',
        inPool && 'bg-success-bg border-success-border/60',
        snoozed && 'opacity-60',
        active && 'border-accent-border bg-accent-bg'
      )}
    >
      <Icon size={15} stroke={1.75} className={cn('shrink-0', inPool ? 'text-success' : 'text-accent-text')} />
      <span className="flex-1 text-text-primary">{candidate.label}</span>
      <span className="font-mono text-[11px] w-9 text-right" style={{ color: recommended ? '#3B6D11' : '#854F0B' }}>
        {candidate.ic5.toFixed(2)}
      </span>
      <span className="text-[11px] text-text-muted w-14 text-right">Decay {Math.round(candidate.decay * 100)}%</span>
      {inPool ? (
        <TagBadge kind="green">In pool ✓</TagBadge>
      ) : snoozed ? (
        <TagBadge kind="muted">Ignored · {candidate.ignored_days_left}d</TagBadge>
      ) : (
        <TagBadge kind={recommended ? 'green' : 'yellow'}>{recommended ? 'Recommended' : 'Watch'}</TagBadge>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEvaluate();
        }}
        className="px-[10px] py-[3px] text-[11px] border border-border-strong bg-surface-2 rounded-default cursor-pointer hover:bg-surface-1"
      >
        Evaluate ↗
      </button>
    </div>
  );
}
