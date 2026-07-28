import { useEffect, useState } from 'react';
import { IconPlayerPlay, IconChartDots3, IconPlayerStop } from '@tabler/icons-react';
import Card from '@/components/shared/Card';
import TrainLogCard from '@/pages/Training/TrainLogCard';
import { useRole, type RetrainMode } from '@/context/RoleContext';
import {
  refreshTrainJobs,
  useStartTraining,
  useStartCrossValidate,
  useStopJob,
  useTrainStatus,
  useTrainLog,
} from '@/hooks/useTraining';
import type { TrainParams } from '@/types/api';
import { cn } from '@/lib/utils';

const AUTO_MODES: { key: RetrainMode; label: string }[] = [
  { key: 'auto', label: 'On ≥2 signals' },
  { key: 'sunday', label: 'Weekly' },
  { key: 'manual', label: 'Manual' },
];

/**
 * The training trigger for the EIA model — the piece the sandbox list was
 * missing (you could view and deploy runs, but not start one). Reuses the real
 * training hooks: Start Training deploys through the gate, Cross-Validate scores
 * folds and deploys nothing. A finished run drops into the Runs list below.
 */
export default function StartRunPanel({ onDone }: { onDone?: () => void } = {}) {
  const { userConfig, setUserConfig } = useRole();
  const [jobId, setJobId] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [startError, setStartError] = useState<string | null>(null);

  const { mutateAsync: startTraining, isPending: trainPending } = useStartTraining();
  const { mutateAsync: startCrossValidate, isPending: cvPending } = useStartCrossValidate();
  const { mutateAsync: stopJob, isPending: stopPending } = useStopJob();
  const { data: job } = useTrainStatus(jobId);

  const isPending = trainPending || cvPending;
  const isRunning = job?.status === 'queued' || job?.status === 'running';

  useTrainLog(jobId, (line) => setLogLines((prev) => [...prev, line]));

  // Surface the finished run in the list immediately (the list's own poll lags).
  useEffect(() => {
    if (job?.status === 'complete' || job?.status === 'failed') {
      refreshTrainJobs();
      onDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  async function launch(start: (p: TrainParams) => Promise<{ job_id: string }>, verb: string) {
    setStartError(null);
    try {
      const newJob = await start({ model_types: ['eia'] });
      setJobId(newJob.job_id);
      setLogLines([]);
      refreshTrainJobs();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : `Failed to ${verb}.`);
    }
  }

  return (
    <Card className="mb-[9px]">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          disabled={isPending || isRunning}
          onClick={() => launch(startTraining, 'start training')}
          className="flex items-center gap-[6px] px-[14px] py-[7px] text-[12px] font-medium rounded-default cursor-pointer bg-accent-fill text-on-accent border-none disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <IconPlayerPlay size={14} stroke={2} />
          {trainPending ? 'Starting…' : 'Retrain EIA'}
        </button>
        <button
          type="button"
          disabled={isPending || isRunning}
          onClick={() => launch(startCrossValidate, 'cross-validate')}
          title="Walk-forward cross-validation — scores folds, deploys nothing (~minutes)"
          className="flex items-center gap-[6px] px-[14px] py-[7px] text-[12px] rounded-default cursor-pointer bg-surface-2 border border-border-strong hover:bg-surface-1 disabled:opacity-50"
        >
          <IconChartDots3 size={14} stroke={1.75} />
          Cross-validate
        </button>

        <div className="ml-auto flex items-center gap-[6px]">
          <span className="text-[11px] text-text-muted">auto-retrain</span>
          {AUTO_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setUserConfig({ ...userConfig, retrain_mode: m.key })}
              className={cn(
                'text-[11px] px-[9px] py-[3px] rounded-[16px] border cursor-pointer',
                userConfig.retrain_mode === m.key
                  ? 'bg-accent-bg border-accent-border text-accent-text font-medium'
                  : 'bg-surface-2 border-border text-text-secondary'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="text-[11px] text-text-muted mt-[8px] leading-[1.5]">
        Fixed split: train 2012–2024, test 2025→today. Start Training goes live only if it clears the
        deployment gate; Cross-validate deploys nothing.
      </div>

      {startError && <div className="text-[11px] text-danger mt-[8px]">Could not start — {startError}</div>}

      {isRunning && (
        <div className="flex items-center gap-3 mt-[10px] text-[12px] text-text-secondary">
          <span className="font-mono">running {job?.job_id}…</span>
          <button
            type="button"
            disabled={stopPending}
            onClick={() => job && stopJob(job.job_id)}
            className="flex items-center gap-[5px] px-[10px] py-[4px] text-[11px] rounded-default cursor-pointer bg-danger-bg text-danger border border-danger-border hover:opacity-80 disabled:opacity-50"
          >
            <IconPlayerStop size={12} stroke={2} />
            {stopPending ? 'Stopping…' : 'Stop'}
          </button>
        </div>
      )}

      {job?.status === 'complete' && (
        <div className="text-[11px] text-success mt-[8px] font-mono">
          ✓ {job.job_id} complete — open it in Runs below to review and deploy.
        </div>
      )}
      {job?.status === 'failed' && (
        <div className="text-[11px] text-danger mt-[8px] font-mono">
          {job.job_id} failed{job.result?.error ? ` — ${job.result.error}` : ''}.
        </div>
      )}

      {jobId && <div className="mt-[10px]"><TrainLogCard lines={logLines} /></div>}
    </Card>
  );
}
