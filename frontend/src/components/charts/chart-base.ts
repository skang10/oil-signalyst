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
