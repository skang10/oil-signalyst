import { useChart } from '@/hooks/useChart';
import { wtiData, wtiLabels } from '@/lib/mock-market-data';
import { baseOptions, GRID_COLOR, MUTED } from './chart-base';

export default function WTIPriceChart() {
  const canvasRef = useChart(() => ({
    type: 'line',
    data: {
      labels: wtiLabels,
      datasets: [
        {
          data: wtiData,
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
          min: 68,
          max: 93,
          grid: { color: GRID_COLOR },
          ticks: { color: MUTED, font: { size: 10 }, callback: (v) => `$${v}` },
        },
      },
    },
  }));

  return (
    <div style={{ position: 'relative', height: 160 }}>
      <canvas ref={canvasRef} role="img" aria-label="WTI oil price over 18 months" />
    </div>
  );
}
