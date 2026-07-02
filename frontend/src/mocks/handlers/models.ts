import { http, HttpResponse } from 'msw';
import { BASE } from '@/lib/api';
import { modelStatusFixture } from '../fixtures/modelStatus';

export const modelsHandlers = [
  http.get(`${BASE}/api/models/status`, () => {
    return HttpResponse.json(modelStatusFixture);
  }),
];
