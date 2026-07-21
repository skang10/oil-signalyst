import { useLocation } from 'react-router-dom';
import {
  IconBell,
  IconCaretDownFilled,
  IconCaretUpFilled,
  IconRefresh,
  IconRobot,
} from '@tabler/icons-react';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { useReport } from '@/hooks/useReport';
import { usePriceTicker } from '@/hooks/usePriceTicker';
import { usePriceStore } from '@/lib/price-store';
import RolePill from './RolePill';
import LiveTick from '@/components/shared/LiveTick';
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

  usePriceTicker(); // establishes the WS connection once; updates the store below
  const { price: wsPrice, changePct: wsChangePct, spread: wsSpread, updatedAt } = usePriceStore();
  // Prefer the WebSocket tick (30s granularity) once connected; fall back to
  // the daily report's price (already real, just less frequent) until the
  // first WS message arrives or if the socket is disconnected.
  const price = wsPrice ?? report?.wti_price;
  const changePct = wsChangePct ?? report?.wti_change_pct;
  // Live Brent-WTI spread from the ticker; fall back to the report's stored
  // spread (present only for the trader role) until the first WS tick lands.
  const spread = wsSpread ?? report?.trader?.brent_wti_spread ?? null;

  return (
    <div className="h-[46px] shrink-0 bg-surface-2 border-b border-border flex items-center px-4 gap-[10px]">
      <div className="text-[13px] font-medium flex-1">{pageTitle(location.pathname)}</div>

      {price != null && changePct != null && (
        // A quote strip, read as a trading terminal reads: mono tabular
        // numerals so digits don't jitter as the price ticks, the price itself
        // neutral with only the session change carrying up/down colour (the
        // old line was a wall of green), and the three data - last, spread,
        // freshness - separated by hairline rules rather than run together.
        <div className="flex items-center gap-[9px] whitespace-nowrap">
          <div className="flex items-baseline gap-[6px]">
            <span className="text-[9.5px] uppercase tracking-[0.7px] text-text-muted font-medium">WTI</span>
            <span className="font-mono tabular-nums text-[13px] font-semibold text-text-primary leading-none">
              {formatUsd(price)}
            </span>
            <span
              className={cn(
                'flex items-center gap-[1px] font-mono tabular-nums text-[11px] leading-none',
                changePct < 0 ? 'text-danger' : 'text-success'
              )}
            >
              {changePct < 0 ? <IconCaretDownFilled size={11} /> : <IconCaretUpFilled size={11} />}
              {(Math.abs(changePct) * 100).toFixed(1)}%
            </span>
          </div>

          {spread != null && (
            <>
              <span className="h-[13px] w-px bg-border" />
              <span className="font-mono tabular-nums text-[11px] text-text-muted" title="Brent minus WTI spot spread">
                B–W {spread < 0 ? '−' : '+'}${Math.abs(spread).toFixed(2)}
              </span>
            </>
          )}

          {/* Live freshness; only when the WS price is in use (updatedAt set by
              the ticker). Absent on the daily-report fallback. */}
          {wsPrice != null && updatedAt != null && (
            <>
              <span className="h-[13px] w-px bg-border" />
              <LiveTick since={updatedAt} />
            </>
          )}
        </div>
      )}

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
