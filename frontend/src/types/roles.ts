export type Role = 'researcher' | 'ds';

export const ROLE_LABELS: Record<Role, string> = {
  researcher: 'Researcher',
  ds: 'DS',
};

export const ROLES: Role[] = ['researcher', 'ds'];

export type SidebarPage =
  | 'dashboard'
  | 'history'
  | 'signals'
  | 'data-monitor'
  | 'model-monitor'
  | 'training'
  | 'settings';

export type DashTab = 'overview' | 'eia' | 'regime' | 'charts';

interface RolePermissions {
  pages: Record<SidebarPage, Role[]>;
  dashTabs: Record<DashTab, Role[]>;
  dimmedDashTabs: DashTab[];
  signalWrite: Role[];
  poolRemove: Role[];
  agentPanel: Role[];
}

export const ROLE_PERMISSIONS: RolePermissions = {
  pages: {
    dashboard: ['researcher', 'ds'],
    history: ['researcher', 'ds'],
    signals: ['researcher', 'ds'],
    'data-monitor': ['ds'],
    'model-monitor': ['ds'],
    training: ['ds'],
    settings: ['researcher', 'ds'],
  },
  dashTabs: {
    overview: ['researcher', 'ds'],
    eia: ['researcher', 'ds'],
    regime: ['researcher', 'ds'],
    charts: ['researcher', 'ds'],
  },
  // Was for the trader/risk roles, which had no use for the modelling tabs.
  // Both roles are gone with the returns forecast, so nothing is dimmed.
  dimmedDashTabs: [],
  // Adopting/snoozing signals is reversible research work; removing pool
  // features can break the daily pipeline until retrain, so it stays DS-only.
  // Enforced server-side too (backend/api/dependencies.py) - these flags
  // only control what the UI shows.
  signalWrite: ['researcher', 'ds'],
  poolRemove: ['ds'],
  agentPanel: ['ds'],
};
