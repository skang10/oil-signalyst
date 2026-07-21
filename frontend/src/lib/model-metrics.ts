import type { ModelStatus } from '@/types/api';

type Model = ModelStatus['models'][number];

export const MODEL_LABEL: Record<Model['type'], string> = {
  regime: 'Market Regime',
  eia: 'EIA Forecast Model',
  returns: 'Returns Model',
};

/**
 * Regime is a state description, not a forecast, so it gets a different
 * subtitle and no score. The dividing line the backend uses is whether the
 * thing has an observable outcome to be checked against: EIA is scored against
 * the inventory change EIA later publishes and returns against the realized
 * 20-day return, while regime was only ever compared to a hardcoded table of
 * transition dates.
 */
export const MODEL_KIND: Record<Model['type'], string> = {
  regime: 'State indicator — not scored',
  eia: 'Forecast',
  returns: 'Forecast',
};

// metrics.* are null until first recorded (types/api.ts) - show a placeholder
// rather than crashing on null.toFixed().
export function fmt(value: number | null | undefined, digits: number, scale = 1): string {
  return value === null || value === undefined ? '—' : (value * scale).toFixed(digits);
}

function primaryText(m: Model): string {
  if (m.type === 'eia') return `MAE ${fmt(m.metrics.primary, 1)} MB`;
  return `Brier ${fmt(m.metrics.primary, 3)}`;
}

function baselineText(m: Model): string | null {
  if (m.metrics.baseline === null || m.metrics.baseline === undefined) return null;
  return m.type === 'eia'
    ? `baseline ${fmt(m.metrics.baseline, 1)} MB`
    : `baseline ${fmt(m.metrics.baseline, 3)}`;
}

/**
 * Just the score and its unit, for the dashboard tab bar. Null for models that
 * forecast nothing - that absence is the point: it is what distinguishes a tab
 * that can be right or wrong from one that only describes the present, without
 * needing a caption to assert it.
 *
 * '—' rather than null when a forecast has no recorded score yet, so the slot
 * still reads as "this should have a number".
 */
export function compactMetric(m: Model): string | null {
  if (!m.is_forecast) return null;
  if (m.metrics.primary === null) return '—';
  return m.type === 'eia' ? `${fmt(m.metrics.primary, 1)} MB` : fmt(m.metrics.primary, 3);
}

/** True when the model beats its baseline; null when it cannot be judged. */
export function beatsBaseline(m: Model): boolean | null {
  const { primary, baseline } = m.metrics;
  if (!m.is_forecast || primary === null || baseline === null || baseline === undefined)
    return null;
  // Every forecast metric here (MAE, Brier) is lower-is-better.
  return primary < baseline;
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
  return m.psi_alert ? `${head} · ${psi} — Alerts` : `${head} · ${psi}`;
}
