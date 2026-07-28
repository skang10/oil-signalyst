/**
 * Workbench view-model layer — the honest bridge between the Stockcast "training
 * sandboxes" mental model and what THIS repo's backend actually stores.
 *
 * The backend has no server-side notion of experiments, forks, an exclusive
 * shadow slot, or a two-gate promote lifecycle (confirmed against
 * core/models/trainer.py + deploy_service.py). It knows: TrainJob rows,
 * CrossValidate runs, and a single active ModelVersion per model type, promoted
 * by one `deploy` action. So the Stockcast concepts map onto real data like:
 *
 *   experiment          -> a real train / cross-validate run (TrainJobSummary)
 *   production pointer   -> the active ModelVersion (ModelStatus.models[eia])
 *   walk-forward result  -> a cross-validate job's per-fold beat/baseline
 *   deployment gate      -> ModelStatus.deployment_gate + a run's gate outcome
 *   lifecycle pill       -> TrainJobSummary.deploy_state
 *   the ONE decision      -> Deploy to production (useDeployModel)
 *
 * Everything with no backing — the shadow slot, fork lineage, promote-to-shadow,
 * and the Returns/Brier tree (that model was retired at -15.3% skill) — is
 * rendered as a clearly-labelled reference/TODO(api) surface and NEVER as
 * fabricated numbers. Only `eia` is trainable; `regime` is a frozen artifact.
 */
import type { ModelStatus, TrainJobSummary } from '@/types/api';

export type EiaModel = ModelStatus['models'][number];

/** Lifecycle states a card can be in. 'production'/'shadow'/'archived'/'idle'
 *  come from real deploy_state; 'reference'/'retired' are the frozen regime and
 *  the pulled Returns model. */
export type Lifecycle =
  | 'production'
  | 'shadow'
  | 'idle'
  | 'blocked'
  | 'archived'
  | 'running'
  | 'failed'
  | 'reference'
  | 'retired';

export type PillKind = 'prod' | 'shadow' | 'ok' | 'run' | 'ref' | 'arch' | 'bad';

export const EIA_METRIC = { label: 'MAE', unit: 'mb', baselineName: 'train-mean' } as const;

/** Card left-accent + ring, keyed to lifecycle. Mirrors the mockup's .xp.prod /
 *  .xp.shadow / .xp.ref / .xp.arch, expressed in the repo's design tokens. */
export function cardAccent(life: Lifecycle): { className: string; style: Record<string, string> } {
  switch (life) {
    case 'production':
      return {
        className: 'border-accent-border',
        style: { borderLeft: '4px solid var(--fill-accent)', boxShadow: '0 0 0 3px var(--bg-accent)' },
      };
    case 'shadow':
      return {
        className: 'border-warning-border',
        style: { borderLeft: '4px solid var(--border-warning)', boxShadow: '0 0 0 3px var(--bg-warning)' },
      };
    case 'reference':
      return { className: '', style: { borderLeft: '4px solid var(--text-pro)', background: 'var(--bg-pro)' } };
    case 'retired':
    case 'archived':
      return { className: '', style: { borderLeft: '4px solid var(--border-strong)', background: 'var(--surface-1)' } };
    case 'failed':
      return { className: '', style: { borderLeft: '4px solid var(--border-danger)' } };
    default:
      return { className: '', style: { borderLeft: '4px solid var(--border-strong)' } };
  }
}

export function pillClass(kind: PillKind): string {
  const map: Record<PillKind, string> = {
    prod: 'bg-accent-bg text-accent-text',
    shadow: 'bg-warning-bg text-warning',
    ok: 'bg-success-bg text-success',
    run: 'bg-surface-1 text-text-secondary border border-border',
    ref: 'bg-pro-bg text-pro',
    arch: 'bg-surface-1 text-text-muted border border-border',
    bad: 'bg-danger-bg text-danger',
  };
  return map[kind];
}

export interface LifecyclePill {
  label: string;
  kind: PillKind;
}

/** Map a real training run to a lifecycle + pill, entirely from its status and
 *  deploy_state — no invented state. */
export function runLifecycle(job: TrainJobSummary): { life: Lifecycle; pill: LifecyclePill } {
  if (job.status === 'failed') return { life: 'failed', pill: { label: 'failed', kind: 'bad' } };
  if (job.status === 'cancelled') return { life: 'archived', pill: { label: 'cancelled', kind: 'arch' } };
  if (job.status === 'queued' || job.status === 'running')
    return { life: 'running', pill: { label: job.status, kind: 'run' } };
  switch (job.deploy_state) {
    case 'live':
      return { life: 'production', pill: { label: 'live', kind: 'prod' } };
    case 'partial':
      return { life: 'production', pill: { label: 'partial', kind: 'prod' } };
    case 'superseded':
      return { life: 'archived', pill: { label: 'superseded', kind: 'arch' } };
    case 'blocked':
      return { life: 'blocked', pill: { label: 'gate-blocked', kind: 'bad' } };
    default:
      return { life: 'idle', pill: { label: 'not deployed', kind: 'run' } };
  }
}

export function fmt(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? '—' : value.toFixed(digits);
}

/** Signed skill as a percentage; the sign is the finding (negative = worse than
 *  the constant baseline). Mirrors lib/model-metrics.fmtSkill. */
export function fmtSkill(skill: number | null | undefined): string {
  if (skill === null || skill === undefined) return '—';
  const pct = skill * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export function skillOf(primary: number | null, baseline: number | null): number | null {
  if (primary == null || baseline == null || baseline === 0) return null;
  return 1 - primary / baseline;
}

/** started_at is naive-UTC "YYYY-MM-DD HH:MM:SS" straight from the DB; slice,
 *  never Date-parse (parsing shifts it into browser-local time). Same convention
 *  as TrainingHistoryCard.fmtStarted. */
export function fmtStarted(s: string | null): string {
  return s ? `${s.slice(5, 10)} · ${s.slice(11, 16)}` : '—';
}

export function fmtDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** A one-line description of what a run changed. Lineage isn't tracked
 *  server-side, so this is derived from the run's own fields, not a real parent
 *  diff. TODO(api): expose a fork/parent relationship to make this a true diff. */
export function runChange(job: TrainJobSummary): string {
  const types = job.model_types.join(', ');
  const kind = job.trigger_source === 'agent' ? 'DS-Agent run' : 'training run';
  return `${kind} · ${types}`;
}

export const RETIRED_RETURNS_NOTE =
  'Return Distribution (20-day WTI return buckets) was pulled after going live at −15.3% skill — worse than climatology. It is retired, not trained; no Brier numbers are shown because none are trustworthy.';

export const SHADOW_SLOT_NOTE =
  'No challenger in shadow. This repo deploys straight to production — an exclusive shadow slot and the shadow→production gate are not tracked server-side yet.';
