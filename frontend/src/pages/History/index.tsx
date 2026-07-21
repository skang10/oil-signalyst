import { useState } from 'react';
import { IconChevronRight } from '@tabler/icons-react';
import PageHeader from '@/components/shared/PageHeader';
import Card from '@/components/shared/Card';
import TagBadge from '@/components/shared/TagBadge';
import { useHistory } from '@/hooks/useHistory';
import HistoryDrawer from './HistoryDrawer';

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function HistoryPage() {
  const { data: history } = useHistory();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="p-[18px] overflow-y-auto flex-1">
      <PageHeader title="History" sub="Past predictions vs actual outcomes" />

      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
          Prediction Log (Last {history?.predictions.length ?? 0} Days)
        </div>
        {history?.predictions.map((p) => (
          <div
            key={p.date}
            onClick={() => setSelected(p.date)}
            className="flex items-center gap-[10px] p-[7px_10px] bg-surface-1 rounded-default text-[12px] mb-[6px] last:mb-0 cursor-pointer hover:bg-surface-2"
          >
            <span className="text-text-muted w-[68px] shrink-0 text-[11px]">{formatShortDate(p.date)}</span>
            <TagBadge kind="red">{p.regime_dominant}</TagBadge>
            <span className="flex-1 text-text-secondary">
              Expected {(p.expected_return * 100).toFixed(1)}% · Downside {Math.round(p.downside_prob * 100)}%
            </span>
            <span className={`text-[11px] ${(p.eia_forecast_mb ?? 0) < 0 ? 'text-text-muted' : 'text-success'}`}>
              EIA {p.eia_forecast_mb == null ? '—' : `${p.eia_forecast_mb > 0 ? '+' : ''}${p.eia_forecast_mb.toFixed(1)} MB`}
            </span>
            <IconChevronRight size={13} stroke={1.75} className="text-text-muted" />
          </div>
        ))}
      </Card>

      <Card>
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
          Model Accuracy (Rolling 30 Days)
        </div>
        {/* No regime tile: its "accuracy" compared the model against a
            hardcoded table of transition dates rather than an observed
            outcome, so it sat here looking comparable to the two below when
            it measured something else entirely. */}
        <div className="flex gap-6">
          <div>
            <div className="text-[11px] text-text-muted">EIA Directional Acc.</div>
            <div className="text-[20px] font-medium mt-[2px]">
              {Math.round((history?.rolling_accuracy.eia_directional_acc ?? 0) * 100)}%
            </div>
          </div>
          <div>
            <div className="text-[11px] text-text-muted">Return Dist. Brier</div>
            {/* Same ?? guard as the tile above - without it this rendered
                blank while SWR was still loading. */}
            <div className="text-[20px] font-medium mt-[2px]">
              {(history?.rolling_accuracy.returns_brier ?? 0).toFixed(2)}
            </div>
          </div>
        </div>
      </Card>

      <HistoryDrawer date={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
