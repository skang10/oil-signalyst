import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { SandboxLife, WorkbenchSandbox } from '@/lib/sandboxModel';

export type PillTone = 'prod' | 'shadow' | 'ready' | 'idle' | 'run' | 'arch';

/** Only production and shadow carry a tag. Shadow turns green once it clears its
 *  8th week (the 'ready' state). idle / training / archived get no pill — the
 *  group header + the metric column already say what they are. */
export function lifePill(s: WorkbenchSandbox): { label: string; tone: PillTone } | null {
  switch (s.life) {
    case 'production':
      return { label: 'production', tone: 'prod' };
    case 'shadow':
      return { label: s.shadowWeek ? `shadow · ${s.shadowWeek} / 8` : 'shadow', tone: 'shadow' };
    case 'ready':
      return { label: `shadow · ${s.shadowWeek ?? 8} / 8`, tone: 'ready' };
    default:
      return null;
  }
}

export function pillTone(tone: PillTone): string {
  const map: Record<PillTone, string> = {
    prod: 'bg-accent-bg text-accent-text',
    shadow: 'bg-warning-bg text-warning',
    ready: 'bg-success-bg text-success',
    idle: 'bg-surface-1 text-text-muted border border-border',
    run: 'bg-warning-bg text-warning',
    arch: 'bg-surface-1 text-text-muted border border-border',
  };
  return map[tone];
}

export function Pill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return (
    <span className={cn('font-mono text-[10px] uppercase tracking-[0.05em] rounded-[4px] px-[6px] py-[1px]', pillTone(tone))}>
      {children}
    </span>
  );
}

/** Left-accent + ring keyed to lifecycle — the Stockcast .sb.prod / .sb.shadow etc. */
export function lifeAccent(life: SandboxLife, ready = false): CSSProperties {
  const base: CSSProperties = { borderLeftWidth: 4 };
  switch (life) {
    case 'production':
      return { ...base, borderLeftColor: 'var(--fill-accent)', boxShadow: '0 0 0 3px var(--bg-accent)' };
    case 'shadow':
      return { ...base, borderLeftColor: 'var(--border-warning)', boxShadow: '0 0 0 3px var(--bg-warning)' };
    case 'ready':
      return { ...base, borderLeftColor: 'var(--border-success)', boxShadow: '0 0 0 3px var(--bg-success)' };
    case 'archived':
      return { ...base, borderLeftColor: 'var(--border-strong)', background: 'var(--surface-1)' };
    default:
      return ready
        ? { ...base, borderLeftColor: 'var(--border-success)' }
        : { ...base, borderLeftColor: 'var(--border-strong)' };
  }
}

/** signed skill %, positive = beats baseline (lower MAE). */
export function skillPct(mae: number | null, baseline: number | null): string {
  if (mae == null || baseline == null || baseline === 0) return '—';
  const s = (1 - mae / baseline) * 100;
  return `${s >= 0 ? '+' : ''}${s.toFixed(1)}%`;
}

export function dirPct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}
