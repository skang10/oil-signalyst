import { useSyncExternalStore } from 'react';
import { mutate } from 'swr';
import { IconFlask, IconDatabase } from '@tabler/icons-react';
import { isMockMode, setMockMode, subscribeMockMode, mockAvailable } from '@/lib/mockMode';

function useMockMode(): boolean {
  return useSyncExternalStore(subscribeMockMode, isMockMode, () => false);
}

/**
 * Dev-only strip telling you whether the workbench is on seeded mock data or the
 * live backend, with a one-click switch. Flipping it revalidates every SWR key
 * so the pages refetch through (or around) the mock layer immediately. Renders
 * nothing in a production build.
 */
export default function MockDataBanner() {
  const mock = useMockMode();
  if (!mockAvailable) return null;

  const toggle = () => {
    setMockMode(!mock);
    mutate(() => true); // revalidate all SWR keys
  };

  if (mock) {
    return (
      <div className="flex items-center gap-[10px] flex-wrap mb-3 rounded-[8px] border border-warning-border bg-warning-bg px-[12px] py-[8px] text-[12px] text-warning">
        <IconFlask size={15} stroke={1.75} />
        <span>
          <b className="font-semibold">Mock data</b> · dev preview — seeded sample data, not the live pipeline.
        </span>
        <button
          type="button"
          onClick={toggle}
          className="ml-auto font-mono text-[11px] rounded-[6px] border border-warning-border px-[10px] py-[3px] hover:bg-[var(--surface-2)]"
        >
          Use real data
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-[10px] flex-wrap mb-3 rounded-[8px] border border-border bg-surface-1 px-[12px] py-[8px] text-[12px] text-text-muted">
      <IconDatabase size={15} stroke={1.75} />
      <span>Live data — hitting the real backend.</span>
      <button
        type="button"
        onClick={toggle}
        className="ml-auto font-mono text-[11px] rounded-[6px] border border-border px-[10px] py-[3px] hover:bg-[var(--surface-2)]"
      >
        Use mock data
      </button>
    </div>
  );
}
