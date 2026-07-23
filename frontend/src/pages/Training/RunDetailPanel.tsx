import { Fragment, useState } from 'react';
import LogMono from '@/components/shared/LogMono';
import { useDeployModel, useTrainJobDetail } from '@/hooks/useTraining';
import { cn } from '@/lib/utils';
import { METRIC_LABEL } from './ModelCompareCard';
import CrossValidateCard from './CrossValidateCard';
import type { TrainJobSummary } from '@/types/api';

// Keys are `${model_type}_${metric}` (see backend trainer's result payload).
// The one trained metric today (eia_mae) improves downward; the
// _accuracy branch is kept so a higher-is-better metric added later is not
// silently coloured backwards.
function isImprovement(key: string, oldValue: number, newValue: number): boolean {
  return key.endsWith('_accuracy') || key.endsWith('_direction_acc')
    ? newValue > oldValue
    : newValue < oldValue;
}

function changeText(oldValue: number | null, newValue: number | null): string {
  if (oldValue == null || newValue == null || oldValue === 0) return '—';
  const pct = ((newValue - oldValue) / Math.abs(oldValue)) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

/**
 * Expanded view of one history row: persisted log + old-vs-new metric table,
 * fetched on demand via GET /api/train/status/{id}?include_log=true.
 *
 * "Redeploy" (not "Deploy") because training auto-activates its models on
 * completion (trainer.py::_save_model) - by the time a run is superseded,
 * promoting it back is a rollback, and do_deploy is built for exactly that.
 */
export default function RunDetailPanel({ job }: { job: TrainJobSummary }) {
  const { data: detail } = useTrainJobDetail(job.job_id);
  const deploy = useDeployModel();
  const [redeployed, setRedeployed] = useState(false);

  const result = detail?.result;
  const oldMetrics = result?.old_metrics;
  const newMetrics = result?.new_metrics;
  const baselines = result?.baselines;
  // Keyed off new_metrics alone: a first-ever training of a model type has no
  // old_metrics entry, and requiring both hid the run's results entirely.
  const compareKeys = newMetrics ? Object.keys(newMetrics) : [];
  const logLines = detail?.log_lines ?? job.log_tail;
  const canRedeploy =
    job.status === 'complete' && job.deploy_state !== 'live' && !!result?.versions;

  async function handleRedeploy() {
    for (const type of Object.keys(result?.versions ?? {})) {
      await deploy.mutateAsync({ type, jobId: job.job_id });
    }
    setRedeployed(true);
  }

  // A cross-validation run carries a per-fold `models` map, not the train/deploy
  // old/new metrics - render its distribution rather than an empty compare grid.
  const isCv = Boolean(result?.models);

  return (
    <div className="bg-surface-0 border-t border-border p-[12px_14px]">
      {isCv && detail && <CrossValidateCard job={detail} />}

      <div className={cn('grid gap-3', compareKeys.length > 0 && 'grid-cols-2')}>
        {compareKeys.length > 0 && (
          <div>
            <div className="text-[10.5px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[6px]">
              Old vs New Comparison
            </div>
            <div className="grid grid-cols-5 border border-border rounded-default overflow-hidden text-[11.5px] bg-surface-2">
              <div className="p-[5px_9px] bg-surface-1 text-[10px] font-medium text-text-muted uppercase tracking-[0.4px]">Model</div>
              <div className="p-[5px_9px] bg-surface-1 text-[10px] font-medium text-text-muted uppercase tracking-[0.4px] text-right">Old</div>
              <div className="p-[5px_9px] bg-surface-1 text-[10px] font-medium text-text-muted uppercase tracking-[0.4px] text-right">New</div>
              <div className="p-[5px_9px] bg-surface-1 text-[10px] font-medium text-text-muted uppercase tracking-[0.4px] text-right">Baseline</div>
              <div className="p-[5px_9px] bg-surface-1 text-[10px] font-medium text-text-muted uppercase tracking-[0.4px] text-right">Change</div>
              {compareKeys.map((key) => {
                const oldValue = oldMetrics?.[key] ?? null;
                const newValue = newMetrics![key];
                const baseline = baselines?.[key] ?? null;
                const improved =
                  oldValue != null && newValue != null && isImprovement(key, oldValue, newValue);
                return (
                  <Fragment key={key}>
                    <div className="p-[5px_9px] border-t border-border text-text-secondary">{METRIC_LABEL[key] ?? key}</div>
                    <div className="p-[5px_9px] border-t border-border text-right text-text-muted tabular-nums">
                      {oldValue == null ? '—' : oldValue.toFixed(3)}
                    </div>
                    <div className="p-[5px_9px] border-t border-border text-right font-medium tabular-nums">
                      {newValue == null ? '—' : newValue.toFixed(3)}
                    </div>
                    <div className="p-[5px_9px] border-t border-border text-right text-text-muted tabular-nums">
                      {baseline == null ? '—' : baseline.toFixed(3)}
                    </div>
                    <div className={cn('p-[5px_9px] border-t border-border text-right tabular-nums', improved ? 'text-success' : 'text-danger')}>
                      {oldValue == null && newValue != null ? 'first run' : changeText(oldValue, newValue)}
                    </div>
                  </Fragment>
                );
              })}
            </div>
            {job.blocked_reasons?.length > 0 && (
              <div className="text-[10.5px] text-warning mt-[6px]">
                Blocked from deploying — {job.blocked_reasons.join(' | ')}
              </div>
            )}
          </div>
        )}
        <div>
          <div className="text-[10.5px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[6px]">
            Persisted Log
          </div>
          {logLines.length > 0 ? (
            <LogMono lines={logLines.map((l) => ({ content: l }))} />
          ) : (
            <div className="font-mono text-[11px] text-text-muted bg-surface-1 rounded-default p-[10px_12px]">
              // No log recorded for this run
            </div>
          )}
        </div>
      </div>

      {job.error && (
        <div className="mt-2 text-[11.5px] text-danger">Error: {job.error}</div>
      )}

      <div className="flex items-center gap-2 mt-3">
        {canRedeploy && (
          <>
            <button
              type="button"
              disabled={redeployed || deploy.isPending}
              onClick={handleRedeploy}
              className="px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-accent-fill text-on-accent border border-accent-fill disabled:opacity-50"
            >
              {redeployed ? 'Redeployed ✓' : deploy.isPending ? 'Redeploying...' : 'Redeploy This Run'}
            </button>
            <span className="text-[11px] text-text-muted">
              Rolls the active model{Object.keys(result?.versions ?? {}).length > 1 ? 's' : ''} back to this run's version
              {Object.keys(result?.versions ?? {}).length > 1 ? 's' : ''}
            </span>
          </>
        )}
        {job.deploy_state === 'live' && (
          <span className="text-[11.5px] text-success font-medium">
            ● This run's model{job.model_types.length > 1 ? 's are' : ' is'} currently live
          </span>
        )}
      </div>
    </div>
  );
}
