import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Role } from '@/types/roles';
import { api } from '@/lib/api';

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
  const [role, setRoleState] = useState<Role>(
    () => (localStorage.getItem('role') as Role) ?? 'researcher'
  );
  const [userConfig, setUserConfigState] = useState<UserConfig>(() => {
    try {
      return JSON.parse(localStorage.getItem('userConfig') ?? 'null') ?? DEFAULT_CONFIG;
    } catch {
      return DEFAULT_CONFIG;
    }
  });

  function setRole(r: Role) {
    setRoleState(r);
    localStorage.setItem('role', r);
  }

  function setUserConfig(c: UserConfig) {
    setUserConfigState(c);
    localStorage.setItem('userConfig', JSON.stringify(c));
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
