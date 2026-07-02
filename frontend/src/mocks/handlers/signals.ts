import { http, HttpResponse } from 'msw';
import { BASE } from '@/lib/api';
import { signalsFixture, signalEvaluationFixtures } from '../fixtures/signals';

export const signalsHandlers = [
  http.get(`${BASE}/api/signals`, () => {
    return HttpResponse.json(signalsFixture);
  }),
  http.get(`${BASE}/api/signals/evaluate/:name`, ({ params }) => {
    const evaluation = signalEvaluationFixtures[params.name as string];
    if (!evaluation) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(evaluation);
  }),
];
