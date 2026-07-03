import { useLocation } from 'react-router-dom';
import { IconBell, IconRefresh, IconRobot } from '@tabler/icons-react';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { useReport } from '@/hooks/useReport';
import { useModelStatus } from '@/hooks/useModelStatus';
import { usePriceTicker } from '@/hooks/usePriceTicker';
import { usePriceStore } from '@/lib/price-store';
import RolePill from './RolePill';
import { cn, formatUsd } from '@/lib/utils';

const PAGE_TITLES: { prefix: string; title: string }[] = [
  { prefix: '/history', title: 'History' },
  { prefix: '/signals', title: 'Signals' },
  { prefix: '/data-monitor', title: 'Data Monitor' },
  { prefix: '/model-monitor', title: 'Model Monitor' },
  { prefix: '/training', title: 'Training Control' },
  { prefix: '/settings', title: 'Settings' },
  { prefix: '/', title: 'Dashboard' },
];

function pageTitle(pathname: string): string {
  return PAGE_TITLES.find((p) => pathname.startsWith(p.prefix))?.title ?? 'Dashboard';
}

export default function Topbar({
  showAgent,
  agentOpen,
  onToggleAgent,
}: {
  showAgent: boolean;
  agentOpen: boolean;
  onToggleAgent: () => void;
}) {
  const location = useLocation();
  const { user } = useAuth();
  const { role } = useRole();
  const { data: report } = useReport(role);
  const { data: modelStatus } = useModelStatus();

  usePriceTicker(); // establishes the WS connection once; updates the store below
  const { price: wsPrice, changePct: wsChangePct } = usePriceStore();
  // Prefer the WebSocket tick (30s granularity) once connected; fall back to
  // the daily report's price (already real, just less frequent) until the
  // first WS message arrives or if the socket is disconnected.
  const price = wsPrice ?? report?.wti_price;
  const changePct = wsChangePct ?? report?.wti_change_pct;

  return (
    <div className="h-[46px] shrink-0 bg-surface-2 border-b border-border flex items-center px-4 gap-[10px]">
      <div className="text-[13px] font-medium flex-1">{pageTitle(location.pathname)}</div>

      {price != null && changePct != null && (
        <div className="text-[12px] text-text-secondary whitespace-nowrap">
          WTI <strong className={changePct < 0 ? 'text-danger' : 'text-success'}>{formatUsd(price)}</strong>{' '}
          <span className={cn('text-[11px]', changePct < 0 ? 'text-danger' : 'text-success')}>
            {changePct < 0 ? '▼' : '▲'} {(Math.abs(changePct) * 100).toFixed(1)}%
          </span>
        </div>
      )}

      <div className="flex items-center gap-[10px]">
        {modelStatus?.data_sources.map((src) => {
          const lagLabel = !src.lag_hours ? 'Live' : `${src.lag_hours}h ago`;
          const recent = (src.lag_hours ?? 0) <= 6;
          return (
            <div
              key={src.name}
              title={`${src.name} · ${lagLabel}${src.status !== 'ok' ? ' (delayed)' : ''}`}
              className="flex items-center gap-1 text-[11px] text-text-muted whitespace-nowrap"
            >
              <span
                className={cn(
                  'w-[6px] h-[6px] rounded-full',
                  src.status === 'ok' ? 'bg-success' : 'bg-warning',
                  (src.status !== 'ok' || recent) && 'animate-pulse'
                )}
              />
              <span className={src.status === 'ok' ? undefined : 'text-warning'}>{src.name}</span>
            </div>
          );
        })}
      </div>

      {/* D17: the pill is a ds-only "view as" preview override, not a
          general role switcher - real role comes from the JWT (user.role). */}
      {user?.role === 'ds' && <RolePill />}

      <button
        type="button"
        title="Alerts"
        className="w-7 h-7 rounded-default border border-border bg-none flex items-center justify-center cursor-pointer text-text-secondary relative shrink-0 hover:bg-surface-1"
      >
        <IconBell size={16} stroke={1.75} />
        <span className="absolute top-[5px] right-[5px] w-[5px] h-[5px] rounded-full bg-warning" />
      </button>
      <button
        type="button"
        title="Refresh"
        className="w-7 h-7 rounded-default border border-border bg-none flex items-center justify-center cursor-pointer text-text-secondary shrink-0 hover:bg-surface-1"
      >
        <IconRefresh size={16} stroke={1.75} />
      </button>
      {showAgent && (
        <button
          type="button"
          title="DS Agent"
          aria-label="DS Agent"
          onClick={onToggleAgent}
          className={cn(
            'w-7 h-7 rounded-default border border-border bg-none flex items-center justify-center cursor-pointer shrink-0 hover:bg-surface-1',
            agentOpen ? 'bg-accent-bg text-accent-text border-accent-border' : 'text-text-secondary'
          )}
        >
          <IconRobot size={16} stroke={1.75} />
        </button>
      )}
    </div>
  );
}
