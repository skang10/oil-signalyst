import type { ReactNode } from 'react';

export interface ToolCall {
  name: string;
  args?: string;
  result: ReactNode;
}

export type GateAction = 'add_feature' | 'run_training' | 'deploy';

export interface ConfirmGateState {
  title: string;
  detail: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  actionId: GateAction;
  status: 'pending' | 'confirmed' | 'cancelled';
}

export interface AgentMessage {
  id: string;
  role: 'agent' | 'user';
  text?: ReactNode;
  toolCalls?: ToolCall[];
  gate?: ConfirmGateState;
  variant?: 'default' | 'success';
  typing?: boolean;
}
