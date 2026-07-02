import useSWR from 'swr';
import { api } from '@/lib/api';
import { swrKeys } from '@/lib/swr-keys';
import type { HistoryDetail } from '@/types/api';

export function useHistoryDetail(date: string | null) {
  return useSWR<HistoryDetail>(date ? swrKeys.historyDetail(date) : null, () => api.get(swrKeys.historyDetail(date!)), {});
}
