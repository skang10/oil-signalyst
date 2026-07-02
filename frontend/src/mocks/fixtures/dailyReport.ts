import type { DailyReport } from '@/types/api';

/**
 * Superset fixture: MSW returns this same object regardless of the role in
 * the request URL (trader/risk/eia/regime/returns all populated at once).
 * Role-based rendering happens client-side, per spec §4/§7.1.
 * Values are copied 1:1 from oil-signalyst-dashboard.html's embedded markup.
 */
export const dailyReportFixture: DailyReport = {
  date: '2026-07-01',
  role: 'researcher',
  wti_price: 78.4,
  wti_change_pct: -0.008,

  trader: {
    signal: 'FLAT',
    kelly_position: 0,
    stop_loss_price: 71.2,
    stop_loss_pct: -0.092,
    expected_return: -0.018,
    price_5d_history: [76.2, 75.8, 77.1, 79.1, 78.4],
    brent_wti_spread: 3.2,
    cot_net_percentile: 22,
    ovx: 28.4,
  },

  risk: {
    var_95: -0.132,
    cvar_95: -0.187,
    current_exposure_mbbls: 1.0,
    hedge_ratio: 0.62,
    recommended_hedge_ratio: 0.75,
    r3_historical_max_drawdown: -0.38,
  },

  eia: {
    forecast_mb: -2.8,
    interval_80_low: -4.5,
    interval_80_high: -1.1,
    consensus_mb: -1.2,
    surprise_mb: -1.6,
    breakdown: {
      crude: -2.8,
      gasoline: -1.1,
      distillate: 0.6,
      cushing: -0.9,
    },
    shap_drivers: [
      { name: 'Refinery utilisation +3.2%', contribution_mb: -1.4 },
      { name: 'Crude import decline', contribution_mb: -0.9 },
      { name: 'Summer driving demand peak', contribution_mb: -0.7 },
      { name: 'US crude exports flat', contribution_mb: 0.2 },
    ],
    historical_direction_accuracy: 0.712,
    historical_mae: 1.3,
    consensus_mae: 1.9,
  },

  regime: {
    probabilities: { R1: 0.18, R2: 0.08, R3: 0.61, R4: 0.13 },
    dominant: 'R3',
    duration_weeks: 8,
    historical_avg_duration: 14,
    switch_probability_4w: 0.28,
    support_signals: [
      { name: 'Futures Curve Structure', value: 'Contango +$2.4/bbl', direction: 'bearish' },
      { name: 'Inventory vs 5yr Average', value: '+8.2% (above average)', direction: 'bearish' },
      { name: 'COT Speculative Net Percentile', value: '22nd percentile (Bearish)', direction: 'bearish' },
      { name: 'OPEC Compliance Rate', value: '87% (significant overproduction)', direction: 'bearish' },
      { name: 'Middle East Geopolitical Risk Index', value: 'Moderate (0.42/1.0)', direction: 'neutral' },
      { name: 'Global PMI', value: '51.2 (mild expansion)', direction: 'bullish' },
    ],
    switch_trigger:
      'Geopolitical escalation or OPEC+ emergency production cut meeting -> R3 -> R1 (Supply Squeeze Bull)',
  },

  returns: {
    condition_description:
      'Conditional on Regime R3 (P=61%); weighted by other regimes: R1x18% + R2x8% + R4x13%',
    buckets: [
      { label: '<-10%', pct: 0.21, color: 'danger' },
      { label: '-10~0%', pct: 0.3, color: 'warning' },
      { label: '0~+10%', pct: 0.34, color: 'success' },
      { label: '>+10%', pct: 0.15, color: 'accent' },
    ],
    expected_return: -0.018,
    median_return: -0.015,
    var_95: -0.132,
    skewness: -0.42,
    price_range_low: 66,
    price_range_high: 89,
    downside_prob: 0.51,
    tail_prob: 0.21,
    upside_prob: 0.49,
  },
};
