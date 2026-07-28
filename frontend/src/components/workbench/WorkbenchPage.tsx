import type { ReactNode } from 'react';

/**
 * Shared shell for every workbench tab. Deliberately matches the rest of the
 * app's page chrome — the same full-width `p-[18px]` scroll container and the
 * same PageHeader typography (15px medium title, 12px muted sub) that
 * Dashboard/History/DataMonitor/Training all use — so switching between the
 * Navigation pages and the DS Workbench doesn't jump width or header size. The
 * outer sidebar/topbar shell is AppShell's; this only owns the page body.
 */
export default function WorkbenchPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="p-[18px] overflow-y-auto flex-1">
      <div className="mb-3">
        <div className="text-[15px] font-medium">{title}</div>
        {lead && (
          <div className="text-[12px] text-text-muted mt-[2px] max-w-[92ch] leading-[1.55]">{lead}</div>
        )}
      </div>
      {children}
    </div>
  );
}

/** The mono uppercase section label from the mockup (.seclbl). */
export function SectionLabel({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-[9px] mt-[22px] mb-[10px] font-mono text-[11px] uppercase tracking-[0.09em] text-text-secondary">
      <span>{children}</span>
      {note && <span className="text-text-muted normal-case tracking-normal text-[11px]">{note}</span>}
    </div>
  );
}

/** Honest footer analog to the mockup's "fabricated data" line. Here the data is
 *  real local inference output, so it says so. */
export function WorkbenchFooter() {
  return (
    <div className="mt-8 pt-5 border-t border-border text-center font-mono text-[11px] text-text-muted">
      OilSignalyst · DS Workbench · live local inference · not investment advice
    </div>
  );
}
