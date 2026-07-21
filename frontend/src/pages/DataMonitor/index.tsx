import { Link } from 'react-router-dom';
import { useModelStatus } from '@/hooks/useModelStatus';
import { useSignals } from '@/hooks/useSignals';
import PageHeader from '@/components/shared/PageHeader';
import Card from '@/components/shared/Card';
import MetricCard from '@/components/shared/MetricCard';
import TagBadge from '@/components/shared/TagBadge';
import { CATEGORY_TAG } from '@/lib/categoryColors';
import TrainingDatasetCard from './TrainingDatasetCard';
import { cn } from '@/lib/utils';

export default function DataMonitorPage() {
  const { data: modelStatus, error } = useModelStatus();
  const { data: signals } = useSignals();
  if (error)
    return <div className="p-[18px] text-text-muted text-[12px]">Data monitor unavailable — {String(error)}</div>;
  if (!modelStatus) return <div className="p-[18px] text-text-muted text-[12px]">Loading...</div>;

  const normalCount = modelStatus.data_sources.filter((s) => s.status === 'ok').length;
  const delayedCount = modelStatus.data_sources.length - normalCount;
  const delayedSources = modelStatus.data_sources.filter((s) => s.status !== 'ok');
  const delayedSource = delayedSources[0];
  // "Max lag" tracks anomalous delay among non-ok sources, not the longest
  // *expected* update cadence (e.g. CFTC's normal weekly ~48h isn't a delay).
  const maxLag = delayedSources.length > 0 ? Math.max(...delayedSources.map((s) => s.lag_hours ?? 0)) : 0;
  const mif = modelStatus.model_input_freshness;

  return (
    <div className="p-[18px] overflow-y-auto flex-1">
      <PageHeader
        title="Data Monitor"
        sub="Training Dataset · Data Source Status · Feature Coverage · Publication Lag"
      />

      <div className="grid grid-cols-3 gap-[10px] mb-3">
        <MetricCard label="Data Sources" value={modelStatus.data_sources.length} sub={`${normalCount} normal · ${delayedCount} delayed`} />
        <MetricCard
          label="Feature Coverage (7d)"
          value={`${(modelStatus.feature_coverage_7d * 100).toFixed(1)}%`}
          valueColor="success"
          sub={`Missing ${((1 - modelStatus.feature_coverage_7d) * 100).toFixed(1)}%`}
        />
        <MetricCard
          label="Max Data Lag"
          value={`+${maxLag}h`}
          valueColor="warning"
          sub={delayedSource ? `${delayedSource.name} data delayed` : 'All sources current'}
          accentTop="warning"
        />
      </div>

      <TrainingDatasetCard dataset={modelStatus.training_dataset} />

      <Card className="mb-3">
        <div className="flex items-center justify-between gap-[10px] mb-[10px]">
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium">Data Source Status</div>
          <div
            className="flex items-center gap-[7px] text-[11px] text-text-muted"
            title="Freshness of the feature matrix the models actually train & score on"
          >
            <span>
              Model input <span className="font-mono text-text-secondary">{mif.matrix_as_of ?? '—'}</span>
            </span>
            <TagBadge kind={mif.pipeline_behind ? 'yellow' : 'green'}>
              {mif.pipeline_behind ? `Behind ${mif.pipeline_lag_days}d` : 'In sync'}
            </TagBadge>
          </div>
        </div>
        {mif.pipeline_behind && (
          <div className="text-[11px] text-warning mb-[8px]">
            Feature matrix is {mif.pipeline_lag_days} days behind the live feeds — start the daily
            pipeline (<span className="font-mono">scheduler/runner.py</span>).
          </div>
        )}
        {modelStatus.data_sources.map((s) => (
          <div
            key={s.name}
            className={cn(
              'flex items-center gap-[10px] py-[6px] text-[12px]',
              s.status !== 'ok' ? 'bg-warning-bg border border-warning-border rounded-default p-[7px_10px]' : 'border-b border-border last:border-b-0'
            )}
          >
            <span className={cn('w-2 h-2 rounded-full shrink-0', s.status === 'ok' ? 'bg-success' : 'bg-warning')} />
            <span className="flex-1">{s.name}</span>
            <span className={cn('text-[11px]', s.status === 'ok' ? 'text-text-muted' : 'text-warning')}>
              {s.status === 'ok' ? (s.lag_hours ? `${s.lag_hours}h lag` : 'Live') : `${s.lag_hours}-hour lag`}
            </span>
            <TagBadge kind={s.status === 'ok' ? 'green' : 'yellow'}>{s.status === 'ok' ? 'OK' : 'Delayed'}</TagBadge>
          </div>
        ))}
      </Card>

      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">Feature Missing Rate (Last 30 Days)</div>
        <div className="flex flex-col gap-[6px]">
          {modelStatus.feature_missing_rates.map((f) => (
            <div key={f.name} className="flex items-center gap-[10px] text-[12px]">
              <span className="w-[140px] font-mono text-[11px] text-text-secondary">{f.name}</span>
              <div className="flex-1 h-[6px] bg-surface-1 rounded-[3px] overflow-hidden">
                <div className="h-full" style={{ width: `${f.pct * 100}%`, background: f.pct < 0.05 ? '#3B6D11' : 'var(--border-warning)' }} />
              </div>
              <span className={cn('text-[11px] w-9 text-right', f.pct < 0.05 ? 'text-success' : 'text-warning')}>
                {Math.round(f.pct * 100)}%
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[4px]">
          Feature Distribution Drift (PSI)
        </div>
        {/* PSI is opaque without saying what it compares and what the number
            means - a bare column of 0.11-2.66 tells a reader nothing. */}
        <div className="text-[11px] text-text-muted leading-[1.5] mb-[10px]">
          How far each feature's recent values have moved from the 2012–2023 training
          distribution. 0 = identical; higher = more drift. Bands:{' '}
          <span className="text-success">&lt; 0.1 stable</span> ·{' '}
          <span className="text-warning">0.1–{modelStatus.psi_threshold.toFixed(2)} moderate</span> ·{' '}
          <span className="text-danger">≥ {modelStatus.psi_threshold.toFixed(2)} significant, flags retrain</span>.
        </div>
        <div className="flex flex-col gap-[6px]">
          {modelStatus.feature_psi.map((f) => {
            // Three tiers keyed to the real retrain threshold, so colour tracks
            // "would this trigger a retrain" rather than an arbitrary cutoff.
            const tier =
              f.psi < 0.1 ? 'stable' : f.psi < modelStatus.psi_threshold ? 'moderate' : 'significant';
            const color =
              tier === 'stable' ? 'text-success' : tier === 'moderate' ? 'text-warning' : 'text-danger';
            const barColor =
              tier === 'stable' ? '#3B6D11' : tier === 'moderate' ? 'var(--border-warning)' : 'var(--text-danger)';
            const badge = tier === 'stable' ? 'green' : tier === 'moderate' ? 'yellow' : 'red';
            // Fill relative to the retrain threshold so the meaningful low range
            // is legible; genuine drift (well past it) simply saturates rather
            // than every bar maxing out as it did at psi*200.
            const width = Math.min(100, (f.psi / (modelStatus.psi_threshold * 2)) * 100);
            return (
              <div key={f.name} className="flex items-center gap-[10px] text-[12px]">
                <span className="w-[140px] font-mono text-[11px] text-text-secondary">{f.name}</span>
                <div className="flex-1 h-[6px] bg-surface-1 rounded-[3px] overflow-hidden">
                  <div className="h-full" style={{ width: `${width}%`, background: barColor }} />
                </div>
                <span className={cn('text-[11px] w-9 text-right', color)}>{f.psi.toFixed(2)}</span>
                <TagBadge kind={badge}>{tier}</TagBadge>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-[10px]">
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium">
            Current Feature Pool ({signals?.active.length ?? 0})
          </div>
          <Link to="/signals" className="text-[12px] text-accent-text no-underline">
            Signals ↗
          </Link>
        </div>
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-left text-[11px] text-text-muted">
              <th className="font-medium p-[6px_8px]">Feature Name</th>
              <th className="font-medium p-[6px_8px]">Source</th>
              <th className="font-medium p-[6px_8px]">Frequency</th>
              <th className="font-medium p-[6px_8px]">Category</th>
            </tr>
          </thead>
          <tbody>
            {signals?.active.map((f, i) => (
              <tr key={f.name} className={i % 2 === 0 ? 'bg-surface-2' : 'bg-surface-1'}>
                <td className="p-[6px_8px] font-mono text-[11px]">{f.name}</td>
                <td className="p-[6px_8px] text-text-secondary">{f.source}</td>
                <td className="p-[6px_8px] text-text-secondary">{f.frequency}</td>
                <td className="p-[6px_8px]">
                  <TagBadge kind={CATEGORY_TAG[f.category] ?? 'muted'}>{f.category}</TagBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
