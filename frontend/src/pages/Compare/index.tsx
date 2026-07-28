import { useState } from 'react';
import WorkbenchPage, { WorkbenchFooter } from '@/components/workbench/WorkbenchPage';
import Card from '@/components/shared/Card';
import { useExperiments } from '@/hooks/useExperiments';
import { useTrainJobDetail } from '@/hooks/useTraining';
import { fmt, fmtSkill, skillOf, type EiaModel } from '@/lib/workbench';
import type { ModelStatus, TrainJobSummary } from '@/types/api';
import { cn } from '@/lib/utils';

type WindowKey = 'full' | 'recent' | 'live';

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: 'full', label: 'Full test window' },
  { key: 'recent', label: 'Recent 6mo' },
  { key: 'live', label: 'Live prints' },
];

const WINDOW_CAPTION: Record<WindowKey, string> = {
  full: 'Each version scored on its own frozen out-of-sample window. Skill divides out how hard that window was, so it — not raw MAE — is the comparable column.',
  recent: 'Trailing ~6 months, ~26 independent prints. Only the live model carries this window; other versions show “—”.',
  live: 'Rolling out-of-sample since deploy, scored against realized EIA prints. Empty until the pipeline has scored enough live weeks.',
};

interface Row {
  key: string;
  name: string;
  version: string;
  state: string;
  stateKind: 'prod' | 'arch' | 'run';
  value: number | null;
  baseline: number | null;
  skill: number | null;
}

/** Windowed metric for the live pointer from ModelStatus (real for full+recent;
 *  live comes from live_performance). */
function liveRow(live: EiaModel, status: ModelStatus, w: WindowKey): Row {
  const base: Omit<Row, 'value' | 'baseline' | 'skill'> = {
    key: 'live',
    name: 'eia (live)',
    version: live.version,
    state: 'production',
    stateKind: 'prod',
  };
  if (w === 'full') return { ...base, value: live.metrics.primary, baseline: live.metrics.baseline, skill: live.metrics.skill };
  if (w === 'recent') {
    const r = live.metrics.recent;
    return { ...base, value: r?.primary ?? null, baseline: r?.baseline ?? null, skill: skillOf(r?.primary ?? null, r?.baseline ?? null) };
  }
  const lp = status.live_performance;
  return { ...base, value: lp?.rolling_mae ?? null, baseline: null, skill: null };
}

function previousRow(live: EiaModel, w: WindowKey): Row | null {
  const p = live.previous;
  if (!p) return null;
  const base: Omit<Row, 'value' | 'baseline' | 'skill'> = {
    key: 'previous',
    name: 'eia (previous)',
    version: p.version,
    state: 'superseded',
    stateKind: 'arch',
  };
  // Only the full-window figures are stored for the displaced version.
  if (w === 'full') return { ...base, value: p.primary, baseline: p.baseline, skill: p.skill };
  return { ...base, value: null, baseline: null, skill: null };
}

function Pill({ kind, children }: { kind: 'prod' | 'arch' | 'run' | 'ref'; children: React.ReactNode }) {
  const cls = {
    prod: 'bg-accent-bg text-accent-text',
    arch: 'bg-surface-1 text-text-muted border border-border',
    run: 'bg-surface-1 text-text-secondary border border-border',
    ref: 'bg-pro-bg text-pro',
  }[kind];
  return <span className={cn('font-mono text-[10px] uppercase rounded-[4px] px-[6px] py-[1px]', cls)}>{children}</span>;
}

/** A picked run row — fetches its own detail so its full-window MAE is real. */
function RunCompareRow({ job, live, w }: { job: TrainJobSummary; live: number | null; w: WindowKey }) {
  const { data: detail } = useTrainJobDetail(job.job_id);
  const mae = detail?.result?.new_metrics?.eia_mae ?? detail?.result?.models?.eia?.mean ?? null;
  const baseline = detail?.result?.baselines?.eia_mae ?? null;
  const value = w === 'full' ? mae : null;
  const skill = w === 'full' ? skillOf(mae, baseline) : null;
  const vs = value != null && live != null ? value - live : null;
  return (
    <div className="grid grid-cols-[1fr_90px_90px_90px_90px] items-center text-[12px] py-[8px] border-t border-border">
      <div className="font-mono text-[11px]">
        {job.job_id} <span className="text-text-muted">· {detail?.result?.versions?.eia ?? 'run'}</span>
      </div>
      <div className="text-right font-mono">{fmt(value, 2)}</div>
      <div className="text-right font-mono">{fmtSkill(skill)}</div>
      <div className={cn('text-right font-mono', vs != null && (vs < 0 ? 'text-success' : 'text-danger'))}>
        {vs == null ? '—' : `${vs < 0 ? '' : '+'}${vs.toFixed(2)}`}
      </div>
      <div className="text-right"><Pill kind="run">{job.deploy_state}</Pill></div>
    </div>
  );
}

