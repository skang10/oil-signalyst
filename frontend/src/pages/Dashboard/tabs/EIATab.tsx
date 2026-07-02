import { useRole } from '@/context/RoleContext';
import { useReport } from '@/hooks/useReport';
import Card from '@/components/shared/Card';
import TagBadge from '@/components/shared/TagBadge';
import SHAPBar from '@/components/shared/SHAPBar';
import InventoryBar from '@/components/shared/InventoryBar';
import { IconBolt } from '@tabler/icons-react';

export default function EIATab() {
  const { role } = useRole();
  const { data: report } = useReport(role);
  if (!report) return <div className="text-text-muted text-[12px]">Loading...</div>;

  const eia = report.eia;
  const breakdown = [
    { label: 'Crude', value: eia.breakdown.crude },
    { label: 'Gasoline', value: eia.breakdown.gasoline },
    { label: 'Distillate', value: eia.breakdown.distillate },
    { label: 'Cushing', value: eia.breakdown.cushing },
  ];
  const maxAbs = Math.max(...breakdown.map((b) => Math.abs(b.value)));
  const maxShap = Math.max(...eia.shap_drivers.map((d) => Math.abs(d.contribution_mb)));
  const modelEdge = ((eia.historical_mae - eia.consensus_mae) / eia.consensus_mae) * 100;

  return (
    <>
      <div className="mb-[14px]">
        <div className="text-[15px] font-medium">EIA Weekly Inventory Forecast</div>
        <div className="text-[12px] text-text-muted mt-[2px]">
          Generated: {report.date} 18:30 UTC · Release: next-day 14:30 ET
        </div>
      </div>

      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">Core Forecast</div>
        <div className="flex items-baseline gap-3 mb-[10px]">
          <span className="text-[32px] font-medium text-danger">{eia.forecast_mb.toFixed(1)}</span>
          <span className="text-[14px] text-text-muted">million barrels ({eia.forecast_mb < 0 ? 'drawdown' : 'build'})</span>
          <TagBadge kind="red">{eia.forecast_mb < 0 ? 'Drawdown' : 'Build'}</TagBadge>
        </div>
        <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
          <span className="text-text-secondary">80% Confidence Interval</span>
          <span className="font-medium font-mono">
            {eia.interval_80_low.toFixed(1)} MB ~ {eia.interval_80_high.toFixed(1)} MB
          </span>
        </div>
        <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
          <span className="text-text-secondary">Market Consensus (Bloomberg survey)</span>
          <span className="font-medium font-mono">{eia.consensus_mb.toFixed(1)} MB</span>
        </div>
        <div className="flex justify-between items-center py-[7px] text-[12px]">
          <span className="text-text-secondary">Model vs Consensus</span>
          <span className="font-medium font-mono text-danger">
            More bearish {eia.surprise_mb.toFixed(1)} MB (larger-than-expected draw)
          </span>
        </div>
        <div className="mt-[10px] p-[8px_10px] bg-warning-bg rounded-default text-[12px] text-warning flex items-center gap-1">
          <IconBolt size={13} stroke={1.75} />
          If confirmed, expect oil price +1.5%~+2.8% short-term
        </div>
      </Card>

      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-3">
          Component Inventory Forecast (million barrels)
        </div>
        <div className="flex flex-col gap-2">
          {breakdown.map((b) => (
            <InventoryBar key={b.label} label={b.label} value={b.value} maxAbs={maxAbs} />
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-[10px]">
        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">Key Drivers (SHAP)</div>
          {eia.shap_drivers.map((d) => (
            <SHAPBar
              key={d.name}
              name={d.name}
              widthPct={(Math.abs(d.contribution_mb) / maxShap) * 65}
              displayValue={`${d.contribution_mb > 0 ? '+' : ''}${d.contribution_mb.toFixed(1)}`}
              color={d.contribution_mb < 0 ? 'danger' : 'success'}
              valueColor={d.contribution_mb < 0 ? 'danger' : 'success'}
            />
          ))}
        </Card>

        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
            Model Historical Performance (Last 52 Weeks)
          </div>
          <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
            <span className="text-text-secondary">Directional Accuracy (draw/build)</span>
            <span className="font-medium text-success">{(eia.historical_direction_accuracy * 100).toFixed(1)}%</span>
          </div>
          <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
            <span className="text-text-secondary">MAE (Mean Absolute Error)</span>
            <span className="font-medium">{eia.historical_mae.toFixed(1)} MB</span>
          </div>
          <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
            <span className="text-text-secondary">vs Consensus MAE</span>
            <span className="font-medium">{eia.consensus_mae.toFixed(1)} MB</span>
          </div>
          <div className="flex justify-between items-center py-[7px] text-[12px]">
            <span className="text-text-secondary">Model Edge</span>
            <span className="font-medium text-success">{modelEdge.toFixed(1)}%</span>
          </div>
          <div className="mt-2 text-[11px] text-text-muted">Most accurate for draws &gt;2 MB — matches current scenario</div>
        </Card>
      </div>
    </>
  );
}
