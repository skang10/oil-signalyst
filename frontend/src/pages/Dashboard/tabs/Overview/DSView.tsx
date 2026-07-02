import { Link } from 'react-router-dom';
import { IconCircleCheck, IconAlertTriangle, IconRobot } from '@tabler/icons-react';
import { useModelStatus } from '@/hooks/useModelStatus';
import Card from '@/components/shared/Card';
import TagBadge from '@/components/shared/TagBadge';
import LogMono from '@/components/shared/LogMono';
import { cn } from '@/lib/utils';
import type { ModelStatus } from '@/types/api';

const MODEL_LABEL: Record<ModelStatus['models'][number]['type'], string> = {
  regime: 'Regime Model',
  eia: 'EIA Forecast Model',
  returns: 'Returns Model',
};

function metricText(m: ModelStatus['models'][number]): string {
  if (m.psi_alert) return `PSI ${m.metrics.psi.toFixed(2)} — Alerts`;
  if (m.type === 'regime') return `Acc ${(m.metrics.primary * 100).toFixed(1)}% · PSI ${m.metrics.psi.toFixed(2)}`;
  if (m.type === 'eia') return `MAE ${m.metrics.primary.toFixed(1)} MB · PSI ${m.metrics.psi.toFixed(2)}`;
  return `Brier ${m.metrics.primary.toFixed(3)} · PSI ${m.metrics.psi.toFixed(2)}`;
}

export default function DSView() {
  const { data: modelStatus } = useModelStatus();
  if (!modelStatus) return null;

  return (
    <>
      <div className="grid grid-cols-3 gap-[10px] mb-3">
        {modelStatus.models.map((m) => (
          <div
            key={m.type}
            className={cn(
              'p-[12px_14px] rounded-default border',
              m.psi_alert ? 'bg-warning-bg border-warning-border' : 'bg-surface-1 border-border'
            )}
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

      <Card className="mb-3" style={{ border: '0.5px solid var(--border-accent)' }}>
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">DS Agent</div>
        <div className="bg-surface-1 rounded-default p-[10px_12px] mb-[10px]">
          <div className="flex gap-2 items-start">
            <div className="w-6 h-6 rounded-full bg-pro-bg border border-accent-border flex items-center justify-center shrink-0">
              <IconRobot size={13} stroke={1.75} className="text-pro" />
            </div>
            <div className="bg-surface-1 border border-border rounded-[3px_10px_10px_10px] p-[9px_12px] text-[12px] leading-[1.75] text-text-secondary flex-1">
              Returns model PSI 0.22 exceeds threshold. 2 new signal candidates found (IC 0.31 / 0.28). Evaluate signals before
              scheduling retraining?
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            to="/model-monitor"
            className="px-[14px] py-[6px] text-[12px] border border-accent-fill bg-accent-fill text-on-accent rounded-default cursor-pointer no-underline"
          >
            Model Monitor ↗
          </Link>
          <Link
            to="/training"
            className="px-[14px] py-[6px] text-[12px] border border-border-strong bg-surface-2 text-text-primary rounded-default cursor-pointer no-underline hover:bg-surface-1"
          >
            Training Control ↗
          </Link>
        </div>
      </Card>

      <Card>
        <div className="flex justify-between items-center mb-[10px]">
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium">Last Training Run</div>
          <TagBadge kind="green">Success</TagBadge>
        </div>
        <LogMono
          lines={[
            { time: '00:00', content: 'Loading feature matrix... 14 features × 3,456 samples' },
            { time: '00:01', content: <>Data leakage check... <span className="text-success">Passed ✓</span></> },
            {
              time: '00:13',
              content: (
                <>
                  OOS Brier: <span className="text-success">0.211 ✓</span> · MLflow:{' '}
                  <span className="text-accent-text">a3f2c8d1</span>
                </>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