export default function ComparePage() {
  const { live, runs, status } = useExperiments();
  const [w, setWindow] = useState<WindowKey>('full');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const completedRuns = runs.filter(
    (r) => r.status === 'complete' && r.summary != null && !picked.has(r.job_id)
  );

  const baseRows: Row[] = [];
  if (live && status) {
    baseRows.push(liveRow(live, status, w));
    const prev = previousRow(live, w);
    if (prev) baseRows.push(prev);
  }
  const liveVal = baseRows.find((r) => r.key === 'live')?.value ?? null;

  return (
    <WorkbenchPage
      title="Compare"
      lead={
        <>
          Only experiments under the <b className="text-text-primary font-semibold">same model</b> can duel —
          different targets carry different metrics. Here that model is <b className="text-text-primary font-semibold">EIA</b>{' '}
          (MAE, lower is better). Return Distribution is retired and regime has no score, so both appear only
          as reference.
        </>
      }
    >
      {/* Window selector */}
      <div className="flex items-center gap-[7px] flex-wrap mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted mr-1">score on</span>
        {WINDOWS.map((win) => (
          <button
            key={win.key}
            type="button"
            onClick={() => setWindow(win.key)}
            className={cn(
              'font-mono text-[11px] border rounded-[7px] px-[11px] py-[6px] cursor-pointer',
              w === win.key ? 'bg-text-primary text-surface-2 border-text-primary' : 'bg-surface-2 border-border text-text-secondary'
            )}
          >
            {win.label}
          </button>
        ))}
      </div>

      <div className="text-[11px] text-warning bg-warning-bg border border-warning-border rounded-default px-[11px] py-[8px] mb-3 leading-[1.5]">
        {WINDOW_CAPTION[w]} True re-scoring of every experiment on one identical fold set isn’t exposed
        server-side yet (TODO(api)) — each version below is on its own window, which is why skill is the
        column to read across.
      </div>

      {!live && <Card>No live EIA model to compare.</Card>}

      {live && (
        <Card className="!p-0 overflow-hidden">
          <div className="grid grid-cols-[1fr_90px_90px_90px_90px] items-center text-[10px] font-mono uppercase tracking-[0.4px] text-text-muted bg-surface-1 px-[16px] py-[8px]">
            <div>Experiment</div>
            <div className="text-right">MAE</div>
            <div className="text-right">Skill</div>
            <div className="text-right">vs live</div>
            <div className="text-right">State</div>
          </div>

          <div className="px-[16px]">
            {baseRows.map((r) => {
              const vs = r.value != null && liveVal != null && r.key !== 'live' ? r.value - liveVal : null;
              return (
                <div key={r.key} className="grid grid-cols-[1fr_90px_90px_90px_90px] items-center text-[12px] py-[8px] border-t border-border first:border-t-0">
                  <div>
                    <span className="font-medium">{r.name}</span>{' '}
                    <span className="font-mono text-[10.5px] text-text-muted">{r.version}</span>
                  </div>
                  <div className="text-right font-mono">{fmt(r.value, 2)}</div>
                  <div className="text-right font-mono">{fmtSkill(r.skill)}</div>
                  <div className={cn('text-right font-mono', vs != null && (vs < 0 ? 'text-success' : 'text-danger'))}>
                    {r.key === 'live' ? '—' : vs == null ? '—' : `${vs < 0 ? '' : '+'}${vs.toFixed(2)}`}
                  </div>
                  <div className="text-right"><Pill kind={r.stateKind}>{r.state}</Pill></div>
                </div>
              );
            })}

            {[...picked].map((id) => {
              const job = runs.find((r) => r.job_id === id);
              return job ? <RunCompareRow key={id} job={job} live={liveVal} w={w} /> : null;
            })}

            {/* Regime pinned reference */}
            <div className="grid grid-cols-[1fr_90px_90px_90px_90px] items-center text-[12px] py-[8px] border-t border-border text-text-muted">
              <div>regime <span className="font-mono text-[10.5px]">frozen reference</span></div>
              <div className="text-right font-mono">—</div>
              <div className="text-right font-mono">—</div>
              <div className="text-right font-mono">—</div>
              <div className="text-right"><Pill kind="ref">ref</Pill></div>
            </div>
          </div>
          <div className="text-[11px] text-text-muted px-[16px] py-[10px] border-t border-border font-mono">
            negative “vs live” = lower MAE than the live pointer on this window.
          </div>
        </Card>
      )}

      {/* Add experiments */}
      {completedRuns.length > 0 && (
        <div className="mt-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted mb-2">
            add an EIA run to the duel
          </div>
          <div className="flex gap-2 flex-wrap">
            {completedRuns.slice(0, 8).map((r) => (
              <button
                key={r.job_id}
                type="button"
                onClick={() => setPicked((p) => new Set(p).add(r.job_id))}
                className="font-mono text-[11px] border border-border rounded-[7px] px-[10px] py-[6px] cursor-pointer bg-surface-2 text-text-secondary hover:border-border-strong"
              >
                + {r.job_id}
              </button>
            ))}
          </div>
          {picked.size > 0 && (
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="mt-2 font-mono text-[11px] text-accent-text underline underline-offset-2 cursor-pointer bg-none border-none p-0"
            >
              clear {picked.size} added
            </button>
          )}
        </div>
      )}

      <WorkbenchFooter />
    </WorkbenchPage>
  );
}
