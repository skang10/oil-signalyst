import { http, HttpResponse } from 'msw';
import { BASE } from '@/lib/api';

export const usersHandlers = [
  http.put(`${BASE}/api/users/me/config`, async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json(body);
  }),
];
