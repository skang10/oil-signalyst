import type { Role } from './roles';

export interface DailyReport {
  date: string;
  role: Role;
  wti_price: number;
  wti_change_pct: number;

  trader?: {
    signal: 'LONG' | 'SHORT' | 'FLAT';
    kelly_position: number;
    stop_loss_price: number;
    stop_loss_pct: number;
    expected_return: number;
    price_5d_history: number[];
    price_5d_high: number;
    price_5d_low: number;
    brent_wti_spread: number;
    cot_net_percentile: number;
    ovx: number;
  };

  risk?: {
    var_95: number;
    cvar_95: number;
    current_exposure_mbbls: number;
    hedge_ratio: number;
    recommended_hedge_ratio: number;
    r3_historical_max_drawdown: number;
  };

  eia: {
    forecast_mb: number;
    interval_80_low: number;
    interval_80_high: number;
    consensus_mb: number;
    surprise_mb: number;
    breakdown: {
      crude: number;
      gasoline: number;
      distillate: number;
      cushing: number;
    };
    shap_drivers: { name: string; contribution_mb: number }[];
    historical_direction_accuracy: number;
    historical_mae: number;
    consensus_mae: number;
  };

  regime: {
    probabilities: Record<'R1' | 'R2' | 'R3' | 'R4', number>;
    dominant: 'R1' | 'R2' | 'R3' | 'R4';
    duration_weeks: number;
    historical_avg_duration: number;
    switch_probability_4w: number;
    support_signals: {
      name: string;
      value: string;
      direction: 'bullish' | 'bearish' | 'neutral';
    }[];
    switch_trigger: string;
    /**
     * Not in spec §9 (only eia.shap_drivers is typed there) - added for
     * ResearcherView/Model Monitor's "SHAP Feature Importance (Regime)"
     * card, which the HTML prototype requires but the spec's type omits.
     */
    shap_drivers: { name: string; contribution: number; direction: 'bullish' | 'bearish' }[];
  };

  returns: {
    condition_description: string;
    buckets: {
      label: string;
      pct: number;
      color: 'danger' | 'warning' | 'success' | 'accent';
    }[];
    expected_return: number;
    median_return: number;
    var_95: number;
    skewness: number;
    price_range_low: number;
    price_range_high: number;
    downside_prob: number;
    tail_prob: number;
    upside_prob: number;
  };
}

export interface ModelStatus {
  models: {
    type: 'regime' | 'eia' | 'returns';
    version: string;
    // Nullable: deployed_at/mlflow_run_id are unset for never-deployed
    // versions, metrics.primary when the training run didn't record the
    // primary metric, metrics.psi until the first PSI computation has been
    // persisted (see api/routes/models.py).
    deployed_at: string | null;
    mlflow_run_id: string | null;
    metrics: {
      primary: number | null;
      psi: number | null;
    };
    psi_alert: boolean;
  }[];
  data_sources: {
    name: string;
    status: 'ok' | 'delayed' | 'error';
    lag_hours: number | null;
    last_updated: string;
  }[];
  feature_coverage_7d: number;
  /**
   * Not in spec §9's ModelStatus - added for Data Monitor's "Feature Missing
   * Rate" and "Feature Distribution Drift (PSI)" bar lists (§7.4), which the
   * HTML prototype requires but the spec's type omits (same gap class as
   * eia.shap_drivers / regime.shap_drivers).
   */
  feature_missing_rates: { name: string; pct: number }[];
  feature_psi: { name: string; psi: number }[];
}

export interface TrainJob {
  job_id: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  model_types: string[];
  started_at: string | null;
  completed_at: string | null;
  result?: {
    // Metric values are null when they have no backing: old_metrics on the
    // first-ever training of a model type (no prior active version),
    // improvement_pct whenever "returns" isn't among the trained types.
    // A failed job's result carries only `error`.
    old_metrics?: Record<string, number | null>;
    new_metrics?: Record<string, number | null>;
    improvement_pct?: number | null;
    error?: string;
  };
}

export interface TrainParams {
  model_types: string[];
  cutoff_date?: string;
}

export interface HistoryPrediction {
  date: string;
  wti_price: number | null;
  regime_dominant: 'R1' | 'R2' | 'R3' | 'R4';
  signal: 'LONG' | 'SHORT' | 'FLAT';
  expected_return: number;
  downside_prob: number;
  // Null when the stored prediction has no EIA forecast component.
  eia_forecast_mb: number | null;
  actual_return: number | null;
}

export interface HistoryResponse {
  predictions: HistoryPrediction[];
  rolling_accuracy: {
    regime_directional_acc: number;
    eia_directional_acc: number;
    returns_brier: number;
  };
}

export interface HistoryDetail {
  date: string;
  wti_price: number | null;
  model_version: string | null;
  summary: {
    signal: 'LONG' | 'SHORT' | 'FLAT';
    expected_return: number;
    downside_prob: number;
    eia_forecast_mb: number | null;
    risk_recommendation: string;
  };
  regime: {
    probabilities: Record<'R1' | 'R2' | 'R3' | 'R4', number>;
    dominant: 'R1' | 'R2' | 'R3' | 'R4';
    duration_weeks: number;
    switch_probability_4w: number;
  };
  features: { name: string; widthPct: number; value: number }[];
  outcome: {
    eia_actual_mb: number | null;
    actual_return: number | null;
  };
}

/**
 * SignalCandidate / SignalEvaluation are not typed anywhere in spec §9 (the
 * spec only defines DailyReport/ModelStatus/TrainJob) - authored fresh here,
 * modeled on oil-signalyst-signals-page.html's embedded `signals` object.
 */
export interface SignalCandidate {
  name: string;
  label: string;
  ic5: number;
  ic20: number;
  decay: number;
  coverage: number;
  status: 'candidate' | 'active' | 'ignored';
  recommendation: 'add' | 'watch' | 'reject';
}

export interface SignalsResponse {
  active: {
    name: string;
    source: string;
    frequency: string;
    // Open string, not a closed union - values come straight from
    // config/features.yaml's per-feature `category` (live data already
    // includes 'Price Momentum', which the old union missed).
    category: string;
  }[];
  candidates: SignalCandidate[];
}

export interface SignalEvaluation {
  name: string;
  label: string;
  ic5: number;
  ic10: number;
  ic20: number;
  decay: number;
  coverage: number;
  status: 'candidate' | 'active' | 'ignored';
  recommendation: 'add' | 'watch' | 'reject';
  price: number[];
  signal: number[];
  dates: string[];
  ic5_series: number[];
  ic10_series: number[];
  ic20_series: number[];
  oos_years: { year: number; train_ic: number; oos_ic: number }[];
}

/**
 * GET /api/reports/stress - real model re-runs against historical extreme
 * scenarios (core/postprocess/stress_test.py). A scenario either carries the
 * full prediction comparison or an `error` explaining why it couldn't run
 * (e.g. no feature snapshot for that date).
 */
export interface StressScenario {
  name: string;
  date: string;
  error?: string;
  actual_return?: number;
  model_alerted?: boolean;
  dominant_regime_predicted?: string;
  dominant_regime_actual?: string;
  regime_probs?: Record<string, number>;
  return_dist?: Record<string, number>;
}

export interface StressTestResponse {
  scenarios: StressScenario[];
  error?: string;
}
