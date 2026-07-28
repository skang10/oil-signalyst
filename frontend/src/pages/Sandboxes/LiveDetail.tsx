import { fmt, fmtSkill, skillOf, type EiaModel } from '@/lib/workbench';
import type { ModelStatus } from '@/types/api';
import { DetailHeader, SecondaryAction, KV, CardBox, GateChips } from './detail-parts';

/** Detail for the production pointer — the active EIA ModelVersion. No promote
 *  decision (it's already live); the meaningful actions are Compare and the
 *  read-only gate/lineage. */
export default function LiveDetail({
  live,
  gate,
  onBack,
  onCompare,
}: {
  live: EiaModel;
  gate: ModelStatus['deployment_gate'];
  onBack: () => void;
  onCompare: () => void;
}) {
  const skill = skillOf(live.metrics.primary, live.metrics.baseline);
  const recent = live.metrics.recent;

  return (
    <>
      <DetailHeader
        life="production"
        title={
          <>
            eia · {live.version}
            <span className="font-mono text-[11px] font-normal text-[#8792AB]">production</span>
          </>
        }
        lineage={
          <>
            {live.previous ? (
              <>
                displaced <b className="text-[#C6CCDA]">eia · {live.previous.version}</b>
                {live.previous.skill != null && <> (skill {fmtSkill(live.previous.skill)})</>} ·{' '}
              </>
            ) : (
              <>first version ever deployed for this type · </>
            )}
            <span className="text-[#7C879E]">forks/children aren’t tracked server-side — TODO(api).</span>
          </>
        }
        decision={
          <div className="flex items-center gap-3 flex-wrap mt-[14px] p-[12px_14px] bg-[#20293F] border border-[#333E5C] rounded-[9px]">
            <span className="font-mono text-[11px] text-[#A7B0C4] leading-[1.5]">
              This is the live pointer. Automation (the weekly rolling refresh) keeps it current in
              place; a new config only goes live when you promote a run in the sandbox list.
            </span>
          </div>
        }
        secondary={
          <>
            <SecondaryAction onClick={onCompare}>Compare vs previous</SecondaryAction>
            <SecondaryAction disabled title="No fork/parent relationship is stored server-side yet (TODO(api)).">
              Fork this
            </SecondaryAction>
          </>
        }
        onBack={onBack}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px]">
        <CardBox title="Pinned config">
          <KV k="Version" v={live.version} />
          <KV k="Deployed" v={live.deployed_at ? live.deployed_at.slice(0, 16).replace('T', ' ') : '—'} />
          <KV k="Metric" v={(live.metric_key ?? 'mae').toUpperCase()} />
          <KV k="Input PSI" v={fmt(live.metrics.psi, 2)} />
          <KV k="Gate" v={live.gate_passed == null ? '—' : live.gate_passed ? 'passed' : 'manual override'} />
          <KV k="MLflow run" v={live.mlflow_run_id ? live.mlflow_run_id.slice(0, 12) : '—'} />
        </CardBox>

        <CardBox title="Headline">
          <div className="flex items-baseline gap-[10px]">
            <div className="font-mono text-[28px] font-semibold tracking-[-0.02em]">{fmt(live.metrics.primary, 2)}</div>
            <div className="font-mono text-[12px] text-text-secondary">MAE, mb</div>
          </div>
          <div className="font-mono text-[11px] text-text-muted mt-[8px]">
            baseline train-mean {fmt(live.metrics.baseline, 2)} · skill{' '}
            <span className={skill != null && skill < 0 ? 'text-danger' : 'text-success'}>{fmtSkill(skill)}</span>
          </div>
          {recent?.primary != null && (
            <div className="font-mono text-[11px] text-text-muted mt-[6px]">
              last 6mo: {fmt(recent.primary, 2)}
              {recent.baseline != null && <> / baseline {fmt(recent.baseline, 2)}</>} · n≈{recent.effective_n ?? '—'} independent
            </div>
          )}
        </CardBox>
      </div>

      <div className="mt-[14px]">
        <GateChips gate={gate} verdict={live.gate_passed ?? null} />
      </div>
    </>
  );
}
