/**
 * The workbench "training sandbox" view-model — a faithful shape for the
 * Stockcast sandbox concept (fork lineage, an exclusive shadow slot, per-sandbox
 * pinned data + walk-forward results, a written hypothesis). The real backend
 * tracks none of that, so:
 *   - MOCK mode fills it from `MOCK_SANDBOXES` (a complete, self-consistent tree)
 *   - LIVE mode derives a sparse list from real ModelStatus + TrainJobs, with the
 *     un-tracked fields left null so the UI renders NA instead of a fabrication.
 * One model, one set of components, two data sources — see `useSandboxes`.
 */
import type { ModelStatus, TrainJobsResponse } from '@/types/api';

export type SandboxLife = 'production' | 'shadow' | 'ready' | 'idle' | 'training' | 'archived';

export interface SandboxFeature {
  name: string;
  desc: string;
  added?: boolean; // added in this fork
}

export interface SandboxResult {
  window: string;
  mae: number | null;
  dir: number | null; // 0..1
  evidence: 'replay' | 'live' | 'running';
}

export interface SandboxGateRule {
  rule: string;
  value: string;
  pass: boolean;
}

export interface WorkbenchSandbox {
  id: string;
  version: string;
  life: SandboxLife;
  // list card
  forkParent: string | null;
  forkParentLife: SandboxLife | null;
  change: string;
  createdOn: string | null;
  specFolds: number | null;
  specFeatures: number | null;
  model: string | null;
  mae: number | null;
  dirPct: number | null;
  spread: number | null; // ± MAE
  vsProd: number | null; // this MAE − prod MAE (for the ready card)
  shadowWeek: number | null; // n of 8
  liveSince: string | null;
  retiredAt: string | null;
  trainingPct: number | null;
  baseline: number | null; // train-mean floor
  // detail
  data: { vintageRange: string | null; folds: string | null; gap: string | null; revisions: string | null };
  training: {
    model: string | null;
    trainWindow: string | null;
    scheme: string | null;
    configHash: string | null;
    lastRun: string | null;
  };
  features: SandboxFeature[]; // empty = NA
  results: SandboxResult[]; // empty = NA
  gate: SandboxGateRule[]; // empty = NA
  hypothesis: string | null;
}

const F = (name: string, desc: string, added = false): SandboxFeature => ({ name, desc, added });

// Shared base feature set (the 18 the production tree inherits).
const BASE_FEATURES: SandboxFeature[] = [
  F('chg_lag_1w', "last week's change"),
  F('chg_lag_52w', 'same week last year'),
  F('chg_roll_mean_4w', '4-week average'),
  F('level_vs_5y_avg', 'vs seasonal norm'),
  F('api_reported_chg', 'API Tuesday estimate'),
  F('refinery_runs_lag1', 'crude processed'),
  F('net_imports_lag1', 'imports − exports'),
  F('week_sin', 'seasonal position'),
  F('week_cos', 'seasonal position'),
  F('spec_net_pct', 'COT speculative net %'),
  F('curve_slope_zscore', 'front-curve slope'),
  F('ovx', 'oil volatility index'),
  F('days_of_supply', 'inventory ÷ demand'),
  F('cushing_stocks_dev', 'Cushing deviation'),
  F('gasoline_demand', 'implied gasoline demand'),
  F('distillate_demand', 'implied distillate demand'),
  F('crude_exports_4w', 'US crude exports'),
  F('rig_count_change', 'Baker Hughes Δ'),
];

const GATE_PASS = (mae: number, base: number): SandboxGateRule[] => [
  { rule: 'beats the train-mean baseline', value: `MAE ${mae.toFixed(2)} < ${base.toFixed(2)}`, pass: mae < base },
  { rule: '≥ 60 out-of-sample rows scored', value: '130 rows', pass: true },
  { rule: 'max feature PSI < 0.20', value: 'PSI 0.08', pass: true },
];

const BASELINE = 2.63;

/** The complete mock experiment tree — the story This-week's `v1.4` production
 *  pointer sits on top of. Grouping follows Stockcast: one production + one
 *  shadow challenger running the forecast, one challenger that finished its 8
 *  shadow weeks and is waiting on a decision, idle + archived below. */
