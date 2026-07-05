import { useMutation } from '@tanstack/react-query';
import { mutate } from 'swr';
import { api } from '@/lib/api';
import { swrKeys } from '@/lib/swr-keys';

function refreshSignals() {
  mutate(swrKeys.signals());
  // Evaluate pages key off /api/signals/evaluate/{name}; status shown there
  // (in pool / ignored) changes with every pool action.
  mutate((key) => typeof key === 'string' && key.startsWith('/api/signals/evaluate/'));
}

export function useAddToPool() {
  return useMutation({
    mutationFn: (name: string) => api.post(`/api/signals/${name}/pool`, {}),
    onSuccess: refreshSignals,
  });
}

/** Throws on 409 when the feature is used by live models and force=false -
 * callers confirm with the user, then retry with force. */
export function useRemoveFromPool() {
  return useMutation({
    mutationFn: ({ name, force = false }: { name: string; force?: boolean }) =>
      api.del(`/api/signals/${name}/pool${force ? '?force=true' : ''}`),
    onSuccess: refreshSignals,
  });
}

export function useIgnoreSignal() {
  return useMutation({
    mutationFn: (name: string) => api.post(`/api/signals/${name}/ignore`, {}),
    onSuccess: refreshSignals,
  });
}

export function useRestoreSignal() {
  return useMutation({
    mutationFn: (name: string) => api.post(`/api/signals/${name}/restore`, {}),
    onSuccess: refreshSignals,
  });
}
