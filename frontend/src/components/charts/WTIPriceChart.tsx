import { useChart } from '@/hooks/useChart';
import { useMarketSeries } from '@/hooks/useMarketSeries';
import { baseOptions, GRID_COLOR, MUTED, sparseLabels } from './chart-base';

interface WtiPricePoint {
  date: string;
  price: number;
}

export default function WTIPriceChart() {
  const { data } = useMarketSeries<WtiPricePoint[]>('wti_price');
  const points = data ?? [];
  const prices = points.map((p) => p.price);
  const min = prices.length ? Math.floor(Math.min(...prices) / 5) * 5 : 60;
  const max = prices.length ? Math.ceil(Math.max(...prices) / 5) * 5 : 90;

  const canvasRef = useChart(
    () => ({
      type: 'line',
      data: {
        labels: sparseLabels(points.map((p) => p.date)),
        datasets: [
          {
            data: prices,
            borderColor: '#378ADD',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            backgroundColor: 'rgba(55,138,221,0.08)',
            fill: true,
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
            ticks: { color: MUTED, font: { size: 10 }, callback: (v) => `$${v}` },
          },
        },
      },
    }),
    [data]
  );

  return (
    <div style={{ position: 'relative', height: 160 }}>
      <canvas ref={canvasRef} role="img" aria-label="WTI oil price over 18 months" />
    </div>
  );
}
