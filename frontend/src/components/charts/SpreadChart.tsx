import { useChart } from '@/hooks/useChart';
import { useMarketSeries } from '@/hooks/useMarketSeries';
import { baseOptions, GRID_COLOR, MUTED, dateAxisX } from './chart-base';

interface SpreadPoint {
  date: string;
  spread: number;
}

export default function SpreadChart() {
  const { data } = useMarketSeries<SpreadPoint[]>('brent_spread');
  const points = data ?? [];
  const spreads = points.map((p) => p.spread);
  const mean = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 0;
  const min = spreads.length ? Math.floor(Math.min(...spreads) * 10) / 10 - 0.3 : 1.2;
  const max = spreads.length ? Math.ceil(Math.max(...spreads) * 10) / 10 + 0.3 : 4.2;

  const canvasRef = useChart(
    () => ({
      type: 'line',
      data: {
        labels: points.map((p) => p.date),
        datasets: [
          {
            data: spreads,
            borderColor: '#185FA5',
            borderWidth: 2,
            pointRadius: 0,
            backgroundColor: 'rgba(24,95,165,0.08)',
            fill: true,
            tension: 0.3,
          },
          {
            data: spreads.map(() => mean),
            borderColor: 'rgba(136,135,128,0.5)',
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
          x: dateAxisX(),
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
      <canvas ref={canvasRef} role="img" aria-label="Brent-WTI spread" />
    </div>
  );
}
