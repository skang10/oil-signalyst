import { useState } from 'react';
import Card from '@/components/shared/Card';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import type { TrainParams } from '@/types/api';

const MODEL_OPTIONS: { type: string; label: string }[] = [
  { type: 'regime', label: 'Regime' },
  { type: 'eia', label: 'EIA Forecast' },
  { type: 'returns', label: 'Return Dist.' },
];

export default function TrainConfigCard({
  onSubmit,
  isPending,
}: {
  onSubmit: (params: TrainParams) => void;
  isPending: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(['returns']));
  const [cutoffDate, setCutoffDate] = useState('2026-06-30');
  const [folds, setFolds] = useState(5);
  const [gapDays, setGapDays] = useState(20);

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

      <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
        <span className="text-text-secondary">TimeSeriesSplit Folds</span>
        <div className="flex items-center gap-2 w-[120px]">
          <Slider value={[folds]} onValueChange={(v) => setFolds(Array.isArray(v) ? v[0] : v)} min={3} max={10} step={1} className="w-20" />
          <span className="font-medium font-mono text-[12px]">{folds}</span>
        </div>
      </div>

      <div className="flex justify-between items-center py-[7px] text-[12px]">
        <span className="text-text-secondary">Validation Gap (leakage prevention)</span>
        <div className="flex items-center gap-2 w-[150px]">
          <Slider value={[gapDays]} onValueChange={(v) => setGapDays(Array.isArray(v) ? v[0] : v)} min={5} max={60} step={5} className="w-20" />
          <span className="font-medium font-mono text-[12px]">{gapDays}</span>
          <span className="text-[11px] text-text-muted">days</span>
        </div>
      </div>

      <button
        type="button"
        disabled={isPending || selected.size === 0}
        onClick={() => onSubmit({ model_types: Array.from(selected), cutoff_date: cutoffDate, cv_folds: folds, gap_days: gapDays })}
        className="mt-3 px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-surface-2 border border-border-strong hover:bg-surface-1 disabled:opacity-50"
      >
        {isPending ? 'Starting...' : 'Start Training'}
      </button>
    </Card>
  );
}
