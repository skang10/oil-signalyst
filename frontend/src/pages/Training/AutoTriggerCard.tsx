import { useState } from 'react';
import Card from '@/components/shared/Card';
import { cn } from '@/lib/utils';

const MODES = [
  { key: 'psi', label: 'Trigger on PSI threshold breach' },
  { key: 'sunday', label: 'Auto every Sunday' },
  { key: 'manual', label: 'Manual only' },
];

export default function AutoTriggerCard() {
  const [mode, setMode] = useState('psi');

  return (
    <Card>
      <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-3">Auto-Trigger Mode</div>
      <div className="flex flex-col gap-2">
        {MODES.map((m) => (
          <label
            key={m.key}
            className={cn(
              'flex items-center justify-between p-[8px_10px] rounded-default text-[12px] cursor-pointer border',
              mode === m.key ? 'border-[1.5px] border-accent-border bg-accent-bg' : 'border-border'
            )}
          >
            <span>{m.label}</span>
            <input
              type="radio"
              name="retrain-mode"
              checked={mode === m.key}
              onChange={() => setMode(m.key)}
              style={{ accentColor: 'var(--fill-accent)' }}
            />
          </label>
        ))}
      </div>
    </Card>
  );
}
