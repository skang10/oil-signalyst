import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { RoleProvider, useRole } from '@/context/RoleContext';
import AppShell from '@/components/layout/AppShell';
import LoginPage from '@/pages/Login';
import OverviewPage from '@/pages/Overview';
import SandboxesPage from '@/pages/Sandboxes';
import EvaluatePage from '@/pages/Evaluate';
import ComparePage from '@/pages/Compare';
import PublishPage from '@/pages/Publish';
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

/**
 * DS Workbench gate. Unlike DSGuard (which reads the ds-only "view as" preview
 * role, so previewing another role bounces you), this gates on the real
 * authenticated role — a ds user stays in the workbench while previewing a
 * dashboard as another role. A genuine researcher is still redirected out.
 */
function WorkbenchGuard({ children }: { children: ReactNode }) {
  const { authenticatedRole } = useRole();
  if (authenticatedRole !== 'ds') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function AuthenticatedApp() {
  return (
    <RoleProvider>
      <AppShell>
        <Routes>
          {/* Original product surface restored: Dashboard is home again. */}
          <Route path="/" element={<Dashboard />} />

          {/* The refactored DS Workbench — the Stockcast flow. Its Overview lives
              at /workbench (not /, which is Dashboard); every tab is gated to
              authenticated ds users via WorkbenchGuard. */}
          <Route
            path="/workbench"
            element={
              <WorkbenchGuard>
                <OverviewPage />
              </WorkbenchGuard>
            }
          />
          <Route
            path="/sandboxes"
            element={
              <WorkbenchGuard>
                <SandboxesPage />
              </WorkbenchGuard>
            }
          />
          <Route
            path="/evaluate"
            element={
              <WorkbenchGuard>
                <EvaluatePage />
              </WorkbenchGuard>
            }
          />
          <Route
            path="/compare"
            element={
              <WorkbenchGuard>
                <ComparePage />
              </WorkbenchGuard>
            }
          />
          <Route
            path="/publish"
            element={
              <WorkbenchGuard>
                <PublishPage />
              </WorkbenchGuard>
            }
          />
          {/* Restored product pages, back in the sidebar's Navigation group. */}
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
    </RoleProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <AuthGuard>
                <AuthenticatedApp />
              </AuthGuard>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
