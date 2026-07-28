import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import WorkbenchPage, { SectionLabel, WorkbenchFooter } from '@/components/workbench/WorkbenchPage';
import { useExperiments } from '@/hooks/useExperiments';
import {
  fmt,
  fmtSkill,
  skillOf,
  runLifecycle,
  runChange,
  fmtStarted,
  fmtDuration,
  RETIRED_RETURNS_NOTE,
  SHADOW_SLOT_NOTE,
} from '@/lib/workbench';
import type { TrainJobSummary } from '@/types/api';
import ExperimentCard, { type ExperimentCardVM } from './ExperimentCard';
import RunDetail from './RunDetail';
import LiveDetail from './LiveDetail';

type Selection = { kind: 'live' } | { kind: 'run'; summary: TrainJobSummary } | null;

export default function SandboxesPage() {
  const navigate = useNavigate();
  const { live, runs, gate, isLoading } = useExperiments();
  const [sel, setSel] = useState<Selection>(null);

  if (sel?.kind === 'live' && live) {
    return (
      <WorkbenchPage title="Training sandboxes">
        <LiveDetail live={live} gate={gate} onBack={() => setSel(null)} onCompare={() => navigate('/compare')} />
        <WorkbenchFooter />
      </WorkbenchPage>
    );
  }
  if (sel?.kind === 'run') {
    return (
      <WorkbenchPage title="Training sandboxes">
        <RunDetail summary={sel.summary} gate={gate} onBack={() => setSel(null)} onCompare={() => navigate('/compare')} />
        <WorkbenchFooter />
      </WorkbenchPage>
    );
  }

  // Live pointer card
  const liveVm: ExperimentCardVM | null = live
    ? {
        key: 'live',
        life: 'production',
        name: `eia · ${live.version} · production`,
        meta: live.deployed_at ? `active model · deployed ${live.deployed_at.slice(0, 10)}` : 'active model',
        specs: [
          `skill ${fmtSkill(skillOf(live.metrics.primary, live.metrics.baseline))}`,
          `PSI ${fmt(live.metrics.psi, 2)}`,
          live.gate_passed == null ? 'gate —' : live.gate_passed ? 'gate ✓' : 'gate override',
        ],
        headlineValue: fmt(live.metrics.primary, 2),
        headlineSub: `MAE mb · base ${fmt(live.metrics.baseline, 2)}`,
        pill: { label: 'production', kind: 'prod' },
        onClick: () => setSel({ kind: 'live' }),
      }
    : null;

  return (
    <WorkbenchPage
      title="Training sandboxes"
      lead={
        <>
          Every experiment is a real training or cross-validate run. Colour marks lifecycle —{' '}
          <span className="text-accent-text">production</span>, neutral for idle/archived,{' '}
          <span className="text-danger">gate-blocked</span>. There is one live model tree (EIA);
          regime is a frozen reference and Return Distribution is retired.
        </>
      }
    >
      <SectionLabel note="metric · MAE (mb), lower is better · baseline train-mean">EIA Forecast</SectionLabel>

      {liveVm && <ExperimentCard vm={liveVm} />}

      {/* Shadow slot — no backend, shown as labelled scaffolding */}
      <div
        className="w-full rounded-[11px] p-[13px_17px] mb-[9px] border border-dashed border-border text-text-muted"
        style={{ borderLeft: '4px solid var(--border-warning)', background: 'var(--bg-warning)' }}
      >
        <div className="font-mono text-[12px] font-semibold text-warning">shadow slot · empty</div>
        <div className="text-[12px] mt-[2px] text-text-secondary">{SHADOW_SLOT_NOTE}</div>
      </div>

      <SectionLabel note={`${runs.length} most recent`}>Runs</SectionLabel>
      {isLoading && <div className="text-[12px] text-text-muted">Loading runs…</div>}
      {!isLoading && runs.length === 0 && (
        <div className="text-[12px] text-text-muted">
          No EIA training runs yet. Start one from the legacy Training Control page, or the scheduler’s
          auto-retrain will create them.
        </div>
      )}
      {runs.map((job) => {
        const { life, pill } = runLifecycle(job);
        const vm: ExperimentCardVM = {
          key: job.job_id,
          life,
          name: job.job_id,
          meta: `${runChange(job)} · ${fmtStarted(job.started_at)}`,
          specs: [
            job.model_types.join(', '),
            fmtDuration(job.duration_seconds),
            job.triggered_by_name ?? job.trigger_source,
          ],
          headlineValue: job.summary ? `${job.summary.improved}/${job.summary.of}` : '—',
          headlineSub: job.summary ? 'metrics improved' : job.status,
          pill,
          dim: life === 'archived' || life === 'failed',
          onClick: () => setSel({ kind: 'run', summary: job }),
        };
        return <ExperimentCard key={job.job_id} vm={vm} />;
      })}

      {/* Frozen reference + retired */}
      <SectionLabel>frozen reference &amp; retired</SectionLabel>
      <div
        className="w-full rounded-[11px] p-[13px_17px] mb-[9px]"
        style={{ borderLeft: '4px solid var(--text-pro)', background: 'var(--bg-pro)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="font-mono text-[13px] font-semibold">regime · frozen artifact</div>
            <div className="text-[12px] text-text-secondary mt-[2px]">
              not trained · no observable outcome to score · shown in Compare as a pinned reference
            </div>
          </div>
          <span className="font-mono text-[10.5px] uppercase rounded-[5px] px-[7px] py-[2px] bg-pro-bg text-pro">reference</span>
        </div>
      </div>
      <div
        className="w-full rounded-[11px] p-[13px_17px]"
        style={{ borderLeft: '4px solid var(--border-strong)', background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="font-mono text-[13px] font-semibold text-text-secondary">Return Distribution · retired</div>
            <div className="text-[12px] text-text-muted mt-[2px]">{RETIRED_RETURNS_NOTE}</div>
          </div>
          <span className="font-mono text-[10.5px] uppercase rounded-[5px] px-[7px] py-[2px] bg-surface-1 text-text-muted border border-border">retired</span>
        </div>
      </div>

      <WorkbenchFooter />
    </WorkbenchPage>
  );
}
