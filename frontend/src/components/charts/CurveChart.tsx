import { useChart } from '@/hooks/useChart';
import { useMarketSeries } from '@/hooks/useMarketSeries';
import { baseOptions, GRID_COLOR, MUTED } from './chart-base';

interface FuturesCurve {
  labels: string[];
  today: (number | null)[];
  ago_3m: (number | null)[];
}

export default function CurveChart() {
  const { data } = useMarketSeries<FuturesCurve>('futures_curve');
  const labels = data?.labels ?? [];
  const today = data?.today ?? [];
  const ago3m = data?.ago_3m ?? [];
  const allPrices = [...today, ...ago3m].filter((v): v is number => v != null);
  const min = allPrices.length ? Math.floor(Math.min(...allPrices) / 2) * 2 - 1 : 60;
  const max = allPrices.length ? Math.ceil(Math.max(...allPrices) / 2) * 2 + 1 : 90;

  const canvasRef = useChart(
    () => ({
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Today',
            data: today,
            borderColor: '#A32D2D',
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: '#A32D2D',
            tension: 0.2,
            fill: false,
            spanGaps: true,
          },
          {
            label: '3 months ago',
            data: ago3m,
            borderColor: 'rgba(136,135,128,0.6)',
            borderWidth: 1.5,
            borderDash: [4, 3],
            pointRadius: 3,
            pointBackgroundColor: 'rgba(136,135,128,0.6)',
            tension: 0.2,
            fill: false,
            spanGaps: true,
          },
        ],
      },
      options: {
        ...baseOptions,
        plugins: { legend: { display: true, position: 'bottom', labels: { color: MUTED, font: { size: 10 }, boxWidth: 12, padding: 8 } } },
        scales: {
          x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 } } },
          y: {
            min,
            max,
            grid: { color: GRID_COLOR },
            ticks: { color: MUTED, font: { size: 10 }, callback: (v) => `$${v}` },
          },
        },
      },
    }),
    [data]
  );

  return (
    <div style={{ position: 'relative', height: 160 }}>
      <canvas ref={canvasRef} role="img" aria-label="WTI futures curve" />
    </div>
  );
}
