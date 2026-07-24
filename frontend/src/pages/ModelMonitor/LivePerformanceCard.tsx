import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Card from '@/components/shared/Card';
import { cn } from '@/lib/utils';
import type { ModelStatus } from '@/types/api';

// Recharts renders stroke as a raw SVG attribute, so line colours must be
// literal hex, not var(--token) references (same constraint as DistChart).
const FORECAST_COLOR = '#185FA5'; // accent — the model's point forecast
const REALIZED_COLOR = '#3B6D11'; // success — what EIA actually published
const CONSENSUS_COLOR = '#9AA0A6'; // muted — the naive rolling-mean consensus

function fmtSigned(value: number, digits = 2, unit = ''): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}${unit}`;
}

function Stat({
  label,
  value,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'bad';
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-[2px]" title={hint}>
      <div className="text-[10px] text-text-muted uppercase tracking-[0.5px]">{label}</div>
      <div
        className={cn(
          'text-[15px] font-medium tabular-nums',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-warning'
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The out-of-sample counterpart to the frozen train-time score cards: the
 * deployed EIA forecast rescored against the inventory change EIA later
 * published, over the trailing weekly-distinct prints. This is the signal that
 * says whether the *live* model still works - drift and the train-window
 * baseline cannot. Feeds the same health flag as those (see
 * livePerformanceUnhealthy) so a decaying model no longer reads green.
 */
export default function LivePerformanceCard({ status }: { status: ModelStatus }) {
  const lp = status.live_performance;
  const jd = status.joint_drift;

  if (!lp || lp.n_prints === 0) {
    return (
      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[8px]">
          Live Performance — EIA Forecast
        </div>
        <div className="text-[11px] text-text-muted">
          No scored predictions yet. Once the daily pipeline has run and the forecast
          horizons have elapsed, past predictions are scored against the realized EIA
          print and this fills in.
        </div>
      </Card>
    );
  }

  const dirPct = lp.directional_acc == null ? null : lp.directional_acc * 100;
  const dirTone: 'good' | 'bad' | 'neutral' =
    dirPct == null ? 'neutral' : dirPct < 50 ? 'bad' : 'good';

  const mvc = lp.model_vs_consensus;
  // Negative = the model beats the consensus, so lower is better here.
  const mvcTone: 'good' | 'bad' | 'neutral' = mvc == null ? 'neutral' : mvc < 0 ? 'good' : 'bad';

  const ph = lp.page_hinkley;
  const auc = jd?.auc;

  return (
    <Card className="mb-3" accentTop={ph.alarm || dirTone === 'bad' || jd?.alert ? 'warning' : undefined}>
      <div className="flex items-baseline justify-between mb-[10px]">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium">
          Live Performance — EIA Forecast
        </div>
        <div className="text-[10px] text-text-muted">
          last {lp.n_prints} weekly print{lp.n_prints === 1 ? '' : 's'}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-[10px] mb-[14px]">
        <Stat
          label="Rolling MAE"
          value={lp.rolling_mae == null ? '—' : `${lp.rolling_mae.toFixed(2)} MB`}
          hint="Mean absolute error vs the realized inventory change, over the trailing prints."
        />
        <Stat
          label="Directional"
          value={dirPct == null ? '—' : `${dirPct.toFixed(0)}%`}
          tone={dirTone}
          hint="Share of prints where the forecast got the build/draw direction right. Below 50% is worse than a coin flip."
        />
        <Stat
          label="vs Consensus"
          value={mvc == null ? '—' : fmtSigned(mvc, 2, ' MB')}
          tone={mvcTone}
          hint="Model MAE minus the naive rolling-mean consensus MAE. Negative = the model beats the market consensus."
        />
        <Stat
          label="Loss Trend"
          value={ph.alarm ? 'Alarm' : 'Stable'}
          tone={ph.alarm ? 'bad' : 'good'}
          hint={`Page-Hinkley change detector on the residual loss (stat ${ph.stat}). Alarm = a sustained rise in error.`}
        />
        <Stat
          label="Joint Drift"
          value={auc == null ? '—' : `AUC ${auc.toFixed(2)}`}
          tone={auc == null ? 'neutral' : jd?.alert ? 'bad' : 'good'}
          hint="Adversarial-validation AUC separating the training window from recent production. ~0.5 = no joint drift; high = the features moved together in a way per-feature PSI misses."
        />
      </div>

      <div style={{ height: 170 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={lp.series} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
              tickFormatter={(d: string) => d.slice(5)}
              interval="preserveStartEnd"
              stroke="var(--border)"
            />
            <YAxis
              tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
              width={40}
              stroke="var(--border)"
              label={{
                value: 'MB',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 9, fill: 'var(--text-muted)' },
              }}
            />
            <Tooltip
              contentStyle={{
                fontSize: 11,
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
              }}
              labelStyle={{ color: 'var(--text-muted)' }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
            <Line
              type="monotone"
              dataKey="realized"
              name="Realized"
              stroke={REALIZED_COLOR}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              name="Forecast"
              stroke={FORECAST_COLOR}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="consensus"
              name="Consensus"
              stroke={CONSENSUS_COLOR}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
