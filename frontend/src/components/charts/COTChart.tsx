import { useChart } from '@/hooks/useChart';
import { cotData, cotLabels } from '@/lib/mock-market-data';
import { baseOptions, GRID_COLOR, MUTED } from './chart-base';

export default function COTChart() {
  const canvasRef = useChart(() => ({
    type: 'bar',
    data: {
      labels: cotLabels,
      datasets: [
        {
          data: cotData,
          backgroundColor: cotData.map((v) => (v >= 0 ? 'rgba(55,138,221,0.55)' : 'rgba(163,45,45,0.55)')),
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
  }));

  return (
    <div style={{ position: 'relative', height: 160 }}>
      <canvas ref={canvasRef} role="img" aria-label="COT speculative net position" />
    </div>
  );
}
