import { cn } from '@/lib/utils';

const LAGS = [5, 10, 20] as const;
export type Lag = (typeof LAGS)[number];

export default function LagSwitcher({ lag, onChange }: { lag: Lag; onChange: (lag: Lag) => void }) {
  return (
    <div className="flex gap-1">
      {LAGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          className={cn(
            'px-[10px] py-[3px] text-[11px] rounded-[20px] border cursor-pointer',
            lag === l ? 'bg-accent-fill text-on-accent border-accent-fill' : 'bg-surface-2 text-text-muted border-border'
          )}
        >
          {l}d
        </button>
      ))}
    </div>
  );
}