export const MOCK_SANDBOXES: WorkbenchSandbox[] = [
  {
    id: 'sb-041',
    version: 'v1.4',
    life: 'production',
    forkParent: 'sb-034',
    forkParentLife: 'archived',
    change: 'promoted to production',
    createdOn: 'May 20',
    specFolds: 34,
    specFeatures: 18,
    model: 'TabPFN · e12-w150',
    mae: 1.91,
    dirPct: 0.71,
    spread: 1.1,
    vsProd: null,
    shadowWeek: null,
    liveSince: 'W22 · May 20 2026',
    retiredAt: null,
    trainingPct: null,
    baseline: BASELINE,
    data: {
      vintageRange: '2019-W40 → 2026-W30',
      folds: '34 · every 4 wk',
      gap: null,
      revisions: 'as-published only',
    },
    training: {
      model: 'TabPFN v2 · ensemble 12',
      trainWindow: '150 weeks, rolling',
      scheme: 'walk-forward, refit weekly',
      configHash: '9c4a…e1',
      lastRun: 'May 20 · 5 min',
    },
    features: BASE_FEATURES,
    results: [
      { window: 'full pinned range · 34 folds', mae: 1.91, dir: 0.71, evidence: 'replay' },
      { window: 'recent 52 wk', mae: 1.88, dir: 0.72, evidence: 'replay' },
      { window: 'live since promote · 9 wk', mae: 1.9, dir: 0.7, evidence: 'live' },
    ],
    gate: GATE_PASS(1.91, BASELINE),
    hypothesis: null,
  },
  {
    id: 'sb-047',
    version: 'v1.5-rc1',
    life: 'shadow',
    forkParent: 'sb-041',
    forkParentLife: 'production',
    change: 'added tanker_arrivals_7d, tanker_discharge_usgc_3d, is_holiday_week',
    createdOn: 'Jul 08',
    specFolds: 34,
    specFeatures: 21,
    model: 'TabPFN · e12-w150',
    mae: 1.84,
    dirPct: 0.73,
    spread: 1.0,
    vsProd: null,
    shadowWeek: 3,
    liveSince: null,
    retiredAt: null,
    trainingPct: null,
    baseline: BASELINE,
    data: {
      vintageRange: '2019-W40 → 2026-W30',
      folds: '34 · every 4 wk',
      gap: 'W28 never captured',
      revisions: 'as-published only',
    },
    training: {
      model: 'TabPFN v2 · ensemble 12',
      trainWindow: '150 weeks, rolling',
      scheme: 'walk-forward, refit weekly',
      configHash: '7d2e…b4',
      lastRun: 'Jul 23 · 6 min',
    },
    features: [
      F('tanker_arrivals_7d', 'added in this fork', true),
      F('tanker_discharge_usgc_3d', 'added in this fork', true),
      F('is_holiday_week', 'added in this fork', true),
      ...BASE_FEATURES,
    ],
    results: [
      { window: 'full pinned range · 34 folds', mae: 1.84, dir: 0.73, evidence: 'replay' },
      { window: 'recent 52 wk', mae: 1.8, dir: 0.74, evidence: 'replay' },
      { window: 'shadow only · 3 wk', mae: 1.71, dir: 0.67, evidence: 'live' },
    ],
    gate: GATE_PASS(1.84, BASELINE),
    hypothesis:
      'Tanker arrivals should help in weeks when import timing shifts. The holiday flag should fix the July-4th-style misses.',
  },
  {
    id: 'sb-045',
    version: 'v1.5-holiday',
    life: 'ready',
    forkParent: 'sb-041',
    forkParentLife: 'production',
    change: 'added is_holiday_week',
    createdOn: 'May 27',
    specFolds: 34,
    specFeatures: 19,
    model: 'TabPFN · e12-w150',
    mae: 1.87,
    dirPct: 0.72,
    spread: 1.0,
    vsProd: 1.87 - 1.91,
    shadowWeek: 8,
    liveSince: null,
    retiredAt: null,
    trainingPct: null,
    baseline: BASELINE,
    data: {
      vintageRange: '2019-W40 → 2026-W30',
      folds: '34 · every 4 wk',
      gap: null,
      revisions: 'as-published only',
    },
    training: {
      model: 'TabPFN v2 · ensemble 12',
      trainWindow: '150 weeks, rolling',
      scheme: 'walk-forward, refit weekly',
      configHash: 'a1f0…9c',
      lastRun: 'May 27 · 5 min',
    },
    features: [F('is_holiday_week', 'added in this fork', true), ...BASE_FEATURES],
    results: [
      { window: 'full pinned range · 34 folds', mae: 1.87, dir: 0.72, evidence: 'replay' },
      { window: 'recent 52 wk', mae: 1.85, dir: 0.73, evidence: 'replay' },
      { window: 'shadow only · 8 wk — complete', mae: 1.82, dir: 0.71, evidence: 'live' },
    ],
    gate: GATE_PASS(1.87, BASELINE),
    hypothesis: 'A holiday flag alone should remove the recurring long-weekend misses without adding noise.',
  },
  {
    id: 'sb-046',
    version: 'lgbm-baseline',
    life: 'idle',
    forkParent: 'sb-041',
    forkParentLife: 'production',
    change: 'model → LightGBM',
    createdOn: 'Apr 08',
    specFolds: 34,
    specFeatures: 18,
    model: 'LightGBM · lr005-l63',
    mae: 1.97,
    dirPct: 0.69,
    spread: 2.3,
    vsProd: null,
    shadowWeek: null,
    liveSince: null,
    retiredAt: null,
    trainingPct: null,
    baseline: BASELINE,
    data: { vintageRange: '2019-W40 → 2026-W30', folds: '34 · every 4 wk', gap: null, revisions: 'as-published only' },
    training: {
      model: 'LightGBM · lr 0.05 · 63 leaves',
      trainWindow: '150 weeks, rolling',
      scheme: 'walk-forward, refit weekly',
      configHash: '4b8c…20',
      lastRun: 'Apr 08 · 3 min',
    },
    features: BASE_FEATURES,
    results: [
      { window: 'full pinned range · 34 folds', mae: 1.97, dir: 0.69, evidence: 'replay' },
      { window: 'recent 52 wk', mae: 2.05, dir: 0.67, evidence: 'replay' },
    ],
    gate: GATE_PASS(1.97, BASELINE),
    hypothesis: 'Sanity check that a gradient-boosted tree is not quietly beating the TabPFN ensemble.',
  },
  {
    id: 'sb-049',
    version: 'longer-window',
    life: 'training',
    forkParent: 'sb-047',
    forkParentLife: 'shadow',
    change: 'train window 150 → 260 weeks',
    createdOn: 'Jul 24',
    specFolds: 34,
    specFeatures: 21,
    model: 'TabPFN · e12-w260',
    mae: null,
    dirPct: null,
    spread: null,
    vsProd: null,
    shadowWeek: null,
    liveSince: null,
    retiredAt: null,
    trainingPct: 62,
    baseline: BASELINE,
    data: { vintageRange: '2019-W40 → 2026-W30', folds: '34 · every 4 wk', gap: null, revisions: 'as-published only' },
    training: {
      model: 'TabPFN v2 · ensemble 12',
      trainWindow: '260 weeks, rolling',
      scheme: 'walk-forward, refit weekly',
      configHash: 'pending',
      lastRun: 'started Jul 24 · 62%',
    },
    features: [
      F('tanker_arrivals_7d', 'inherited from sb-047', true),
      F('tanker_discharge_usgc_3d', 'inherited from sb-047', true),
      F('is_holiday_week', 'inherited from sb-047', true),
      ...BASE_FEATURES,
    ],
    results: [{ window: 'no results yet', mae: null, dir: null, evidence: 'running' }],
    gate: [],
    hypothesis: 'A longer training window may stabilise the shadow model across regime changes.',
  },
  {
    id: 'sb-034',
    version: 'v1.3',
    life: 'archived',
    forkParent: null,
    forkParentLife: null,
    change: 'root sandbox · first tracked config',
    createdOn: 'Jan 12',
    specFolds: 30,
    specFeatures: 18,
    model: 'LightGBM · core18',
    mae: 2.06,
    dirPct: 0.67,
    spread: 1.4,
    vsProd: null,
    shadowWeek: null,
    liveSince: null,
    retiredAt: 'W21 · live W03 → W21',
    trainingPct: null,
    baseline: BASELINE,
    data: { vintageRange: '2022-W40 → 2026-W21', folds: '30 · every 4 wk', gap: null, revisions: 'as-published only' },
    training: {
      model: 'LightGBM · core18',
      trainWindow: '150 weeks, rolling',
      scheme: 'walk-forward, refit weekly',
      configHash: '1a77…03',
      lastRun: 'Jan 12 · 3 min',
    },
    features: BASE_FEATURES,
    results: [{ window: 'full pinned range · 30 folds', mae: 2.06, dir: 0.67, evidence: 'replay' }],
    gate: GATE_PASS(2.06, BASELINE),
    hypothesis: null,
  },
];

