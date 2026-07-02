import { useEffect, useRef, useState } from 'react';
import { createElement as h, Fragment } from 'react';
import { useStartTraining, useTrainStatus, useTrainLog, useDeployModel } from '@/hooks/useTraining';
import type { AgentMessage, ConfirmGateState, GateAction, ToolCall } from './types';

let counter = 0;
const nextId = () => `m${++counter}`;

const INITIAL_MESSAGE: AgentMessage = {
  id: nextId(),
  role: 'agent',
  text: h(Fragment, null,
    'Hi Xuemei. The following issues were detected:',
    h('br'), h('br'),
    '· ', h('strong', { className: 'text-warning' }, 'Returns model PSI 0.22'), ' — exceeds threshold 0.20',
    h('br'),
    '· 2 new signal candidates found (IC 0.31 / 0.28)',
    h('br'), h('br'),
    'Shall I evaluate the signals and schedule retraining?'
  ),
  toolCalls: [{ name: 'compute_psi', args: 'Auto-detected', result: 'Returns model PSI 0.22 → exceeds threshold 0.20' }],
};

function reply(msg: string): { text: React.ReactNode; toolCalls?: ToolCall[]; gate?: Omit<ConfirmGateState, 'status'> } {
  const m = msg.toLowerCase();

  if (m.includes('evaluate signal') || m.includes('evaluate first')) {
    return {
      text: 'Starting evaluation of satellite tank fill rate signal.',
      toolCalls: [
        { name: 'fetch_data_sample', args: 'sat_tank_fill_middle_east · 2019-01-01 ~ 2025-06-30', result: '✓ Coverage 94.2% · 6.5yr history · 3d publication lag' },
        { name: 'compute_ic', args: 'target=regime_label · lag 5d/10d/20d · Bonferroni α=0.0125', result: 'IC=0.31/0.29/0.28 · p<0.01 · All pass ✓' },
        { name: 'compute_oos_decay', args: 'train_end=2022-12-31 / oos_start=2023-01-01', result: 'Train IC 0.33 → OOS IC 0.27 · Decay 18.2% < 30% ✓' },
        { name: 'compute_feature_correlation', args: 'vs existing 14 features', result: 'Max correlation 0.42 < 0.5 ✓ No redundancy' },
      ],
      gate: {
        title: 'Modify features.yaml',
        detail: h(Fragment, null, 'Will append entry:', h('br'), h('code', { className: 'font-mono bg-surface-1 px-1 py-[2px] rounded-[3px]' }, 'sat_tank_fill_me · bearish_if_positive: true')),
        confirmLabel: 'Confirm add ✓',
        cancelLabel: 'Cancel',
        actionId: 'add_feature',
      },
    };
  }

  if (m.includes('retrain directly') || m.includes('without adding')) {
    return {
      text: 'Understood. Retraining with current 14 features.',
      toolCalls: [
        { name: 'check_sample_size', args: '3,456 samples · 5-fold', result: '✓ Meets minimum sample size' },
        { name: 'check_leakage', args: 'gap=20days', result: '✓ No data leakage' },
      ],
      gate: {
        title: 'Start retraining',
        detail: h(Fragment, null, '· Model: Returns (TabPFN v2.3)', h('br'), '· Features: 14', h('br'), '· Folds: 5, gap=20d'),
        confirmLabel: 'Confirm training ✓',
        cancelLabel: 'Cancel',
        actionId: 'run_training',
      },
    };
  }

  if (m.includes('ais') || m.includes('vlcc')) {
    return {
      text: 'Evaluating AIS VLCC vessel count (Persian Gulf) — IC stable, recommended for feature pool.',
      toolCalls: [
        { name: 'compute_ic', args: 'ais_vlcc_count · lag 5d/10d/20d', result: 'IC=0.28/0.26/0.25 · All significant ✓' },
        { name: 'compute_oos_decay', args: 'OOS decay analysis', result: 'Decay 22.6% < threshold 30% ✓' },
        { name: 'compute_feature_correlation', args: 'vs existing 14 features', result: 'Max correlation 0.38 < 0.5 ✓ No redundancy' },
      ],
    };
  }

  if (m.includes('yes') || m.includes('proceed') || m.includes('add')) {
    return {
      text: 'Adding AIS VLCC signal to feature pool.',
      gate: {
        title: 'Modify features.yaml',
        detail: h(Fragment, null, 'Will append entry:', h('br'), h('code', { className: 'font-mono bg-surface-1 px-1 py-[2px] rounded-[3px]' }, 'ais_vlcc_count · source: ais')),
        confirmLabel: 'Confirm add ✓',
        cancelLabel: 'Cancel',
        actionId: 'add_feature',
      },
    };
  }

  return { text: 'Understood. What should I do first — data fetch, IC computation, or queue for training?' };
}

