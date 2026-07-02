import { useState, type ReactNode } from 'react';
import { IconAlertTriangle } from '@tabler/icons-react';

export default function AlertBanner({ children }: { children: ReactNode }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="bg-warning-bg border border-warning-border rounded-default px-3 py-2 mb-[14px] flex items-center gap-2 text-[12px] text-warning">
      <IconAlertTriangle size={15} stroke={1.75} className="shrink-0" />
      <span className="flex-1">{children}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="ml-auto bg-none border-none text-warning cursor-pointer text-[16px] leading-none opacity-70 p-0"
      >
        ×
      </button>
    </div>
  );
}
