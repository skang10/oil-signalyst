import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconPlus, IconGitFork, IconChecklist, IconSettings2 } from '@tabler/icons-react';
import WorkbenchPage, { WorkbenchFooter } from '@/components/workbench/WorkbenchPage';
import NA from '@/components/workbench/NA';
import { useExperiments } from '@/hooks/useExperiments';
import { useReport } from '@/hooks/useReport';
import { useRole } from '@/context/RoleContext';
import { fmt, fmtSkill, skillOf, runLifecycle, fmtStarted, fmtDuration, type Lifecycle, type LifecyclePill } from '@/lib/workbench';
import { cn } from '@/lib/utils';
import type { TrainJobSummary } from '@/types/api';
import RunDetail from './RunDetail';
import LiveDetail from './LiveDetail';
import NewSandbox from './NewSandbox';
import Automation from './Automation';

type View = 'list' | { kind: 'live' } | { kind: 'run'; summary: TrainJobSummary } | 'new' | 'automation';

/** A Stockcast-style sandbox card row. Backend has no fork lineage / vintage /
 *  shadow, so those render as NA; name, status, trigger, and (for production)
 *  the live MAE are real. */
function SandboxRow({
  name,
  status,
  pill,
  life,
  forkLine,
  specs,
  mae,
  maeSub,
  maeColor,
  selectMode,
  selected,
  onToggle,
  onOpen,
}: {
  name: string;
  status: string;
  pill: LifecyclePill;
  life: Lifecycle;
  forkLine: React.ReactNode;
  specs: React.ReactNode[];
  mae: React.ReactNode;
  maeSub: React.ReactNode;
  maeColor?: string;
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const accent =
    life === 'production'
      ? { borderLeftColor: 'var(--fill-accent)', boxShadow: '0 0 0 3px var(--bg-accent)' }
      : life === 'shadow'
        ? { borderLeftColor: 'var(--border-warning)', boxShadow: '0 0 0 3px var(--bg-warning)' }
        : life === 'archived' || life === 'retired'
          ? { borderLeftColor: 'var(--border-strong)', background: 'var(--surface-1)' }
          : { borderLeftColor: 'var(--border-strong)' };
  return (
    <button
      type="button"
      onClick={selectMode ? onToggle : onOpen}
      className="w-full text-left bg-surface-2 border border-border rounded-[10px] p-[14px_17px] flex items-center gap-4 flex-wrap cursor-pointer hover:border-border-strong"
      style={{ borderLeftWidth: 4, ...accent }}
    >
      {selectMode && (
        <span
          className={cn(
            'w-[19px] h-[19px] rounded-[5px] border shrink-0 grid place-items-center text-[11px]',
            selected ? 'bg-accent-fill border-accent-fill text-on-accent' : 'bg-surface-2 border-border-strong'
          )}
        >
          {selected ? '✓' : ''}
        </span>
      )}
      <div className="flex-1 min-w-[230px]">
        <div className="font-mono text-[13px] font-semibold flex items-center gap-2 flex-wrap">
          {name}
          <span className={cn('font-mono text-[10px] uppercase rounded-[4px] px-[6px] py-[1px]', pillTone(pill.kind))}>
            {status}
          </span>
        </div>
        <div className="font-mono text-[11px] text-text-muted mt-[4px]">{forkLine}</div>
        <div className="flex gap-[14px] flex-wrap mt-[7px] font-mono text-[11px] text-text-muted">
          {specs.map((s, i) => (
            <span key={i}>{s}</span>
          ))}
        </div>
      </div>
      <div className="text-right min-w-[96px] ml-auto">
        <div className="font-mono text-[18px] font-semibold tracking-[-0.02em]" style={maeColor ? { color: maeColor } : undefined}>
          {mae}
        </div>
        <div className="font-mono text-[11px] text-text-muted">{maeSub}</div>
      </div>
      {!selectMode && <div className="font-mono text-[11px] text-accent-text">open →</div>}
    </button>
  );
}

function pillTone(kind: LifecyclePill['kind']): string {
  const map: Record<string, string> = {
    prod: 'bg-accent-bg text-accent-text',
    shadow: 'bg-warning-bg text-warning',
    ok: 'bg-success-bg text-success',
    run: 'bg-surface-1 text-text-secondary border border-border',
    ref: 'bg-pro-bg text-pro',
    arch: 'bg-surface-1 text-text-muted border border-border',
    bad: 'bg-danger-bg text-danger',
  };
  return map[kind] ?? map.run;
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted mt-5 mb-[9px] first:mt-0">
      {children}
    </div>
  );
}

