import { Fragment, useState } from 'react';
import Card from '@/components/shared/Card';
import { useDeployModel } from '@/hooks/useTraining';
import type { TrainJob } from '@/types/api';

export const METRIC_LABEL: Record<string, string> = {
  eia_mae: 'EIA MAE',
};

// old_metrics values are null on the first-ever training of a model type
// (no prior active version) -
// see types/api.ts's TrainJob.result.
function fmtMetric(value: number | null | undefined, digits: number): string {
  return value == null ? '—' : value.toFixed(digits);
}

export default function ModelCompareCard({ job }: { job: TrainJob }) {
  const [deployed, setDeployed] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const deploy = useDeployModel();

  const { old_metrics, new_metrics, baselines, improvement_pct, blocked_reasons } =
    job.result ?? {};

  // Previously this returned null outright, which silently removed the whole
  // card - Deploy button included - with no explanation.
  if (!new_metrics) {
    return (
      <Card>
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">Old vs New Model Comparison</div>
        <div className="text-[12px] text-text-muted">
          This run recorded no metrics, so there is nothing to compare.
        </div>
      </Card>
    );
  }

  // Driven by new_metrics: a model type trained for the first time has no
  // old_metrics entry, and keying off old_metrics would hide it entirely.
  const keys = Object.keys(new_metrics);
  const isBlocked = (type: string) => Boolean(blocked_reasons?.[type]?.length);
  const deployableTypes = job.model_types;

  async function handleDeploy() {
    setDeployError(null);
    try {
      for (const type of deployableTypes) {
        await deploy.mutateAsync({ type, jobId: job.job_id });
      }
      setDeployed(true);
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Deploy failed.');
    }
  }

  const anyBlocked = deployableTypes.some(isBlocked);

  return (
    <Card>
      <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">Old vs New Model Comparison</div>
      <div className="grid grid-cols-5 border border-border rounded-default overflow-hidden text-[12px]">
        <div className="p-[8px_10px] bg-surface-1 text-[11px] font-medium text-text-muted">Model</div>
        <div className="p-[8px_10px] bg-surface-1 text-[11px] font-medium text-text-muted text-right">Old</div>
        <div className="p-[8px_10px] bg-surface-1 text-[11px] font-medium text-text-muted text-right">New</div>
        {/* What the metric has to beat before it means anything. */}
        <div className="p-[8px_10px] bg-surface-1 text-[11px] font-medium text-text-muted text-right">Baseline</div>
        <div className="p-[8px_10px] bg-surface-1 text-[11px] font-medium text-text-muted text-right">Change</div>
        {keys.map((key) => {
          const baseline = baselines?.[key];
          const value = new_metrics[key];
          // Every metric shown here (Brier, MAE) is lower-is-better.
          const beatsBaseline =
            value != null && baseline != null ? value < baseline : null;
          return (
            <Fragment key={key}>
              <div className="p-[8px_10px] border-t border-border text-text-secondary">{METRIC_LABEL[key] ?? key}</div>
              <div className="p-[8px_10px] border-t border-border text-right text-text-muted">{fmtMetric(old_metrics?.[key], 3)}</div>
              <div
                className={
                  'p-[8px_10px] border-t border-border text-right font-medium ' +
                  (beatsBaseline === false ? 'text-warning' : 'text-success')
                }
              >
                {fmtMetric(value, 3)}
              </div>
              <div className="p-[8px_10px] border-t border-border text-right text-text-muted">{fmtMetric(baseline, 3)}</div>
              <div className="p-[8px_10px] border-t border-border text-right text-text-muted">
                {improvement_pct == null ? '—' : `${improvement_pct.toFixed(1)}%`}
              </div>
            </Fragment>
          );
        })}
      </div>

      {anyBlocked && (
        <div className="text-[11px] text-warning mt-[10px]">
          Not deployed automatically —{' '}
          {Object.entries(blocked_reasons ?? {})
            .map(([type, reasons]) => `${type}: ${(reasons ?? []).join('; ')}`)
            .join(' | ')}
        </div>
      )}
      {deployError && <div className="text-[11px] text-danger mt-[6px]">{deployError}</div>}

      <div className="flex gap-2 mt-3">
        <button
          type="button"
          disabled={deployed || deploy.isPending}
          onClick={handleDeploy}
          className="px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-accent-fill text-on-accent border border-accent-fill disabled:opacity-50"
        >
          {deployed
            ? 'Deployed ✓'
            : deploy.isPending
              ? 'Deploying...'
              : anyBlocked
                ? 'Deploy Anyway'
                : 'Deploy New Model'}
        </button>
        <button type="button" disabled={deployed} className="px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-surface-2 border border-border-strong disabled:opacity-50">
          Save for later
        </button>
      </div>
    </Card>
  );
}
