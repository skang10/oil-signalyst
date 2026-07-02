import { useChart } from '@/hooks/useChart';
import { curveLabels, curveToday, curve3ago } from '@/lib/mock-market-data';
import { baseOptions, GRID_COLOR, MUTED } from './chart-base';

export default function CurveChart() {
  const canvasRef = useChart(() => ({
    type: 'line',
    data: {
      labels: curveLabels,
      datasets: [
        {
          label: 'Today (Contango)',
          data: curveToday,
          borderColor: '#A32D2D',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#A32D2D',
          tension: 0.2,
          fill: false,
        },
        {
          label: '3 months ago (Backwardation)',
          data: curve3ago,
          borderColor: 'rgba(136,135,128,0.6)',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 3,
          pointBackgroundColor: 'rgba(136,135,128,0.6)',
          tension: 0.2,
          fill: false,
        },
      ],
    },
    options: {
      ...baseOptions,
      plugins: { legend: { display: true, position: 'bottom', labels: { color: MUTED, font: { size: 10 }, boxWidth: 12, padding: 8 } } },
      scales: {
        x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 } } },
        y: {
          min: 77,
          max: 84,
          grid: { color: GRID_COLOR },
          ticks: { color: MUTED, font: { size: 10 }, callback: (v) => `$${v}` },
        },
      },
    },
  }));

  return (
    <div style={{ position: 'relative', height: 160 }}>
      <canvas ref={canvasRef} role="img" aria-label="WTI futures curve" />
    </div>
  );
}