export default function SandboxesPage() {
  const navigate = useNavigate();
  const { role } = useRole();
  const { live, runs, gate, isLoading } = useExperiments();
  const { data: report } = useReport(role);
  const [view, setView] = useState<View>('list');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ---- detail / new / automation views ----
  if (view === 'new') {
    return (
      <WorkbenchPage title="Training sandboxes">
        <NewSandbox live={live} onBack={() => setView('list')} />
        <WorkbenchFooter />
      </WorkbenchPage>
    );
  }
  if (view === 'automation') {
    return (
      <WorkbenchPage title="Training sandboxes">
        <Automation gate={gate} onBack={() => setView('list')} />
        <WorkbenchFooter />
      </WorkbenchPage>
    );
  }
  if (typeof view === 'object' && view.kind === 'live' && live) {
    return (
      <WorkbenchPage title="Training sandboxes">
        <LiveDetail live={live} gate={gate} onBack={() => setView('list')} onCompare={() => navigate('/compare')} />
        <WorkbenchFooter />
      </WorkbenchPage>
    );
  }
  if (typeof view === 'object' && view.kind === 'run') {
    return (
      <WorkbenchPage title="Training sandboxes">
        <RunDetail summary={view.summary} gate={gate} onBack={() => setView('list')} onCompare={() => navigate('/compare')} />
        <WorkbenchFooter />
      </WorkbenchPage>
    );
  }

  // ---- list ----
  // The run that produced the live model is represented by the production card,
  // so exclude live/partial from the other groups.
  const idle = runs.filter(
    (r) => (r.status === 'complete' && r.deploy_state === 'none') || r.status === 'running' || r.status === 'queued'
  );
  const archived = runs.filter(
    (r) => r.deploy_state === 'superseded' || r.status === 'failed' || r.status === 'cancelled'
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runRow(job: TrainJobSummary) {
    const { life, pill } = runLifecycle(job);
    return (
      <SandboxRow
        key={job.job_id}
        name={job.job_id}
        status={pill.label}
        pill={pill}
        life={life}
        forkLine={<>forked from <NA short /> · one change: <NA short /></>}
        specs={[
          <><NA short /> features</>,
          job.model_types.join(', '),
          job.triggered_by_name ?? job.trigger_source,
          fmtStarted(job.started_at),
          fmtDuration(job.duration_seconds),
        ]}
        mae={<NA short />}
        maeSub={<>open to score</>}
        selectMode={selectMode}
        selected={selected.has(job.job_id)}
        onToggle={() => toggle(job.job_id)}
        onOpen={() => setView({ kind: 'run', summary: job })}
      />
    );
  }

  return (
    <WorkbenchPage
      title="Training sandboxes"
      lead="A training sandbox pins its own data range, feature set and config. Nothing is shared — that is what makes two of them comparable."
    >
      {/* action row */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Btn onClick={() => setView('new')} icon={<IconPlus size={14} stroke={2} />}>New training sandbox</Btn>
        <Btn ghost onClick={() => setView('new')} icon={<IconGitFork size={14} stroke={1.75} />}>Fork production</Btn>
        <Btn
          hold
          onClick={() => {
            setSelectMode((m) => !m);
            setSelected(new Set());
          }}
          icon={<IconChecklist size={14} stroke={1.75} />}
        >
          {selectMode ? 'Cancel selection' : 'Select to compare'}
        </Btn>
        <div className="ml-auto">
          <Btn hold onClick={() => setView('automation')} icon={<IconSettings2 size={14} stroke={1.75} />}>Automation</Btn>
        </div>
      </div>

      {isLoading && <div className="text-[12px] text-text-muted">Loading sandboxes…</div>}

      {/* waiting on your decision — no shadow slot server-side */}
      <GroupLabel>waiting on your decision</GroupLabel>
      <div className="rounded-[10px] border border-dashed border-border p-[13px_16px] text-[12px] text-text-secondary">
        Nothing waiting. A shadow slot and the shadow→production decision aren’t tracked server-side — <NA />.
      </div>

      {/* running the forecast */}
      <GroupLabel>running the forecast · refits itself every week</GroupLabel>
      {live ? (
        <SandboxRow
          name={`eia · ${live.version}`}
          status="production"
          pill={{ label: 'production', kind: 'prod' }}
          life="production"
          forkLine={
            live.previous ? (
              <>displaced <span className="text-text-secondary">eia · {live.previous.version}</span></>
            ) : (
              <>first version deployed · lineage <NA short /></>
            )
          }
          specs={[
            <><NA short /> folds</>,
            <><NA short /> features</>,
            (live.metric_key ?? 'mae').toUpperCase(),
            live.deployed_at ? `live since ${live.deployed_at.slice(0, 10)}` : '',
          ]}
          mae={fmt(live.metrics.primary, 2)}
          maeSub={<>skill {fmtSkill(live.metrics.skill ?? skillOf(live.metrics.primary, live.metrics.baseline))}</>}
          selectMode={selectMode}
          selected={selected.has('live')}
          onToggle={() => toggle('live')}
          onOpen={() => setView({ kind: 'live' })}
        />
      ) : (
        <div className="text-[12px] text-text-muted">No production model deployed.</div>
      )}

      {/* idle */}
      <GroupLabel>idle</GroupLabel>
      {idle.length === 0 ? (
        <div className="text-[12px] text-text-muted">No idle runs.</div>
      ) : (
        <div className="flex flex-col gap-[10px]">{idle.map(runRow)}</div>
      )}

      {/* archived */}
      <GroupLabel>archived</GroupLabel>
      {archived.length === 0 ? (
        <div className="text-[12px] text-text-muted">No archived runs.</div>
      ) : (
        <div className="flex flex-col gap-[10px]">{archived.map(runRow)}</div>
      )}

      {/* references */}
      <p className="font-mono text-[11px] text-text-muted mt-5 leading-[1.6]">
        references — consensus{' '}
        {report?.eia.consensus_mb != null ? `${report.eia.consensus_mb.toFixed(1)} mb` : <NA short />} and Δ=0
        floor (train-mean) {fmt(live?.metrics.baseline, 2)} — sit outside the sandbox model and are pinned into
        every comparison.
      </p>

      {/* select bar */}
      {selectMode && (
        <div className="sticky bottom-3 mt-4 flex items-center justify-between gap-4 flex-wrap bg-surface-2 border border-border rounded-[11px] p-[12px_18px] shadow-sm">
          <span className="font-mono text-[13px] text-text-secondary">
            <b className="text-accent-text text-[15px]">{selected.size}</b> selected
          </span>
          <div className="flex gap-2">
            <Btn
              onClick={() => {
                navigate('/compare', { state: { selected: [...selected] } });
              }}
            >
              Compare selected
            </Btn>
            <Btn hold onClick={() => setSelected(new Set())}>Clear</Btn>
          </div>
        </div>
      )}

      <WorkbenchFooter />
    </WorkbenchPage>
  );
}

function Btn({
  children,
  onClick,
  ghost,
  hold,
  icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  ghost?: boolean;
  hold?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-[6px] font-medium text-[12px] rounded-[7px] px-[14px] py-[8px] cursor-pointer border',
        ghost
          ? 'bg-transparent text-accent-text border-accent-border'
          : hold
            ? 'bg-transparent text-text-secondary border-border'
            : 'bg-accent-fill text-on-accent border-accent-fill'
      )}
    >
      {icon}
      {children}
    </button>
  );
}
