import { useState } from 'react';
import Card from '@/components/shared/Card';
import { Checkbox } from '@/components/ui/checkbox';
import type { TrainParams } from '@/types/api';

// 'regime' is deliberately absent - it describes the current market state
// rather than forecasting an observable outcome, so there is nothing to train
// it against and the backend rejects it (api/routes/training.py). It now
// serves from a frozen artifact. These two forecast against real outcomes:
// the inventory change EIA later publishes, and the realized 20-day return.
const MODEL_OPTIONS: { type: string; label: string }[] = [
  { type: 'eia', label: 'EIA Forecast' },
  { type: 'returns', label: 'Return Dist.' },
];

export default function TrainConfigCard({
  onSubmit,
  onCrossValidate,
  isPending,
}: {
  onSubmit: (params: TrainParams) => void;
  onCrossValidate: (params: TrainParams) => void;
  isPending: boolean;
}) {
  // Both trainable models selected by default - the two are independent now
  // that returns no longer conditions on regime, so the common case is
  // retraining the whole forecast set together.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(MODEL_OPTIONS.map((o) => o.type))
  );

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

      {/* No cutoff-date / fold controls: training uses a fixed train (2012-2024)
          / test (2025->today) split now, and the old cutoff knob is gone - it
          produced degenerate windows and is replaced by Cross-Validate. */}
      <div className="text-[11px] text-text-muted py-[7px] border-b border-border leading-[1.5]">
        Fixed split: train 2012–2024, test 2025→today (held out).
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          disabled={isPending || selected.size === 0}
          onClick={() => onSubmit({ model_types: Array.from(selected) })}
          className="px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-surface-2 border border-border-strong hover:bg-surface-1 disabled:opacity-50"
        >
          {isPending ? 'Starting...' : 'Start Training'}
        </button>
        <button
          type="button"
          disabled={isPending || selected.size === 0}
          onClick={() => onCrossValidate({ model_types: Array.from(selected) })}
          title="Walk-forward cross-validation (~several minutes, deploys nothing)"
          className="px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-none border border-border hover:bg-surface-1 disabled:opacity-50"
        >
          Cross-Validate
        </button>
      </div>
    </Card>
  );
}
