import { useSyncExternalStore } from 'react';
import { useModelStatus } from '@/hooks/useModelStatus';
import { useTrainJobs } from '@/hooks/useTraining';
import { isMockMode, subscribeMockMode } from '@/lib/mockMode';
import { MOCK_SANDBOXES, fromReal, type WorkbenchSandbox } from '@/lib/sandboxModel';

/**
 * The workbench sandbox list. In mock mode it's the full Stockcast tree; in live
 * mode it's derived from real ModelStatus + TrainJobs (sparse, NA-filled). The
 * hook subscribes to the mock flag so flipping the banner re-renders it.
 */
export function useSandboxes(): { sandboxes: WorkbenchSandbox[]; isLoading: boolean } {
  const mock = useSyncExternalStore(subscribeMockMode, isMockMode, () => false);
  const { data: status, isLoading: statusLoading } = useModelStatus();
  const { data: jobs, isLoading: jobsLoading } = useTrainJobs(25);

  if (mock) return { sandboxes: MOCK_SANDBOXES, isLoading: false };
  return { sandboxes: fromReal(status, jobs), isLoading: statusLoading || jobsLoading };
}

export function useSandbox(id: string | null): WorkbenchSandbox | undefined {
  const { sandboxes } = useSandboxes();
  return id ? sandboxes.find((s) => s.id === id) : undefined;
}
