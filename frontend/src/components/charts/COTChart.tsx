import { useChart } from '@/hooks/useChart';
import { useMarketSeries } from '@/hooks/useMarketSeries';
import { baseOptions, GRID_COLOR, MUTED, sparseLabels } from './chart-base';

interface CotPoint {
  date: string;
  net_k: number;
}

export default function COTChart() {
  const { data } = useMarketSeries<CotPoint[]>('cot_net');
  const points = data ?? [];
  const netData = points.map((p) => p.net_k);

  const canvasRef = useChart(
    () => ({
      type: 'bar',
      data: {
        labels: sparseLabels(points.map((p) => p.date)),
        datasets: [
          {
            data: netData,
            backgroundColor: netData.map((v) => (v >= 0 ? 'rgba(55,138,221,0.55)' : 'rgba(163,45,45,0.55)')),
            borderWidth: 0,
            borderRadius: 2,
          },
        ],
      },
      options: {
        ...baseOptions,
        scales: {
          x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 }, maxRotation: 0 } },
          y: {
            grid: { color: GRID_COLOR },
            ticks: { color: MUTED, font: { size: 10 }, callback: (v) => `${v}k` },
          },
        },
      },
    }),
    [data]
  );

  return (
    <div style={{ position: 'relative', height: 160 }}>
      <canvas ref={canvasRef} role="img" aria-label="COT speculative net position" />
    </div>
  );
}
