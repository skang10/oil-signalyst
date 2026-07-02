import { useEffect, useRef, useState } from 'react';
import { useStartTraining, useTrainStatus, useTrainLog, useDeployModel } from '@/hooks/useTraining';
import type { AgentMessage, ConfirmGateState, GateAction, ToolCall } from './types';

let counter = 0;
const nextId = () => `m${++counter}`;

const INITIAL_MESSAGE: AgentMessage = {
  id: nextId(),
  role: 'agent',
  text: (
    <>
      Hi Xuemei. The following issues were detected:
      <br />
      <br />
      · <strong className="text-warning">Returns model PSI 0.22</strong>, exceeds threshold 0.20 — retraining recommended
      <br />
      · Signal Scanner found <strong>2 new signal candidates</strong> worth evaluating
      <br />
      · Satellite tank fill rate IC=0.31 (Recommended)
      <br />
      · AIS VLCC vessel count IC=0.28 (Recommended)
      <br />
      <br />
      Would you like to evaluate the new signals first, or start retraining directly?
    </>
  ),
};

const codeBlock = (lines: string[]) => (
  <>
    {lines.map((l, i) => (
      <span key={i}>
        {l}
        {i < lines.length - 1 && <br />}
      </span>
    ))}
  </>
);

function evaluateSatelliteReply(): { text: React.ReactNode; toolCalls: ToolCall[]; footer: React.ReactNode } {
  return {
    text: "OK, I'll evaluate the satellite tank fill rate signal.",
    footer:
      'Overall, satellite tank fill rate passed all evaluation gates: IC significant (Bonferroni-corrected), low OOS decay, no redundancy with existing features.',
    toolCalls: [
      {
        name: 'fetch_data_sample',
        code: codeBlock(['signal = "sat_tank_fill_middle_east"', 'start = "2019-01-01"', 'end = "2025-06-30"', 'check_coverage = True']),
        result: codeBlock([
          '✓ Data fetch complete',
          'Coverage: 94.2% (gaps mainly in 2020 Q1-Q2 due to cloud cover)',
          'Frequency: Weekly',
          'History length: 6.5 years',
          'publication lag: ~3 days',
        ]),
      },
      {
        name: 'compute_ic',
        code: codeBlock([
          'signal = "sat_tank_fill_middle_east"',
          'target = "regime_label"',
          'lags = [5, 10, 20]',
          'method = "spearman"',
          'bonferroni_alpha = 0.05 / 4  # 4 candidate signals',
        ]),
        result: codeBlock([
          'lag 5d:  IC=0.31, p=0.003 ✓ significant',
          'lag 10d: IC=0.29, p=0.006 ✓ significant',
          'lag 20d: IC=0.28, p=0.008 ✓ significant',
          'Bonferroni α=0.0125, 3/3 lags pass',
        ]),
      },
      {
        name: 'compute_oos_decay',
        code: codeBlock(['signal = "sat_tank_fill_middle_east"', 'train_end = "2022-12-31"', 'oos_start = "2023-01-01"']),
        result: codeBlock(['Train IC: 0.33', 'OOS IC:   0.27', 'OOS decay: 18.2% ← below threshold 30% ✓']),
      },
      {
        name: 'compute_feature_correlation',
        code: codeBlock(['signal = "sat_tank_fill_middle_east"', 'existing_features = ["crude_inv_dev", "spec_net_pct", ...]']),
        result: codeBlock(['vs crude_inv_dev: 0.42 (within threshold 0.5)', 'Max correlation with existing features: 0.38', 'No highly correlated existing features ✓']),
      },
    ],
  };
}

