import { NavLink } from 'react-router-dom';
import {
  IconLayoutDashboard,
  IconChartLine,
  IconRadar,
  IconGauge,
  IconFlask,
  IconTargetArrow,
  IconGitCompare,
  IconSend,
  IconSettings,
  IconLogout,
} from '@tabler/icons-react';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { ROLE_PERMISSIONS, ROLE_LABELS, type SidebarPage } from '@/types/roles';
import { cn } from '@/lib/utils';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

interface NavItem {
  page: string;
  to: string;
  label: string;
  icon: typeof IconLayoutDashboard;
  badge?: { text: string; kind: 'warn' | 'danger' };
}

// The original product navigation — restored untouched. These are role-gated the
// same way they always were (researcher + ds), independent of the DS Workbench.
const MAIN_NAV: (NavItem & { page: SidebarPage })[] = [
  { page: 'dashboard', to: '/', label: 'Dashboard', icon: IconLayoutDashboard },
  { page: 'history', to: '/history', label: 'History', icon: IconChartLine },
  {
    page: 'signals',
    to: '/signals',
    label: 'Signals',
    icon: IconRadar,
    badge: { text: '2 New', kind: 'warn' },
  },
];

// The DS Workbench group, reorganized as the Stockcast top-tab flow. This is the
// ONLY group that was refactored — it replaces the old Data Monitor / Model
// Monitor / Training Control items with the model lifecycle: overview →
// sandboxes → evaluate → compare → publish. The old operational pages stay
// reachable by URL (/data-monitor, /model-monitor, /training).
const WORKBENCH_NAV: NavItem[] = [
  { page: 'overview', to: '/workbench', label: 'Overview', icon: IconGauge },
  {
    page: 'sandboxes',
    to: '/sandboxes',
    label: 'Training sandboxes',
    icon: IconFlask,
    badge: { text: '1', kind: 'warn' }, // waiting on your decision
  },
  { page: 'evaluate', to: '/evaluate', label: 'Evaluate', icon: IconTargetArrow },
  { page: 'compare', to: '/compare', label: 'Compare', icon: IconGitCompare },
  { page: 'publish', to: '/publish', label: 'Publish', icon: IconSend },
];

function NavRow({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 px-[10px] py-[6px] mx-[6px] my-[1px] rounded-default cursor-pointer text-[13px] transition-colors',
          isActive
            ? 'bg-accent-bg text-accent-text font-medium'
            : 'text-text-secondary hover:bg-surface-1 hover:text-text-primary'
        )
      }
    >
      <Icon size={16} stroke={1.75} className="shrink-0" />
      {item.label}
      {item.badge && (
        <span
          className={cn(
            'ml-auto text-[10px] font-medium px-[6px] py-[1px] rounded-[10px]',
            item.badge.kind === 'warn' ? 'bg-warning-bg text-warning' : 'bg-danger-bg text-danger'
          )}
        >
          {item.badge.text}
        </span>
      )}
    </NavLink>
  );
}

function GroupLabel({ children }: { children: string }) {
  return (
    <div className="text-[10px] text-text-muted tracking-[0.7px] uppercase px-[14px] pt-3 pb-1 font-medium">
      {children}
    </div>
  );
}

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { role, authenticatedRole } = useRole();
  const name = user?.name ?? '';

  const visibleMain = MAIN_NAV.filter((item) => ROLE_PERMISSIONS.pages[item.page].includes(role));
  // The DS Workbench is gated on the real authenticated role (not the ds-only
  // "view as" preview), so a ds user previewing another role's dashboards still
  // sees — and can reach — the workbench they're authorised for. Matches
  // WorkbenchGuard in App.tsx.
  const showWorkbench = authenticatedRole === 'ds';

  return (
    <div className="w-[192px] shrink-0 bg-surface-2 border-r border-border flex flex-col">
      <div className="px-4 pt-[13px] pb-[11px] border-b border-border">
        <div className="text-[14px] font-medium tracking-[-0.2px]">OilSignalyst</div>
        <div className="text-[11px] text-text-muted mt-[1px] font-mono">v0.1 · local</div>
      </div>
      <div className="flex-1 overflow-y-auto pt-1">
        <GroupLabel>Navigation</GroupLabel>
        {visibleMain.map((item) => (
          <NavRow key={item.page} item={item} />
        ))}

        {showWorkbench && (
          <>
            <GroupLabel>DS Workbench</GroupLabel>
            {WORKBENCH_NAV.map((item) => (
              <NavRow key={item.page} item={item} />
            ))}
          </>
        )}

        <GroupLabel>System</GroupLabel>
        <NavRow item={{ page: 'settings', to: '/settings', label: 'Settings', icon: IconSettings }} />
      </div>
      <div className="mt-auto p-[10px_6px] border-t border-border">
        <div className="flex items-center gap-[9px] px-[10px] py-[7px] rounded-default">
          <div className="w-[26px] h-[26px] rounded-full bg-accent-bg border border-accent-border flex items-center justify-center text-[10px] font-medium text-accent-text shrink-0">
            {initials(name || '?')}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium truncate">{name}</div>
            <div className="text-[11px] text-text-muted">{ROLE_LABELS[role]}</div>
          </div>
          <button
            type="button"
            title="Log out"
            aria-label="Log out"
            onClick={() => logout()}
            className="w-6 h-6 rounded-default border-none bg-none cursor-pointer text-text-muted flex items-center justify-center shrink-0 hover:bg-surface-2 hover:text-text-primary"
          >
            <IconLogout size={14} stroke={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
