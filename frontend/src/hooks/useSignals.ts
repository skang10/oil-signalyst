import useSWR from 'swr';
import { api } from '@/lib/api';
import { swrKeys } from '@/lib/swr-keys';
import type { SignalsResponse } from '@/types/api';

export function useSignals() {
  return useSWR<SignalsResponse>(swrKeys.signals(), () => api.get(swrKeys.signals()), {});
}
