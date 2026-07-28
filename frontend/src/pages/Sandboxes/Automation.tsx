import { IconArrowLeft } from '@tabler/icons-react';
import NA from '@/components/workbench/NA';
import { useRole, type RetrainMode } from '@/context/RoleContext';
import type { ModelStatus } from '@/types/api';
import { cn } from '@/lib/utils';

const MODES: { key: RetrainMode; label: string }[] = [
  { key: 'auto', label: 'On ≥2 signals' },
  { key: 'sunday', label: 'Weekly (Sunday)' },
  { key: 'manual', label: 'Manual only' },
];

/**
 * Stockcast "Automation" reproduced. Two lanes: the automatic weekly refresh
 * (real — driven by users.retrain_mode + the scheduler) and the manual new-model
 * promotion. The non-inferiority gate the mockup shows (≤+0.15 MAE etc.) isn't a
 * server-side auto-refresh gate here — we show the real deployment_gate rules and
 * mark the numeric thresholds NA.
 */
export default function Automation({
  gate,
  onBack,
}: {
  gate: ModelStatus['deployment_gate'];
  onBack: () => void;
}) {
  const { userConfig, setUserConfig } = useRole();
  const mode = userConfig.retrain_mode;

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 font-mono text-[11px] text-text-secondary bg-none border-none cursor-pointer p-0 mb-[10px] hover:text-text-primary"
      >
        <IconArrowLeft size={12} /> training sandboxes
      </button>
      <div className="mb-4">
        <div className="text-[15px] font-medium">Automation</div>
        <div className="text-[12px] text-text-muted mt-[2px]">Two things can put a model live. Only one of them is automatic.</div>
      </div>

      {/* lanes */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px] rounded-[11px] p-[17px_19px] bg-success-bg border border-success-border">
          <div className="flex items-center justify-between mb-[11px]">
            <span className="font-mono text-[11px] uppercase tracking-[0.09em] text-success">automatic</span>
            <ModeToggle on={mode !== 'manual'} />
          </div>
          <div className="text-[17px] font-bold tracking-[-0.01em] mb-[7px]">Weekly refresh</div>
          <div className="text-[12.5px] text-text-secondary leading-[1.6]">
            Same model, refit on the new week of data — nothing is being chosen, so it can ship on its own.
            Currently <b className="font-mono">{MODES.find((m) => m.key === mode)?.label}</b>.
          </div>
        </div>
        <div className="flex-1 min-w-[240px] rounded-[11px] p-[17px_19px] bg-pro-bg border border-border">
          <div className="flex items-center justify-between mb-[11px]">
            <span className="font-mono text-[11px] uppercase tracking-[0.09em] text-pro">needs you</span>
            <span className="text-[15px]">🔒</span>
          </div>
          <div className="text-[17px] font-bold tracking-[-0.01em] mb-[7px]">New model</div>
          <div className="text-[12.5px] text-text-secondary leading-[1.6]">
            Any change to features, model or window. You promote it from its sandbox page. Automation never
            promotes a new config. (Shadow weeks before promotion: <NA short />.)
          </div>
        </div>
      </div>

      {/* auto-retrain mode picker (real) */}
      <div className="bg-surface-2 border border-border rounded-[10px] p-[16px_18px] mt-[14px]">
        <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[11px]">Auto-retrain trigger</h3>
        <div className="flex gap-2 flex-wrap">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setUserConfig({ ...userConfig, retrain_mode: m.key })}
              className={cn(
                'text-[12px] px-[13px] py-[7px] rounded-[16px] border cursor-pointer',
                mode === m.key ? 'bg-accent-bg border-accent-border text-accent-text font-medium' : 'bg-surface-2 border-border text-text-secondary'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-muted mt-3 leading-[1.5]">
          Checked after each daily pipeline run. Auto retrains only when ≥2 of {'{'}rolling directional
          accuracy below 50%, Page-Hinkley loss alarm, joint feature drift{'}'} fire together. Persisted to your
          profile and honoured by the scheduler.
        </p>
      </div>

      {/* gate (real rules, NA thresholds) */}
      <div className="bg-surface-2 border border-border rounded-[10px] p-[16px_18px] mt-[14px]">
        <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[11px]">
          A refresh ships only if it clears the gate
        </h3>
        <div className="flex gap-[10px] flex-wrap">
          {gate.length === 0 ? (
            <NA />
          ) : (
            gate.map((g) => (
              <div key={g.label} className="flex-1 min-w-[150px] bg-surface-1 border border-border rounded-[9px] p-[12px_13px]">
                <div className="font-mono text-[13px] font-semibold">{g.rule}</div>
                <div className="text-[12px] text-text-secondary mt-1">{g.label}</div>
              </div>
            ))
          )}
        </div>
        <p className="text-[11px] text-text-muted mt-3">
          Non-inferiority thresholds the mockup shows (≤+0.15 MAE, coverage band): <NA /> — not a server-side
          auto-refresh gate here.
        </p>
      </div>

      {/* pauses */}
      <div className="bg-surface-2 border border-border rounded-[10px] p-[16px_18px] mt-[14px]">
        <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[11px]">It pauses and calls you when</h3>
        <div className="flex gap-[9px] flex-wrap">
          {['directional accuracy drops below 50%', 'Page-Hinkley loss alarm fires', 'joint feature drift is detected'].map((p) => (
            <span key={p} className="flex items-center gap-2 text-[12px] text-text-secondary bg-surface-1 border border-border rounded-[8px] px-[12px] py-[8px]">
              <i className="w-2 h-2 rounded-full bg-warning shrink-0" />
              {p}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-text-muted mt-3">Automation only ever brakes — it keeps the current model fresh, and stops when something looks off.</p>
      </div>
    </>
  );
}

function ModeToggle({ on }: { on: boolean }) {
  return (
    <span className={cn('w-[34px] h-[19px] rounded-[10px] relative', on ? 'bg-success' : 'bg-border-strong')}>
      <i className={cn('absolute top-[2px] w-[15px] h-[15px] rounded-full bg-surface-2 transition-all', on ? 'left-[17px]' : 'left-[2px]')} />
    </span>
  );
}
