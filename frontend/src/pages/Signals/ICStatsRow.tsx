import type { SignalEvaluation } from '@/types/api';
import TagBadge from '@/components/shared/TagBadge';

export default function ICStatsRow({ evaluation }: { evaluation: SignalEvaluation }) {
  const recommended = evaluation.recommendation === 'add';
  return (
    <div className="grid grid-cols-5 gap-[10px] mb-[14px]">
      <div className="bg-surface-1 rounded-default p-[10px_12px]">
        <div className="text-[11px] text-text-muted mb-1">IC (lag 5d)</div>
        <div className="text-[18px] font-medium text-success">{evaluation.ic5.toFixed(2)}</div>
      </div>
      <div className="bg-surface-1 rounded-default p-[10px_12px]">
        <div className="text-[11px] text-text-muted mb-1">IC (lag 20d)</div>
        <div className="text-[18px] font-medium text-success">{evaluation.ic20.toFixed(2)}</div>
      </div>
      <div className="bg-surface-1 rounded-default p-[10px_12px]">
        <div className="text-[11px] text-text-muted mb-1">OOS decay</div>
        <div className={`text-[18px] font-medium ${evaluation.decay < 0.25 ? 'text-success' : 'text-warning'}`}>
          {Math.round(evaluation.decay * 100)}%
        </div>
      </div>
      <div className="bg-surface-1 rounded-default p-[10px_12px]">
        <div className="text-[11px] text-text-muted mb-1">Coverage</div>
        <div className="text-[18px] font-medium">{Math.round(evaluation.coverage * 100)}%</div>
      </div>
      <div className="bg-surface-1 rounded-default p-[10px_12px]">
        <div className="text-[11px] text-text-muted mb-1">Recommendation</div>
        <TagBadge kind={recommended ? 'green' : 'yellow'}>{recommended ? 'Recommended' : 'Watch'}</TagBadge>
      </div>
    </div>
  );
}
