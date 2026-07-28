import type { ReactNode } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import { fmt, type Lifecycle } from '@/lib/workbench';
import { cn } from '@/lib/utils';
import type { CrossValidateModel, ModelStatus } from '@/types/api';

/** Dark experiment header — title, lineage, the one primary decision, and quiet
 *  secondary actions. Matches the mockup's .xphead. */
export function DetailHeader({
  life,
  title,
  lineage,
  decision,
  secondary,
  onBack,
}: {
  life: Lifecycle;
  title: ReactNode;
  lineage: ReactNode;
  decision?: ReactNode;
  secondary?: ReactNode;
  onBack: () => void;
}) {
  const accentColor =
    life === 'production'
      ? '#6C8CEA'
      : life === 'shadow'
        ? '#E0A83E'
        : life === 'reference'
          ? '#9B7BD0'
          : '#7A8398';
  return (
    <div
      className="rounded-[12px] p-[19px_22px] mb-4 text-[#EDEFF4]"
      style={{ background: 'linear-gradient(90deg,#1E2740,#161D2E 55%)', borderLeft: `5px solid ${accentColor}` }}
    >
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 font-mono text-[11px] text-[#8792AB] bg-none border-none cursor-pointer p-0 mb-[10px] hover:text-[#EDEFF4]"
      >
        <IconArrowLeft size={12} /> sandboxes
      </button>
      <h2 className="font-mono text-[16px] font-semibold flex items-center gap-[9px] flex-wrap">{title}</h2>
      <div className="font-mono text-[11px] text-[#8792AB] mt-[7px] leading-[1.6]">{lineage}</div>
      {decision}
      {secondary && <div className="flex gap-2 flex-wrap mt-3">{secondary}</div>}
    </div>
  );
}

export function SecondaryAction({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="font-mono text-[11px] text-[#C6CCDA] bg-[#232C43] border border-[#333E5C] rounded-[6px] px-3 py-[6px] cursor-pointer hover:border-[#5C6784] hover:text-[#EDEFF4] disabled:opacity-45 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-[7px] border-b border-border last:border-b-0 text-[12.5px]">
      <span className="text-text-secondary">{k}</span>
      <span className="font-mono text-[12px] text-right">{v}</span>
    </div>
  );
}

export function CardBox({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-surface-2 border border-border rounded-[12px] p-[16px_18px]">
      <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[11px]">
        {title}
        {note && <span className="text-text-muted normal-case tracking-normal"> · {note}</span>}
      </h3>
      {children}
    </div>
  );
}

/** Read-only deployment-gate criteria + the run/version's overall verdict.
 *  Per-rule pass/fail isn't stored server-side, so each rule shows the criterion
 *  and the overall verdict drives the colour; blocked reasons are listed when a
 *  run failed the gate. */
export function GateChips({
  gate,
  verdict,
  blockedReasons,
}: {
  gate: ModelStatus['deployment_gate'];
  verdict: boolean | null;
  blockedReasons?: string[];
}) {
  if (gate.length === 0) return null;
  const pass = verdict === true;
  const known = verdict !== null;
  return (
    <CardBox title="Deployment gate" note="every rule must pass to auto-deploy">
      <div className="flex gap-[9px] flex-wrap">
        {gate.map((g) => (
          <span
            key={g.label}
            className={cn(
              'font-mono text-[11px] border rounded-[6px] px-[9px] py-[5px] flex items-center gap-[6px]',
              !known
                ? 'bg-surface-1 border-border text-text-secondary'
                : pass
                  ? 'bg-success-bg border-success-border text-success'
                  : 'bg-warning-bg border-warning-border text-warning'
            )}
            title={g.rule}
          >
            {known ? (pass ? '✓' : '•') : '•'} {g.label}
          </span>
        ))}
      </div>
      {verdict === false && blockedReasons && blockedReasons.length > 0 && (
        <div className="text-[11px] text-warning mt-[10px] font-mono">
          blocked — {blockedReasons.join(' · ')}
        </div>
      )}
      {verdict === true && (
        <div className="text-[11px] text-success mt-[10px] font-mono">cleared the gate</div>
      )}
    </CardBox>
  );
}

/** Walk-forward cross-validation folds — the "N/M folds beat baseline" evidence,
 *  a frozen snapshot. Real per-fold beat/baseline from the CV job result. */
export function CvFoldsTable({ m, type }: { m: CrossValidateModel; type: string }) {
  const digits = m.metric === 'mae' ? 2 : 3;
  return (
    <CardBox
      title="Walk-forward results"
      note={`${type} · ${m.n_beat_baseline}/${m.n_folds} folds beat baseline · frozen snapshot`}
    >
      <div className="grid grid-cols-[60px_1fr_1fr_60px] text-[10px] text-text-muted uppercase tracking-[0.4px] pb-[4px]">
        <div>Fold</div>
        <div className="text-right">{m.metric}</div>
        <div className="text-right">Baseline</div>
        <div className="text-right">Beat</div>
      </div>
      {m.folds.map((f) => {
        const value = f[m.metric] as number | null;
        return (
          <div
            key={f.fold}
            className="grid grid-cols-[60px_1fr_1fr_60px] text-[11px] py-[3px] border-t border-border font-mono tabular-nums"
          >
            <div className="text-text-secondary">{f.fold}</div>
            <div className={cn('text-right', f.beat ? 'text-success' : 'text-text-primary')}>{fmt(value, digits)}</div>
            <div className="text-right text-text-muted">{fmt(f.baseline, digits)}</div>
            <div className={cn('text-right', f.beat ? 'text-success' : 'text-danger')}>
              {f.beat == null ? '—' : f.beat ? '✓' : '✗'}
            </div>
          </div>
        );
      })}
    </CardBox>
  );
}
