import { IconMessageCircle, IconX } from '@tabler/icons-react';

export default function AgentBubble({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="DS Agent"
      className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-accent-fill border-none text-white cursor-pointer flex items-center justify-center z-[200] hover:opacity-90"
    >
      {open ? <IconX size={20} stroke={1.75} /> : <IconMessageCircle size={20} stroke={1.75} />}
    </button>
  );
}
