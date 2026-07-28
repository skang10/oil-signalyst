import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import WorkbenchPage, { SectionLabel, WorkbenchFooter } from '@/components/workbench/WorkbenchPage';
import Card from '@/components/shared/Card';
import LivePerformanceCard from '@/pages/ModelMonitor/LivePerformanceCard';
import { useReport } from '@/hooks/useReport';
import { useModelStatus } from '@/hooks/useModelStatus';
import { useRole } from '@/context/RoleContext';
import { fmt, fmtSkill, skillOf, pillClass, RETIRED_RETURNS_NOTE } from '@/lib/workbench';
import { cn } from '@/lib/utils';
import type { ModelStatus } from '@/types/api';

const FORECAST_COLOR = '#185FA5';
const REALIZED_COLOR = '#3B6D11';

function Pill({ kind, children }: { kind: Parameters<typeof pillClass>[0]; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-block font-mono text-[10.5px] uppercase tracking-[0.04em] rounded-[5px] px-[7px] py-[2px] font-medium',
        pillClass(kind)
      )}
    >
      {children}
    </span>
  );
}

export default function OverviewPage() {
  const { role } = useRole();
  const { data: report } = useReport(role);
  const { data: status } = useModelStatus();

  const eia = status?.models.find((m) => m.type === 'eia');
  const lp = status?.live_performance;

  const forecast = report?.eia.forecast_mb ?? null;
  const consensus = report?.eia.consensus_mb ?? null;
  const direction = forecast == null ? '' : forecast < 0 ? 'crude draw' : 'crude build';
  const skill = skillOf(eia?.metrics.primary ?? null, eia?.metrics.baseline ?? null);

  // Real forecast-vs-actual history: the deployed model rescored against the
  // inventory change EIA later published (backend performance_monitor).
  const series = (lp?.series ?? []).map((r) => ({
    date: r.date.slice(5),
    forecast: r.forecast,
    realized: r.realized,
  }));

  return (
    <WorkbenchPage
      title="EIA Forecast · workbench"
      lead="One trainable model — the weekly EIA crude-inventory forecast. Regime is a frozen reference; Return Distribution is retired."
    >
      {/* Next release — the live EIA forecast about to be published */}
      <Card className="!p-0 overflow-hidden mb-[14px]">
        <div className="flex flex-wrap">
          <div className="flex-1 min-w-[230px] p-[22px_26px] bg-[var(--text-primary)] text-[#EDEFF4]">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#8792AB]">
              next EIA release · from the daily pipeline
            </div>
            <div className="font-mono text-[44px] font-semibold tracking-[-0.03em] leading-[1.05] mt-[6px] text-[#F0C878]">
              {forecast == null ? '—' : `${forecast > 0 ? '+' : ''}${forecast.toFixed(1)}`}
              <span className="text-[18px] text-[#B8935A] ml-[6px]">Mb</span>
            </div>
            <div className="text-[13px] text-[#C6CCDA] mt-[1px]">{direction || '—'}</div>
          </div>
          <div className="flex-1 min-w-[240px] p-[22px_26px] border-l border-[rgba(255,255,255,0.08)] bg-[#1B2338] text-[#EDEFF4]">
            <Row k="our forecast" v={forecast == null ? '—' : `${forecast.toFixed(1)} Mb`} accent />
            <Row k="consensus" v={consensus == null ? '—' : `${consensus.toFixed(1)} Mb`} />
            {report?.eia.interval_80_low != null && report?.eia.interval_80_high != null && (
              <Row
                k="80% band"
                v={`${report.eia.interval_80_low.toFixed(1)} … ${report.eia.interval_80_high.toFixed(1)}`}
                muted
              />
            )}
          </div>
        </div>
        <div className="flex items-center gap-[11px] flex-wrap bg-[#141A29] text-[#8792AB] px-[26px] py-[11px] font-mono text-[11px]">
          <span>
            from <span className="text-[#8FA8F0]">eia · {eia?.version ?? '—'}</span> · production
          </span>
          <span className="text-[#3D4763]">·</span>
          <span>no challenger in shadow — deploys go straight to production</span>
        </div>
      </Card>

      {/* Live pointer diagnostics */}
      <Card>
        <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[10px]">
          EIA Forecast · live pointer
        </h3>
        <div className="flex items-baseline gap-[10px] flex-wrap">
          <div className="font-mono text-[26px] font-semibold tracking-[-0.02em]">
            {fmt(eia?.metrics.primary, 2)}
          </div>
          <div className="font-mono text-[12px] text-text-secondary">
            MAE, mb · baseline train-mean {fmt(eia?.metrics.baseline, 2)} · skill{' '}
            <span className={cn(skill != null && skill < 0 ? 'text-danger' : 'text-success')}>
              {fmtSkill(skill)}
            </span>
          </div>
        </div>
        <div className="font-mono text-[11px] text-text-muted mt-[8px]">
          points to <Link className="text-accent-text underline underline-offset-2" to="/sandboxes">eia · {eia?.version ?? '—'}</Link>
          {eia?.deployed_at ? ` · deployed ${eia.deployed_at.slice(0, 10)}` : ''} · PSI {fmt(eia?.metrics.psi, 2)}
        </div>
      </Card>

      {/* Health — the daily "is everything OK" check, folded in from the old
          Data Monitor + Model Monitor. */}
      <SectionLabel note="is the live model still trustworthy, and are its inputs current">health</SectionLabel>
      {status && <DataHealthCard status={status} />}
      {status && <div className="mt-[14px]"><LivePerformanceCard status={status} /></div>}

      {/* One-line reminder of the single decision this surface owns. */}
      <div className="mt-[14px] text-[12px] text-text-secondary">
        One human gate: <b className="text-text-primary">promote a trained run to production</b>. The
        weekly rolling refresh only updates the live model in place — it never puts a new config live.
      </div>

      {/* Real forecast-vs-actual, last N scored prints */}
      {series.length > 1 && (
        <Card className="mt-[14px]">
          <div className="flex items-baseline justify-between mb-[10px]">
            <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted">
              Recent releases · forecast vs realized
            </h3>
            <span className="text-[11px] text-text-muted">last {series.length} weekly prints</span>
          </div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                  interval="preserveStartEnd"
                  stroke="var(--border)"
                />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} width={40} stroke="var(--border)" />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                  }}
                  labelStyle={{ color: 'var(--text-muted)' }}
                />
                <Line type="monotone" dataKey="realized" name="Realized" stroke={REALIZED_COLOR} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="forecast" name="Forecast" stroke={FORECAST_COLOR} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Frozen reference + retired */}
      <SectionLabel note="never deployed, never scored — the pass-bars">frozen reference &amp; retired</SectionLabel>
      <Card className="mb-[9px]" style={{ borderLeft: '4px solid var(--text-pro)', background: 'var(--bg-pro)' }}>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="font-mono text-[13px] font-semibold">regime · frozen artifact</div>
            <div className="text-[12px] text-text-secondary mt-[2px]">
              market-state classifier · no observable outcome to score, so it is not trained or promoted
            </div>
          </div>
          <Pill kind="ref">reference</Pill>
        </div>
      </Card>
      <Card style={{ borderLeft: '4px solid var(--border-strong)', background: 'var(--surface-1)' }}>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="font-mono text-[13px] font-semibold text-text-secondary">
              Return Distribution · retired
            </div>
            <div className="text-[12px] text-text-muted mt-[2px]">{RETIRED_RETURNS_NOTE}</div>
          </div>
          <Pill kind="arch">retired</Pill>
        </div>
      </Card>

      <WorkbenchFooter />
    </WorkbenchPage>
  );
}

