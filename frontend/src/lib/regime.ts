export type RegimeId = 'R1' | 'R2' | 'R3' | 'R4';

export const REGIME_IDS: readonly RegimeId[] = ['R1', 'R2', 'R3', 'R4'] as const;

/**
 * Single source of truth. RegimeTab, ResearcherView, TraderView and
 * HistoryDrawer each carried their own copy and they had drifted - TraderView
 * dropped the em-dash, HistoryDrawer showed the bare id - so the same regime
 * read differently depending on which page you were on.
 */
export const REGIME_LABELS: Record<RegimeId, string> = {
  R1: 'R1 — Supply Squeeze Bull',
  R2: 'R2 — Demand Expansion Bull',
  R3: 'R3 — Oversupply Bear',
  R4: 'R4 — Demand Collapse Bear',
};

export const REGIME_TRIGGER: Record<RegimeId, string> = {
  R1: 'Production cuts / geopolitical disruption',
  R2: 'Strong GDP / China demand',
  R3: 'OPEC production increase / inventory build',
  R4: 'Recession / pandemic shock',
};

/**
 * Shown wherever regime figures appear. These four buckets are an analyst
 * framework, not a model output: their boundaries are 17 dates typed by hand
 * in backend/core/models/regime_labels.py. The percentages below come from a
 * frozen classifier asking "which of those hand-drawn periods does today most
 * resemble" - it is a description of now, not a forecast, and unlike the EIA
 * and return-distribution models there is no observable outcome to score it
 * against.
 */
export const REGIME_PROVENANCE =
  'Analyst-defined market states, not a forecast. Probabilities come from a frozen classifier ' +
  'matching today against hand-drawn historical periods; there is no future outcome to score ' +
  'them against, so they carry no accuracy metric.';

/**
 * Renders a historical regime statistic with the sample it rests on. The
 * segment counts are single-digit (R1 has 5, R4 exactly 1), so "60.8 weeks"
 * alone reads like a population parameter.
 */
export function sampleNote(segmentCount: number | undefined): string {
  if (!segmentCount) return '';
  return segmentCount === 1
    ? ' (n=1 historical period)'
    : ` (n=${segmentCount} historical periods)`;
}

/**
 * States what a switch "probability" actually counts, instead of printing a
 * bare percentage. `comparable === 0` means the neutral prior was substituted
 * because there was too little history to estimate anything.
 */
export function switchProbabilityText(basis: {
  probability: number;
  switched: number;
  comparable: number;
  horizon_weeks: number;
}): string {
  if (!basis || basis.comparable === 0) {
    return 'Too few comparable historical periods to estimate — showing a neutral prior.';
  }
  return `${basis.switched} of ${basis.comparable} comparable historical periods ended within ${basis.horizon_weeks} weeks.`;
}
