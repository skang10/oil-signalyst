import { useChart } from '@/hooks/useChart';
import { invData, wtiLabels } from '@/lib/mock-market-data';
import { baseOptions, GRID_COLOR, MUTED } from './chart-base';

export default function InventoryChart() {
  const canvasRef = useChart(() => {
    const upperBand = invData.map(() => 436);
    const lowerBand = invData.map(() => 400);
    const avgLine = invData.map(() => 418);

    return {
      type: 'line',
      data: {
        labels: wtiLabels,
        datasets: [
          { data: upperBand, borderColor: 'transparent', backgroundColor: 'rgba(136,135,128,0.12)', fill: '+1', pointRadius: 0 },
          { data: lowerBand, borderColor: 'transparent', backgroundColor: 'transparent', fill: false, pointRadius: 0 },
          { data: avgLine, borderColor: 'rgba(136,135,128,0.5)', borderWidth: 1, borderDash: [4, 3], fill: false, pointRadius: 0 },
          {
            data: invData,
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
            min: 390,
            max: 465,
            grid: { color: GRID_COLOR },
            ticks: { color: MUTED, font: { size: 10 }, callback: (v) => `${v}M` },
          },
        },
      },
    };
  });

  return (
    <div style={{ position: 'relative', height: 160 }}>
      <canvas ref={canvasRef} role="img" aria-label="US crude inventory vs 5 year average" />
    </div>
  );
}
