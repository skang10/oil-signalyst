import { useChart } from '@/hooks/useChart';
import { formatShortMonth } from '@/lib/utils';
import { baseOptions, GRID_COLOR, MUTED } from './chart-base';

export default function SignalPriceOverlayChart({ price, signal, dates }: { price: number[]; signal: number[]; dates: string[] }) {
  const canvasRef = useChart(() => ({
    type: 'line',
    data: {
      labels: dates.map(formatShortMonth),
      datasets: [
        {
          label: 'WTI Price',
          data: price,
          borderColor: '#378ADD',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          tension: 0.3,
          yAxisID: 'y',
        },
        {
          label: 'Signal',
          data: signal,
          borderColor: '#BA7517',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          backgroundColor: 'rgba(186,117,23,0.08)',
          fill: true,
          tension: 0.3,
          yAxisID: 'y2',
        },
      ],
    },
    options: {
      ...baseOptions,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: {
          type: 'linear',
          position: 'left',
          grid: { color: GRID_COLOR },
          ticks: { color: MUTED, font: { size: 10 }, callback: (v) => `$${v}` },
        },
        y2: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: MUTED, font: { size: 10 } },
        },
      },
    },
  }));

  return (
    <div style={{ position: 'relative', height: 140 }}>
      <canvas ref={canvasRef} role="img" aria-label="Price vs signal overlay" />
    </div>
  );
}
