import PageHeader from '@/components/shared/PageHeader';

export default function HistoryPage() {
  return (
    <div className="content-inner p-[18px] overflow-y-auto flex-1">
      <PageHeader title="History" sub="Past predictions vs actual outcomes" />
      <div className="text-text-muted text-[12px]">History page — CP4</div>
    </div>
  );
}
