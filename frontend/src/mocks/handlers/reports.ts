import { http, HttpResponse } from 'msw';
import { BASE } from '@/lib/api';
import { dailyReportFixture } from '../fixtures/dailyReport';

export const reportsHandlers = [
  http.get(`${BASE}/api/reports/daily/:role`, ({ params }) => {
    return HttpResponse.json({ ...dailyReportFixture, role: params.role });
  }),
];
