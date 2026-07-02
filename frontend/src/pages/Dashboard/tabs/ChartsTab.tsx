import { Chart, registerables } from 'chart.js';
import Card from '@/components/shared/Card';
import TagBadge from '@/components/shared/TagBadge';
import WTIPriceChart from '@/components/charts/WTIPriceChart';
import SpreadChart from '@/components/charts/SpreadChart';
import InventoryChart from '@/components/charts/InventoryChart';
import CurveChart from '@/components/charts/CurveChart';
import VolatilityChart from '@/components/charts/VolatilityChart';
import COTChart from '@/components/charts/COTChart';

Chart.register(...registerables);

export default function ChartsTab() {
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
            <TagBadge kind="red">Current $78.40</TagBadge>
          </div>
          <WTIPriceChart />
        </Card>
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[12px] font-medium">Brent-WTI Spread</div>
              <div className="text-[11px] text-text-muted mt-[1px]">Widening spread reflects export premium or transport costs</div>
            </div>
            <TagBadge kind="blue">Current +$3.2</TagBadge>
          </div>
          <SpreadChart />
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-[10px] mb-3">
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[12px] font-medium">US Crude Inventory (EIA Weekly)</div>
              <div className="text-[11px] text-text-muted mt-[1px]">Grey band = 5yr avg ±1σ · Current +8.2% above avg</div>
            </div>
            <TagBadge kind="red">+8.2% above avg</TagBadge>
          </div>
          <InventoryChart />
        </Card>
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[12px] font-medium">WTI Futures Curve Structure</div>
              <div className="text-[11px] text-text-muted mt-[1px]">Today (red) vs 3 months ago (grey)</div>
            </div>
            <TagBadge kind="red">Contango +$2.4</TagBadge>
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
            <div className="flex gap-[6px]">
              <TagBadge kind="muted">OVX 28.4</TagBadge>
              <TagBadge kind="muted">VIX 18.2</TagBadge>
            </div>
          </div>
          <VolatilityChart />
        </Card>
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[12px] font-medium">COT Speculative Net (CFTC Weekly)</div>
              <div className="text-[11px] text-text-muted mt-[1px]">Positive=net long · Negative=net short · Current: 22nd percentile</div>
            </div>
            <TagBadge kind="red">Net short, 22nd percentile</TagBadge>
          </div>
          <COTChart />
        </Card>
      </div>
    </>
  );
}
