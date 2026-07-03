import { useChart } from '@/hooks/useChart';
import { useMarketSeries } from '@/hooks/useMarketSeries';
import { baseOptions, GRID_COLOR, MUTED, sparseLabels } from './chart-base';

interface OvxVixPoint {
  date: string;
  ovx: number;
  vix: number;
}

function niceRange(values: number[], fallback: [number, number]): [number, number] {
  if (!values.length) return fallback;
  return [Math.floor(Math.min(...values) / 2) * 2 - 2, Math.ceil(Math.max(...values) / 2) * 2 + 2];
}

export default function VolatilityChart() {
  const { data } = useMarketSeries<OvxVixPoint[]>('ovx_vix');
  const points = data ?? [];
  const ovxData = points.map((p) => p.ovx);
  const vixData = points.map((p) => p.vix);
  const [ovxMin, ovxMax] = niceRange(ovxData, [20, 42]);
  const [vixMin, vixMax] = niceRange(vixData, [12, 28]);

  const canvasRef = useChart(
    () => ({
      type: 'line',
      data: {
        labels: sparseLabels(points.map((p) => p.date)),
        datasets: [
          {
            label: 'OVX',
            data: ovxData,
            borderColor: '#378ADD',
            borderWidth: 2,
            pointRadius: 0,
            backgroundColor: 'rgba(55,138,221,0.06)',
            fill: true,
            tension: 0.3,
            yAxisID: 'y',
          },
          {
            label: 'VIX',
            data: vixData,
            borderColor: '#BA7517',
            borderWidth: 1.5,
            borderDash: [4, 3],
            pointRadius: 0,
            fill: false,
            tension: 0.3,
            yAxisID: 'y2',
          },
        ],
      },
      options: {
        ...baseOptions,
        plugins: { legend: { display: true, position: 'bottom', labels: { color: MUTED, font: { size: 10 }, boxWidth: 12, padding: 8 } } },
        scales: {
          x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 }, maxRotation: 0 } },
          y: {
            type: 'linear',
            min: ovxMin,
            max: ovxMax,
            position: 'left',
            grid: { color: GRID_COLOR },
            ticks: { color: '#378ADD', font: { size: 10 } },
            title: { display: true, text: 'OVX', color: '#378ADD', font: { size: 9 } },
          },
          y2: {
            type: 'linear',
            min: vixMin,
            max: vixMax,
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#BA7517', font: { size: 10 } },
            title: { display: true, text: 'VIX', color: '#BA7517', font: { size: 9 } },
          },
        },
      },
    }),
    [data]
  );

  return (
    <div style={{ position: 'relative', height: 160 }}>
      <canvas ref={canvasRef} role="img" aria-label="OVX and VIX volatility indices" />
    </div>
  );
}
