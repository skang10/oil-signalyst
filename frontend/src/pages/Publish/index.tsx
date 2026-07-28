import { Link } from 'react-router-dom';
import WorkbenchPage, { WorkbenchFooter } from '@/components/workbench/WorkbenchPage';
import Card from '@/components/shared/Card';
import { useReport } from '@/hooks/useReport';
import { useHistory } from '@/hooks/useHistory';
import { useModelStatus } from '@/hooks/useModelStatus';
import { useRole } from '@/context/RoleContext';
import { fmt } from '@/lib/workbench';

const REGIME_LABEL: Record<string, string> = { R1: 'R1', R2: 'R2', R3: 'R3', R4: 'R4' };

export default function PublishPage() {
  const { role } = useRole();
  const { data: report } = useReport(role);
  const { data: history } = useHistory();
  const { data: status } = useModelStatus();

  const eia = status?.models.find((m) => m.type === 'eia');
  const forecast = report?.eia.forecast_mb ?? null;
  const consensus = report?.eia.consensus_mb ?? null;
  const direction = forecast == null ? '' : forecast < 0 ? 'crude draw' : 'crude build';
  const predictions = history?.predictions ?? [];
  const dirAcc = history?.rolling_accuracy.eia_directional_acc ?? null;

  return (
    <WorkbenchPage
      title="Publish"
      lead={
        <>
          The daily prediction the platform serves to every role. Publishing itself is driven by the{' '}
          <b className="text-text-primary font-semibold">daily scheduler</b> (ingest → inference → publish),
          not a manual button — this surface is where you review what’s about to go out and the trail of what
          already has.
        </>
      }
    >
      {/* Next release */}
      <Card className="!p-0 overflow-hidden mb-4">
        <div className="p-[20px_24px] bg-[var(--text-primary)] text-[#EDEFF4]">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#8792AB]">
            next release · EIA crude inventory change · publishes on the daily pipeline
          </div>
          <div className="flex items-baseline gap-4 flex-wrap mt-[8px]">
            <div className="font-mono text-[40px] font-semibold tracking-[-0.03em] text-[#F0C878] leading-none">
              {forecast == null ? '—' : `${forecast > 0 ? '+' : ''}${forecast.toFixed(1)}`}
              <span className="text-[16px] text-[#B8935A] ml-[6px]">Mb</span>
            </div>
            <div className="text-[13px] text-[#C6CCDA]">
              {direction}
              {consensus != null && <span className="text-[#8792AB]"> · consensus {consensus.toFixed(1)} Mb</span>}
            </div>
          </div>
          <div className="font-mono text-[11px] text-[#8792AB] mt-[10px]">
            from eia · {eia?.version ?? '—'} · production
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap px-[24px] py-[12px] bg-surface-1">
          <button
            type="button"
            disabled
            title="Publishing is handled by the daily scheduler (scheduler.runner), not a manual API action."
            className="font-semibold text-[13px] rounded-[8px] px-[16px] py-[8px] bg-accent-fill text-on-accent border-none opacity-50 cursor-not-allowed"
          >
            Publish now
          </button>
          <span className="text-[11px] text-text-muted font-mono leading-[1.5] flex-1 min-w-[220px]">
            Scheduler-driven — the pipeline publishes on its cron (default Tue 22:00 UTC). TODO(api): a
            manual publish / hold control isn’t exposed yet.
          </span>
        </div>
      </Card>

      {/* Release history */}
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          publish history · {predictions.length} releases
        </div>
        {dirAcc != null && (
          <div className="text-[11px] text-text-secondary">
            rolling EIA directional accuracy <span className="font-mono font-medium">{(dirAcc * 100).toFixed(0)}%</span>
          </div>
        )}
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="grid grid-cols-[110px_1fr_90px_90px] items-center text-[10px] font-mono uppercase tracking-[0.4px] text-text-muted bg-surface-1 px-[16px] py-[8px]">
          <div>Date</div>
          <div>EIA forecast</div>
          <div className="text-right">Regime</div>
          <div className="text-right">WTI</div>
        </div>
        {predictions.length === 0 && (
          <div className="px-[16px] py-[14px] text-[12px] text-text-muted">
            {history ? 'No published releases yet — the scheduler has not produced prediction history.' : 'Loading…'}
          </div>
        )}
        {predictions.slice(0, 20).map((p) => (
          <div key={p.date} className="grid grid-cols-[110px_1fr_90px_90px] items-center text-[12px] px-[16px] py-[8px] border-t border-border">
            <div className="font-mono text-[11.5px]">{p.date}</div>
            <div className="font-mono">
              {p.eia_forecast_mb == null ? '—' : `${p.eia_forecast_mb > 0 ? '+' : ''}${p.eia_forecast_mb.toFixed(1)} Mb`}
              {p.eia_forecast_mb != null && (
                <span className="text-text-muted"> · {p.eia_forecast_mb < 0 ? 'draw' : 'build'}</span>
              )}
            </div>
            <div className="text-right font-mono text-text-secondary">{REGIME_LABEL[p.regime_dominant] ?? p.regime_dominant}</div>
            <div className="text-right font-mono">{p.wti_price == null ? '—' : `$${fmt(p.wti_price, 2)}`}</div>
          </div>
        ))}
        <div className="px-[16px] py-[10px] border-t border-border">
          <Link to="/history" className="font-mono text-[11px] text-accent-text underline underline-offset-2">
            full release history →
          </Link>
        </div>
      </Card>

      <WorkbenchFooter />
    </WorkbenchPage>
  );
}
