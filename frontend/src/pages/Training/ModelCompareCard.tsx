import { Fragment, useState } from 'react';
import Card from '@/components/shared/Card';
import { useDeployModel } from '@/hooks/useTraining';
import type { TrainJob } from '@/types/api';

const METRIC_LABEL: Record<string, string> = {
  returns_brier: 'Return Dist. Brier',
  regime_accuracy: 'Regime Accuracy',
  eia_mae: 'EIA MAE',
};

export default function ModelCompareCard({ job }: { job: TrainJob }) {
  const [deployed, setDeployed] = useState(false);
  const deploy = useDeployModel();
  if (!job.result) return null;

  const { old_metrics, new_metrics, improvement_pct } = job.result;
  const keys = Object.keys(old_metrics);

  async function handleDeploy() {
    for (const type of job.model_types) {
      await deploy.mutateAsync({ type, jobId: job.job_id });
    }
    setDeployed(true);
  }

  return (
    <Card>
      <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">Old vs New Model Comparison</div>
      <div className="grid grid-cols-4 border border-border rounded-default overflow-hidden text-[12px]">
        <div className="p-[8px_10px] bg-surface-1 text-[11px] font-medium text-text-muted">Model</div>
        <div className="p-[8px_10px] bg-surface-1 text-[11px] font-medium text-text-muted text-right">Old</div>
        <div className="p-[8px_10px] bg-surface-1 text-[11px] font-medium text-text-muted text-right">New</div>
        <div className="p-[8px_10px] bg-surface-1 text-[11px] font-medium text-text-muted text-right">Change</div>
        {keys.map((key) => (
          <Fragment key={key}>
            <div className="p-[8px_10px] border-t border-border text-text-secondary">{METRIC_LABEL[key] ?? key}</div>
            <div className="p-[8px_10px] border-t border-border text-right text-text-muted">{old_metrics[key].toFixed(3)}</div>
            <div className="p-[8px_10px] border-t border-border text-right font-medium text-success">{new_metrics[key].toFixed(3)}</div>
            <div className="p-[8px_10px] border-t border-border text-right text-success">{improvement_pct.toFixed(1)}%</div>
          </Fragment>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          disabled={deployed || deploy.isPending}
          onClick={handleDeploy}
          className="px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-accent-fill text-on-accent border border-accent-fill disabled:opacity-50"
        >
          {deployed ? 'Deployed ✓' : deploy.isPending ? 'Deploying...' : 'Deploy New Model'}
        </button>
        <button type="button" disabled={deployed} className="px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-surface-2 border border-border-strong disabled:opacity-50">
          Save for later
        </button>
      </div>
    </Card>
  );
}
