import useSWR from 'swr';
import { api } from '@/lib/api';
import { swrKeys } from '@/lib/swr-keys';
import type { ModelStatus } from '@/types/api';

export function useModelStatus() {
  return useSWR<ModelStatus>(swrKeys.modelStatus(), () => api.get(swrKeys.modelStatus()), {
    refreshInterval: 30_000,
  });
}
