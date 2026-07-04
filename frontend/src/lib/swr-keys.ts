import type { Role } from '@/types/roles';

export const swrKeys = {
  report: (role: Role) => `/api/reports/daily/${role}`,
  modelStatus: () => '/api/models/status',
  history: () => '/api/reports/history',
  historyDetail: (date: string) => `/api/reports/history/${date}`,
  signals: () => '/api/signals',
  stressTest: () => '/api/reports/stress',
  signalEvaluation: (name: string) => `/api/signals/evaluate/${name}`,
  trainStatus: (jobId: string) => `/api/train/status/${jobId}`,
  trainStatusFull: (jobId: string) => `/api/train/status/${jobId}?include_log=true`,
  trainJobs: (limit: number, trigger?: string) =>
    `/api/train/jobs?limit=${limit}&offset=0${trigger ? `&trigger=${trigger}` : ''}`,
  trainLog: (jobId: string) => `/api/train/log/${jobId}`,
};