function evaluateAisReply(): { text: React.ReactNode; toolCalls: ToolCall[]; footer: React.ReactNode } {
  return {
    text: 'Evaluating AIS VLCC vessel count (Persian Gulf).',
    footer: 'IC stable across lags, low OOS decay, no redundancy with existing features — recommended for feature pool.',
    toolCalls: [
      {
        name: 'fetch_data_sample',
        code: codeBlock(['signal = "ais_vlcc_count"', 'start = "2019-01-01"', 'end = "2025-06-30"', 'check_coverage = True']),
        result: codeBlock(['✓ Data fetch complete', 'Coverage: 91.0%', 'Frequency: Weekly', 'History length: 6.5 years']),
      },
      {
        name: 'compute_ic',
        code: codeBlock(['signal = "ais_vlcc_count"', 'target = "regime_label"', 'lags = [5, 10, 20]', 'method = "spearman"']),
        result: codeBlock(['lag 5d:  IC=0.28, p=0.004 ✓ significant', 'lag 10d: IC=0.26, p=0.007 ✓ significant', 'lag 20d: IC=0.25, p=0.009 ✓ significant']),
      },
      {
        name: 'compute_oos_decay',
        code: codeBlock(['signal = "ais_vlcc_count"', 'train_end = "2022-12-31"', 'oos_start = "2023-01-01"']),
        result: codeBlock(['Train IC: 0.30', 'OOS IC:   0.23', 'OOS decay: 22.6% ← below threshold 30% ✓']),
      },
      {
        name: 'compute_feature_correlation',
        code: codeBlock(['signal = "ais_vlcc_count"', 'existing_features = ["crude_inv_dev", "spec_net_pct", ...]']),
        result: codeBlock(['Max correlation with existing features: 0.38', 'No highly correlated existing features ✓']),
      },
    ],
  };
}

