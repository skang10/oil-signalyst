import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Role } from '@/types/roles';
import { api } from '@/lib/api';
import { useAuth } from './AuthContext';

export interface UserConfig {
  name: string;
  role: Role;
  commodity: 'WTI' | 'Brent';
  forecastHorizon: number;
  alerts: {
    downside_risk_threshold: number;
    psi_threshold: number;
    eia_surprise_threshold: number;
  };
}

export const DEFAULT_CONFIG: UserConfig = {
  name: 'Xuemei',
  role: 'researcher',
  commodity: 'WTI',
  forecastHorizon: 20,
  alerts: {
    downside_risk_threshold: 0.45,
    psi_threshold: 0.2,
    eia_surprise_threshold: 1.5,
  },
};

interface RoleContextValue {
  role: Role;
  setRole: (r: Role) => void;
  userConfig: UserConfig;
  setUserConfig: (c: UserConfig) => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const authenticatedRole = user?.role ?? 'researcher';

  // D17: role is normally the authenticated user's JWT-derived role, not a
  // client-side switch - but for `ds` users specifically, keep a "view as"
  // override so the pill can still preview other roles' dashboards without
  // requiring 4 separate logins (the multi-role comparison workflow this
  // whole app was built and verified around in Phase 3). Only ever applies
  // when actually authenticated as `ds` - Topbar only renders the pill in
  // that case, and setRole below is a no-op otherwise as a defensive guard.
  const [viewAsRole, setViewAsRole] = useState<Role | null>(null);
  const role = authenticatedRole === 'ds' ? (viewAsRole ?? authenticatedRole) : authenticatedRole;

  const [userConfig, setUserConfigState] = useState<UserConfig>(DEFAULT_CONFIG);

  function setRole(r: Role) {
    if (authenticatedRole === 'ds') setViewAsRole(r);
  }

  function setUserConfig(c: UserConfig) {
    setUserConfigState(c);
    api.put('/api/users/me/config', c).catch(console.error);
  }

  return (
    <RoleContext.Provider value={{ role, setRole, userConfig, setUserConfig }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
}
