import { useChart } from '@/hooks/useChart';
import { formatShortMonth } from '@/lib/utils';
import { baseOptions, GRID_COLOR, MUTED } from './chart-base';

export default function RollingICChart({ series, dates }: { series: number[]; dates: string[] }) {
  const canvasRef = useChart(() => ({
    type: 'line',
    data: {
      labels: dates.map(formatShortMonth),
      datasets: [
        {
          data: series,
          borderColor: '#378ADD',
          borderWidth: 2,
          pointRadius: 0,
          backgroundColor: 'rgba(55,138,221,0.10)',
          fill: true,
          tension: 0.3,
        },
        {
          data: series.map(() => 0),
          borderColor: 'rgba(226,75,74,0.5)',
          borderWidth: 1,
          borderDash: [4, 3],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      ...baseOptions,
      scales: {
        x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: { min: -0.05, max: 0.45, grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 } } },
      },
    },
  }));

  return (
    <div style={{ position: 'relative', height: 120 }}>
      <canvas ref={canvasRef} role="img" aria-label="Rolling information coefficient" />
    </div>
  );
}
