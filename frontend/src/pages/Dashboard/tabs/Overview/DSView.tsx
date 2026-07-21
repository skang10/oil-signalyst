import { Link } from 'react-router-dom';
import { IconCircleCheck, IconAlertTriangle, IconRobot } from '@tabler/icons-react';
import { useModelStatus } from '@/hooks/useModelStatus';
import { useTrainJobs } from '@/hooks/useTraining';
import Card from '@/components/shared/Card';
import LogMono from '@/components/shared/LogMono';
import { TriggerBadge, TrainStatusBadge } from '@/components/shared/TrainBadges';
import { cn } from '@/lib/utils';
import { MODEL_KIND, MODEL_LABEL, isUnhealthy, metricText } from '@/lib/model-metrics';

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
              isUnhealthy(m) ? 'bg-warning-bg border-warning-border' : 'bg-surface-1 border-border'
            )}
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

      <LastTrainingRunCard />
    </>
  );
}

/** Latest real train_jobs row (was hardcoded mock log lines before the
 * history feature landed). */
function LastTrainingRunCard() {
  const { data } = useTrainJobs(1);
  const last = data?.jobs[0];

  return (
    <Card>
      <div className="flex justify-between items-center mb-[10px] gap-2">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium">Last Training Run</div>
        {last && (
          <div className="flex items-center gap-[6px]">
            <span className="font-mono text-[11px] text-text-secondary">{last.job_id}</span>
            <TriggerBadge source={last.trigger_source} name={last.triggered_by_name} />
            <TrainStatusBadge status={last.status} />
          </div>
        )}
      </div>
      {!last ? (
        <div className="font-mono text-[11px] text-text-muted bg-surface-1 rounded-default p-[10px_12px]">
          // No training runs yet
        </div>
      ) : (
        <>
          <LogMono lines={last.log_tail.map((l) => ({ content: l }))} />
          <div className="flex items-center gap-2 mt-[8px] text-[11.5px]">
            {last.summary && (
              <span className={cn('font-medium', last.summary.improved > 0 ? 'text-success' : 'text-danger')}>
                {last.summary.improved > 0 ? '▲' : '▼'} {last.summary.improved}/{last.summary.of} metrics improved
              </span>
            )}
            {last.deploy_state === 'live' && <span className="text-success">● Live</span>}
            <Link to="/training" className="ml-auto text-accent-text no-underline text-[11px] font-medium">
              Training Control →
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}
