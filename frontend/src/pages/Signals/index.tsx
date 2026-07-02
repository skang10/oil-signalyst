import { useNavigate } from 'react-router-dom';
import { useSignals } from '@/hooks/useSignals';
import PageHeader from '@/components/shared/PageHeader';
import Card from '@/components/shared/Card';
import FeatureTagCloud from './FeatureTagCloud';
import SignalRow from './SignalRow';

export default function SignalsPage() {
  const { data } = useSignals();
  const navigate = useNavigate();

  return (
    <div className="p-[18px] overflow-y-auto flex-1">
      <PageHeader title="Signals" sub="Active Features · Signal Scanner Candidates" />

      <Card className="mb-3">
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">
          Active Features ({data?.active.length ?? 0})
        </div>
        <FeatureTagCloud features={data?.active ?? []} />
      </Card>

      <Card>
        <div className="text-[11px] text-text-muted uppercase tracking-[0.5px] font-medium mb-[10px]">New Signal Candidates</div>
        {data?.candidates.map((c) => (
          <SignalRow key={c.name} candidate={c} onEvaluate={() => navigate(`/signals/evaluate/${c.name}`)} />
        ))}
      </Card>
    </div>
  );
}
