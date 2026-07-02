import useSWR from 'swr';
import { api } from '@/lib/api';
import { swrKeys } from '@/lib/swr-keys';
import type { HistoryResponse } from '@/types/api';

export function useHistory() {
  return useSWR<HistoryResponse>(swrKeys.history(), () => api.get(swrKeys.history()), {});
}
