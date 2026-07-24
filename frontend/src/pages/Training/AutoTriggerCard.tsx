import Card from '@/components/shared/Card';
import { useRole, type RetrainMode } from '@/context/RoleContext';
import { cn } from '@/lib/utils';

const MODES: { key: RetrainMode; label: string }[] = [
  { key: 'auto', label: 'Auto — retrain when ≥2 degradation signals fire' },
  { key: 'psi', label: 'Trigger on PSI threshold breach' },
  { key: 'sunday', label: 'Auto every Sunday' },
  { key: 'manual', label: 'Manual only' },
];

/**
 * Persisted for real (users.retrain_mode via PUT /api/users/me/config) and
 * honored by the scheduler's daily pipeline (scheduler/jobs.py::
 * _maybe_auto_retrain) - previously this card was pure local state that
 * configured nothing.
 */
export default function AutoTriggerCard() {
  const { userConfig, setUserConfig } = useRole();
  const mode = userConfig.retrain_mode;

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
              onChange={() => setUserConfig({ ...userConfig, retrain_mode: m.key })}
              style={{ accentColor: 'var(--fill-accent)' }}
            />
          </label>
        ))}
      </div>
      <div className="mt-2 text-[11px] text-text-muted">
        Checked after each daily pipeline run · PSI mode uses your alert threshold ({userConfig.alert_psi_threshold}) ·
        Auto retrains only when at least two of {'{'}PSI drift, rolling directional accuracy below 50%, Page-Hinkley loss alarm{'}'} fire together
      </div>
    </Card>
  );
}
