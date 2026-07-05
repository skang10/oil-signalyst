import { IconX, IconAlertTriangle } from '@tabler/icons-react';
import Card from '@/components/shared/Card';
import TagBadge from '@/components/shared/TagBadge';
import { useModelStatus } from '@/hooks/useModelStatus';
import { useAddToPool, useRemoveFromPool } from '@/hooks/useFeaturePool';
import { cn } from '@/lib/utils';
import type { PoolFeature } from '@/types/api';

const GRID = 'grid grid-cols-[1fr_110px_130px_70px_70px_150px_40px] items-center gap-x-2';

function StatusBadge({ feature }: { feature: PoolFeature }) {
  if (feature.pool_status === 'live') return <TagBadge kind="green">Live · {feature.used_by.join(', ')}</TagBadge>;
  if (feature.pool_status === 'pending_retrain') return <TagBadge kind="yellow">Pending retrain</TagBadge>;
  return <TagBadge kind="red">Removed · retrain needed</TagBadge>;
}

/**
 * The managed feature pool (config/features.yaml), with health stats joined
 * client-side from /api/models/status (missing rate, PSI) so membership and
 * "is this feature earning its place" live on the same rows.
 */
export default function FeaturePoolCard({ pool }: { pool: PoolFeature[] }) {
  const { data: modelStatus } = useModelStatus();
  const removeFromPool = useRemoveFromPool();
  const addToPool = useAddToPool();

  const missingByName = new Map((modelStatus?.feature_missing_rates ?? []).map((m) => [m.name, m.pct]));
  const psiByName = new Map((modelStatus?.feature_psi ?? []).map((p) => [p.name, p.psi]));

  async function handleRemove(feature: PoolFeature) {
    if (feature.used_by.length > 0) {
      const ok = window.confirm(
        `"${feature.label}" is used by the live ${feature.used_by.join(', ')} model(s).\n\n` +
          'Removing it from the pool will break daily predictions until those models are retrained. Remove anyway?'
      );
      if (!ok) return;
    }
    await removeFromPool.mutateAsync({ name: feature.name, force: feature.used_by.length > 0 });
  }

  return (
    <Card className="mb-3" style={{ padding: 0 }}>
      <div className="flex items-center p-[14px_16px] pb-0">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium">
          Feature Pool ({pool.filter((p) => p.pool_status !== 'removed_pending_retrain').length})
        </div>
        <div className="ml-auto text-[11px] text-text-muted">
          config/features.yaml · additions apply at the next retrain
        </div>
      </div>
      <div className="mt-[10px] overflow-x-auto">
        <div className="min-w-[820px]">
          <div className={cn(GRID, 'bg-surface-1 text-[10.5px] font-medium text-text-muted uppercase tracking-[0.4px] px-[16px] py-[7px]')}>
            <div>Feature</div>
            <div>Category</div>
            <div>Source · Freq</div>
            <div className="text-right">Missing</div>
            <div className="text-right">PSI</div>
            <div>Status</div>
            <div />
          </div>
          {pool.map((feature) => {
            const missing = missingByName.get(feature.name);
            const psi = psiByName.get(feature.name);
            const ghost = feature.pool_status === 'removed_pending_retrain';
            return (
              <div
                key={feature.name}
                className={cn(GRID, 'px-[16px] py-[7px] text-[12px] border-t border-border', ghost && 'bg-danger-bg/40')}
              >
                <div className="min-w-0">
                  <div className="truncate">{feature.label}</div>
                  <div className="font-mono text-[10.5px] text-text-muted truncate">{feature.name}</div>
                </div>
                <div className="text-text-secondary text-[11.5px]">{feature.category}</div>
                <div className="text-text-muted text-[11px]">
                  {feature.source} · {feature.frequency}
                </div>
                <div className="text-right font-mono text-[11px] text-text-secondary tabular-nums">
                  {missing == null ? '—' : `${missing.toFixed(1)}%`}
                </div>
                <div
                  className={cn(
                    'text-right font-mono text-[11px] tabular-nums',
                    psi != null && psi > 0.2 ? 'text-warning font-medium' : 'text-text-secondary'
                  )}
                >
                  {psi == null ? '—' : psi.toFixed(2)}
                </div>
                <div className="flex items-center gap-1">
                  {ghost && <IconAlertTriangle size={13} stroke={1.75} className="text-danger shrink-0" />}
                  <StatusBadge feature={feature} />
                </div>
                <div className="text-right">
                  {ghost ? (
                    <button
                      type="button"
                      title={`Restore ${feature.label} to the feature pool`}
                      disabled={addToPool.isPending}
                      onClick={() => addToPool.mutate(feature.name)}
                      className="px-[8px] py-[3px] text-[11px] rounded-default border border-success-border bg-success-bg text-success cursor-pointer whitespace-nowrap disabled:opacity-40"
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      type="button"
                      title={`Remove ${feature.label} from the feature pool`}
                      disabled={removeFromPool.isPending}
                      onClick={() => handleRemove(feature)}
                      className="p-[4px] rounded-default border border-transparent text-text-muted cursor-pointer hover:text-danger hover:border-danger-border hover:bg-danger-bg disabled:opacity-40"
                    >
                      <IconX size={13} stroke={1.75} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {pool.length === 0 && (
            <div className="px-[16px] py-[14px] text-[12px] text-text-muted border-t border-border">
              Feature pool is empty.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
