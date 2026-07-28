import { useModelStatus } from '@/hooks/useModelStatus';
import { useTrainJobs } from '@/hooks/useTraining';
import type { EiaModel } from '@/lib/workbench';
import type { TrainJobSummary } from '@/types/api';

/**
 * The EIA experiment tree, assembled from real data only:
 *   - `live`  : the active EIA ModelVersion (the production pointer)
 *   - `runs`  : recent train / cross-validate jobs (the experiments/forks)
 *   - `gate`  : the read-only deployment-gate criteria
 *
 * `eia` jobs are filtered from the shared jobs list. regime is never here (it is
 * a frozen artifact), and Returns is retired — both are rendered as static
 * reference cards by the pages, not sourced from this hook.
 */
export function useExperiments(limit = 25) {
  const { data: status, isLoading: statusLoading, error: statusError } = useModelStatus();
  const { data: jobs, isLoading: jobsLoading, error: jobsError } = useTrainJobs(limit);

  const live: EiaModel | undefined = status?.models.find((m) => m.type === 'eia');
  const runs: TrainJobSummary[] = (jobs?.jobs ?? []).filter((j) => j.model_types.includes('eia'));

  return {
    live,
    runs,
    gate: status?.deployment_gate ?? [],
    status,
    isLoading: statusLoading || jobsLoading,
    error: statusError ?? jobsError,
  };
}
