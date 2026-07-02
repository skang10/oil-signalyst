import type { DailyReport } from '@/types/api';
import Card from '@/components/shared/Card';
import MetricCard from '@/components/shared/MetricCard';
import TagBadge from '@/components/shared/TagBadge';
import RegimeGrid, { type RegimeGridItem } from '@/components/shared/RegimeGrid';
import DistChart from '@/components/shared/DistChart';
import { formatUsd, lastBusinessDayLabels } from '@/lib/utils';
import { IconBolt } from '@tabler/icons-react';

const REGIME_LABELS: Record<'R1' | 'R2' | 'R3' | 'R4', string> = {
  R1: 'R1 Supply Squeeze Bull',
  R2: 'R2 Demand Expansion Bull',
  R3: 'R3 Oversupply Bear',
  R4: 'R4 Demand Collapse Bear',
};

export default function TraderView({ report }: { report: DailyReport }) {
  const trader = report.trader!;
  const regime = report.regime;
  const returns = report.returns;
  const eia = report.eia;

  const prices = trader.price_5d_history;
  const labels = lastBusinessDayLabels(report.date, prices.length);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const change5d = (prices[prices.length - 1] - prices[0]) / prices[0];

  const regimeItems: RegimeGridItem[] = (['R1', 'R2', 'R3', 'R4'] as const)
    .map((id) => ({
      id,
      label: REGIME_LABELS[id],
      prob: regime.probabilities[id],
      isDominant: id === regime.dominant,
    }))
    .sort((a, b) => b.prob - a.prob);

  const downsidePct = Math.round(returns.downside_prob * 100);
  const tailPct = Math.round(returns.tail_prob * 100);

  return (
    <>
      <div className="grid grid-cols-3 gap-[10px] mb-3">
        <MetricCard
          label="Signal"
          value={trader.signal}
          valueColor={trader.signal === 'FLAT' ? 'muted' : trader.signal === 'LONG' ? 'success' : 'danger'}
          sub={`Expected ${(trader.expected_return * 100).toFixed(1)}%, signal too weak`}
          accentTop="danger"
        />
        <MetricCard
          label="Kelly Position"
          value={`${Math.round(trader.kelly_position * 100)}%`}
          sub="Win/odds insufficient to enter"
        />
        <MetricCard
          label="Stop Loss"
          value={formatUsd(trader.stop_loss_price, 1)}
          sub={`${(trader.stop_loss_pct * 100).toFixed(1)}% below current price`}
        />
      </div>

      <div className="grid grid-cols-2 gap-[10px] mb-3">
        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
            WTI Price (Last {prices.length} Days)
          </div>
          <div className="flex items-end gap-1 h-[56px] mb-2">
            {prices.map((p, i) => {
              const up = i === 0 ? true : p >= prices[i - 1];
              const h = 14 + ((p - min) / range) * 36;
              return (
                <div key={labels[i]} className="flex-1 flex flex-col items-center gap-[3px]">
                  <div
                    className="w-full rounded-t-[2px]"
                    style={{
                      height: h,
                      background: up ? 'var(--bg-success)' : 'var(--bg-danger)',
                      borderTop: `2px solid ${up ? 'var(--border-success)' : 'var(--border-danger)'}`,
                    }}
                  />
                  <span className="text-[10px] text-text-muted">{labels[i]}</span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-[12px] text-text-secondary">
              {formatUsd(prices[0], 1)} → <strong className="text-text-primary">{formatUsd(prices[prices.length - 1])}</strong>
            </span>
            <TagBadge kind={change5d >= 0 ? 'green' : 'red'}>
              {change5d >= 0 ? '+' : ''}
              {(change5d * 100).toFixed(1)}% 5d
            </TagBadge>
          </div>
          <div className="flex gap-4 pt-2 border-t border-border">
            <div>
              <div className="text-[10px] text-text-muted">5d High</div>
              <div className="text-[13px] font-medium">{formatUsd(max, 1)}</div>
            </div>
            <div>
              <div className="text-[10px] text-text-muted">5d Low</div>
              <div className="text-[13px] font-medium">{formatUsd(min, 1)}</div>
            </div>
            <div>
              <div className="text-[10px] text-text-muted">Brent Spread</div>
              <div className="text-[13px] font-medium">+{formatUsd(trader.brent_wti_spread, 1)}</div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
            Market Regime
          </div>
          <RegimeGrid regimes={regimeItems} />
          <div className="mt-2 text-[12px] text-warning">
            {Math.round(regime.switch_probability_4w * 100)}% chance of regime switch in 4w · Trigger: {regime.switch_trigger}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-[10px] mb-3">
        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-2">
            EIA Inventory Forecast
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[22px] font-medium text-danger">{eia.forecast_mb.toFixed(1)}</span>
            <span className="text-[13px] text-text-muted">MB</span>
            <TagBadge kind="red">Surprise</TagBadge>
          </div>
          <div className="text-[12px] text-text-secondary mb-[6px]">
            Consensus {eia.consensus_mb.toFixed(1)} MB · Tomorrow 14:30 ET
          </div>
          <div className="text-[12px] text-warning flex items-center gap-1">
            <IconBolt size={12} stroke={1.75} />
            Price impact if data confirms: +1.5~+2.8%
          </div>
        </Card>

        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-2">
            COT Speculative Net
          </div>
          <div className="flex items-baseline gap-2 mb-[6px]">
            <span className="text-[22px] font-medium text-danger">{trader.cot_net_percentile}</span>
            <span className="text-[13px] text-text-muted">percentile</span>
            <TagBadge kind="red">Bearish</TagBadge>
          </div>
          <div className="h-[6px] bg-surface-1 rounded-[3px] mb-[6px] overflow-hidden">
            <div className="h-full bg-danger rounded-[3px]" style={{ width: `${trader.cot_net_percentile}%` }} />
          </div>
          <div className="text-[12px] text-text-secondary">Speculators reducing longs, bearish sentiment</div>
        </Card>

        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-2">OVX Volatility</div>
          <div className="flex items-baseline gap-2 mb-[6px]">
            <span className="text-[22px] font-medium">{trader.ovx.toFixed(1)}</span>
            <TagBadge kind="muted">Below avg</TagBadge>
          </div>
          <div className="h-[6px] bg-surface-1 rounded-[3px] mb-[6px] overflow-hidden">
            <div className="h-full bg-accent-text rounded-[3px]" style={{ width: '38%' }} />
          </div>
          <div className="text-[12px] text-text-secondary">Low option protection cost — consider buying Puts</div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-[10px]">
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium">
            Return Distribution (Next 20 Days)
          </div>
          <div className="flex gap-2">
            <TagBadge kind="red">Downside {downsidePct}%</TagBadge>
            <TagBadge kind="yellow">Tail {tailPct}%</TagBadge>
          </div>
        </div>
        <DistChart buckets={returns.buckets} />
        <div className="grid grid-cols-4 gap-2 mt-[10px] pt-[10px] border-t border-border">
          <div className="text-center">
            <div className="text-[10px] text-text-muted">Expected Return</div>
            <div className="text-[15px] font-medium text-danger">{(returns.expected_return * 100).toFixed(1)}%</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-text-muted">VaR 95%</div>
            <div className="text-[15px] font-medium text-danger">{(returns.var_95 * 100).toFixed(1)}%</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-text-muted">Price Range</div>
            <div className="text-[15px] font-medium">
              ${returns.price_range_low}~${returns.price_range_high}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-text-muted">Kelly Position</div>
            <div className="text-[15px] font-medium text-text-muted">
              {trader.kelly_position === 0 ? 'Flat' : `${Math.round(trader.kelly_position * 100)}%`}
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
