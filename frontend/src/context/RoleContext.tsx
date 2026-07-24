import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Role } from '@/types/roles';
import { api } from '@/lib/api';
import { useAuth } from './AuthContext';

export type RetrainMode = 'manual' | 'sunday' | 'auto';

/**
 * Field names deliberately mirror the backend's User columns /
 * UserConfigUpdate schema (api/routes/users.py) 1:1 - the previous
 * frontend-shaped config ({forecastHorizon, alerts: {...}}) was silently
 * dropped field-by-field by Pydantic on PUT, so "Save Settings" persisted
 * nothing.
 */
export interface UserConfig {
  name: string;
  role: Role;
  horizon_days: number;
  exposure_barrels: number;
  alert_downside_threshold: number;
  alert_psi_threshold: number;
  alert_eia_threshold: number;
  retrain_mode: RetrainMode;
}

export const DEFAULT_CONFIG: UserConfig = {
  name: 'Xuemei',
  role: 'researcher',
  horizon_days: 20,
  exposure_barrels: 100_000,
  alert_downside_threshold: 0.45,
  alert_psi_threshold: 0.2,
  alert_eia_threshold: 1.5,
  retrain_mode: 'manual',
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

  // Hydrate from the persisted profile so Settings round-trips instead of
  // resetting to DEFAULT_CONFIG on every reload.
  useEffect(() => {
    if (!user) return;
    api
      .get<Partial<Record<keyof UserConfig, unknown>>>('/api/users/me')
      .then((me) => {
        setUserConfigState({
          name: (me.name as string) ?? DEFAULT_CONFIG.name,
          role: (me.role as Role) ?? DEFAULT_CONFIG.role,
          horizon_days: (me.horizon_days as number) ?? DEFAULT_CONFIG.horizon_days,
          exposure_barrels: (me.exposure_barrels as number) ?? DEFAULT_CONFIG.exposure_barrels,
          alert_downside_threshold:
            (me.alert_downside_threshold as number) ?? DEFAULT_CONFIG.alert_downside_threshold,
          alert_psi_threshold:
            (me.alert_psi_threshold as number) ?? DEFAULT_CONFIG.alert_psi_threshold,
          alert_eia_threshold:
            (me.alert_eia_threshold as number) ?? DEFAULT_CONFIG.alert_eia_threshold,
          retrain_mode: (me.retrain_mode as RetrainMode) ?? DEFAULT_CONFIG.retrain_mode,
        });
      })
      .catch(console.error);
  }, [user]);

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
