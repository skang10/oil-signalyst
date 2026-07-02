export type Role = 'trader' | 'risk' | 'researcher' | 'ds';

export const ROLE_LABELS: Record<Role, string> = {
  trader: 'Trader',
  risk: 'Risk',
  researcher: 'Researcher',
  ds: 'DS',
};

export const ROLES: Role[] = ['trader', 'risk', 'researcher', 'ds'];

export type SidebarPage =
  | 'dashboard'
  | 'history'
  | 'signals'
  | 'data-monitor'
  | 'model-monitor'
  | 'training'
  | 'settings';

export type DashTab = 'overview' | 'eia' | 'regime' | 'returns' | 'charts';

interface RolePermissions {
  pages: Record<SidebarPage, Role[]>;
  dashTabs: Record<DashTab, Role[]>;
  dimmedDashTabs: DashTab[];
  signalWrite: Role[];
  agentPanel: Role[];
}

export const ROLE_PERMISSIONS: RolePermissions = {
  pages: {
    dashboard: ['trader', 'risk', 'researcher', 'ds'],
    history: ['trader', 'risk', 'researcher', 'ds'],
    signals: ['researcher', 'ds'],
    'data-monitor': ['ds'],
    'model-monitor': ['ds'],
    training: ['ds'],
    settings: ['trader', 'risk', 'researcher', 'ds'],
  },
  dashTabs: {
    overview: ['trader', 'risk', 'researcher', 'ds'],
    eia: ['trader', 'risk', 'researcher', 'ds'],
    regime: ['trader', 'risk', 'researcher', 'ds'],
    returns: ['trader', 'risk', 'researcher', 'ds'],
    charts: ['trader', 'risk', 'researcher', 'ds'],
  },
  dimmedDashTabs: ['eia', 'regime', 'returns'],
  signalWrite: ['ds'],
  agentPanel: ['ds'],
};
