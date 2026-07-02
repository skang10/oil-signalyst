import type { HistoryDetail, HistoryResponse } from '@/types/api';

export const historyFixture: HistoryResponse = {
  predictions: [
    {
      date: '2026-07-01',
      wti_price: 78.4,
      regime_dominant: 'R3',
      signal: 'FLAT',
      expected_return: -0.018,
      downside_prob: 0.51,
      eia_forecast_mb: -2.8,
      actual_return: null,
    },
    {
      date: '2026-06-30',
      wti_price: 77.8,
      regime_dominant: 'R3',
      signal: 'FLAT',
      expected_return: -0.021,
      downside_prob: 0.54,
      eia_forecast_mb: -1.4,
      actual_return: -0.019,
    },
    {
      date: '2026-06-27',
      wti_price: 76.5,
      regime_dominant: 'R3',
      signal: 'FLAT',
      expected_return: -0.009,
      downside_prob: 0.46,
      eia_forecast_mb: 0.3,
      actual_return: 0.011,
    },
  ],
  rolling_accuracy: {
    regime_directional_acc: 0.73,
    eia_directional_acc: 0.71,
    returns_brier: 0.21,
  },
};

export const historyDetailFixtures: Record<string, HistoryDetail> = {
  '2026-07-01': {
    date: '2026-07-01',
    wti_price: 78.4,
    model_version: 'v2.3',
    summary: {
      signal: 'FLAT',
      expected_return: -0.018,
      downside_prob: 0.51,
      eia_forecast_mb: -2.8,
      risk_recommendation: 'Raise hedge to 75%',
    },
    regime: { probabilities: { R1: 0.18, R2: 0.08, R3: 0.61, R4: 0.13 }, dominant: 'R3', duration_weeks: 8, switch_probability_4w: 0.28 },
    features: [
      { name: 'curve_slope_zscore', widthPct: 72, value: 0.18 },
      { name: 'crude_inv_dev', widthPct: 60, value: 0.16 },
    ],
    outcome: { eia_actual_mb: null, actual_return: null },
  },
  '2026-06-30': {
    date: '2026-06-30',
    wti_price: 77.8,
    model_version: 'v2.3',
    summary: {
      signal: 'FLAT',
      expected_return: -0.021,
      downside_prob: 0.54,
      eia_forecast_mb: -1.4,
      risk_recommendation: 'Raise hedge to 72%',
    },
    regime: { probabilities: { R1: 0.16, R2: 0.07, R3: 0.64, R4: 0.13 }, dominant: 'R3', duration_weeks: 7, switch_probability_4w: 0.24 },
    features: [
      { name: 'curve_slope_zscore', widthPct: 68, value: 0.17 },
      { name: 'crude_inv_dev', widthPct: 58, value: 0.15 },
    ],
    outcome: { eia_actual_mb: -1.5, actual_return: -0.019 },
  },
  '2026-06-27': {
    date: '2026-06-27',
    wti_price: 76.5,
    model_version: 'v2.3',
    summary: {
      signal: 'FLAT',
      expected_return: -0.009,
      downside_prob: 0.46,
      eia_forecast_mb: 0.3,
      risk_recommendation: 'Hold current hedge',
    },
    regime: { probabilities: { R1: 0.21, R2: 0.09, R3: 0.57, R4: 0.13 }, dominant: 'R3', duration_weeks: 6, switch_probability_4w: 0.22 },
    features: [
      { name: 'curve_slope_zscore', widthPct: 61, value: 0.15 },
      { name: 'crude_inv_dev', widthPct: 52, value: 0.13 },
    ],
    outcome: { eia_actual_mb: 0.4, actual_return: 0.011 },
  },
};
