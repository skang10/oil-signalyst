import type { Role } from '@/types/roles';

export const swrKeys = {
  report: (role: Role) => `/api/reports/daily/${role}`,
  modelStatus: () => '/api/models/status',
  history: () => '/api/reports/history',
  historyDetail: (date: string) => `/api/reports/history/${date}`,
  signals: () => '/api/signals',
  signalEvaluation: (name: string) => `/api/signals/evaluate/${name}`,
  trainStatus: (jobId: string) => `/api/train/status/${jobId}`,
  trainLog: (jobId: string) => `/api/train/log/${jobId}`,
};
