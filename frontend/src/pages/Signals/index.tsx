import { useNavigate } from 'react-router-dom';
import { IconClockPause } from '@tabler/icons-react';
import { useSignals } from '@/hooks/useSignals';
import { useRestoreSignal } from '@/hooks/useFeaturePool';
import { useRole } from '@/context/RoleContext';
import { ROLE_PERMISSIONS } from '@/types/roles';
import PageHeader from '@/components/shared/PageHeader';
import Card from '@/components/shared/Card';
import FeaturePoolCard from './FeaturePoolCard';
import SignalRow from './SignalRow';

export default function SignalsPage() {
  const { data } = useSignals();
  const navigate = useNavigate();
  const restore = useRestoreSignal();
  const { role } = useRole();
  const canWrite = ROLE_PERMISSIONS.signalWrite.includes(role);

  // Snoozed candidates live in their own section below; the scanner's own
  // 'rejected' verdicts (ignored with no expiry) stay in the main list with
  // their Reject recommendation visible.
  const snoozed = data?.candidates.filter((c) => c.ignored_days_left != null) ?? [];
  const candidates = data?.candidates.filter((c) => c.ignored_days_left == null) ?? [];

  return (
    <div className="p-[18px] overflow-y-auto flex-1">
      <PageHeader title="Signals" sub="Feature Pool · Signal Scanner Candidates" />

      <FeaturePoolCard pool={data?.pool ?? []} />

      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">New Signal Candidates</div>
        {candidates.map((c) => (
          <SignalRow key={c.name} candidate={c} onEvaluate={() => navigate(`/signals/evaluate/${c.name}`)} />
        ))}
        {candidates.length === 0 && <div className="text-[12px] text-text-muted">No candidates awaiting review.</div>}
      </Card>

      {snoozed.length > 0 && (
        <Card>
          <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
            Ignored ({snoozed.length}) — auto-restore after 30 days
          </div>
          {snoozed.map((c) => (
            <div
              key={c.name}
              className="flex items-center gap-[10px] p-[8px_10px] bg-surface-1 rounded-default text-[12px] mb-[6px] last:mb-0 opacity-70"
            >
              <IconClockPause size={15} stroke={1.75} className="text-text-muted shrink-0" />
              <span className="flex-1 text-text-secondary">{c.label}</span>
              <span className="text-[11px] text-text-muted">
                auto-restores in {c.ignored_days_left}d
              </span>
              {canWrite && (
                <button
                  type="button"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(c.name)}
                  className="px-[10px] py-[3px] text-[11px] border border-border-strong bg-surface-2 rounded-default cursor-pointer hover:bg-surface-1 disabled:opacity-50"
                >
                  Restore now
                </button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
