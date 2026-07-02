import type { ModelStatus } from '@/types/api';

export const modelStatusFixture: ModelStatus = {
  models: [
    {
      type: 'regime',
      version: 'TabPFN v2.3',
      deployed_at: '2026-06-28T00:00:00Z',
      mlflow_run_id: 'a3f2c8d1',
      metrics: { primary: 0.731, psi: 0.08 },
      psi_alert: false,
    },
    {
      type: 'eia',
      version: 'TabPFN v2.3',
      deployed_at: '2026-06-28T00:00:00Z',
      mlflow_run_id: 'b7e1d420',
      metrics: { primary: 1.2, psi: 0.11 },
      psi_alert: false,
    },
    {
      type: 'returns',
      version: 'TabPFN v2.3',
      deployed_at: '2026-06-20T00:00:00Z',
      mlflow_run_id: 'c91a55f3',
      metrics: { primary: 0.211, psi: 0.22 },
      psi_alert: true,
    },
  ],
  data_sources: [
    { name: 'EIA', status: 'ok', lag_hours: 3, last_updated: '2026-07-01T15:00:00Z' },
    { name: 'Price', status: 'ok', lag_hours: 0, last_updated: '2026-07-01T18:00:00Z' },
    { name: 'CFTC', status: 'ok', lag_hours: 48, last_updated: '2026-06-29T18:00:00Z' },
    { name: 'AIS', status: 'delayed', lag_hours: 26, last_updated: '2026-06-30T16:00:00Z' },
  ],
  feature_coverage_7d: 0.986,
  feature_missing_rates: [
    { name: 'crude_inv_dev', pct: 0 },
    { name: 'spec_net_pct', pct: 0.03 },
    { name: 'ais_vlcc_count', pct: 0.09 },
  ],
  feature_psi: [
    { name: 'curve_slope_zscore', psi: 0.06 },
    { name: 'ret_20d', psi: 0.22 },
  ],
};
