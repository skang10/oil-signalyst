import { useState, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useRole } from '@/context/RoleContext';
import { ROLE_PERMISSIONS } from '@/types/roles';
import AgentBubble from '@/components/agent/AgentBubble';
import AgentPanel from '@/components/agent/AgentPanel';

export default function AppShell({ children }: { children: ReactNode }) {
  const { role } = useRole();
  const [agentOpen, setAgentOpen] = useState(false);
  const showAgent = ROLE_PERMISSIONS.agentPanel.includes(role);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Topbar />
        <div className="flex-1 bg-surface-0 flex flex-col overflow-hidden">{children}</div>
      </div>
      {showAgent && (
        <>
          <AgentBubble open={agentOpen} onClick={() => setAgentOpen((o) => !o)} />
          {agentOpen && <AgentPanel onClose={() => setAgentOpen(false)} />}
        </>
      )}
    </div>
  );
}
