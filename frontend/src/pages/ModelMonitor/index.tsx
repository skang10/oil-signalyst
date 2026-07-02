import { useRole } from '@/context/RoleContext';
import { useReport } from '@/hooks/useReport';
import { useModelStatus } from '@/hooks/useModelStatus';
import PageHeader from '@/components/shared/PageHeader';
import Card from '@/components/shared/Card';
import TagBadge from '@/components/shared/TagBadge';
import SHAPBar from '@/components/shared/SHAPBar';
import { STRESS_SCENARIOS } from '@/lib/stress-scenarios';
import { cn } from '@/lib/utils';
import { IconCircleCheck, IconAlertTriangle } from '@tabler/icons-react';
import type { ModelStatus } from '@/types/api';

const MODEL_LABEL: Record<ModelStatus['models'][number]['type'], string> = {
  regime: 'Regime Model',
  eia: 'EIA Forecast Model',
  returns: 'Returns Model',
};

function metricText(m: ModelStatus['models'][number]): string {
  if (m.type === 'regime') return `Acc ${(m.metrics.primary * 100).toFixed(1)}% · PSI ${m.metrics.psi.toFixed(2)}`;
  if (m.type === 'eia') return `MAE ${m.metrics.primary.toFixed(1)} MB · PSI ${m.metrics.psi.toFixed(2)}`;
  return m.psi_alert ? `PSI ${m.metrics.psi.toFixed(2)} — Alerts` : `Brier ${m.metrics.primary.toFixed(3)} · PSI ${m.metrics.psi.toFixed(2)}`;
}

export default function ModelMonitorPage() {
  const { role } = useRole();
  const { data: report } = useReport(role);
  const { data: modelStatus } = useModelStatus();
  if (!modelStatus || !report) return <div className="p-[18px] text-text-muted text-[12px]">Loading...</div>;

  const shapDrivers = report.regime.shap_drivers;
  const maxShap = Math.max(...shapDrivers.map((d) => Math.abs(d.contribution)));

  return (
    <div className="p-[18px] overflow-y-auto flex-1">
      <PageHeader title="Model Monitor" sub="PSI Drift · Brier Score · Feature Importance" />

      <div className="grid grid-cols-3 gap-[10px] mb-3">
        {modelStatus.models.map((m) => (
          <div
            key={m.type}
            className={cn('p-[12px_14px] rounded-default border', m.psi_alert ? 'bg-warning-bg border-warning-border' : 'bg-surface-1 border-border')}
          >
            <div className="text-[10px] text-text-muted uppercase tracking-[0.5px] mb-[5px]">{MODEL_LABEL[m.type]}</div>
            <div className="text-[13px] font-medium">{m.version}</div>
            <div className={cn('text-[11px] mt-[3px] flex items-center gap-1', m.psi_alert ? 'text-warning' : 'text-success')}>
              {m.psi_alert ? <IconAlertTriangle size={12} stroke={1.75} /> : <IconCircleCheck size={12} stroke={1.75} />}
              {metricText(m)}
            </div>
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
                    {m.metrics.psi.toFixed(2)}
                    {m.psi_alert ? ' ⚠' : ''}
                  </span>
                </div>
                <div className="h-[6px] bg-surface-1 rounded-[3px] overflow-hidden">
                  <div
                    className="h-full rounded-[3px]"
                    style={{ width: `${Math.min(100, m.metrics.psi * 200)}%`, background: m.psi_alert ? '#BA7517' : '#3B6D11' }}
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

      <Card>
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">Stress Test</div>
        {STRESS_SCENARIOS.map((s) => (
          <div key={s.label} className="flex items-center gap-[10px] p-[8px_10px] bg-surface-1 rounded-default text-[12px] mb-[6px] last:mb-0">
            <span className="flex-1 text-text-secondary">{s.label}</span>
            <span className={`font-medium ${s.pct < 0 ? 'text-danger' : 'text-success'}`}>
              {s.pct > 0 ? '+' : ''}
              {Math.round(s.pct * 100)}%
            </span>
            <TagBadge kind="green">Alerted ✓</TagBadge>
          </div>
        ))}
      </Card>
    </div>
  );
}
