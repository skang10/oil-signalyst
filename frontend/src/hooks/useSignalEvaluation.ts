import useSWR from 'swr';
import { api } from '@/lib/api';
import { swrKeys } from '@/lib/swr-keys';
import type { SignalEvaluation } from '@/types/api';

export function useSignalEvaluation(name: string) {
  return useSWR<SignalEvaluation>(swrKeys.signalEvaluation(name), () => api.get(swrKeys.signalEvaluation(name)), {});
}
