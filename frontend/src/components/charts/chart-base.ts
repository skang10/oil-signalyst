import type { ChartOptions, Scale, TooltipItem } from 'chart.js';

export const GRID_COLOR = 'rgba(0,0,0,0.06)';
export const MUTED = '#888780';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Friendly tooltip date: "2026-07-06" -> "Jul 6, 2026". Only touches ISO
 * dates, so categorical labels (the curve's "M1", a year axis's "2024")
 * pass through unchanged and those charts are unaffected.
 */
export function formatTooltipDate(label: string): string {
  if (!ISO_DATE.test(label)) return label;
  // Parse as local midnight so the shown day can't drift across a TZ boundary.
  return new Date(`${label}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Shared tooltip that shows the point's date as the title. Charts that
 * override `plugins` (e.g. to show a legend) should spread this into their
 * tooltip so they keep the date header; charts that don't override plugins
 * inherit it from `baseOptions` below.
 */
export const dateTooltip = {
  enabled: true,
  callbacks: {
    title: (items: TooltipItem<'line' | 'bar'>[]) =>
      items.length ? formatTooltipDate(String(items[0].label)) : '',
  },
};

export const baseOptions: Partial<ChartOptions<'line' | 'bar'>> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  // Hover anywhere over an x-position to surface that point - the series draw
  // with pointRadius 0, so requiring an exact point hit would make the tooltip
  // (and its date) almost impossible to trigger.
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: false }, tooltip: dateTooltip },
  scales: {
    x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 }, maxRotation: 0 } },
    y: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 } } },
  },
};

/**
 * X-axis for a daily date series. Keeps every date as a label - so the tooltip
 * can always show it - but only *prints* every `every`th tick. Replaces the old
 * sparseLabels(), which blanked the underlying labels and so left the tooltip
 * date empty on ~21 of every 22 points.
 */
export function dateAxisX(every = 22) {
  return {
    grid: { color: GRID_COLOR },
    ticks: {
      color: MUTED,
      font: { size: 10 },
      maxRotation: 0,
      autoSkip: false,
      callback(this: Scale, value: string | number, index: number) {
        return index % every === 0 ? this.getLabelForValue(value as number) : '';
      },
    },
  };
}
