import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A live-quote freshness indicator: a pulsing dot plus "12s ago", ticking once
 * a second. The pulse says the feed is live at a glance; past `staleAfterMs`
 * (the price ticker runs ~30s, so 90s is three missed ticks) the dot and text
 * turn warning-coloured and the pulse stops, so a dropped socket reads as
 * stale rather than as a frozen-but-fine price. Its own component so only it
 * re-renders each second, and the pulse is gated on motion-safe.
 */
export default function LiveTick({
  since,
  staleAfterMs = 90_000,
}: {
  since: number;
  staleAfterMs?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.max(0, now - since);
  const stale = elapsed > staleAfterMs;
  const secs = Math.floor(elapsed / 1000);
  const label = secs < 60 ? `${secs}s` : secs < 3600 ? `${Math.floor(secs / 60)}m` : `${Math.floor(secs / 3600)}h`;

  return (
    <span
      className={cn(
        'flex items-center gap-[5px] font-mono tabular-nums text-[11px]',
        stale ? 'text-warning' : 'text-text-muted'
      )}
      title={stale ? 'Live quote has stopped updating' : 'Live quote'}
    >
      <span className="relative flex h-[6px] w-[6px]">
        {!stale && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-50 motion-safe:animate-ping" />
        )}
        <span
          className={cn('relative inline-flex h-[6px] w-[6px] rounded-full', stale ? 'bg-warning' : 'bg-success')}
        />
      </span>
      {label} ago
    </span>
  );
}
