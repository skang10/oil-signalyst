import { cardAccent, pillClass, type Lifecycle, type LifecyclePill } from '@/lib/workbench';
import { cn } from '@/lib/utils';

export interface ExperimentCardVM {
  key: string;
  life: Lifecycle;
  /** mono title, e.g. "eia · v1.4 · production" or a job id */
  name: string;
  /** subtitle — the fork/change line or the run's trigger line */
  meta: string;
  /** small mono chips */
  specs: string[];
  headlineValue: string;
  headlineSub: string;
  pill: LifecyclePill;
  onClick?: () => void;
  dim?: boolean;
}

/**
 * One experiment/run card. Colour + ring encode lifecycle (production=accent,
 * shadow=warning, reference=pro, archived/retired=muted), matching the mockup's
 * left-accent cards but in the repo's design tokens.
 */
export default function ExperimentCard({ vm }: { vm: ExperimentCardVM }) {
  const accent = cardAccent(vm.life);
  const clickable = Boolean(vm.onClick);
  return (
    <button
      type="button"
      onClick={vm.onClick}
      disabled={!clickable}
      className={cn(
        'w-full text-left bg-surface-2 border border-border rounded-[11px] p-[14px_17px] mb-[9px] flex items-center gap-4 flex-wrap',
        accent.className,
        clickable ? 'cursor-pointer hover:border-border-strong hover:shadow-sm' : 'cursor-default',
        vm.dim && 'opacity-90'
      )}
      style={accent.style}
    >
      <div className="flex-1 min-w-[230px]">
        <div className={cn('font-mono text-[13px] font-semibold', vm.dim && 'text-text-secondary')}>
          {vm.name}
        </div>
        <div className={cn('text-[12px] mt-[2px]', vm.dim ? 'text-text-muted' : 'text-text-secondary')}>
          {vm.meta}
        </div>
        {vm.specs.length > 0 && (
          <div className="flex gap-[7px] flex-wrap mt-[7px]">
            {vm.specs.map((s, i) => (
              <span
                key={i}
                className="font-mono text-[10.5px] text-text-secondary bg-surface-1 border border-border rounded-[4px] px-[7px] py-[2px]"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="text-right min-w-[110px] ml-auto">
        <div className="font-mono text-[20px] font-semibold tracking-[-0.02em]">{vm.headlineValue}</div>
        <div className="font-mono text-[10.5px] text-text-muted">{vm.headlineSub}</div>
        <div className="mt-[6px]">
          <span
            className={cn(
              'inline-block font-mono text-[10.5px] uppercase tracking-[0.04em] rounded-[5px] px-[7px] py-[2px] font-medium',
              pillClass(vm.pill.kind)
            )}
          >
            {vm.pill.label}
          </span>
        </div>
      </div>
    </button>
  );
}
