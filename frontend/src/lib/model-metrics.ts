import type { ModelStatus } from '@/types/api';

type Model = ModelStatus['models'][number];

export const MODEL_LABEL: Record<Model['type'], string> = {
  regime: 'Market Regime',
  eia: 'EIA Forecast Model',
};

/**
 * Regime is a state description, not a forecast, so it gets a different
 * subtitle and no score. The dividing line the backend uses is whether the
 * thing has an observable outcome to be checked against: EIA is scored against
 * the inventory change EIA later publishes, while regime was only ever compared
 * to a hardcoded table of transition dates.
 */
export const MODEL_KIND: Record<Model['type'], string> = {
  regime: 'State indicator — not scored',
  eia: 'Forecast',
};

// metrics.* are null until first recorded (types/api.ts) - show a placeholder
// rather than crashing on null.toFixed().
export function fmt(value: number | null | undefined, digits: number, scale = 1): string {
  return value === null || value === undefined ? '—' : (value * scale).toFixed(digits);
}

/** Unit suffix for a model type's primary metric. */
export function metricUnit(type: Model['type']): string {
  return type === 'eia' ? ' MB' : '';
}

/**
 * Skill as a percentage. Signed always - the sign IS the finding, since a
 * negative skill means the model lost to a predictor that ignores every
 * feature. `delta` renders it as a change in percentage points instead.
 */
export function fmtSkill(skill: number | null | undefined, delta = false): string {
  if (skill === null || skill === undefined) return '—';
  const pct = skill * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}${delta ? 'pp' : '%'}`;
}

function primaryText(m: Model): string {
  return `MAE ${fmt(m.metrics.primary, 1)} MB`;
}

function baselineText(m: Model): string | null {
  if (m.metrics.baseline === null || m.metrics.baseline === undefined) return null;
  return `baseline ${fmt(m.metrics.baseline, 1)} MB`;
}

/** True when the model beats its baseline; null when it cannot be judged. */
export function beatsBaseline(m: Model): boolean | null {
  const { primary, baseline } = m.metrics;
  if (!m.is_forecast || primary === null || baseline === null || baseline === undefined)
    return null;
  // The one forecast metric here (MAE) is lower-is-better.
  return primary < baseline;
}

/**
 * Whether a model should read as healthy on the status cards.
 *
 * Two things drive this: the model beating its train-time baseline at all (a
 * model that loses to guessing can still be promoted by override through
 * deploy_service), and the live out-of-sample signals for the forecast model
 * (see livePerformanceUnhealthy). PSI drift is deliberately NOT one of them -
 * per-feature PSI is too weak and noisy a signal for this market to gate health
 * on, so it is shown for context but never turns a model amber. Joint drift
 * (adversarial validation), which PSI cannot see, is what feeds health instead.
 */
export function isUnhealthy(m: Model, liveUnhealthy = false): boolean {
  return beatsBaseline(m) === false || (m.is_forecast && liveUnhealthy);
}

/**
 * Model-failure signals that live outside the per-model card - rolling
 * out-of-sample performance and joint drift. These describe the deployed EIA
 * forecast, so a caller ORs the result into isUnhealthy for the forecast model.
 *
 * Drift said "the inputs moved"; baseline said "never beat guessing at train
 * time". This is the third and most direct failure: the live model has stopped
 * getting the sign right, its loss is climbing, or the feature set has jointly
 * shifted under it - none of which the frozen train-time metric can see.
 */
export function livePerformanceUnhealthy(status: ModelStatus): boolean {
  const lp = status.live_performance;
  const jd = status.joint_drift;
  const dropped = lp?.directional_acc != null && lp.directional_acc < 0.5;
  const phAlarm = Boolean(lp?.page_hinkley?.alarm);
  const jointAlert = Boolean(jd?.alert);
  return dropped || phAlarm || jointAlert;
}

/**
 * Secondary line: the same model rescored on the trailing 6 months.
 *
 * Kept out of metricText and isUnhealthy on purpose. It is there to show
 * whether recent conditions have moved away from what the model was fit on -
 * the constant baselines drift with the market, so the pair moving together
 * says "harder period", the pair diverging says "the model is decaying". It is
 * far too noisy to judge a model by: ~6 independent observations, which is why
 * the deployment gate reads the full window instead.
 */
export function recentText(m: Model): string | null {
  const r = m.metrics.recent;
  if (!m.is_forecast || !r || r.primary === null) return null;
  const digits = 1;
  const unit = metricUnit(m.type);
  const base =
    r.baseline === null || r.baseline === undefined
      ? ''
      : ` / baseline ${fmt(r.baseline, digits)}${unit}`;
  return `Last 6mo: ${fmt(r.primary, digits)}${unit}${base} · n≈${r.effective_n ?? '—'} independent`;
}

/**
 * One line per model. Single implementation - ModelMonitor and DSView each had
 * their own near-copy whose branch ordering differed, so the same model could
 * read differently on two pages.
 */
export function metricText(m: Model): string {
  const psi = `PSI ${fmt(m.metrics.psi, 2)}`;
  if (!m.is_forecast) return psi;
  const baseline = baselineText(m);
  const head = baseline ? `${primaryText(m)} / ${baseline}` : primaryText(m);
  // Named rather than left to colour alone - "below baseline" is the whole
  // finding, and it should survive a screenshot or a colourblind reader.
  // PSI is shown as a number for context but is not a health note - it does not
  // gate health (see isUnhealthy), so it must not read as a warning here either.
  const notes = [beatsBaseline(m) === false ? 'below baseline' : null].filter(Boolean);
  return notes.length ? `${head} · ${psi} — ${notes.join(', ')}` : `${head} · ${psi}`;
}
