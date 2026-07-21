import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * "12s ago" / "3m ago", ticking once a second, for a live timestamp. Isolated
 * into its own component so only it re-renders on the interval, not the parent.
 * Turns warning-coloured once `staleAfterMs` has passed with no update - for
 * the price ticker (~30s cadence) that reads as "the quote has stopped
 * arriving".
 */
export default function TimeAgo({
  since,
  staleAfterMs = 90_000,
  className,
}: {
  since: number | null;
  staleAfterMs?: number;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (since == null) return null;
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  const label =
    secs < 60 ? `${secs}s ago` : secs < 3600 ? `${Math.floor(secs / 60)}m ago` : `${Math.floor(secs / 3600)}h ago`;
  const stale = now - since > staleAfterMs;
  return <span className={cn(stale ? 'text-warning' : 'text-text-muted', className)}>{label}</span>;
}
