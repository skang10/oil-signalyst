import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RoleProvider, useRole } from '@/context/RoleContext';
import AppShell from '@/components/layout/AppShell';
import Dashboard from '@/pages/Dashboard';
import HistoryPage from '@/pages/History';
import SignalsPage from '@/pages/Signals';
import SignalEvaluatePage from '@/pages/Signals/SignalEvaluatePage';
import DataMonitorPage from '@/pages/DataMonitor';
import ModelMonitorPage from '@/pages/ModelMonitor';
import TrainingPage from '@/pages/Training';
import SettingsPage from '@/pages/Settings';

function DSGuard({ children }: { children: ReactNode }) {
  const { role } = useRole();
  if (role !== 'ds') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <RoleProvider>
      <BrowserRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/signals" element={<SignalsPage />} />
            <Route path="/signals/evaluate/:name" element={<SignalEvaluatePage />} />
            <Route
              path="/data-monitor"
              element={
                <DSGuard>
                  <DataMonitorPage />
                </DSGuard>
              }
            />
            <Route
              path="/model-monitor"
              element={
                <DSGuard>
                  <ModelMonitorPage />
                </DSGuard>
              }
            />
            <Route
              path="/training"
              element={
                <DSGuard>
                  <TrainingPage />
                </DSGuard>
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </RoleProvider>
  );
}
