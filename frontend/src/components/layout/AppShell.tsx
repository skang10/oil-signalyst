import { useState, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useRole } from '@/context/RoleContext';
import { ROLE_PERMISSIONS } from '@/types/roles';
import AgentPanel from '@/components/agent/AgentPanel';
import { cn } from '@/lib/utils';

export default function AppShell({ children }: { children: ReactNode }) {
  const { role } = useRole();
  const [agentOpen, setAgentOpen] = useState(false);
  const [fullpage, setFullpage] = useState(false);
  const showAgent = ROLE_PERMISSIONS.agentPanel.includes(role);
  const agentVisible = showAgent && agentOpen;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Topbar
          showAgent={showAgent}
          agentOpen={agentOpen}
          onToggleAgent={() => setAgentOpen((o) => !o)}
        />
        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className={cn('flex-1 bg-surface-0 flex flex-col overflow-hidden min-w-0', agentVisible && fullpage && 'hidden')}>
            {children}
          </div>
          {agentVisible && (
            <AgentPanel
              onClose={() => setAgentOpen(false)}
              fullpage={fullpage}
              onToggleFullpage={() => setFullpage((f) => !f)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
