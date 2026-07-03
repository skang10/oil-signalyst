import type { ChartOptions } from 'chart.js';

export const GRID_COLOR = 'rgba(0,0,0,0.06)';
export const MUTED = '#888780';

export const baseOptions: Partial<ChartOptions<'line' | 'bar'>> = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: { legend: { display: false }, tooltip: { enabled: true } },
  scales: {
    x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 }, maxRotation: 0 } },
    y: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 } } },
  },
};

/**
 * Real daily series (~18 months = ~365-547 points depending on trading-day
 * gaps) are too dense to label every point on the x-axis - show a label
 * only every `every`th point, blank string otherwise, same convention the
 * old mock data used (MONTHS_18 every 8th point).
 */
export function sparseLabels(dates: string[], every = 22): string[] {
  return dates.map((d, i) => (i % every === 0 ? d : ''));
}
