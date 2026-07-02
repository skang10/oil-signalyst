import type { TrainJob } from '@/types/api';

interface JobState extends TrainJob {
  logLines: string[];
}

const jobs = new Map<string, JobState>();

const LOG_LINES = [
  'Loading feature matrix... 14 features x 3,456 samples',
  'Data leakage check... Passed',
  'Fold 1/5 Brier: 0.214',
  'Fold 2/5 Brier: 0.208',
  'Fold 3/5 Brier: 0.221',
  'Fold 4/5 Brier: 0.216',
  'Fold 5/5 Brier: 0.212',
  'OOS Brier: 0.198 - MLflow: b7d4e2a9',
];

/**
 * In-memory stateful mock: progresses queued -> running -> complete over
 * real elapsed time via setTimeout/setInterval, so useTrainStatus's 2s
 * polling (D8) and useTrainLog's line-by-line polling both observe genuine
 * state transitions instead of an instantly-resolved fixture.
 */
export function createTrainJob(modelTypes: string[]): TrainJob {
  const job: JobState = {
    job_id: crypto.randomUUID(),
    status: 'queued',
    model_types: modelTypes,
    started_at: new Date().toISOString(),
    completed_at: null,
    logLines: [],
  };
  jobs.set(job.job_id, job);
  runSimulation(job.job_id);
  return stripLog(job);
}

function runSimulation(jobId: string) {
  setTimeout(() => {
    const job = jobs.get(jobId);
    if (!job) return;
    job.status = 'running';

    let i = 0;
    const interval = setInterval(() => {
      const current = jobs.get(jobId);
      if (!current) {
        clearInterval(interval);
        return;
      }
      if (i < LOG_LINES.length) {
        current.logLines.push(LOG_LINES[i]);
        i++;
        return;
      }
      clearInterval(interval);
      current.status = 'complete';
      current.completed_at = new Date().toISOString();
      current.result = {
        old_metrics: { returns_brier: 0.24 },
        new_metrics: { returns_brier: 0.198 },
        improvement_pct: -17.5,
      };
    }, 550);
  }, 400);
}

function stripLog(job: JobState): TrainJob {
  const { logLines: _logLines, ...trainJob } = job;
  return trainJob;
}

export function getTrainJob(jobId: string): TrainJob | undefined {
  const job = jobs.get(jobId);
  return job ? stripLog(job) : undefined;
}

export function getTrainLog(jobId: string): string[] | undefined {
  return jobs.get(jobId)?.logLines;
}
