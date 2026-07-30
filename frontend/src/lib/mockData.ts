/**
 * Dev-only mock fixtures for the DS Workbench. When mock mode is on (see
 * `mockMode.ts`), the API layer serves these instead of hitting the backend, so
 * every workbench page renders with a rich, self-consistent sample dataset while
 * the real daily pipeline produces nothing locally. The numbers mirror the DB
 * seed in `backend/scripts/seed_workbench_mock.py` so mock-on and mock-off tell
 * the same story. Fabricated data — never ship as real.
 */
import type { DailyReport, ModelStatus, TrainJobsResponse } from '@/types/api';

// weekly forecast/realized history — the releases chart + rolling performance
const WEEKLY: [string, number, number, number][] = [
  ['2026-05-06', -1.8, -2.1, -1.2],
  ['2026-05-13', 0.9, 1.4, 0.6],
  ['2026-05-20', -3.2, -2.8, -2.1],
  ['2026-05-27', -1.1, -0.5, -0.8],
  ['2026-06-03', 2.1, 1.7, 1.3],
  ['2026-06-10', -2.5, -3.1, -1.6],
  ['2026-06-17', -0.8, 0.6, -0.4], // miss
  ['2026-06-24', -2.9, -2.4, -1.9],
  ['2026-07-01', 1.2, 3.5, 0.9],
  ['2026-07-08', -4.1, -4.6, -2.7],
  ['2026-07-15', -1.8, 0.9, -1.1], // miss
  ['2026-07-22', -3.4, -3.1, -2.2],
];

const series = WEEKLY.map(([date, forecast, realized, consensus]) => ({
  date,
  forecast,
  realized,
  consensus,
  abs_error: Math.round(Math.abs(realized - forecast) * 100) / 100,
  hit: forecast < 0 === realized < 0,
}));

export const mockModelStatus: ModelStatus = {
  models: [
    {
      type: 'eia',
      version: 'v1.4',
      deployed_at: '2026-05-20 09:06:00',
      mlflow_run_id: 'a3f2c8d1',
      is_forecast: true,
      metrics: {
        primary: 1.91,
        baseline: 2.63,
        psi: 0.08,
        recent: { primary: 1.88, baseline: 2.55, window_start: '2026-04-29', n_rows: 130, effective_n: 13 },
        skill: 0.2738,
      },
      metric_key: 'mae',
      gate_passed: true,
      previous: {
        version: 'v1.3',
        primary: 2.06,
        baseline: 2.63,
        skill: 0.2167,
        deployed_at: '2026-01-12 09:04:00',
        gate_passed: true,
      },
      psi_alert: false,
    },
  ],
  data_sources: [
    { name: 'EIA', status: 'ok', lag_hours: 3, last_updated: '2026-07-29 06:30:00' },
    { name: 'Yahoo Finance', status: 'ok', lag_hours: 0, last_updated: '2026-07-29 20:00:00' },
    { name: 'CFTC', status: 'delayed', lag_hours: 50, last_updated: '2026-07-27 15:30:00' },
    { name: 'AIS', status: 'delayed', lag_hours: 26, last_updated: '2026-07-28 18:00:00' },
  ],
  live_performance: {
    n_prints: 12,
    rolling_mae: 0.88,
    directional_acc: 0.83,
    model_vs_consensus: -0.25,
    series,
    page_hinkley: { alarm: false, stat: 0.41 },
  },
  joint_drift: { auc: 0.58, alert: false, n_folds: 5 },
  model_input_freshness: { matrix_as_of: '2026-07-28', pipeline_lag_days: 1, pipeline_behind: false },
  feature_coverage_7d: 0.97,
  training_dataset: {
    available: true,
    matrix: {
      start: '2012-01-04',
      end: '2026-07-22',
      rows: 3608,
      weekday_rows: 2604,
      weekend_rows: 1004,
      largest_gap_days: 4,
      largest_gap_at: '2020-03-16',
    },
    splits: [
      {
        name: 'train',
        declared_start: '2012-01-01',
        start: '2012-01-04',
        end: '2024-12-31',
        rows: 3210,
        weekday_rows: 2320,
        effective_n: 160,
      },
      {
        name: 'test',
        declared_start: null,
        start: '2025-01-01',
        end: '2026-07-22',
        rows: 398,
        weekday_rows: 284,
        effective_n: 20,
      },
    ],
  },
  feature_missing_rates: [
    { name: 'tanker_arrivals_7d', pct: 0.04 },
    { name: 'vlcc_count_gulf', pct: 0.03 },
    { name: 'geopol_risk_index', pct: 0.01 },
  ],
  feature_psi: [
    { name: 'curve_slope_zscore', psi: 0.12 },
    { name: 'ovx', psi: 0.09 },
    { name: 'crude_inv_dev', psi: 0.08 },
    { name: 'spec_net_pct', psi: 0.06 },
    { name: 'refinery_util', psi: 0.04 },
  ],
  psi_threshold: 0.2,
  deployment_gate: [
    { label: 'Beats baseline', rule: 'MAE below the train-mean constant' },
    { label: 'Validation window', rule: '≥ 60 out-of-sample rows scored' },
    { label: 'Input drift', rule: 'max feature PSI < 0.20' },
  ],
};

