import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import WorkbenchPage, { WorkbenchFooter } from '@/components/workbench/WorkbenchPage';
import Card from '@/components/shared/Card';
import { useModelStatus } from '@/hooks/useModelStatus';
import { useReport } from '@/hooks/useReport';
import { useRole } from '@/context/RoleContext';
import { fmt, fmtSkill } from '@/lib/workbench';
import { cn } from '@/lib/utils';

const FORECAST_COLOR = '#185FA5';
const REALIZED_COLOR = '#3B6D11';
const POS = '#A32D2D';
const NEG = '#3B6D11';

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: 'good' | 'bad'; hint?: string }) {
  return (
    <div className="bg-surface-2 border border-border rounded-default p-[13px_15px]" title={hint}>
      <div className="font-mono text-[16px] font-semibold tabular-nums leading-none">
        <span className={cn(tone === 'good' && 'text-success', tone === 'bad' && 'text-warning')}>{value}</span>
      </div>
      <div className="text-[11px] text-text-secondary mt-[6px]">{label}</div>
    </div>
  );
}

export default function EvaluatePage() {
  const { role } = useRole();
  const { data: status } = useModelStatus();
  const { data: report } = useReport(role);

  const eia = status?.models.find((m) => m.type === 'eia');
  const lp = status?.live_performance;
  const series = lp?.series ?? [];
  const hasLive = series.length > 0;

  const chartData = series.map((r) => ({
    date: r.date.slice(5),
    forecast: r.forecast,
    realized: r.realized,
    residual: Number((r.forecast - r.realized).toFixed(2)),
    hit: r.hit,
  }));

  // Error by segment: does the model do better on builds or draws? Real, from
  // the sign of the realized inventory change.
  const draws = series.filter((r) => r.realized < 0);
  const builds = series.filter((r) => r.realized >= 0);
  const meanAbs = (rows: typeof series) =>
    rows.length ? rows.reduce((a, r) => a + r.abs_error, 0) / rows.length : null;

  const dirAcc = report?.eia.historical_direction_accuracy ?? null;

  return (
    <WorkbenchPage
      title="Evaluate"
      lead="How right is the live EIA forecast on its own terms — against what EIA actually published. Head-to-head ranking is in Compare."
    >
      {/* Always-available diagnostics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] mb-4">
        <Stat label="Train-time MAE (mb)" value={fmt(eia?.metrics.primary, 2)} hint="Frozen out-of-sample MAE on the test window." />
        <Stat label="Baseline / skill" value={`${fmt(eia?.metrics.baseline, 2)} · ${fmtSkill(eia?.metrics.skill)}`}
          tone={eia?.metrics.skill != null ? (eia.metrics.skill < 0 ? 'bad' : 'good') : undefined}
          hint="Train-mean baseline and the share of its error the model removed." />
        <Stat label="Directional acc." value={dirAcc == null ? '—' : `${(dirAcc * 100).toFixed(0)}%`}
          tone={dirAcc == null ? undefined : dirAcc < 0.5 ? 'bad' : 'good'}
          hint="Historical share of prints where build/draw direction was right." />
        <Stat label="Live prints scored" value={String(lp?.n_prints ?? 0)}
          hint="Weekly-distinct predictions scored against the realized EIA print." />
      </div>

      {!hasLive && (
        <Card accentTop="warning" className="mb-4">
          <div className="text-[12px] text-text-secondary leading-[1.6]">
            <b className="text-text-primary">No scored live predictions yet.</b> The diagnostics below fill
            in once the pipeline has scored past predictions against realized EIA prints; the train-time
            figures above stand in.
            {eia?.metrics.recent?.primary != null && (
              <>
                {' '}Trailing-6mo rescore: <span className="font-mono">{fmt(eia.metrics.recent.primary, 2)} mb</span>
                {eia.metrics.recent.baseline != null && <> vs baseline {fmt(eia.metrics.recent.baseline, 2)}</>} ·
                n≈{eia.metrics.recent.effective_n ?? '—'}.
              </>
            )}
          </div>
        </Card>
      )}

      {hasLive && (
        <>
          <Card className="mb-4">
            <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[10px]">
              Forecast vs realized · last {series.length} prints
            </h3>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="2 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} interval="preserveStartEnd" stroke="var(--border)" />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} width={40} stroke="var(--border)" />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)' }} labelStyle={{ color: 'var(--text-muted)' }} />
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
                  <Line type="monotone" dataKey="realized" name="Realized" stroke={REALIZED_COLOR} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="forecast" name="Forecast" stroke={FORECAST_COLOR} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px] mb-4">
            <Card>
              <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[10px]">
                Residual over time · forecast − realized
              </h3>
              <div style={{ height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="2 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} interval="preserveStartEnd" stroke="var(--border)" />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} width={40} stroke="var(--border)" />
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)' }} labelStyle={{ color: 'var(--text-muted)' }} />
                    <ReferenceLine y={0} stroke="var(--border-strong)" />
                    <Bar dataKey="residual" name="Residual">
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={d.residual >= 0 ? POS : NEG} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[10px]">
                Error by segment · mean |error|
              </h3>
              <SegmentBar label="Draw weeks" mae={meanAbs(draws)} n={draws.length} />
              <SegmentBar label="Build weeks" mae={meanAbs(builds)} n={builds.length} />
              <div className="text-[11px] text-text-muted mt-[10px] leading-[1.5]">
                Whether the model is more accurate on inventory draws or builds — a systematic gap points at a
                missing feature for one regime.
              </div>
            </Card>
          </div>
        </>
      )}

      {/* Interval coverage — not recorded per-print yet */}
      <Card>
        <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[8px]">
          Interval coverage
        </h3>
        <div className="text-[12px] text-text-secondary leading-[1.6]">
          Live 80% band
          {report?.eia.interval_80_low != null && report?.eia.interval_80_high != null ? (
            <>: <span className="font-mono">{report.eia.interval_80_low.toFixed(1)} … {report.eia.interval_80_high.toFixed(1)} mb</span></>
          ) : null}
          . Empirical coverage per print isn’t recorded yet — <span className="text-text-muted">TODO(api)</span>.
        </div>
      </Card>

      <WorkbenchFooter />
    </WorkbenchPage>
  );
}

function SegmentBar({ label, mae, n }: { label: string; mae: number | null; n: number }) {
  const pct = mae == null ? 0 : Math.min(100, (mae / 8) * 100); // 8mb ~ full bar
  return (
    <div className="flex items-center gap-[11px] mb-[9px]">
      <div className="font-mono text-[11px] text-text-secondary w-[86px] shrink-0">{label}</div>
      <div className="flex-1 h-[14px] bg-surface-1 rounded-[4px] overflow-hidden">
        <div className="h-full bg-accent-fill rounded-[4px]" style={{ width: `${pct}%` }} />
      </div>
      <div className="font-mono text-[11px] w-[70px] text-right">
        {mae == null ? '—' : `${mae.toFixed(2)}`} <span className="text-text-muted">n={n}</span>
      </div>
    </div>
  );
}
