import { useMutation } from '@tanstack/react-query';
import useSWR, { mutate } from 'swr';
import { useEffect } from 'react';
import { api, BASE, getAccessToken } from '@/lib/api';
import { swrKeys } from '@/lib/swr-keys';
import type { TrainJob, TrainJobsResponse, TrainParams, TrainTriggerFilter } from '@/types/api';

/** Revalidates every mounted training-history list (any filter/limit key). */
export function refreshTrainJobs() {
  mutate((key) => typeof key === 'string' && key.startsWith('/api/train/jobs'));
}

export function useTrainJobs(limit: number, trigger?: TrainTriggerFilter) {
  const key = swrKeys.trainJobs(limit, trigger);
  // Slow poll keeps the list fresh for runs started elsewhere (DS Agent,
  // scheduler auto-retrain); runs started on this page refresh instantly
  // via refreshTrainJobs().
  return useSWR<TrainJobsResponse>(key, () => api.get<TrainJobsResponse>(key), {
    refreshInterval: 15_000,
  });
}

/** Full record incl. persisted log - for the history detail panel. */
export function useTrainJobDetail(jobId: string | null) {
  return useSWR<TrainJob>(jobId ? swrKeys.trainStatusFull(jobId) : null, () =>
    api.get<TrainJob>(swrKeys.trainStatusFull(jobId!))
  );
}

export function useStartTraining() {
  return useMutation({
    mutationFn: (params: TrainParams) => api.post<TrainJob>('/api/train/start', params),
  });
}

/** Walk-forward cross-validation - a slow background job that reports a metric
 *  distribution across folds and deploys nothing. */
export function useStartCrossValidate() {
  return useMutation({
    mutationFn: (params: TrainParams) =>
      api.post<TrainJob>('/api/train/cross-validate', params),
  });
}

/** Cooperatively cancel a running training / cross-validation job. Frees the
 *  single-run guard immediately; the loop stops at the next checkpoint. */
export function useStopJob() {
  return useMutation({
    mutationFn: (jobId: string) => api.post(`/api/train/stop/${jobId}`, {}),
  });
}

export function useTrainStatus(jobId: string | null) {
  return useSWR<TrainJob>(
    jobId ? swrKeys.trainStatus(jobId) : null,
    () => api.get(swrKeys.trainStatus(jobId!)),
    { refreshInterval: 2_000 }
  );
}

/**
 * Reads the backend's real SSE stream (GET /api/train/log/{job_id}, a
 * text/event-stream of `data: <line>` frames ending in a `[done:status]`
 * sentinel). Closes explicitly on that sentinel rather than letting the
 * stream end naturally - EventSource auto-reconnects by default when a
 * connection closes, which would replay the whole log from the top.
 *
 * Token goes as a query param, not a header - EventSource can't set
 * Authorization, same as useAgentStream.ts's stream endpoint.
 */
export function useTrainLog(jobId: string | null, onLine: (line: string) => void) {
  useEffect(() => {
    if (!jobId) return;

    const token = getAccessToken();
    const source = new EventSource(`${BASE}${swrKeys.trainLog(jobId)}?token=${encodeURIComponent(token ?? '')}`);
    source.onmessage = (event) => {
      if (event.data.startsWith('[done:') || event.data === '[job not found]') {
        source.close();
        return;
      }
      onLine(event.data);
    };
    source.onerror = () => source.close();

    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
}

export function useDeployModel() {
  return useMutation({
    mutationFn: ({ type, jobId }: { type: string; jobId: string }) =>
      api.post(`/api/models/${type}/deploy?job_id=${jobId}`, {}),
    onSuccess: () => {
      // Deploy invalidates useModelStatus's SWR cache (D14) so the PSI
      // banner updates immediately - React Query's cache is unrelated here.
      mutate(swrKeys.modelStatus());
      // Deploy also flips which history rows count as 'live'.
      refreshTrainJobs();
    },
  });
}
