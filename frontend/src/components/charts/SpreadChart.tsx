import { useChart } from '@/hooks/useChart';
import { spreadData, wtiLabels } from '@/lib/mock-market-data';
import { baseOptions, GRID_COLOR, MUTED } from './chart-base';

export default function SpreadChart() {
  const canvasRef = useChart(() => ({
    type: 'line',
    data: {
      labels: wtiLabels,
      datasets: [
        {
          data: spreadData,
          borderColor: '#185FA5',
          borderWidth: 2,
          pointRadius: 0,
          backgroundColor: 'rgba(24,95,165,0.08)',
          fill: true,
          tension: 0.3,
        },
        {
          data: spreadData.map(() => 2.6),
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
        x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: { size: 10 }, maxRotation: 0 } },
        y: {
          min: 1.2,
          max: 4.2,
          grid: { color: GRID_COLOR },
          ticks: { color: MUTED, font: { size: 10 }, callback: (v) => `$${v}` },
        },
      },
    },
  }));

  return (
    <div style={{ position: 'relative', height: 160 }}>
      <canvas ref={canvasRef} role="img" aria-label="Brent-WTI spread" />
    </div>
  );
}
