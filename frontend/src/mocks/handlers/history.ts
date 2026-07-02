import { http, HttpResponse } from 'msw';
import { BASE } from '@/lib/api';
import { historyFixture, historyDetailFixtures } from '../fixtures/history';

export const historyHandlers = [
  http.get(`${BASE}/api/reports/history`, () => {
    return HttpResponse.json(historyFixture);
  }),
  http.get(`${BASE}/api/reports/history/:date`, ({ params }) => {
    const detail = historyDetailFixtures[params.date as string];
    if (!detail) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(detail);
  }),
];
