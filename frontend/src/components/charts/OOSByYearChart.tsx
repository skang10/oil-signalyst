import { useChart } from '@/hooks/useChart';
import { baseOptions, GRID_COLOR, MUTED } from './chart-base';
import type { SignalEvaluation } from '@/types/api';

export default function OOSByYearChart({ oosYears }: { oosYears: SignalEvaluation['oos_years'] }) {
  const canvasRef = useChart(() => ({
    type: 'bar',
    data: {
      labels: oosYears.map((y) => String(y.year)),
      datasets: [
        { label: 'Train IC', data: oosYears.map((y) => y.train_ic), backgroundColor: 'rgba(55,138,221,0.7)', borderRadius: 2 },
        { label: 'OOS IC', data: oosYears.map((y) => y.oos_ic), backgroundColor: 'rgba(151,196,89,0.85)', borderRadius: 2 },
      ],
    },
    options: {
      ...baseOptions,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 } } },
        y: { min: 0, max: 0.4, grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 } } },
      },
    },
  }));

  return (
    <div style={{ position: 'relative', height: 140 }}>
      <canvas ref={canvasRef} role="img" aria-label="Year by year out-of-sample IC" />
    </div>
  );
}
