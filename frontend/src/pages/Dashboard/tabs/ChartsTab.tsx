import { Chart, registerables } from 'chart.js';
import Card from '@/components/shared/Card';
import TagBadge from '@/components/shared/TagBadge';
import WTIPriceChart from '@/components/charts/WTIPriceChart';
import SpreadChart from '@/components/charts/SpreadChart';
import InventoryChart from '@/components/charts/InventoryChart';
import CurveChart from '@/components/charts/CurveChart';
import VolatilityChart from '@/components/charts/VolatilityChart';
import COTChart from '@/components/charts/COTChart';
import { useMarketSeries } from '@/hooks/useMarketSeries';

Chart.register(...registerables);

function percentileRank(values: number[], current: number): number {
  if (values.length === 0) return 50;
  const below = values.filter((v) => v < current).length;
  return Math.round((below / values.length) * 100);
}

export default function ChartsTab() {
  const { data: wti } = useMarketSeries<{ date: string; price: number }[]>('wti_price');
  const { data: spread } = useMarketSeries<{ date: string; spread: number }[]>('brent_spread');
  const { data: inventory } = useMarketSeries<
    { date: string; value: number; avg: number; upper: number; lower: number }[]
  >('inventory');
  const { data: curve } = useMarketSeries<{ labels: string[]; today: (number | null)[]; ago_3m: (number | null)[] }>(
    'futures_curve'
  );
  const { data: ovxVix } = useMarketSeries<{ date: string; ovx: number; vix: number }[]>('ovx_vix');
  const { data: cot } = useMarketSeries<{ date: string; net_k: number }[]>('cot_net');

  const lastWti = wti?.at(-1);
  const lastSpread = spread?.at(-1);
  const lastInv = inventory?.at(-1);
  const invPctAboveAvg = lastInv ? Math.round(((lastInv.value - lastInv.avg) / lastInv.avg) * 1000) / 10 : null;

  const curveValues = curve ? curve.today.filter((v): v is number => v != null) : [];
  const curveDiff = curveValues.length >= 2 ? curveValues[curveValues.length - 1] - curveValues[0] : null;
  const isContango = curveDiff != null && curveDiff > 0;

  const lastOvxVix = ovxVix?.at(-1);

  const lastCot = cot?.at(-1);
  const cotPctile = lastCot && cot ? percentileRank(cot.map((c) => c.net_k), lastCot.net_k) : null;

  return (
    <>
      <div className="mb-[14px]">
        <div className="text-[15px] font-medium">Market Data Charts</div>
        <div className="text-[12px] text-text-muted mt-[2px]">
          Price · Inventory · Futures Curve · Sentiment · Indicative data
        </div>
      </div>

      <div className="grid grid-cols-2 gap-[10px] mb-3">
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[12px] font-medium">WTI Crude Price (Last 18 Months)</div>
              <div className="text-[11px] text-text-muted mt-[1px]">Background colour = Regime phase</div>
            </div>
            {lastWti && <TagBadge kind="red">Current ${lastWti.price.toFixed(2)}</TagBadge>}
          </div>
          <WTIPriceChart />
        </Card>
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[12px] font-medium">Brent-WTI Spread</div>
              <div className="text-[11px] text-text-muted mt-[1px]">Widening spread reflects export premium or transport costs</div>
            </div>
            {lastSpread && (
              <TagBadge kind="blue">
                Current {lastSpread.spread >= 0 ? '+' : ''}${lastSpread.spread.toFixed(2)}
              </TagBadge>
            )}
          </div>
          <SpreadChart />
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-[10px] mb-3">
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[12px] font-medium">US Crude Inventory (EIA Weekly)</div>
              <div className="text-[11px] text-text-muted mt-[1px]">
                Grey band = 5yr avg ±1σ{invPctAboveAvg != null && ` · Current ${invPctAboveAvg >= 0 ? '+' : ''}${invPctAboveAvg}% vs avg`}
              </div>
            </div>
            {invPctAboveAvg != null && (
              <TagBadge kind={invPctAboveAvg >= 0 ? 'red' : 'blue'}>
                {invPctAboveAvg >= 0 ? '+' : ''}
                {invPctAboveAvg}% vs avg
              </TagBadge>
            )}
          </div>
          <InventoryChart />
        </Card>
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[12px] font-medium">WTI Futures Curve Structure</div>
              <div className="text-[11px] text-text-muted mt-[1px]">Today (red) vs 3 months ago (grey)</div>
            </div>
            {curveDiff != null && (
              <TagBadge kind="red">
                {isContango ? 'Contango' : 'Backwardation'} {curveDiff >= 0 ? '+' : ''}${curveDiff.toFixed(2)}
              </TagBadge>
            )}
          </div>
          <CurveChart />
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-[10px]">
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[12px] font-medium">OVX + VIX Volatility Indices</div>
              <div className="text-[11px] text-text-muted mt-[1px]">Low OVX = cheap option protection</div>
            </div>
            {lastOvxVix && (
              <div className="flex gap-[6px]">
                <TagBadge kind="muted">OVX {lastOvxVix.ovx.toFixed(1)}</TagBadge>
                <TagBadge kind="muted">VIX {lastOvxVix.vix.toFixed(1)}</TagBadge>
              </div>
            )}
          </div>
          <VolatilityChart />
        </Card>
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[12px] font-medium">COT Speculative Net (CFTC Weekly)</div>
              <div className="text-[11px] text-text-muted mt-[1px]">
                Positive=net long · Negative=net short
                {cotPctile != null && ` · Current: ${cotPctile}th percentile (18mo)`}
              </div>
            </div>
            {lastCot && cotPctile != null && (
              <TagBadge kind={lastCot.net_k >= 0 ? 'blue' : 'red'}>
                Net {lastCot.net_k >= 0 ? 'long' : 'short'}, {cotPctile}th percentile
              </TagBadge>
            )}
          </div>
          <COTChart />
        </Card>
      </div>
    </>
  );
}
