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
    /**
     * How many hand-curated historical segments back historical_avg_duration.
     * Single-digit (R1 has 5, R4 has 1) - shown next to the statistic so it
     * doesn't read as a population parameter.
     */
    historical_segment_count: number;
    switch_probability_4w: number;
    /** The counts behind switch_probability_4w. comparable === 0 means the
     * neutral prior was substituted, not that a probability was measured. */
    switch_probability_basis: {
      probability: number;
      switched: number;
      comparable: number;
      horizon_weeks: number;
    };
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
    /**
     * False for 'regime', which describes the current market state rather than
     * forecasting anything with an observable outcome - so it carries no score
     * and must not be rendered alongside eia/returns as if it did. See
     * core/models/metrics.py::PRIMARY_METRIC_KEY.
     */
    is_forecast: boolean;
    metrics: {
      primary: number | null;
      /**
       * What the primary metric has to beat to mean anything: majority-class
       * accuracy / climatology Brier for classifiers, train-mean MAE for eia.
       * Null for non-forecast models and for versions trained before baselines
       * were recorded.
       */
      baseline: number | null;
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
  /**
   * Freshness of the persisted feature Parquet matrix the models actually
   * train/score on, vs the live feeds. Answers "is the model's input current
   * and consistent with training" (data_sources above answers "are the feeds
   * alive"). `pipeline_behind` = the daily scheduler has fallen behind.
   */
  model_input_freshness: {
    matrix_as_of: string | null;
    pipeline_lag_days: number | null;
    pipeline_behind: boolean;
  };
  feature_coverage_7d: number;
  /**
   * Shape of the dataset the models are fit on - coverage, row counts and
   * split boundaries. `available: false` when no feature Parquet exists yet.
   */
  training_dataset:
    | { available: false }
    | {
        available: true;
        matrix: {
          start: string;
          end: string;
          rows: number;
          weekday_rows: number;
          /** Calendar-day index with weekends forward-filled, so these are
           *  carried-forward duplicates rather than observations. */
          weekend_rows: number;
          largest_gap_days: number;
          largest_gap_at: string | null;
        };
        splits: {
          name: string;
          /** Configured start, when it differs from the first row actually present. */
          declared_start: string | null;
          start: string | null;
          end: string | null;
          rows: number;
          weekday_rows: number;
          /** Non-overlapping label windows - the count that matters for reading
           *  any metric, given 20-day forward labels on daily rows. */
          effective_n: number;
          warning?: string;
        }[];
      };
  /**
   * Not in spec §9's ModelStatus - added for Data Monitor's "Feature Missing
   * Rate" and "Feature Distribution Drift (PSI)" bar lists (§7.4), which the
   * HTML prototype requires but the spec's type omits (same gap class as
   * eia.shap_drivers / regime.shap_drivers).
   */
  feature_missing_rates: { name: string; pct: number }[];
  feature_psi: { name: string; psi: number }[];
  /** PSI at or above which a feature is flagged for retrain (backend
   *  PSI_RETRAIN_THRESHOLD). Drives the drift legend's cutoff. */
  psi_threshold: number;
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
    /**
     * Same keys as new_metrics. Deliberately a separate map rather than extra
     * new_metrics entries, which would render as bogus comparison rows.
     */
    baselines?: Record<string, number | null>;
    improvement_pct?: number | null;
    versions?: Record<string, string>;
    /** Per model type: did it clear the deployment gate and go live? */
    deployed?: Record<string, boolean>;
    /** Per model type: why the gate blocked it. Absent when nothing was blocked. */
    blocked_reasons?: Record<string, string[]>;
    error?: string;
  };
  // Present only when fetched with ?include_log=true (history detail panel).
  log_lines?: string[];
}

export type TrainTriggerSource = 'manual' | 'auto:psi' | 'auto:sunday' | 'agent';
export type TrainTriggerFilter = 'manual' | 'auto' | 'agent';

/** One row of GET /api/train/jobs - list counterpart to TrainJob. */
export interface TrainJobSummary {
  job_id: string;
  status: TrainJob['status'];
  model_types: string[];
  trigger_source: TrainTriggerSource;
  triggered_by_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  // Null when nothing is comparable: failed/running jobs, or a first-ever
  // training where every old metric is null.
  summary: { improved: number; of: number } | null;
  // 'live': every version this job trained is still active; 'partial': some
  // are; 'blocked': the deployment gate stopped all of them going live at all;
  // 'superseded': they were live and a later run replaced them; 'none': job
  // produced no versions.
  deploy_state: 'live' | 'partial' | 'blocked' | 'superseded' | 'none';
  error: string | null;
  /** Flattened "modelType: reason" strings when deploy_state is 'blocked'. */
  blocked_reasons: string[];
  log_tail: string[];
}

export interface TrainJobsResponse {
  total: number;
  jobs: TrainJobSummary[];
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
  // Only outcomes that are actually observed. Regime is absent by design: its
  // "accuracy" compared the model against a hardcoded table of transition
  // dates, which measures agreement with a constant, not accuracy.
  rolling_accuracy: {
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
    switch_probability_basis: {
      probability: number;
      switched: number;
      comparable: number;
      horizon_weeks: number;
    };
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
  // Days until an ignore snooze expires and the signal returns to the
  // candidate list; null when not ignored (or when status is 'ignored' via
  // the scanner's own 'rejected' verdict, which has no expiry).
  ignored_days_left: number | null;
}

/** One managed entry of the feature pool (config/features.yaml), badged
 * with live-model usage. 'removed_pending_retrain' marks ghost rows: a live
 * model still depends on the feature but it's gone from the yaml - daily
 * predictions break until that model is retrained. */
export interface PoolFeature {
  name: string;
  label: string;
  category: string;
  source: string;
  frequency: string;
  transform: string | null;
  used_by: string[];
  pool_status: 'live' | 'pending_retrain' | 'removed_pending_retrain';
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
  pool: PoolFeature[];
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
  ignored_days_left: number | null;
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
