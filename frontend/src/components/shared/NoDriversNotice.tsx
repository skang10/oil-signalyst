import type { DailyReport } from '@/types/api';

type Status = DailyReport['eia']['shap_status'];

/**
 * Why a Key Drivers panel is empty.
 *
 * It was a blank card, which read as "the model has no strong drivers today"
 * when the truth was always structural - and for a long time the truth was that
 * SHAP never ran at all in production, because no saved model carried the
 * background sample the explainer requires.
 */
const REASON: Record<Exclude<Status, 'ok'>, string> = {
  baseline:
    'The baseline model is serving, and it reads no features — so every contribution is zero by construction, not merely small.',
  no_model: 'No model is deployed for this forecast, so there is nothing to attribute.',
  unavailable:
    'Feature attribution could not be computed for this prediction. The forecast itself is unaffected.',
};

export default function NoDriversNotice({ status }: { status: Status }) {
  if (status === 'ok') return null;
  return <div className="text-[11.5px] text-text-muted">{REASON[status]}</div>;
}
