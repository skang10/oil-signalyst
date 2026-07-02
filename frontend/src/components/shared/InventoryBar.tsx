export default function InventoryBar({ label, value, maxAbs }: { label: string; value: number; maxAbs: number }) {
  const positive = value >= 0;
  const widthPct = Math.min(100, (Math.abs(value) / maxAbs) * 100);

  return (
    <div className="flex items-center gap-[10px] text-[12px]">
      <span className="w-14 text-text-secondary">{label}</span>
      <div className="flex-1 h-[24px] bg-surface-1 rounded-[3px] overflow-hidden flex items-center">
        <div
          className="h-full flex items-center pl-[7px] text-[11px] font-medium"
          style={{
            width: `${widthPct}%`,
            background: positive ? 'var(--bg-success)' : 'var(--bg-danger)',
            borderLeft: `4px solid ${positive ? 'var(--border-success)' : 'var(--border-danger)'}`,
            color: positive ? 'var(--text-success)' : 'var(--text-danger)',
          }}
        >
          {positive ? '+' : ''}
          {value.toFixed(1)} MB
        </div>
      </div>
      <span
        className="font-medium w-11 text-right"
        style={{ color: positive ? 'var(--text-success)' : 'var(--text-danger)' }}
      >
        {positive ? '+' : ''}
        {value.toFixed(1)}
      </span>
    </div>
  );
}