export function useAgentEngine() {
  const [messages, setMessages] = useState<AgentMessage[]>([INITIAL_MESSAGE]);
  const [jobId, setJobId] = useState<string | null>(null);
  const trainingMsgId = useRef<string | null>(null);
  const completedForJob = useRef<string | null>(null);

  const startTraining = useStartTraining();
  const { data: trainStatus } = useTrainStatus(jobId);
  const deployModel = useDeployModel();

  useTrainLog(jobId, (line) => {
    const msgId = trainingMsgId.current;
    if (!msgId) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.toolCalls) return m;
        const toolCalls = m.toolCalls.map((tc) =>
          tc.name === 'run_training' ? { ...tc, result: h(Fragment, null, tc.result, h('br'), line) } : tc
        );
        return { ...m, toolCalls };
      })
    );
  });

  useEffect(() => {
    if (!jobId || !trainStatus || trainStatus.status !== 'complete' || completedForJob.current === jobId) return;
    completedForJob.current = jobId;
    const result = trainStatus.result;
    push({
      role: 'agent',
      text: 'Training complete. Deploy?',
      toolCalls: undefined,
      gate: {
        status: 'pending',
        title: 'Replace production model',
        detail: h(Fragment, null,
          '· Current v2.3 (Brier ', result ? result.old_metrics.returns_brier.toFixed(3) : '0.240', ') will be replaced', h('br'),
          '· New v2.4 (Brier ', result ? result.new_metrics.returns_brier.toFixed(3) : '0.198', ')', h('br'),
          '· MLflow run_id: b7d4e2a9'
        ),
        confirmLabel: 'Confirm deploy ✓',
        cancelLabel: 'Skip deploy',
        actionId: 'deploy',
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, trainStatus]);

  function push(msg: Omit<AgentMessage, 'id'>) {
    const id = nextId();
    setMessages((prev) => [...prev, { id, ...msg }]);
    return id;
  }

  function sendMessage(text: string) {
    push({ role: 'user', text });
    const typingId = push({ role: 'agent', typing: true });
    setTimeout(() => {
      const r = reply(text);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === typingId
            ? { ...m, typing: false, text: r.text, toolCalls: r.toolCalls, gate: r.gate ? { ...r.gate, status: 'pending' } : undefined }
            : m
        )
      );
    }, 900);
  }

  async function executeAction(actionId: GateAction) {
    if (actionId === 'add_feature') {
      push({
        role: 'agent',
        text: 'Feature added. Retraining required to take effect.',
        toolCalls: [{ name: 'add_to_feature_registry', args: 'Writing config/features.yaml', result: '✓ New feature added (total: 15)' }],
        gate: {
          status: 'pending',
          title: 'Start returns model retraining',
          detail: h(Fragment, null, '· Model: Returns (TabPFN v2.3)', h('br'), '· Features: 15 (including new)', h('br'), '· Folds: 5, gap=20d'),
          confirmLabel: 'Confirm training ✓',
          cancelLabel: 'Later',
          actionId: 'run_training',
        },
      });
      return;
    }

    if (actionId === 'run_training') {
      const msgId = push({
        role: 'agent',
        text: undefined,
        toolCalls: [
          { name: 'check_leakage', args: 'gap=20d, 5-fold, Bonferroni α=0.0125', result: '✓ No data leakage' },
          { name: 'run_training', args: 'Returns · TabPFN', result: 'Starting...' },
        ],
      });
      trainingMsgId.current = msgId;
      const job = await startTraining.mutateAsync({ model_types: ['returns'], cutoff_date: '2026-06-30', cv_folds: 5, gap_days: 20 });
      setJobId(job.job_id);
      return;
    }

    if (actionId === 'deploy') {
      await deployModel.mutateAsync({ type: 'returns', jobId: jobId! });
      push({
        role: 'agent',
        variant: 'success',
        text: h(Fragment, null,
          h('strong', { className: 'text-success' }, 'All done.'), h('br'),
          '· Added feature sat_tank_fill_me (total: 15)', h('br'),
          '· Brier: 0.240 → ', h('strong', null, '0.198'), ' (−17.5%)', h('br'),
          '· PSI: 0.22 → ', h('strong', null, '0.06')
        ),
        toolCalls: [{ name: 'deploy_model', args: 'returns_v2.4.joblib → production service', result: '✓ Deployed · model_versions table updated' }],
      });
    }
  }

  function confirmGate(msgId: string) {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg?.gate) return;
    const actionId = msg.gate.actionId;
    setMessages((prev) => prev.map((m) => (m.id === msgId && m.gate ? { ...m, gate: { ...m.gate, status: 'confirmed' } } : m)));
    setTimeout(() => executeAction(actionId), 400);
  }

  function cancelGate(msgId: string) {
    setMessages((prev) => prev.map((m) => (m.id === msgId && m.gate ? { ...m, gate: { ...m.gate, status: 'cancelled' } } : m)));
  }

  return { messages, sendMessage, confirmGate, cancelGate };
}
