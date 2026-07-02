import { http, HttpResponse } from 'msw';
import { BASE } from '@/lib/api';
import { modelStatusFixture } from '../fixtures/modelStatus';
import { getTrainJob } from '../state/trainJobs';

export const modelsHandlers = [
  http.get(`${BASE}/api/models/status`, () => {
    return HttpResponse.json(modelStatusFixture);
  }),
  http.post(`${BASE}/api/models/:type/deploy`, ({ params, request }) => {
    const type = params.type as string;
    const url = new URL(request.url);
    const jobId = url.searchParams.get('job_id');
    const job = jobId ? getTrainJob(jobId) : undefined;
    if (!job || job.status !== 'complete') {
      return new HttpResponse(null, { status: 409 });
    }

    const model = modelStatusFixture.models.find((m) => m.type === type);
    if (model) {
      // 0.04 matches oil-signalyst-ds-agent.html's canonical post-deploy PSI.
      model.metrics.psi = 0.04;
      model.psi_alert = false;
      model.deployed_at = new Date().toISOString();
      model.mlflow_run_id = 'b7d4e2a9';
      if (job.result) model.metrics.primary = job.result.new_metrics.returns_brier;
    }

    return HttpResponse.json({ deployed: true, type });
  }),
];
