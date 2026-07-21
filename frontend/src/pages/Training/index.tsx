import { useEffect, useState } from 'react';
import { useModelStatus } from '@/hooks/useModelStatus';
import { refreshTrainJobs, useStartTraining, useTrainStatus, useTrainLog } from '@/hooks/useTraining';
import PageHeader from '@/components/shared/PageHeader';
import AlertBanner from '@/components/shared/AlertBanner';
import TrainConfigCard from './TrainConfigCard';
import AutoTriggerCard from './AutoTriggerCard';
import TrainLogCard from './TrainLogCard';
import ModelCompareCard from './ModelCompareCard';
import TrainingHistoryCard from './TrainingHistoryCard';
import type { TrainParams } from '@/types/api';

export default function TrainingPage() {
  const { data: modelStatus } = useModelStatus();
  const [jobId, setJobId] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const { mutateAsync: startTraining, isPending } = useStartTraining();
  const { data: job } = useTrainStatus(jobId);

  useTrainLog(jobId, (line) => setLogLines((prev) => [...prev, line]));

  // Surface this session's run in the history list as soon as it settles
  // (the list's own slow poll would lag by up to 15s).
  useEffect(() => {
    if (job?.status === 'complete' || job?.status === 'failed') refreshTrainJobs();
  }, [job?.status]);

  // Without the catch, a rejected mutation from an onClick handler becomes an
  // unhandled promise rejection: the button just un-disables and the user gets
  // no feedback at all. The 409 from the single-run guard and the 400 for a
  // non-trainable model type both land here.
  async function handleStart(params: TrainParams) {
    setStartError(null);
    try {
      const newJob = await startTraining(params);
      setJobId(newJob.job_id);
      setLogLines([]);
      refreshTrainJobs();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start training.');
    }
  }

  const alertModel = modelStatus?.models.find((m) => m.psi_alert);

  return (
    <div className="p-[18px] overflow-y-auto flex-1">
      <PageHeader title="Training Control" sub="Config · Triggers · Live Log · Model Compare · History" />

      {alertModel && (
        <AlertBanner>
          {alertModel.type[0].toUpperCase() + alertModel.type.slice(1)} model PSI {(alertModel.metrics.psi ?? 0).toFixed(2)} exceeds threshold
          0.20 — retraining recommended
        </AlertBanner>
      )}

      <div className="grid grid-cols-2 gap-[10px] mb-3">
        <TrainConfigCard onSubmit={handleStart} isPending={isPending} />
        <AutoTriggerCard />
      </div>

      {startError && <AlertBanner>Could not start training — {startError}</AlertBanner>}

      {job?.status === 'failed' && (
        <AlertBanner>
          Training job {job.job_id} failed{job.result?.error ? ` — ${job.result.error}` : ''}
        </AlertBanner>
      )}

      {job?.status === 'complete' && job.result?.blocked_reasons &&
        Object.keys(job.result.blocked_reasons).length > 0 && (
          <AlertBanner>
            Trained but not deployed —{' '}
            {Object.entries(job.result.blocked_reasons)
              .map(([type, reasons]) => `${type}: ${(reasons ?? []).join('; ')}`)
              .join(' | ')}
          </AlertBanner>
        )}

      <TrainLogCard lines={logLines} />

      {job?.status === 'complete' && <ModelCompareCard job={job} />}

      <TrainingHistoryCard />
    </div>
  );
}
