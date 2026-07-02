import { useMutation } from '@tanstack/react-query';
import useSWR, { mutate } from 'swr';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
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
 * Public signature matches spec §5.2's SSE-based useTrainLog exactly, but
 * Phase 3 drives it via polling an in-memory mock log array instead of a
 * real EventSource (locked decision - sidesteps MSW/Service-Worker SSE
 * compatibility risk, zero-change swap to real SSE in Phase 4).
 */
export function useTrainLog(jobId: string | null, onLine: (line: string) => void) {
  const seenCount = useRef(0);

  useEffect(() => {
    seenCount.current = 0;
    if (!jobId) return;

    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const { lines } = await api.get<{ lines: string[] }>(swrKeys.trainLog(jobId));
        for (let i = seenCount.current; i < lines.length; i++) onLine(lines[i]);
        seenCount.current = lines.length;
      } catch {
        // job not found yet / transient - keep polling
      }
    };

    const interval = setInterval(poll, 500);
    poll();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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
