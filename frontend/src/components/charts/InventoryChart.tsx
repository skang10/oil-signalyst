import { useChart } from '@/hooks/useChart';
import { useMarketSeries } from '@/hooks/useMarketSeries';
import { baseOptions, GRID_COLOR, MUTED, sparseLabels } from './chart-base';

interface InventoryPoint {
  date: string;
  value: number;
  avg: number;
  upper: number;
  lower: number;
}

export default function InventoryChart() {
  const { data } = useMarketSeries<InventoryPoint[]>('inventory');
  const points = data ?? [];
  const values = points.map((p) => p.value);
  const allBounds = points.flatMap((p) => [p.upper, p.lower, p.value]);
  const min = allBounds.length ? Math.floor(Math.min(...allBounds) / 5) * 5 - 10 : 390;
  const max = allBounds.length ? Math.ceil(Math.max(...allBounds) / 5) * 5 + 10 : 465;

  const canvasRef = useChart(
    () => ({
      type: 'line',
      data: {
        labels: sparseLabels(points.map((p) => p.date)),
        datasets: [
          {
            data: points.map((p) => p.upper),
            borderColor: 'transparent',
            backgroundColor: 'rgba(136,135,128,0.12)',
            fill: '+1',
            pointRadius: 0,
          },
          {
            data: points.map((p) => p.lower),
            borderColor: 'transparent',
            backgroundColor: 'transparent',
            fill: false,
            pointRadius: 0,
          },
          {
            data: points.map((p) => p.avg),
            borderColor: 'rgba(136,135,128,0.5)',
            borderWidth: 1,
            borderDash: [4, 3],
            fill: false,
            pointRadius: 0,
          },
          {
            data: values,
            borderColor: '#A32D2D',
            borderWidth: 2,
            backgroundColor: 'rgba(163,45,45,0.07)',
            fill: false,
            pointRadius: 0,
            tension: 0.3,
          },
        ],
      },
      options: {
        ...baseOptions,
        scales: {
          x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 }, maxRotation: 0 } },
          y: {
            min,
            max,
            grid: { color: GRID_COLOR },
            ticks: { color: MUTED, font: { size: 10 }, callback: (v) => `${v}M` },
          },
        },
      },
    }),
    [data]
  );

  return (
    <div style={{ position: 'relative', height: 160 }}>
      <canvas ref={canvasRef} role="img" aria-label="US crude inventory vs 5 year average" />
    </div>
  );
}
