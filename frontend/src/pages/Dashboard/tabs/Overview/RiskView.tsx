import type { DailyReport } from '@/types/api';
import Card from '@/components/shared/Card';
import MetricCard from '@/components/shared/MetricCard';
import TagBadge from '@/components/shared/TagBadge';
import DistChart from '@/components/shared/DistChart';
import StressTestCard from '@/components/shared/StressTestCard';

export default function RiskView({ report }: { report: DailyReport }) {
  const risk = report.risk!;
  const returns = report.returns;
  const regime = report.regime;

  return (
    <>
      <div className="grid grid-cols-4 gap-[10px] mb-3">
        <MetricCard
          label="VaR 95% (20-day)"
          value={`${(risk.var_95 * 100).toFixed(1)}%`}
          valueColor="danger"
          sub={`= $${(Math.abs(risk.var_95) * risk.current_exposure_mbbls * 100).toFixed(1)}M (${risk.current_exposure_mbbls.toFixed(1)}M bbl exposure)`}
          accentTop="danger"
        />
        <MetricCard
          label="CVaR (conditional expected loss)"
          value={`${(risk.cvar_95 * 100).toFixed(1)}%`}
          valueColor="danger"
          sub="Tail average loss, more conservative"
          accentTop="danger"
        />
        <MetricCard
          label="Crude Exposure"
          value={`${risk.current_exposure_mbbls.toFixed(1)}M bbl`}
          valueColor="warning"
          sub={`Notional value $${(risk.current_exposure_mbbls * report.wti_price).toFixed(1)}M`}
          accentTop="warning"
        />
        <MetricCard
          label="Hedge Ratio"
          value={`${Math.round(risk.hedge_ratio * 100)}%`}
          valueColor="warning"
          sub={`Raise to ${Math.round(risk.recommended_hedge_ratio * 100)}% recommended`}
          subColor="warning"
          accentTop="warning"
        />
      </div>

      <div className="grid grid-cols-2 gap-[10px] mb-3">
        <Card>
          <div className="flex items-center justify-between mb-[10px]">
            <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium">
              Return Distribution (Full Stats)
            </div>
            <TagBadge kind="red">Left-skewed {returns.skewness.toFixed(2)}</TagBadge>
          </div>
          <DistChart buckets={returns.buckets} />
          <div className="grid grid-cols-3 gap-[6px] mt-2 pt-2 border-t border-border">
            <div className="p-[6px_8px] bg-danger-bg rounded-default text-center">
              <div className="text-[10px] text-danger">VaR 95%</div>
              <div className="text-[13px] font-medium text-danger">{(returns.var_95 * 100).toFixed(1)}%</div>
            </div>
            <div className="p-[6px_8px] bg-danger-bg rounded-default text-center">
              <div className="text-[10px] text-danger">CVaR 95%</div>
              <div className="text-[13px] font-medium text-danger">{(risk.cvar_95 * 100).toFixed(1)}%</div>
            </div>
            <div className="p-[6px_8px] bg-surface-1 rounded-default text-center">
              <div className="text-[10px] text-text-muted">Price Range</div>
              <div className="text-[13px] font-medium">
                ${returns.price_range_low}~${returns.price_range_high}
              </div>
            </div>
          </div>
        </Card>

        <StressTestCard title="Stress Test (Historical Extremes)">
          <div className="mt-2 p-[7px_10px] bg-surface-1 rounded-default text-[11px] text-text-muted">
            Max drawdown in R3 regime: <strong className="text-danger">{Math.round(risk.r3_historical_max_drawdown * 100)}%</strong>{' '}
            (2014 OPEC price war)
          </div>
        </StressTestCard>
      </div>

      <div className="grid grid-cols-2 gap-[10px]">
        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
            R3 Regime Historical Risk
          </div>
          <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
            <span className="text-text-secondary">R3 avg duration</span>
            <span className="font-medium font-mono">{regime.historical_avg_duration} weeks</span>
          </div>
          <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
            <span className="text-text-secondary">Currently Running</span>
            <span className="font-medium font-mono">{regime.duration_weeks} weeks (mid-cycle)</span>
          </div>
          <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
            <span className="text-text-secondary">R3 avg return</span>
            <span className="font-medium font-mono text-danger">−2.3% (20-day)</span>
          </div>
          <div className="flex justify-between items-center py-[7px] border-b border-border text-[12px]">
            <span className="text-text-secondary">R3 max drawdown</span>
            <span className="font-medium font-mono text-danger">{Math.round(risk.r3_historical_max_drawdown * 100)}%</span>
          </div>
          <div className="flex justify-between items-center py-[7px] text-[12px]">
            <span className="text-text-secondary">4w switch probability</span>
            <span className="font-medium font-mono text-warning">{Math.round(regime.switch_probability_4w * 100)}%</span>
          </div>
        </Card>

        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
            Hedge Recommendations + Cost Estimate
          </div>
          <div className="flex flex-col gap-[6px] mb-[10px]">
            <div className="p-[8px_10px] bg-warning-bg border border-warning-border rounded-default">
              <div className="text-[11px] text-warning mb-[3px]">✈ Airlines (oil buyers)</div>
              <div className="font-medium text-warning">Raise hedge ratio to {Math.round(risk.recommended_hedge_ratio * 100)}%</div>
              <div className="text-[11px] text-text-muted mt-[2px]">
                Downside {Math.round(returns.downside_prob * 100)}%, tail {Math.round(returns.tail_prob * 100)}%, locking in cost is prudent
              </div>
            </div>
            <div className="p-[8px_10px] bg-surface-1 rounded-default">
              <div className="text-[11px] text-text-muted mb-[3px]">🛢 Oil producers (oil sellers)</div>
              <div className="font-medium">Hold current hedge, do not increase</div>
              <div className="text-[11px] text-text-muted mt-[2px]">
                Upside {Math.round(returns.upside_prob * 100)}% intact — full hedge forgoes gains
              </div>
            </div>
          </div>
          <div className="p-[8px_10px] bg-surface-1 rounded-default">
            <div className="text-[11px] text-text-muted mb-[6px]">Hedge Cost Estimate (OVX {report.trader?.ovx.toFixed(1)})</div>
            <div className="flex justify-between py-[3px] text-[12px]">
              <span className="text-text-secondary">ATM Put option (20-day)</span>
              <span className="font-medium font-mono">approx $1.8/bbl</span>
            </div>
            <div className="flex justify-between py-[3px] text-[12px]">
              <span className="text-text-secondary">10% OTM Put</span>
              <span className="font-medium font-mono">approx $0.6/bbl</span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
