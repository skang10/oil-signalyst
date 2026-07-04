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
  const { data: report, error } = useReport(role);

  // The backend 503s with "No predictions available yet" until the first
  // daily pipeline run - distinguish that from a normal loading spinner
  // instead of showing "Loading..." forever.
  if (error)
    return (
      <div className="text-text-muted text-[12px]">
        No prediction available yet — the daily pipeline hasn't produced a report. Check back after the next scheduled
        run, or trigger one from the backend.
      </div>
    );
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