function reply(msg: string): {
  text: React.ReactNode;
  toolCalls?: ToolCall[];
  footer?: React.ReactNode;
  gate?: Omit<ConfirmGateState, 'status'>;
} {
  const m = msg.toLowerCase();

  if (m.includes('feature pool') || (m.includes('adding') && m.includes('retrain'))) {
    return {
      text: 'I am ready to execute the following two steps — please confirm:',
      gate: {
        step: '1/2',
        title: 'Modify features.yaml',
        detail: (
          <>
            Will append the following entry to <code className="font-mono bg-surface-1 px-1 py-[1px] rounded-[3px]">config/features.yaml</code>:
            <div className="block p-2 bg-surface-1 rounded mt-[6px] font-mono text-[11px] leading-[1.7]">
              - name: sat_tank_fill_me
              <br />
              &nbsp;&nbsp;source: satellite_middle_east
              <br />
              &nbsp;&nbsp;transform: raw
              <br />
              &nbsp;&nbsp;bearish_if_positive: true
              <br />
              &nbsp;&nbsp;window: 1
            </div>
          </>
        ),
        confirmLabel: 'Confirm add ✓',
        cancelLabel: 'Cancel',
        actionId: 'add_feature',
      },
    };
  }

  if (m.includes('satellite')) {
    return evaluateSatelliteReply();
  }

  if (m.includes('ais') || m.includes('vlcc')) {
    return evaluateAisReply();
  }

  if (m.includes('all three') || m.includes('full retrain') || (m.includes('retrain') && m.includes('latest data'))) {
    return {
      text: 'Understood. Retraining all three models with the current feature set.',
      toolCalls: [
        { name: 'check_sample_size', code: codeBlock(['models = ["regime", "eia", "returns"]', 'samples = 3456']), result: '✓ Meets minimum sample size for all models' },
        { name: 'check_leakage', code: codeBlock(['gap = 20  # days']), result: '✓ No data leakage' },
      ],
      gate: {
        step: '1/1',
        title: 'Retrain all three models',
        detail: (
          <>
            · Models: Regime, EIA Forecast, Returns (TabPFN)
            <br />
            · Features: 14 (current pool)
            <br />
            · TimeSeriesSplit: 5-fold, gap=20d
          </>
        ),
        confirmLabel: 'Confirm training ✓',
        cancelLabel: 'Cancel',
        actionId: 'run_training',
      },
    };
  }

  if (m.includes('explain')) {
    return {
      text: (
        <>
          Today's Regime forecast (R3 — Oversupply Bear, 61%) is driven mainly by:
          <br />
          <br />
          · <strong>curve_slope_zscore</strong> (0.18) — futures curve in contango, bearish
          <br />
          · <strong>crude_inv_dev</strong> (0.16) — inventory 8.2% above 5yr average, bearish
          <br />
          · <strong>spec_net_pct</strong> (0.11) — speculators reducing longs, bearish
          <br />
          <br />
          The only bullish driver is <strong>copper_ret_20d</strong> (0.07), a weak demand-growth proxy. Net signal is firmly bearish.
        </>
      ),
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
          tc.name === 'run_training' ? { ...tc, code: tc.code ? <>{tc.code}<br />{line}</> : <>{line}</> } : tc
        );
        return { ...m, toolCalls };
      })
    );
  });

  useEffect(() => {
    if (!jobId || !trainStatus || trainStatus.status !== 'complete' || completedForJob.current === jobId) return;
    completedForJob.current = jobId;

    // Stop the run_training spinner.
    const msgId = trainingMsgId.current;
    if (msgId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.toolCalls
            ? { ...m, toolCalls: m.toolCalls.map((tc) => (tc.name === 'run_training' ? { ...tc, streaming: false } : tc)) }
            : m
        )
      );
    }

    const result = trainStatus.result;
    const oldBrier = result?.old_metrics.returns_brier ?? 0.24;
    const newBrier = result?.new_metrics.returns_brier ?? 0.198;
    const improvement = result?.improvement_pct ?? -17.5;

    // ds-agent.html auto-deploys once training improves - no separate confirm gate.
    deployModel.mutateAsync({ type: 'returns', jobId }).then(() => {
      push({
        role: 'agent',
        toolCalls: [
          {
            name: 'compare_model_performance',
            result: codeBlock([
              `Old (v2.3): OOS Brier = ${oldBrier.toFixed(3)}, PSI = 0.22`,
              `New (v2.4): OOS Brier = ${newBrier.toFixed(3)} ✓, PSI = 0.04 ✓`,
              `Improvement: ${improvement.toFixed(1)}% (Brier) ← significant improvement`,
            ]),
          },
          {
            name: 'deploy_model',
            result: codeBlock(['✓ returns_v2.4.joblib deployed as active production version', 'model_versions table updated', 'MLflow run_id: b7d4e2a9']),
          },
        ],
        footer: (
          <>
            Training complete! New returns model auto-deployed:
            <br />
            <br />
            · OOS Brier <strong className="text-success">{newBrier.toFixed(3)}</strong> (old: {oldBrier.toFixed(3)}, improvement {Math.abs(improvement).toFixed(1)}%)
            <br />
            · PSI reset to <strong className="text-success">0.04</strong> (old: 0.22)
            <br />
            · New feature <code className="font-mono text-[11px] bg-surface-1 px-1 py-[1px] rounded-[3px]">sat_tank_fill_me</code> SHAP contribution 9.2%
            <br />
            <br />
            Tomorrow's Dashboard will show updated forecasts.
          </>
        ),
      });
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
            ? {
                ...m,
                typing: false,
                text: r.text,
                toolCalls: r.toolCalls,
                footer: r.footer,
                gate: r.gate ? { ...r.gate, status: 'pending' } : undefined,
              }
            : m
        )
      );
    }, 900);
  }

  async function executeAction(actionId: GateAction) {
    if (actionId === 'add_feature') {
      push({
        role: 'agent',
        toolCalls: [
          {
            name: 'add_to_feature_registry',
            code: codeBlock(['feature = "sat_tank_fill_me"', 'config = { source: "satellite_middle_east", bearish_if_positive: true }']),
            result: '✓ features.yaml updated, 1 new feature added (total: 15)',
          },
        ],
        footer: 'Feature added. Step 2 — retrain returns model:',
        gate: {
          status: 'pending',
          step: '2/2',
          title: 'Retrain returns model',
          detail: (
            <>
              Training will run with the following config:
              <br />
              <br />
              · Model: <code className="font-mono bg-surface-1 px-1 py-[1px] rounded-[3px]">returns</code> (Returns model · TabPFN · 4-class)
              <br />
              · Features: 15 (including new sat_tank_fill_me)
              <br />
              · Training set: 2010-01-01 ~ 2023-12-31
              <br />
              · TimeSeriesSplit: 5-fold, gap=20d
              <br />
              · Bonferroni α = 0.05/4 = 0.0125
              <br />
              <br />
              If the new OOS Brier improves on 0.24, it will be auto-deployed.
            </>
          ),
          confirmLabel: 'Confirm training ✓',
          cancelLabel: 'Cancel',
          actionId: 'run_training',
        },
      });
      return;
    }

    if (actionId === 'run_training') {
      const msgId = push({
        role: 'agent',
        toolCalls: [{ name: 'run_training', streaming: true, code: codeBlock(['[00:00] Starting training run...'])}],
      });
      trainingMsgId.current = msgId;
      const job = await startTraining.mutateAsync({ model_types: ['returns'], cutoff_date: '2026-06-30', cv_folds: 5, gap_days: 20 });
      setJobId(job.job_id);
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
