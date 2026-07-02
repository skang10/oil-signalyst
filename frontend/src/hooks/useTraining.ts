import { useMutation } from '@tanstack/react-query';
import useSWR, { mutate } from 'swr';
import { useEffect } from 'react';
import { api, BASE } from '@/lib/api';
import { swrKeys } from '@/lib/swr-keys';
import type { TrainJob, TrainParams } from '@/types/api';

export function useStartTraining() {
  return useMutation({
    mutationFn: (params: TrainParams) => api.post<TrainJob>('/api/train/start', params),
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
 */
export function useTrainLog(jobId: string | null, onLine: (line: string) => void) {
  useEffect(() => {
    if (!jobId) return;

    const source = new EventSource(`${BASE}${swrKeys.trainLog(jobId)}`);
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
    },
  });
}
