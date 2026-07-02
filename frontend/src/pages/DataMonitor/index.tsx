import PageHeader from '@/components/shared/PageHeader';

export default function DataMonitorPage() {
  return (
    <div className="content-inner p-[18px] overflow-y-auto flex-1">
      <PageHeader title="Data Monitor" sub="Source status · Feature coverage · Drift" />
      <div className="text-text-muted text-[12px]">Data Monitor page — CP6</div>
    </div>
  );
}
