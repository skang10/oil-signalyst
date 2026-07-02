import { useChart } from '@/hooks/useChart';
import { ovxData, vixData, wtiLabels } from '@/lib/mock-market-data';
import { baseOptions, GRID_COLOR, MUTED } from './chart-base';

export default function VolatilityChart() {
  const canvasRef = useChart(() => ({
    type: 'line',
    data: {
      labels: wtiLabels,
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
          min: 20,
          max: 42,
          position: 'left',
          grid: { color: GRID_COLOR },
          ticks: { color: '#378ADD', font: { size: 10 } },
          title: { display: true, text: 'OVX', color: '#378ADD', font: { size: 9 } },
        },
        y2: {
          type: 'linear',
          min: 12,
          max: 28,
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#BA7517', font: { size: 10 } },
          title: { display: true, text: 'VIX', color: '#BA7517', font: { size: 9 } },
        },
      },
    },
  }));

  return (
    <div style={{ position: 'relative', height: 160 }}>
      <canvas ref={canvasRef} role="img" aria-label="OVX and VIX volatility indices" />
    </div>
  );
}
