import PageHeader from '@/components/shared/PageHeader';

export default function SettingsPage() {
  return (
    <div className="content-inner p-[18px] overflow-y-auto flex-1">
      <PageHeader title="Settings" sub="Identity · Alert thresholds" />
      <div className="text-text-muted text-[12px]">Settings page — CP7</div>
    </div>
  );
}
