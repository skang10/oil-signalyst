import useSWR from 'swr';
import { api } from '@/lib/api';
import { swrKeys } from '@/lib/swr-keys';
import type { DailyReport } from '@/types/api';
import type { Role } from '@/types/roles';

export function useReport(role: Role) {
  return useSWR<DailyReport>(swrKeys.report(role), () => api.get(swrKeys.report(role)), {
    refreshInterval: 60_000,
  });
}
