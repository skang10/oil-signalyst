import { useRole } from '@/context/RoleContext';
import { useReport } from '@/hooks/useReport';
import Card from '@/components/shared/Card';
import TagBadge from '@/components/shared/TagBadge';
import DistChart from '@/components/shared/DistChart';
import { formatUsd } from '@/lib/utils';
import { isAbstained, pctOrAbstain } from '@/lib/abstain';

export default function ReturnsTab() {
  const { role } = useRole();
  const { data: report } = useReport(role);
  if (!report) return <div className="text-text-muted text-[12px]">Loading...</div>;

  const returns = report.returns;
  const risk = report.risk;
  // Sign-driven, not fixed: expected return is currently +0.29% and was
  // rendered in red regardless, as were skewness and VaR.
  const signColor = (v: number) => (v < 0 ? 'text-danger' : 'text-success');
  // Described from the value instead of the hardcoded "Left-skewed (fat
  // downside tail)", which claimed a fat left tail at any skewness at all.
  const skewText =
    Math.abs(returns.skewness) < 0.1
      ? 'Near-symmetric'
      : returns.skewness < 0
        ? 'Left-skewed (fat downside tail)'
        : 'Right-skewed (fat upside tail)';

  return (
    <>
      {/* No longer "Conditional": that meant conditioned on the regime model,
          whose probabilities were removed from this model's inputs because
          they leaked hindsight into training. */}
      <div className="mb-[14px]">
        <div className="text-[15px] font-medium">WTI Return Forecast (Next 20 Trading Days)</div>
        <div className="text-[12px] text-text-muted mt-[2px]">
          {report.date} · Current price: {formatUsd(report.wti_price)}/bbl
        </div>
      </div>

      <Card className="mb-3">
        {/* The callout that stood here read "Regime {X} dominant with N%
            downside probability", presenting the forecast as derived from a
            regime this model no longer sees. Removed rather than reworded -
            there is no generated narrative to put in its place. */}
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
          Return Bucket Probability Distribution
        </div>
        <DistChart buckets={returns.buckets} height={100} />
        <div className="flex gap-2 flex-wrap mt-[6px]">
          <TagBadge kind="red">Downside (&lt;0%): {Math.round(returns.downside_prob * 100)}%</TagBadge>
          <TagBadge kind="green">Upside (&gt;0%): {Math.round(returns.upside_prob * 100)}%</TagBadge>
          <TagBadge kind="yellow">Tail risk (&lt;−10%): {Math.round(returns.tail_prob * 100)}%</TagBadge>
        </div>
      </Card>

      <div className="grid grid-cols-4 gap-[10px] mb-3">
        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-2">Expected Return</div>
          <div className={`text-[22px] font-medium ${signColor(returns.expected_return)}`}>
            {returns.expected_return > 0 ? '+' : ''}{(returns.expected_return * 100).toFixed(2)}%
          </div>
        </Card>
        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-2">VaR 95%</div>
          <div className="text-[22px] font-medium text-danger">
            {returns.var_95_bucket_limited ? '\u2264 ' : ''}
            {(returns.var_95 * 100).toFixed(1)}%
          </div>
          {returns.var_95_bucket_limited && (
            <div className="text-[11px] text-text-muted mt-[3px]">
              Bucket-limited — the 5% tail sits inside the unbounded &lt;−10% bucket
            </div>
          )}
        </Card>
        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-2">Distribution Skewness</div>
          <div className={`text-[22px] font-medium ${signColor(returns.skewness)}`}>{returns.skewness.toFixed(2)}</div>
          <div className="text-[11px] text-text-muted mt-[3px]">{skewText}</div>
        </Card>
        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-2">Price Range</div>
          <div className="text-[18px] font-medium">
            ${returns.price_range_low}~${returns.price_range_high}
          </div>
          <div className="text-[11px] text-text-muted mt-[3px]">
            {returns.price_range_bucket_limited
              ? 'Bucket-limited — both ends fall in the unbounded outer buckets, so this is ±15% (their midpoints), not a resolved interval'
              : '80% interval (10th–90th percentile)'}
          </div>
        </Card>
      </div>

      <Card>
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-3">
          Distribution-Based Decision Recommendations
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-border rounded-default p-[10px_12px]">
            <div className="text-[11px] text-text-muted mb-[6px]">✈ Airlines (oil buyers)</div>
            <div className="font-medium text-danger mb-1">
              {risk && isAbstained(risk.recommended_hedge_ratio)
                ? 'Hedge sizing withheld — a baseline model is serving'
                : `Raise hedge ratio to ${risk ? pctOrAbstain(risk.recommended_hedge_ratio) : '75%'}`}
            </div>
            <div className="text-[11px] text-text-muted leading-[1.6]">
              Downside {Math.round(returns.downside_prob * 100)}%, tail {Math.round(returns.tail_prob * 100)}% — locking in cost
              beats bearing downside
            </div>
          </div>
          <div className="border border-border rounded-default p-[10px_12px]">
            <div className="text-[11px] text-text-muted mb-[6px]">🛢 Oil producers (oil sellers)</div>
            <div className="font-medium text-warning mb-1">
              {risk && isAbstained(risk.recommended_hedge_ratio)
                ? 'Hedge sizing withheld — a baseline model is serving'
                : 'Hold current hedge, do not increase'}
            </div>
            <div className="text-[11px] text-text-muted leading-[1.6]">
              Upside {Math.round(returns.upside_prob * 100)}% intact — full hedge forgoes geopolitical upside
            </div>
          </div>
          <div className="border border-border rounded-default p-[10px_12px]">
            <div className="text-[11px] text-text-muted mb-[6px]">📊 Trader (directional)</div>
            <div className="font-medium text-text-muted mb-1">Small short, tight stop-loss</div>
            <div className="text-[11px] text-text-muted leading-[1.6]">
              Negative expected return but weak signal ({(returns.expected_return * 100).toFixed(1)}%) — too small to size up
            </div>
          </div>
          <div className="border border-border rounded-default p-[10px_12px]">
            <div className="text-[11px] text-text-muted mb-[6px]">⚙ Options Strategy</div>
            <div className="font-medium text-accent-text mb-1">Buy puts to hedge downside tail</div>
            <div className="text-[11px] text-text-muted leading-[1.6]">
              {Math.round(returns.tail_prob * 100)}% large-drop probability makes OTM put insurance value exceed premium cost
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