/** Live-mode fallback: derive a sparse sandbox list from real data. The active
 *  ModelVersion is the production pointer; completed/idle/failed train jobs are
 *  the rest. Everything the backend does not track (lineage, features, shadow,
 *  per-fold results) is null → NA. */
export function fromReal(
  status: ModelStatus | undefined,
  jobs: TrainJobsResponse | undefined
): WorkbenchSandbox[] {
  const out: WorkbenchSandbox[] = [];
  const eia = status?.models.find((m) => m.type === 'eia');
  if (eia) {
    out.push({
      id: `eia · ${eia.version}`,
      version: eia.version,
      life: 'production',
      forkParent: null,
      forkParentLife: null,
      change: eia.previous ? `displaced eia · ${eia.previous.version}` : 'first version deployed',
      createdOn: eia.deployed_at ? eia.deployed_at.slice(0, 10) : null,
      specFolds: null,
      specFeatures: null,
      model: (eia.metric_key ?? 'mae').toUpperCase(),
      mae: eia.metrics.primary,
      dirPct: null,
      spread: null,
      vsProd: null,
      shadowWeek: null,
      liveSince: eia.deployed_at ? eia.deployed_at.slice(0, 10) : null,
      retiredAt: null,
      trainingPct: null,
      baseline: eia.metrics.baseline,
      data: { vintageRange: null, folds: null, gap: null, revisions: null },
      training: { model: null, trainWindow: null, scheme: 'walk-forward, refit weekly', configHash: null, lastRun: null },
      features: [],
      results: [],
      gate: (status?.deployment_gate ?? []).map((g) => ({ rule: g.rule, value: '', pass: eia.gate_passed ?? false })),
      hypothesis: null,
    });
  }
  for (const j of jobs?.jobs ?? []) {
    if (!j.model_types.includes('eia')) continue;
    if (j.deploy_state === 'live' || j.deploy_state === 'partial') continue; // == the production card
    const life: SandboxLife =
      j.status === 'failed' || j.status === 'cancelled' || j.deploy_state === 'superseded'
        ? 'archived'
        : j.status === 'running' || j.status === 'queued'
          ? 'training'
          : 'idle';
    out.push({
      id: j.job_id,
      version: '',
      life,
      forkParent: null,
      forkParentLife: null,
      change: '',
      createdOn: j.started_at ? j.started_at.slice(5, 10) : null,
      specFolds: null,
      specFeatures: null,
      model: j.model_types.join(', '),
      mae: null,
      dirPct: null,
      spread: null,
      vsProd: null,
      shadowWeek: null,
      liveSince: null,
      retiredAt: null,
      trainingPct: null,
      baseline: null,
      data: { vintageRange: null, folds: null, gap: null, revisions: null },
      training: { model: null, trainWindow: null, scheme: null, configHash: null, lastRun: j.started_at },
      features: [],
      results: [],
      gate: [],
      hypothesis: null,
    });
  }
  return out;
}