/** Input-side health, folded in from the old Data Monitor: is the feature
 *  matrix the model scores on current, and are the upstream feeds alive. */
function DataHealthCard({ status }: { status: ModelStatus }) {
  const f = status.model_input_freshness;
  const sources = status.data_sources ?? [];
  const ok = sources.filter((s) => s.status === 'ok').length;
  const delayed = sources.filter((s) => s.status === 'delayed').length;
  const error = sources.filter((s) => s.status === 'error').length;
  const cov = status.feature_coverage_7d;

  return (
    <Card accentTop={f.pipeline_behind || error > 0 ? 'warning' : undefined}>
      <div className="flex items-baseline justify-between mb-[10px]">
        <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted">
          Data health — model inputs
        </h3>
        {f.pipeline_behind && (
          <span className="text-[10.5px] font-mono px-[7px] py-[1px] rounded-[5px] bg-warning-bg text-warning">
            pipeline behind
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px]">
        <HStat label="Matrix as-of" value={f.matrix_as_of ? f.matrix_as_of.slice(0, 10) : '—'} tone={f.pipeline_behind ? 'bad' : undefined} />
        <HStat label="Pipeline lag" value={f.pipeline_lag_days == null ? '—' : `${f.pipeline_lag_days}d`} tone={f.pipeline_behind ? 'bad' : undefined} />
        <HStat
          label="Feeds"
          value={`${ok} ok${delayed ? ` · ${delayed} late` : ''}${error ? ` · ${error} err` : ''}`}
          tone={error > 0 ? 'bad' : delayed > 0 ? 'warn' : 'good'}
        />
        <HStat label="7-day coverage" value={cov == null ? '—' : `${(cov * 100).toFixed(0)}%`} />
      </div>
    </Card>
  );
}

function HStat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div>
      <div
        className={cn(
          'text-[15px] font-medium tabular-nums',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-danger',
          tone === 'warn' && 'text-warning'
        )}
      >
        {value}
      </div>
      <div className="text-[11px] text-text-muted mt-[2px]">{label}</div>
    </div>
  );
}

function Row({ k, v, accent, muted }: { k: string; v: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className={cn('flex justify-between items-center text-[13px] py-[4px]', muted && 'border-t border-[rgba(255,255,255,0.08)] mt-[5px] pt-[9px]')}>
      <span className={cn('flex items-center gap-[7px]', muted ? 'text-[#7C879E]' : 'text-[#B4BCCC]')}>
        {accent && <i className="w-[9px] h-[9px] rounded-full inline-block" style={{ background: '#F0C878' }} />}
        {k}
      </span>
      <span className={cn('font-mono', muted ? 'text-[#7C879E] text-[12px]' : 'text-[#EDEFF4] text-[13px]')}>{v}</span>
    </div>
  );
}
