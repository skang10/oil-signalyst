import type { ReactNode } from 'react';

export interface ToolCall {
  name: string;
  /** Multi-line key=value parameters shown in a separate code box. */
  code?: ReactNode;
  result?: ReactNode;
  resultVariant?: 'success' | 'warn';
  /** Live-streaming state (e.g. run_training): shows a spinner, no result box yet. */
  streaming?: boolean;
}

export type GateAction = 'add_feature' | 'run_training';

export interface ConfirmGateState {
  step: string;
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
  /** Rendered after toolCalls - for a closing summary sentence like ds-agent.html's flow. */
  footer?: ReactNode;
  gate?: ConfirmGateState;
  typing?: boolean;
}
