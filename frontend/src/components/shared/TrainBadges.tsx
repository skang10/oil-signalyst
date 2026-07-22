import TagBadge, { type TagKind } from './TagBadge';
import type { TrainJobSummary, TrainTriggerSource } from '@/types/api';

const TRIGGER_LABEL: Record<TrainTriggerSource, string> = {
  manual: 'Manual',
  'auto:psi': 'Auto · PSI',
  'auto:sunday': 'Auto · Sunday',
  agent: 'DS Agent',
};

const TRIGGER_KIND: Record<TrainTriggerSource, TagKind> = {
  manual: 'muted',
  'auto:psi': 'yellow',
  'auto:sunday': 'yellow',
  agent: 'purple',
};

export function TriggerBadge({
  source,
  name,
}: {
  source: TrainTriggerSource;
  name?: string | null;
}) {
  const label =
    source === 'manual' && name ? `Manual · ${name}` : (TRIGGER_LABEL[source] ?? source);
  return <TagBadge kind={TRIGGER_KIND[source] ?? 'muted'}>{label}</TagBadge>;
}

const STATUS_KIND: Record<TrainJobSummary['status'], TagKind> = {
  queued: 'blue',
  running: 'blue',
  complete: 'green',
  failed: 'red',
  cancelled: 'muted',
};

export function TrainStatusBadge({ status }: { status: TrainJobSummary['status'] }) {
  return (
    <TagBadge kind={STATUS_KIND[status]}>
      {status[0].toUpperCase() + status.slice(1)}
    </TagBadge>
  );
}
