import { Fragment, useState } from 'react';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import Card from '@/components/shared/Card';
import { TriggerBadge, TrainStatusBadge } from '@/components/shared/TrainBadges';
import { useTrainJobs } from '@/hooks/useTraining';
import { cn } from '@/lib/utils';
import RunDetailPanel from './RunDetailPanel';
import type { TrainJobSummary, TrainTriggerFilter } from '@/types/api';

const PAGE_SIZE = 10;

const FILTERS: { key: TrainTriggerFilter | undefined; label: string }[] = [
  { key: undefined, label: 'All' },
  { key: 'manual', label: 'Manual' },
  { key: 'auto', label: 'Auto' },
  { key: 'agent', label: 'DS Agent' },
];

// started_at is "YYYY-MM-DD HH:MM:SS" (naive UTC straight from the DB, same
// convention the rest of the UI shows). Sliced, not Date-parsed - parsing
// would silently shift it into browser-local time.
function fmtStarted(s: string | null): string {
  return s ? `${s.slice(5, 10)} · ${s.slice(11, 16)}` : '—';
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function ResultCell({ job }: { job: TrainJobSummary }) {
  if (job.status === 'failed') {
    return <span className="text-danger truncate block">{job.error ?? 'failed'}</span>;
  }
  if (!job.summary) return <span className="text-text-muted">—</span>;
  const { improved, of } = job.summary;
  return (
    <span className={cn('font-medium', improved > 0 ? 'text-success' : 'text-danger')}>
      {improved > 0 ? '▲' : '▼'} {improved}/{of} improved
    </span>
  );
}

function DeployCell({ job }: { job: TrainJobSummary }) {
  const state = job.deploy_state;
  if (state === 'live') return <span className="text-success font-medium">● Live</span>;
  if (state === 'partial') return <span className="text-warning">◐ Partial</span>;
  // 'blocked' is not 'superseded': it never went live at all, because the
  // deployment gate rejected it. The reason rides in the tooltip.
  if (state === 'blocked')
    return (
      <span className="text-warning" title={job.blocked_reasons?.join('\n')}>
        ⨯ Blocked
      </span>
    );
  if (state === 'superseded') return <span className="text-text-muted">Superseded</span>;
  return <span className="text-text-muted">—</span>;
}

const GRID = 'grid grid-cols-[20px_110px_150px_1fr_75px_130px_90px_100px] items-center gap-x-2';

export default function TrainingHistoryCard() {
  const [trigger, setTrigger] = useState<TrainTriggerFilter | undefined>(undefined);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data } = useTrainJobs(limit, trigger);

  const jobs = data?.jobs ?? [];
  const total = data?.total ?? 0;

  return (
    <Card className="mb-3" style={{ padding: 0 }}>
      <div className="flex items-center p-[14px_16px] pb-0">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium">Training History</div>
        <div className="flex gap-[6px] ml-auto">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => {
                setTrigger(f.key);
                setLimit(PAGE_SIZE);
                setExpandedId(null);
              }}
              className={cn(
                'text-[11px] px-[10px] py-[3px] rounded-[20px] border cursor-pointer',
                trigger === f.key
                  ? 'bg-accent-bg border-accent-border text-accent-text font-medium'
                  : 'bg-surface-2 border-border-strong text-text-secondary'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-[10px] overflow-x-auto">
        <div className="min-w-[860px]">
          <div className={cn(GRID, 'bg-surface-1 text-[10.5px] font-medium text-text-muted uppercase tracking-[0.4px] px-[16px] py-[7px]')}>
            <div />
            <div>Run</div>
            <div>Trigger</div>
            <div>Models</div>
            <div className="text-right">Duration</div>
            <div className="text-right">Result</div>
            <div>Status</div>
            <div>Deployed</div>
          </div>

          {jobs.length === 0 && (
            <div className="px-[16px] py-[14px] text-[12px] text-text-muted">
              {data ? 'No training runs yet.' : 'Loading…'}
            </div>
          )}

          {jobs.map((job) => {
            const open = expandedId === job.job_id;
            return (
              <Fragment key={job.job_id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedId(open ? null : job.job_id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedId(open ? null : job.job_id);
                    }
                  }}
                  className={cn(
                    GRID,
                    'px-[16px] py-[8px] text-[12px] border-t border-border cursor-pointer',
                    open ? 'bg-accent-bg' : 'hover:bg-surface-1'
                  )}
                >
                  <div className="text-text-muted">
                    {open ? <IconChevronDown size={13} stroke={1.75} /> : <IconChevronRight size={13} stroke={1.75} />}
                  </div>
                  <div>
                    <div className="font-mono text-[11.5px] font-medium">{job.job_id}</div>
                    <div className="text-[10.5px] text-text-muted tabular-nums">{fmtStarted(job.started_at)}</div>
                  </div>
                  <div>
                    <TriggerBadge source={job.trigger_source} name={job.triggered_by_name} />
                  </div>
                  <div className="flex gap-[4px] flex-wrap">
                    {job.model_types.map((t) => (
                      <span key={t} className="font-mono text-[10.5px] px-[7px] py-[1px] rounded-[4px] bg-surface-1 border border-border text-text-secondary">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="text-right tabular-nums text-text-secondary text-[11.5px]">{fmtDuration(job.duration_seconds)}</div>
                  <div className="text-right text-[11.5px] min-w-0"><ResultCell job={job} /></div>
                  <div><TrainStatusBadge status={job.status} /></div>
                  <div className="text-[11px]"><DeployCell job={job} /></div>
                </div>
                {open && <RunDetailPanel job={job} />}
              </Fragment>
            );
          })}
        </div>
      </div>

      {jobs.length < total ? (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE_SIZE)}
          className="w-full text-center text-[11.5px] text-accent-text py-[8px] border-t border-border cursor-pointer bg-transparent"
        >
          Load {Math.min(PAGE_SIZE, total - jobs.length)} more ({jobs.length} of {total})
        </button>
      ) : (
        jobs.length > 0 && <div className="border-t border-border py-[6px]" />
      )}
    </Card>
  );
}
