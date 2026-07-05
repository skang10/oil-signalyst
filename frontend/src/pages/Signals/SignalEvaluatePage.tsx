import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRole } from '@/context/RoleContext';
import { useSignals } from '@/hooks/useSignals';
import { useAddToPool, useIgnoreSignal } from '@/hooks/useFeaturePool';
import { useSignalEvaluation } from '@/hooks/useSignalEvaluation';
import { ROLE_PERMISSIONS } from '@/types/roles';
import PageHeader from '@/components/shared/PageHeader';
import Card from '@/components/shared/Card';
import SignalSelectorTabs from './SignalSelectorTabs';
import ICStatsRow from './ICStatsRow';
import LagSwitcher, { type Lag } from './LagSwitcher';
import SignalRow from './SignalRow';
import SignalPriceOverlayChart from '@/components/charts/SignalPriceOverlayChart';
import RollingICChart from '@/components/charts/RollingICChart';
import OOSByYearChart from '@/components/charts/OOSByYearChart';

const IC_SERIES_KEY: Record<Lag, 'ic5_series' | 'ic10_series' | 'ic20_series'> = {
  5: 'ic5_series',
  10: 'ic10_series',
  20: 'ic20_series',
};

export default function SignalEvaluatePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { role } = useRole();
  const { data: signals } = useSignals();
  const { data: evaluation } = useSignalEvaluation(name!);
  const [lag, setLag] = useState<Lag>(5);
  const addToPool = useAddToPool();
  const ignore = useIgnoreSignal();

  const canWrite = ROLE_PERMISSIONS.signalWrite.includes(role);

  if (!signals || !evaluation) return <div className="p-[18px] text-text-muted text-[12px]">Loading...</div>;

  const inPool = evaluation.status === 'active';
  const isIgnored = evaluation.ignored_days_left != null;

  return (
    <div className="p-[18px] overflow-y-auto flex-1">
      <PageHeader title="Signal Evaluation" sub="Select a candidate signal to view IC, OOS decay and historical charts" />

      <SignalSelectorTabs
        candidates={signals.candidates}
        active={evaluation.name}
        onSelect={(n) => navigate(`/signals/evaluate/${n}`)}
      />

      <ICStatsRow evaluation={evaluation} />

      <Card className="mb-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[12px] font-medium">Price vs Signal Overlay (dual Y-axis)</div>
            <div className="text-[11px] text-text-muted mt-[1px]">WTI close + {evaluation.label.toLowerCase()} (normalised)</div>
          </div>
          <div className="flex gap-4">
            <div className="flex items-center gap-[5px] text-[11px] text-text-muted">
              <span className="w-4 h-[2px] bg-[#378ADD]" /> WTI Price
            </div>
            <div className="flex items-center gap-[5px] text-[11px] text-text-muted">
              <span className="w-4 h-0 border-t-2 border-dashed border-[#BA7517]" /> Signal
            </div>
          </div>
        </div>
        <SignalPriceOverlayChart key={evaluation.name} price={evaluation.price} signal={evaluation.signal} dates={evaluation.dates} />
      </Card>

      <Card className="mb-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[12px] font-medium">Rolling IC (52-week window)</div>
            <div className="text-[11px] text-text-muted mt-[1px]">Spearman IC, higher = more stable</div>
          </div>
          <LagSwitcher lag={lag} onChange={setLag} />
        </div>
        <RollingICChart key={`${evaluation.name}-${lag}`} series={evaluation[IC_SERIES_KEY[lag]]} dates={evaluation.dates} />
        <div className="flex gap-4 mt-[6px]">
          <div className="flex items-center gap-[5px] text-[11px] text-text-muted">
            <span className="w-4 h-[2px] bg-[#378ADD]" /> Rolling IC
          </div>
          <div className="flex items-center gap-[5px] text-[11px] text-text-muted">
            <span className="w-4 h-0 border-t border-dashed border-[#E24B4A]" /> IC=0 baseline
          </div>
        </div>
      </Card>

      <Card className="mb-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[12px] font-medium">Year-by-Year OOS (Train IC vs Out-of-Sample IC)</div>
            <div className="text-[11px] text-text-muted mt-[1px]">Each year as independent OOS test set, checking stability</div>
          </div>
          <div className="flex gap-4">
            <div className="flex items-center gap-[5px] text-[11px] text-text-muted">
              <span className="w-2 h-2 rounded-full bg-accent-fill" /> Train IC
            </div>
            <div className="flex items-center gap-[5px] text-[11px] text-text-muted">
              <span className="w-2 h-2 rounded-full" style={{ background: '#97C459' }} /> OOS IC
            </div>
          </div>
        </div>
        <OOSByYearChart key={evaluation.name} oosYears={evaluation.oos_years} />
      </Card>

      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">All Candidate Signals</div>
        {signals.candidates.map((c) => (
          <SignalRow
            key={c.name}
            candidate={c}
            active={c.name === evaluation.name}
            onClick={() => navigate(`/signals/evaluate/${c.name}`)}
            onEvaluate={() => navigate(`/signals/evaluate/${c.name}`)}
          />
        ))}
      </Card>

      {canWrite && (
        <div className="flex gap-2 items-center">
          <button
            type="button"
            disabled={inPool || isIgnored || addToPool.isPending}
            onClick={() => addToPool.mutate(evaluation.name)}
            className="px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-accent-fill text-on-accent border border-accent-fill disabled:opacity-50"
          >
            {inPool
              ? 'In feature pool ✓'
              : addToPool.isPending
                ? 'Adding...'
                : `Add "${evaluation.label}" to feature pool ↗`}
          </button>
          <button
            type="button"
            disabled={inPool || isIgnored || ignore.isPending}
            onClick={() => ignore.mutate(evaluation.name)}
            className="px-[14px] py-[6px] text-[12px] rounded-default cursor-pointer bg-surface-2 border border-border-strong disabled:opacity-50"
          >
            {isIgnored
              ? `Ignored · auto-restores in ${evaluation.ignored_days_left}d`
              : ignore.isPending
                ? 'Ignoring...'
                : 'Ignore for 30 days'}
          </button>
          {(addToPool.isError || ignore.isError) && (
            <span className="text-[11.5px] text-danger">
              {String((addToPool.error ?? ignore.error) as Error)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
