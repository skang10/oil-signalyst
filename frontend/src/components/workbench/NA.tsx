import { cn } from '@/lib/utils';

/**
 * The single "not available" convention for the whole workbench. The DS
 * Workbench reproduces the Stockcast information architecture faithfully, but
 * this repo's backend has no server-side experiments/shadow/lineage and only a
 * couple of real prediction weeks. Anywhere the mockup shows a number the
 * backend cannot supply, we render this — never a fabricated value.
 */
export default function NA({ className, short }: { className?: string; short?: boolean }) {
  return (
    <span
      className={cn('text-text-muted font-normal italic', className)}
      title="not available — the backend does not track this yet"
    >
      {short ? 'n/a' : 'not available'}
    </span>
  );
}

/** true when a value should render as NA (null/undefined/empty). */
export function isNA(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
}
