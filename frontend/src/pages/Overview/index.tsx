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
import { useReport } from '@/hooks/useReport';
import { useModelStatus } from '@/hooks/useModelStatus';
import { useRole } from '@/context/RoleContext';
import { fmt, fmtSkill, skillOf, pillClass, RETIRED_RETURNS_NOTE } from '@/lib/workbench';
import { cn } from '@/lib/utils';

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
      title="One model live, one decision to make"
      lead={
        <>
          The Workbench is organized around <b className="text-text-primary font-semibold">experiments</b>, not
          runs — each pins a config and freezes its walk-forward score. Today exactly one model is
          trainable and live: <b className="text-text-primary font-semibold">EIA Forecast</b>.{' '}
          <b className="text-text-primary font-semibold">Regime</b> is a frozen reference (no observable
          outcome to score), and the old <b className="text-text-primary font-semibold">Return Distribution</b>{' '}
          model is retired.
        </>
      }
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

      {/* What you actually decide here */}
      <Card className="mt-[14px]">
        <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[6px]">
          What you actually decide here
        </h3>
        <p className="text-[13px] text-text-secondary leading-[1.65] m-0">
          There is exactly one human gate today:{' '}
          <b className="text-text-primary">Promote to production</b> — deploy a trained run's model so
          the daily pipeline serves it. Everything else — the weekly rolling refresh — is automation
          that only refreshes the live model in place, never puts a new config live. A second{' '}
          <span className="font-mono text-[12px]">idle → shadow</span> gate and an exclusive shadow
          slot are part of the target lifecycle but aren't tracked server-side yet.
        </p>
      </Card>

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
