import { useRole } from '@/context/RoleContext';
import { useReport } from '@/hooks/useReport';
import { useModelStatus } from '@/hooks/useModelStatus';
import PageHeader from '@/components/shared/PageHeader';
import Card from '@/components/shared/Card';
import SHAPBar from '@/components/shared/SHAPBar';
import StressTestCard from '@/components/shared/StressTestCard';
import { cn } from '@/lib/utils';
import { IconCircleCheck, IconAlertTriangle } from '@tabler/icons-react';
import { MODEL_KIND, MODEL_LABEL, fmt, isUnhealthy, metricText } from '@/lib/model-metrics';

export default function ModelMonitorPage() {
  const { role } = useRole();
  const { data: report, error: reportError } = useReport(role);
  const { data: modelStatus, error: statusError } = useModelStatus();
  if (reportError || statusError)
    return (
      <div className="p-[18px] text-text-muted text-[12px]">
        No model data available yet — run the daily pipeline to produce a first prediction.
      </div>
    );
  if (!modelStatus || !report) return <div className="p-[18px] text-text-muted text-[12px]">Loading...</div>;

  const shapDrivers = report.regime.shap_drivers;
  const maxShap = Math.max(...shapDrivers.map((d) => Math.abs(d.contribution)), 1e-9);

  return (
    <div className="p-[18px] overflow-y-auto flex-1">
      <PageHeader title="Model Monitor" sub="PSI Drift · Score vs Baseline · Feature Importance" />

      <div className="grid grid-cols-3 gap-[10px] mb-3">
        {modelStatus.models.map((m) => (
          <div
            key={m.type}
            className={cn('p-[12px_14px] rounded-default border', isUnhealthy(m) ? 'bg-warning-bg border-warning-border' : 'bg-surface-1 border-border')}
          >
            <div className="text-[10px] text-text-muted uppercase tracking-[0.5px] mb-[5px]">{MODEL_LABEL[m.type]}</div>
            <div className="text-[13px] font-medium">{m.version}</div>
            <div className={cn('text-[11px] mt-[3px] flex items-center gap-1', isUnhealthy(m) ? 'text-warning' : 'text-success')}>
              {isUnhealthy(m) ? <IconAlertTriangle size={12} stroke={1.75} /> : <IconCircleCheck size={12} stroke={1.75} />}
              {metricText(m)}
            </div>
            <div className="text-[10px] text-text-muted mt-[3px]">{MODEL_KIND[m.type]}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-[10px] mb-3">
        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">PSI Drift Trend</div>
          <div className="flex flex-col gap-2">
            {modelStatus.models.map((m) => (
              <div key={m.type}>
                <div className="flex justify-between text-[11px] mb-[3px]">
                  <span className="text-text-secondary">{MODEL_LABEL[m.type].replace(' Model', '')}</span>
                  <span className={m.psi_alert ? 'text-warning' : 'text-success'}>
                    {fmt(m.metrics.psi, 2)}
                    {m.psi_alert ? ' ⚠' : ''}
                  </span>
                </div>
                <div className="h-[6px] bg-surface-1 rounded-[3px] overflow-hidden">
                  <div
                    className="h-full rounded-[3px]"
                    style={{ width: `${Math.min(100, (m.metrics.psi ?? 0) * 200)}%`, background: m.psi_alert ? '#BA7517' : '#3B6D11' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">Feature Importance (SHAP)</div>
          {shapDrivers.map((d) => (
            <SHAPBar
              key={d.name}
              name={d.name}
              widthPct={(Math.abs(d.contribution) / maxShap) * 80}
              displayValue={d.contribution.toFixed(2)}
              color="accent"
            />
          ))}
        </Card>
      </div>

      <StressTestCard title="Stress Test" />
    </div>
  );
}
