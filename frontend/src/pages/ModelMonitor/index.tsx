import { useRole } from '@/context/RoleContext';
import { useReport } from '@/hooks/useReport';
import { useModelStatus } from '@/hooks/useModelStatus';
import PageHeader from '@/components/shared/PageHeader';
import Card from '@/components/shared/Card';
import SHAPBar from '@/components/shared/SHAPBar';
import ScoreComparisonCard from './ScoreComparisonCard';
import NoDriversNotice from '@/components/shared/NoDriversNotice';
import { cn } from '@/lib/utils';
import { IconCircleCheck, IconAlertTriangle } from '@tabler/icons-react';
import { MODEL_KIND, MODEL_LABEL, fmt, isUnhealthy, metricText, recentText } from '@/lib/model-metrics';

export default function ModelMonitorPage() {
  const { role } = useRole();
  // The report (SHAP drivers, stress test) needs a daily prediction, but the
  // model cards / PSI / gate only need modelStatus - so a missing report (e.g.
  // right after a data reset, before the pipeline runs) shouldn't blank the
  // whole page. Only a status failure means there's genuinely nothing to show.
  const { data: report } = useReport(role);
  const { data: modelStatus, error: statusError } = useModelStatus();
  if (statusError)
    return (
      <div className="p-[18px] text-text-muted text-[12px]">
        Model status unavailable — {String(statusError)}
      </div>
    );
  if (!modelStatus) return <div className="p-[18px] text-text-muted text-[12px]">Loading...</div>;

  // EIA, not regime: EIA is the only deployed forecast model, so it is the only
  // one with feature attribution. This card read report.regime.shap_drivers,
  // which is empty because no regime model is deployed - so it showed nothing
  // while the EIA drivers sat computed and unused.
  const shapDrivers = report?.eia.shap_drivers ?? [];
  const maxShap = Math.max(...shapDrivers.map((d) => Math.abs(d.contribution_share)), 1e-9);

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
            {recentText(m) && (
              <div
                className="text-[10px] text-text-muted mt-[3px]"
                title="Diagnostic only - too few independent observations to gate on. The deployment gate uses the full test window."
              >
                {recentText(m)}
              </div>
            )}
            <div className="text-[10px] text-text-muted mt-[3px]">{MODEL_KIND[m.type]}</div>
          </div>
        ))}
      </div>

      <ScoreComparisonCard models={modelStatus.models} />

      {/* Read-only: what a freshly trained model must clear to auto-deploy.
          Rules come from the backend (deployment_gate_criteria) so the panel
          can't drift from the logic, and are deliberately not editable - the
          gate is a safety rail, and a specific model can still be promoted by
          hand through the training history if the operator means it. */}
      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[8px]">
          Deployment Gate
        </div>
        <div className="text-[11px] text-text-muted mb-[10px]">
          A newly trained model deploys automatically only if it clears all of these.
          A blocked model is still saved, and can be deployed by hand from the training history.
        </div>
        <div className="flex flex-col gap-[6px]">
          {modelStatus.deployment_gate.map((c) => (
            <div key={c.label} className="flex items-baseline gap-[8px] text-[12px]">
              <IconCircleCheck size={13} stroke={1.75} className="text-text-muted shrink-0 translate-y-[2px]" />
              <span className="text-text-secondary w-[130px] shrink-0">{c.label}</span>
              <span className="text-text-primary">{c.rule}</span>
            </div>
          ))}
        </div>
      </Card>

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
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
            Feature Importance (SHAP) — EIA Model
          </div>
          {shapDrivers.length > 0 ? (
            shapDrivers.map((d) => (
              <SHAPBar
                key={d.name}
                name={d.name}
                widthPct={(Math.abs(d.contribution_share) / maxShap) * 80}
                displayValue={`${(d.contribution_share * 100).toFixed(1)}%`}
                color="accent"
              />
            ))
          ) : (
            <div className="text-[11px] text-text-muted">
              {report ? (
                <NoDriversNotice status={report.eia.shap_status} />
              ) : (
                'No prediction yet — run the daily pipeline to populate feature importances.'
              )}
            </div>
          )}
        </Card>
      </div>

    </div>
  );
}
