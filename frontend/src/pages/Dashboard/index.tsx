import { useEffect, useState } from 'react';
import { useRole } from '@/context/RoleContext';
import { ROLE_PERMISSIONS, type DashTab } from '@/types/roles';
import { useModelStatus } from '@/hooks/useModelStatus';
import { useReport } from '@/hooks/useReport';
import AlertBanner from '@/components/shared/AlertBanner';
import DashTabBar from './DashTabBar';
import OverviewTab from './tabs/Overview';
import EIATab from './tabs/EIATab';
import RegimeTab from './tabs/RegimeTab';
import ReturnsTab from './tabs/ReturnsTab';
import ChartsTab from './tabs/ChartsTab';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<DashTab>('overview');
  const { role } = useRole();
  const { data: modelStatus } = useModelStatus();
  const { data: report } = useReport(role);

  useEffect(() => {
    if (role === 'trader' || role === 'risk') {
      setActiveTab((prev) => (ROLE_PERMISSIONS.dimmedDashTabs.includes(prev) ? 'overview' : prev));
    }
    // Only bounce on role change - dimmed tabs must stay manually clickable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const alertModel = modelStatus?.models.find((m) => m.psi_alert);
  // Non-empty when a model type failed the deployment gate and the constant
  // baseline took over production. Stated up front, because several numbers
  // further down the report are withheld as a direct consequence.
  const onBaseline = report?.baseline_models ?? [];

  return (
    <div className="flex flex-col h-full">
      <DashTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 overflow-y-auto p-[18px]">
        {alertModel && (
          <AlertBanner>
            {alertModel.type[0].toUpperCase() + alertModel.type.slice(1)} model PSI{' '}
            {(alertModel.metrics.psi ?? 0).toFixed(2)} exceeds alert threshold. Retraining recommended.
          </AlertBanner>
        )}
        {onBaseline.length > 0 && (
          <AlertBanner>
            {onBaseline.join(' and ')} {onBaseline.length > 1 ? 'are' : 'is'} running on the
            baseline model, not a trained model.
          </AlertBanner>
        )}
        {activeTab === 'overview' && <OverviewTab onNavigateTab={setActiveTab} />}
        {activeTab === 'eia' && <EIATab />}
        {activeTab === 'regime' && <RegimeTab />}
        {activeTab === 'returns' && <ReturnsTab />}
        {activeTab === 'charts' && <ChartsTab />}
      </div>
    </div>
  );
}
