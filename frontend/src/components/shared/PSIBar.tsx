interface PSIBarProps {
  label: string;
  value: number;
  stableMax?: number;
  warnMax?: number;
}

export default function PSIBar({ label, value, stableMax = 0.1, warnMax = 0.2 }: PSIBarProps) {
  const color = value < stableMax ? '#3B6D11' : value < warnMax ? '#BA7517' : 'var(--text-danger)';
  const textColor = value < stableMax ? 'text-success' : value < warnMax ? 'text-warning' : 'text-danger';
  const widthPct = Math.min(100, (value / (warnMax * 2)) * 100);

  return (
    <div>
      <div className="flex justify-between text-[11px] mb-[3px]">
        <span className="text-text-secondary">{label}</span>
        <span className={textColor}>
          {value.toFixed(2)}
          {value >= warnMax ? ' ⚠' : ''}
        </span>
      </div>
      <div className="h-[6px] bg-surface-1 rounded-[3px] overflow-hidden">
        <div className="h-full rounded-[3px]" style={{ width: `${widthPct}%`, background: color }} />
      </div>
    </div>
  );
}
