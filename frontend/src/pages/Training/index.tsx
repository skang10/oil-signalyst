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
  const { mutateAsync: startTraining, isPending } = useStartTraining();
  const { data: job } = useTrainStatus(jobId);

  useTrainLog(jobId, (line) => setLogLines((prev) => [...prev, line]));

  // Surface this session's run in the history list as soon as it settles
  // (the list's own slow poll would lag by up to 15s).
  useEffect(() => {
    if (job?.status === 'complete' || job?.status === 'failed') refreshTrainJobs();
  }, [job?.status]);

  async function handleStart(params: TrainParams) {
    const newJob = await startTraining(params);
    setJobId(newJob.job_id);
    setLogLines([]);
    refreshTrainJobs();
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

      {job?.status === 'failed' && (
        <AlertBanner>
          Training job {job.job_id} failed{job.result?.error ? ` — ${job.result.error}` : ''}
        </AlertBanner>
      )}

      <TrainLogCard lines={logLines} />

      {job?.status === 'complete' && <ModelCompareCard job={job} />}

      <TrainingHistoryCard />
    </div>
  );
}
