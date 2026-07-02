import { useEffect, useRef } from 'react';
import { Chart, type ChartConfiguration } from 'chart.js';

export function useChart(buildConfig: () => ChartConfiguration) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const chart = new Chart(canvasRef.current, buildConfig());
    return () => chart.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return canvasRef;
}
