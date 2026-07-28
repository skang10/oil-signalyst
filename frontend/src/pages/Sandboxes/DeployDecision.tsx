import { useState } from 'react';
import { useDeployModel } from '@/hooks/useTraining';
import type { TrainJob } from '@/types/api';

/**
 * The single human gate that IS backed server-side: promote a trained run's EIA
 * model to production (POST /api/models/eia/deploy?job_id=…). This is the one
 * primary decision per the Stockcast model; Fork / promote-to-shadow have no
 * backend and render as disabled scaffolding elsewhere.
 *
 * A run whose model is gate-blocked can still be deployed as a human override
 * (deploy_service returns a warning) — mirrors the Training page's "Deploy
 * Anyway". A superseded run re-activates its version (a rollback).
 */
export default function DeployDecision({
  job,
  deployState,
  blocked,
  onDeployed,
}: {
  job: TrainJob;
  deployState: string;
  blocked: boolean;
  onDeployed: () => void;
}) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deploy = useDeployModel();

  // Already the live pointer — no decision to make.
  if (deployState === 'live' || deployState === 'partial') {
    return (
      <div className="flex items-center gap-3 flex-wrap mt-[14px] p-[12px_14px] bg-[#20293F] border border-[#333E5C] rounded-[9px]">
        <span className="font-mono text-[11px] text-[#A7B0C4] leading-[1.5]">
          This run's model is live in production. The weekly rolling refresh keeps it current in
          place — no promotion decision is pending.
        </span>
      </div>
    );
  }

  const canDeploy = job.status === 'complete' && Boolean(job.result?.new_metrics);
  if (!canDeploy) {
    return (
      <div className="flex items-center gap-3 flex-wrap mt-[14px] p-[12px_14px] bg-[#20293F] border border-[#333E5C] rounded-[9px]">
        <span className="font-mono text-[11px] text-[#A7B0C4] leading-[1.5]">
          {job.status !== 'complete'
            ? `Run is ${job.status} — nothing to promote yet.`
            : 'This run produced no deployable model (e.g. a cross-validate run, which deploys nothing).'}
        </span>
      </div>
    );
  }

  const label =
    deployState === 'superseded' ? 'Re-deploy (rollback to this version)' : 'Promote to production';
  const note = blocked
    ? 'gate-blocked — deploying is a human override and will be logged with a warning'
    : deployState === 'superseded'
      ? 'moves the live pointer back to this run’s version'
      : 'moves the live pointer to this run’s EIA version, effective on the next daily run';

  async function handle() {
    setError(null);
    try {
      await deploy.mutateAsync({ type: 'eia', jobId: job.job_id });
      setDone(true);
      onDeployed();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deploy failed.');
    }
  }

  return (
    <div className="mt-[14px] p-[12px_14px] bg-[#20293F] border border-[#333E5C] rounded-[9px]">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handle}
          disabled={done || deploy.isPending}
          className="font-bold text-[13px] rounded-[8px] px-[18px] py-[9px] cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: done ? '#333E5C' : blocked ? '#8FA8F0' : '#5BC98B', color: done ? '#8792AB' : '#0C2A19' }}
        >
          {done ? 'Deployed ✓' : deploy.isPending ? 'Deploying…' : blocked ? `${label} (override)` : label}
        </button>
        <span className="font-mono text-[11px] text-[#A7B0C4] leading-[1.5] flex-1 min-w-[180px]">{note}</span>
      </div>
      {error && <div className="font-mono text-[11px] text-[#F0A08F] mt-[8px]">{error}</div>}
    </div>
  );
}
