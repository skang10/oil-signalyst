import { http, HttpResponse } from 'msw';
import { BASE } from '@/lib/api';
import type { TrainParams } from '@/types/api';
import { createTrainJob, getTrainJob, getTrainLog } from '../state/trainJobs';

export const trainingHandlers = [
  http.post(`${BASE}/api/train/start`, async ({ request }) => {
    const body = (await request.json()) as TrainParams;
    const job = createTrainJob(body.model_types);
    return HttpResponse.json(job);
  }),
  http.get(`${BASE}/api/train/status/:jobId`, ({ params }) => {
    const job = getTrainJob(params.jobId as string);
    if (!job) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(job);
  }),
  http.get(`${BASE}/api/train/log/:jobId`, ({ params }) => {
    const lines = getTrainLog(params.jobId as string);
    if (!lines) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({ lines });
  }),
];
