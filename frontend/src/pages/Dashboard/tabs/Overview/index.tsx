import type { Dispatch, SetStateAction } from 'react';
import { useRole } from '@/context/RoleContext';
import { useReport } from '@/hooks/useReport';
import type { DashTab } from '@/types/roles';
import TraderView from './TraderView';
import RiskView from './RiskView';
import ResearcherView from './ResearcherView';
import DSView from './DSView';

export default function OverviewTab({ onNavigateTab }: { onNavigateTab: Dispatch<SetStateAction<DashTab>> }) {
  const { role } = useRole();
  const { data: report } = useReport(role);

  if (!report) return <div className="text-text-muted text-[12px]">Loading...</div>;

  return (
    <>
      {role === 'trader' && <TraderView report={report} />}
      {role === 'risk' && <RiskView report={report} />}
      {role === 'researcher' && <ResearcherView report={report} onNavigateTab={onNavigateTab} />}
      {role === 'ds' && <DSView />}
    </>
  );
}
