import { Fragment } from 'react';
import { useTrainJobDetail } from '@/hooks/useTraining';
import { fmt, fmtSkill, skillOf, runLifecycle, fmtStarted, fmtDuration } from '@/lib/workbench';
import type { ModelStatus, TrainJobSummary } from '@/types/api';
import { DetailHeader, SecondaryAction, KV, CardBox, GateChips, CvFoldsTable } from './detail-parts';
import DeployDecision from './DeployDecision';

/** Detail for a single training run (an "experiment"). Config, frozen
 *  walk-forward or old/new results, the deployment gate, and the one promote
 *  decision — all from the real job record. */
export default function RunDetail({
  summary,
  gate,
  onBack,
  onCompare,
}: {
  summary: TrainJobSummary;
  gate: ModelStatus['deployment_gate'];
  onBack: () => void;
  onCompare: () => void;
}) {
  const { data: job, mutate } = useTrainJobDetail(summary.job_id);
  const { life, pill } = runLifecycle(summary);

  const result = job?.result;
  const cvModels = result?.models;
  const newMetrics = result?.new_metrics;
  const oldMetrics = result?.old_metrics;
  const baselines = result?.baselines;
  const oldBaselines = result?.old_baselines;

  const verdict: boolean | null = result?.deployed?.eia
    ? true
    : (result?.blocked_reasons?.eia?.length ?? 0) > 0
      ? false
      : null;

  return (
    <>
      <DetailHeader
        life={life}
        title={
          <>
            {summary.job_id}
            <span className="font-mono text-[11px] font-normal text-[#8792AB]">{pill.label}</span>
          </>
        }
        lineage={
          <>
            {result?.old_versions?.eia ? (
              <>trained against live version <b className="text-[#C6CCDA]">{result.old_versions.eia}</b> · </>
            ) : null}
            {result?.versions?.eia ? (
              <>produced <b className="text-[#C6CCDA]">eia · {result.versions.eia}</b>. </>
            ) : null}
            <span className="text-[#7C879E]">
              Fork lineage (parent / children) isn’t tracked server-side yet — TODO(api).
            </span>
          </>
        }
        decision={job ? <DeployDecision job={job} deployState={summary.deploy_state} blocked={verdict === false} onDeployed={() => mutate()} /> : undefined}
        secondary={
          <>
            <SecondaryAction onClick={onCompare}>Compare with production</SecondaryAction>
            <SecondaryAction disabled title="No fork/parent relationship is stored server-side yet (TODO(api)).">
              Fork this
            </SecondaryAction>
          </>
        }
        onBack={onBack}
      />

      {!job && <div className="text-[12px] text-text-muted px-1">Loading run…</div>}

      {job && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px]">
          <CardBox title="Pinned config">
            <KV k="Run id" v={job.job_id} />
            <KV k="Trigger" v={`${summary.trigger_source}${summary.triggered_by_name ? ` · ${summary.triggered_by_name}` : ''}`} />
            <KV k="Models" v={job.model_types.join(', ')} />
            <KV k="Version" v={result?.versions?.eia ?? '—'} />
            <KV k="Started" v={fmtStarted(job.started_at)} />
            <KV k="Duration" v={fmtDuration(summary.duration_seconds)} />
          </CardBox>

          <CardBox title="Headline">
            {newMetrics?.eia_mae != null ? (
              <>
                <div className="flex items-baseline gap-[10px]">
                  <div className="font-mono text-[28px] font-semibold tracking-[-0.02em]">
                    {fmt(newMetrics.eia_mae, 2)}
                  </div>
                  <div className="font-mono text-[12px] text-text-secondary">MAE, mb</div>
                </div>
                <div className="font-mono text-[11px] text-text-muted mt-[8px]">
                  baseline {fmt(baselines?.eia_mae, 2)} · skill {fmtSkill(skillOf(newMetrics.eia_mae, baselines?.eia_mae ?? null))}
                  {result?.improvement_pct != null && (
                    <> · {result.improvement_pct >= 0 ? '+' : ''}{(result.improvement_pct * 100).toFixed(1)}% vs live</>
                  )}
                </div>
              </>
            ) : cvModels?.eia ? (
              <>
                <div className="flex items-baseline gap-[10px]">
                  <div className="font-mono text-[28px] font-semibold tracking-[-0.02em]">
                    {fmt(cvModels.eia.mean, 2)}
                  </div>
                  <div className="font-mono text-[12px] text-text-secondary">mean MAE across folds</div>
                </div>
                <div className="font-mono text-[11px] text-text-muted mt-[8px]">
                  ± {fmt(cvModels.eia.std, 2)} · {cvModels.eia.n_beat_baseline}/{cvModels.eia.n_folds} folds beat baseline
                </div>
              </>
            ) : (
              <div className="text-[12px] text-text-muted">
                {job.status === 'failed'
                  ? `Failed — ${result?.error ?? 'no metrics recorded'}.`
                  : 'No metrics recorded for this run.'}
              </div>
            )}
          </CardBox>
        </div>
      )}

      {/* Old vs new comparison for a full-training run */}
      {job && newMetrics && (
        <div className="mt-[14px]">
          <CardBox title="Old vs new" note="skill divides out each version's own test-window difficulty">
            <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr] gap-y-1 text-[12px]">
              {['Metric', 'Old', 'New', 'Baseline', 'Skill new'].map((h) => (
                <div key={h} className="text-[10.5px] font-mono uppercase tracking-[0.4px] text-text-muted pb-1">
                  {h}
                </div>
              ))}
              {Object.keys(newMetrics).map((k) => (
                <Fragment key={k}>
                  <div className="border-t border-border py-[6px] text-text-secondary">{k}</div>
                  <div className="border-t border-border py-[6px] font-mono text-right text-text-muted">{fmt(oldMetrics?.[k], 3)}</div>
                  <div className="border-t border-border py-[6px] font-mono text-right font-medium">{fmt(newMetrics[k], 3)}</div>
                  <div className="border-t border-border py-[6px] font-mono text-right text-text-muted">{fmt(baselines?.[k], 3)}</div>
                  <div className="border-t border-border py-[6px] font-mono text-right">{fmtSkill(skillOf(newMetrics[k], baselines?.[k] ?? null))}</div>
                </Fragment>
              ))}
            </div>
            {oldBaselines?.eia_mae != null && (
              <div className="text-[11px] text-text-muted mt-[8px]">
                Old skill {fmtSkill(skillOf(oldMetrics?.eia_mae ?? null, oldBaselines.eia_mae))} on its own window.
              </div>
            )}
          </CardBox>
        </div>
      )}

      {/* Walk-forward folds for a cross-validate run */}
      {job && cvModels?.eia && (
        <div className="mt-[14px]">
          <CvFoldsTable m={cvModels.eia} type="eia" />
        </div>
      )}

      {job && (
        <div className="mt-[14px]">
          <GateChips gate={gate} verdict={verdict} blockedReasons={result?.blocked_reasons?.eia} />
        </div>
      )}
    </>
  );
}
