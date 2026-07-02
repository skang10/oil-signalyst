import PageHeader from '@/components/shared/PageHeader';

export default function TrainingPage() {
  return (
    <div className="content-inner p-[18px] overflow-y-auto flex-1">
      <PageHeader title="Training Control" sub="Configure and trigger model retraining" />
      <div className="text-text-muted text-[12px]">Training Control page — CP6</div>
    </div>
  );
}
