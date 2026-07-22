import { useEffect, useState } from 'react';
import { useModelStatus } from '@/hooks/useModelStatus';
import {
  refreshTrainJobs,
  useStartCrossValidate,
  useStartTraining,
  useTrainStatus,
  useTrainLog,
} from '@/hooks/useTraining';
import PageHeader from '@/components/shared/PageHeader';
import AlertBanner from '@/components/shared/AlertBanner';
import TrainConfigCard from './TrainConfigCard';
import AutoTriggerCard from './AutoTriggerCard';
import TrainLogCard from './TrainLogCard';
import ModelCompareCard from './ModelCompareCard';
import CrossValidateCard from './CrossValidateCard';
import TrainingHistoryCard from './TrainingHistoryCard';
import type { TrainParams } from '@/types/api';

export default function TrainingPage() {
  const { data: modelStatus } = useModelStatus();
  const [jobId, setJobId] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const { mutateAsync: startTraining, isPending: trainPending } = useStartTraining();
  const { mutateAsync: startCrossValidate, isPending: cvPending } = useStartCrossValidate();
  const { data: job } = useTrainStatus(jobId);
  const isPending = trainPending || cvPending;

  useTrainLog(jobId, (line) => setLogLines((prev) => [...prev, line]));

  // A finished job is a cross-validation run when its result carries the
  // per-fold `models` map rather than the train/deploy old/new metrics.
  const isCvResult = Boolean(job?.result?.models);

  // Surface this session's run in the history list as soon as it settles
  // (the list's own slow poll would lag by up to 15s).
  useEffect(() => {
    if (job?.status === 'complete' || job?.status === 'failed') refreshTrainJobs();
  }, [job?.status]);

  // Without the catch, a rejected mutation from an onClick handler becomes an
  // unhandled promise rejection: the button just un-disables and the user gets
  // no feedback at all. The 409 from the single-run guard and the 400 for a
  // non-trainable model type both land here.
  async function launch(
    start: (p: TrainParams) => Promise<{ job_id: string }>,
    params: TrainParams,
    verb: string
  ) {
    setStartError(null);
    try {
      const newJob = await start(params);
      setJobId(newJob.job_id);
      setLogLines([]);
      refreshTrainJobs();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : `Failed to ${verb}.`);
    }
  }
  const handleStart = (p: TrainParams) => launch(startTraining, p, 'start training');
  const handleCrossValidate = (p: TrainParams) => launch(startCrossValidate, p, 'cross-validate');

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
        <TrainConfigCard
          onSubmit={handleStart}
          onCrossValidate={handleCrossValidate}
          isPending={isPending}
        />
        <AutoTriggerCard />
      </div>

      {startError && <AlertBanner>Could not start training — {startError}</AlertBanner>}

      {job?.status === 'failed' && (
        <AlertBanner>
          Job {job.job_id} failed{job.result?.error ? ` — ${job.result.error}` : ''}
        </AlertBanner>
      )}

      {job?.status === 'complete' && !isCvResult && job.result?.blocked_reasons &&
        Object.keys(job.result.blocked_reasons).length > 0 && (
          <AlertBanner>
            Trained but not deployed —{' '}
            {Object.entries(job.result.blocked_reasons)
              .map(([type, reasons]) => `${type}: ${(reasons ?? []).join('; ')}`)
              .join(' | ')}
          </AlertBanner>
        )}

      <TrainLogCard lines={logLines} />

      {job?.status === 'complete' &&
        (isCvResult ? <CrossValidateCard job={job} /> : <ModelCompareCard job={job} />)}

      <TrainingHistoryCard />
    </div>
  );
}
