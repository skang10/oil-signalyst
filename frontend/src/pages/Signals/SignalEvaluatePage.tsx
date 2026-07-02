import { useParams } from 'react-router-dom';
import PageHeader from '@/components/shared/PageHeader';

export default function SignalEvaluatePage() {
  const { name } = useParams<{ name: string }>();
  return (
    <div className="content-inner p-[18px] overflow-y-auto flex-1">
      <PageHeader title={`Evaluate: ${name}`} sub="Signal candidate evaluation" />
      <div className="text-text-muted text-[12px]">Signal Evaluate page — CP5</div>
    </div>
  );
}
