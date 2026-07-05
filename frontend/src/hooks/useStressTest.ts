import useSWR from 'swr';
import { api } from '@/lib/api';
import { swrKeys } from '@/lib/swr-keys';
import type { StressTestResponse } from '@/types/api';

/**
 * Real historical-extreme stress test (GET /api/reports/stress) - re-runs
 * the active models against the 2020/2022/2014 scenarios server-side.
 * Replaces the hardcoded lib/stress-scenarios.ts list that rendered a fake
 * "Alerted ✓" on every row. Inference over three scenarios takes a few
 * seconds, so cache aggressively - the result only changes on model deploy.
 */
export function useStressTest() {
  return useSWR<StressTestResponse>(swrKeys.stressTest(), () => api.get(swrKeys.stressTest()), {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60_000,
  });
}
