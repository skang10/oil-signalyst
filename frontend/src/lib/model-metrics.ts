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

/** True when the model beats its baseline; null when it cannot be judged. */
export function beatsBaseline(m: Model): boolean | null {
  const { primary, baseline } = m.metrics;
  if (!m.is_forecast || primary === null || baseline === null || baseline === undefined)
    return null;
  // Every forecast metric here (MAE, Brier) is lower-is-better.
  return primary < baseline;
}

/**
 * Whether a model should read as healthy on the status cards.
 *
 * Drift was the only thing these cards reacted to, so a model losing to its own
 * baseline - which can be deployed by override through deploy_service - showed
 * the same green check as one that was working. Losing to the baseline is the
 * more fundamental failure of the two: drift says the inputs moved, this says
 * the model never beat guessing.
 */
export function isUnhealthy(m: Model): boolean {
  return m.psi_alert || beatsBaseline(m) === false;
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
  const notes = [
    beatsBaseline(m) === false ? 'below baseline' : null,
    m.psi_alert ? 'drift' : null,
  ].filter(Boolean);
  return notes.length ? `${head} · ${psi} — ${notes.join(', ')}` : `${head} · ${psi}`;
}