export const mockTrainJobs: TrainJobsResponse = {
  total: 6,
  jobs: [
    {
      job_id: 'a1b2c3d4',
      status: 'complete',
      model_types: ['eia'],
      trigger_source: 'manual',
      triggered_by_name: 'Xuemei',
      started_at: '2026-05-20 09:00:00',
      completed_at: '2026-05-20 09:05:00',
      duration_seconds: 300,
      summary: { improved: 1, of: 1 },
      deploy_state: 'live',
      error: null,
      blocked_reasons: [],
      log_tail: ['[00:01] data leakage check... passed', '[done:complete]'],
    },
    {
      job_id: '11223344',
      status: 'complete',
      model_types: ['eia'],
      trigger_source: 'manual',
      triggered_by_name: 'Xuemei',
      started_at: '2026-01-12 09:00:00',
      completed_at: '2026-01-12 09:03:00',
      duration_seconds: 180,
      summary: { improved: 1, of: 1 },
      deploy_state: 'superseded',
      error: null,
      blocked_reasons: [],
      log_tail: ['[done:complete]'],
    },
    {
      job_id: 'aa11bb22',
      status: 'complete',
      model_types: ['eia'],
      trigger_source: 'agent',
      triggered_by_name: 'Xuemei',
      started_at: '2026-07-24 14:00:00',
      completed_at: '2026-07-24 14:06:00',
      duration_seconds: 360,
      summary: { improved: 0, of: 1 },
      deploy_state: 'blocked',
      error: null,
      blocked_reasons: ['eia: only 41 validation rows (< 60 required)'],
      log_tail: ['[00:05] gate: insufficient validation window', '[done:complete]'],
    },
    {
      job_id: 'c9d0e1f2',
      status: 'complete',
      model_types: ['eia'],
      trigger_source: 'cross-validate' as TrainJobsResponse['jobs'][number]['trigger_source'],
      triggered_by_name: 'Xuemei',
      started_at: '2026-07-23 11:00:00',
      completed_at: '2026-07-23 11:12:00',
      duration_seconds: 720,
      summary: null,
      deploy_state: 'none',
      error: null,
      blocked_reasons: [],
      log_tail: ['[done:complete]'],
    },
    {
      job_id: 'deadbeef',
      status: 'failed',
      model_types: ['eia'],
      trigger_source: 'auto:sunday' as TrainJobsResponse['jobs'][number]['trigger_source'],
      triggered_by_name: 'Xuemei',
      started_at: '2026-07-18 08:00:00',
      completed_at: '2026-07-18 08:01:00',
      duration_seconds: 60,
      summary: null,
      deploy_state: 'none',
      error: 'feature matrix missing 3 columns: natural_gas_ret_20d, ...',
      blocked_reasons: [],
      log_tail: ['[00:01] KeyError: natural_gas_ret_20d', '[done:failed]'],
    },
    {
      job_id: '99887766',
      status: 'running',
      model_types: ['eia'],
      trigger_source: 'manual',
      triggered_by_name: 'Xuemei',
      started_at: '2026-07-29 10:15:00',
      completed_at: null,
      duration_seconds: null,
      summary: null,
      deploy_state: 'none',
      error: null,
      blocked_reasons: [],
      log_tail: ['[00:00] loading feature matrix...'],
    },
  ],
};

function buildReport(role: DailyReport['role']): DailyReport {
  return {
    date: '2026-07-29',
    role,
    wti_price: 78.4,
    wti_change_pct: -0.008,
    baseline_models: [],
    regime_available: true,
    eia: {
      forecast_mb: -2.7,
      interval_80_low: -5.1,
      interval_80_high: 0,
      consensus_mb: -1.9,
      surprise_mb: -0.8,
      next_eia_release: '2026-07-29',
      breakdown: { crude: -2.7, gasoline: null, distillate: null, cushing: null },
      shap_drivers: [
        { name: 'refinery_util', contribution_share: 0.31 },
        { name: 'crude_imports_4w', contribution_share: 0.22 },
        { name: 'curve_slope_zscore', contribution_share: 0.16 },
        { name: 'spec_net_pct', contribution_share: 0.11 },
      ],
      shap_status: 'ok',
      historical_direction_accuracy: 0.71,
      historical_mae: 1.91,
      consensus_mae: 2.26,
    },
    regime: {
      probabilities: { R1: 0.18, R2: 0.08, R3: 0.61, R4: 0.13 },
      dominant: 'R3',
      duration_weeks: 8,
      historical_avg_duration: 14,
      historical_segment_count: 4,
      switch_probability_4w: 0.28,
      switch_probability_basis: { probability: 0.28, switched: 3, comparable: 11, horizon_weeks: 4 },
      support_signals: [
        { name: 'Curve slope', value: '−0.42', direction: 'bearish' },
        { name: 'Spec net %', value: '22 pct', direction: 'bearish' },
        { name: 'Copper 20d', value: '+3.1%', direction: 'bullish' },
      ],
      switch_trigger: 'geopolitical escalation or an OPEC+ cut',
      shap_drivers: [
        { name: 'curve_slope_zscore', contribution: 0.18, direction: 'bearish' },
        { name: 'crude_inv_dev', contribution: 0.16, direction: 'bearish' },
        { name: 'spec_net_pct', contribution: 0.11, direction: 'bearish' },
        { name: 'copper_ret_20d', contribution: 0.07, direction: 'bullish' },
      ],
      shap_status: 'ok',
    },
  };
}

/** Return the mock payload for a workbench GET path, or undefined to let the
 *  request hit the real backend. */
export function mockResponseFor(path: string): unknown {
  if (path.startsWith('/api/models/status')) return mockModelStatus;
  if (path.startsWith('/api/train/jobs')) return mockTrainJobs;
  const report = path.match(/^\/api\/reports\/daily\/([a-z_]+)/);
  if (report) return buildReport(report[1] as DailyReport['role']);
  return undefined;
}
