import { useState } from 'react';
import { useRole } from '@/context/RoleContext';
import type { DashTab } from '@/types/roles';
import { useModelStatus } from '@/hooks/useModelStatus';
import { useReport } from '@/hooks/useReport';
import AlertBanner from '@/components/shared/AlertBanner';
import DashTabBar from './DashTabBar';
import OverviewTab from './tabs/Overview';
import EIATab from './tabs/EIATab';
import RegimeTab from './tabs/RegimeTab';
import ChartsTab from './tabs/ChartsTab';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<DashTab>('overview');
  const { role } = useRole();
  const { data: modelStatus } = useModelStatus();
  const { data: report } = useReport(role);


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
            EIA Forecast is running on the baseline model, not a trained model.
          </AlertBanner>
        )}
        {activeTab === 'overview' && <OverviewTab onNavigateTab={setActiveTab} />}
        {activeTab === 'eia' && <EIATab />}
        {activeTab === 'regime' && <RegimeTab />}
        {activeTab === 'charts' && <ChartsTab />}
      </div>
    </div>
  );
}
