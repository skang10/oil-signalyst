import { useState } from 'react';
import Card from '@/components/shared/Card';
import { Checkbox } from '@/components/ui/checkbox';
import type { TrainParams } from '@/types/api';

const MODEL_OPTIONS: { type: string; label: string }[] = [
  { type: 'regime', label: 'Regime' },
  { type: 'eia', label: 'EIA Forecast' },
  { type: 'returns', label: 'Return Dist.' },
];

// Today minus 90 days: the most recent default that reliably trains.
// Cutoff is the train/val split, and forward-looking labels need future
// data past it (returns: ~20 trading days of prices; eia: the next weekly
// report), so anything much closer to today trips the trainer's
// "no validation rows" guard. 90 days leaves a ~2-month validation window.
// Local date parts, not toISOString() - UTC conversion can shift the day.
function defaultCutoffDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function TrainConfigCard({
  onSubmit,
  isPending,
}: {
  onSubmit: (params: TrainParams) => void;
  isPending: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(['returns']));
  const [cutoffDate, setCutoffDate] = useState(defaultCutoffDate);

  function toggle(type: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(type);
      else next.delete(type);
      return next;
    });
  }

  return (
    <Card>
      <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-3">Training Configuration</div>

      <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
        <span className="text-text-secondary">Retrain Models</span>
        <div className="flex flex-col gap-[5px] items-end">
          {MODEL_OPTIONS.map((m) => (
            <label key={m.type} className="flex items-center gap-[6px] text-[12px] cursor-pointer">
              {m.label}
              <Checkbox checked={selected.has(m.type)} onCheckedChange={(c) => toggle(m.type, c === true)} />
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
        <span className="text-text-secondary">Training Cutoff Date</span>
        <input
          type="date"
          value={cutoffDate}
          onChange={(e) => setCutoffDate(e.target.value)}
          className="bg-surface-1 border border-border-strong rounded-default p-[5px_10px] text-[12px] w-[140px]"
        />
      </div>

      {/* The old TimeSeriesSplit-folds / validation-gap sliders were removed:
          the backend trains a single train/val split and silently ignored
          both knobs (api/routes/training.py::TrainStartRequest), so the
          controls only pretended to configure anything. */}
      <button
        type="button"
        disabled={isPending || selected.size === 0}
        onClick={() =>
          onSubmit({
            model_types: Array.from(selected),
            cutoff_date: cutoffDate || undefined,
          })
        }
        className="mt-3 px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-surface-2 border border-border-strong hover:bg-surface-1 disabled:opacity-50"
      >
        {isPending ? 'Starting...' : 'Start Training'}
      </button>
    </Card>
  );
}
