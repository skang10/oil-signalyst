import PageHeader from '@/components/shared/PageHeader';

export default function ModelMonitorPage() {
  return (
    <div className="content-inner p-[18px] overflow-y-auto flex-1">
      <PageHeader title="Model Monitor" sub="Model versions · PSI trends · Stress tests" />
      <div className="text-text-muted text-[12px]">Model Monitor page — CP6</div>
    </div>
  );
}
