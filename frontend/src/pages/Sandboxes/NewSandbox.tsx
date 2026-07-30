import { useState } from 'react';
import Card from '@/components/shared/Card';
import type { WorkbenchSandbox } from '@/lib/sandboxModel';
import { addCreatedSandbox, getCreatedSandboxes } from '@/lib/sandboxStore';

const CHANGE_TABS = ['Features', 'Model', 'Data range', 'Train window'] as const;
type ChangeTab = (typeof CHANGE_TABS)[number];

const MODELS = ['TabPFN v2 · ensemble 12', 'TabPFN v2 · ensemble 24', 'LightGBM · lr 0.05 · 63 leaves', 'Elastic Net'];
const RANGES = ['2024-W01 → 2026-W30 · 34 folds', '2019-W01 → 2026-W30 · full history', '2025-W01 → 2026-W30 · 20 folds'];
const WINDOWS = ['150 weeks, rolling', '260 weeks, rolling', '104 weeks, rolling', 'expanding — keep all history'];
const CANDIDATE_FEATURES = [
  'tanker_arrivals_7d',
  'tanker_discharge_usgc_3d',
  'is_holiday_week',
  'ovx_term_slope',
  'copper_ret_20d',
  'natural_gas_ret_20d',
];

function modelFamily(m: string): string {
  if (m.startsWith('TabPFN')) return 'TabPFN';
  if (m.startsWith('LightGBM')) return 'LightGBM';
  return m;
}

/** Green train-window bar as a fraction of the ~365-week (2019→2026) span. */
function windowPct(w: string): number {
  if (w.startsWith('expanding')) return 100;
  const weeks = Number(w.match(/(\d+)/)?.[1] ?? 150);
  return Math.min(100, Math.round((weeks / 365) * 100));
}

/**
 * New training sandbox — the Stockcast create flow: start from a parent, change
 * exactly one thing, preview which weeks it will use, confirm what's inherited,
 * and write the hypothesis before running. "Create and run" adds a live-mock
 * sandbox that shows up under "training now".
 */
export default function NewSandbox({
  parents,
  onBack,
  onCreated,
}: {
  parents: WorkbenchSandbox[];
  onBack: () => void;
  onCreated: (id: string, ran: boolean) => void;
}) {
  const forkable = parents.filter((p) => p.life !== 'training' && p.life !== 'archived');
  const [parentId, setParentId] = useState<string>(
    forkable.find((p) => p.life === 'production')?.id ?? forkable[0]?.id ?? 'blank'
  );
  const parent = forkable.find((p) => p.id === parentId) ?? null;
  const blank = parentId === 'blank';

  const [tab, setTab] = useState<ChangeTab>('Features');
  const [added, setAdded] = useState<string[]>(['tanker_arrivals_7d', 'is_holiday_week']);
  const [model, setModel] = useState(MODELS[0]);
  const [range, setRange] = useState(RANGES[0]);
  const [win, setWin] = useState(WINDOWS[0]);
  const [name, setName] = useState('tanker-plus-holiday');
  const [hypothesis, setHypothesis] = useState(
    'Tanker arrivals should help when import timing shifts. The holiday flag should fix the July-4th-style misses.'
  );

  const changes: string[] = [];
  if (added.length) changes.push(`added ${added.join(', ')}`);
  if (model !== MODELS[0]) changes.push(`model → ${modelFamily(model)}`);
  if (range !== RANGES[0]) changes.push(`data range → ${range.split(' · ')[0]}`);
  if (win !== WINDOWS[0]) changes.push(`train window → ${win.split(',')[0]}`);
  const changeSummary = changes.join(' · ');

  function toggleFeature(f: string) {
    setAdded((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  function create(ran: boolean) {
    const id = `sb-0${51 + getCreatedSandboxes().length}`;
    const baseFeatures = parent?.specFeatures ?? 18;
    const sb: WorkbenchSandbox = {
      id,
      version: name.trim() || 'experiment',
      life: ran ? 'training' : 'idle',
      forkParent: blank ? null : parentId,
      forkParentLife: blank ? null : parent?.life ?? null,
      change: blank ? 'blank sandbox · own baseline' : changeSummary || 'no change from parent',
      createdOn: 'W31',
      specFolds: parent?.specFolds ?? 34,
      specFeatures: baseFeatures + added.length,
      model: modelFamily(model),
      mae: null,
      dirPct: null,
      spread: null,
      vsProd: null,
      shadowWeek: null,
      liveSince: null,
      retiredAt: null,
      trainingPct: ran ? 0 : null,
      baseline: parent?.baseline ?? 2.63,
      data: parent?.data ?? {
        vintageRange: range.split(' · ')[0],
        folds: '34 · every 4 wk',
        gap: null,
        revisions: 'as-published only',
      },
      training: {
        model,
        trainWindow: win,
        scheme: 'walk-forward, refit weekly',
        configHash: 'pending',
        lastRun: ran ? 'started just now · 0%' : 'not run yet',
      },
      features: [
        ...added.map((f) => ({ name: f, desc: 'added in this fork', added: true })),
        ...(parent?.features.filter((pf) => !pf.added) ?? []),
      ],
      results: ran ? [{ window: 'no results yet', mae: null, dir: null, evidence: 'running' as const }] : [],
      gate: [],
      hypothesis,
    };
    addCreatedSandbox(sb);
    onCreated(id, ran);
  }

  return (
    <>
      <button
        onClick={onBack}
        className="inline-flex items-center gap-[6px] font-mono text-[12px] text-text-secondary border border-border-strong rounded-[7px] px-[11px] py-[5px] mb-[13px] hover:bg-surface-1 hover:text-text-primary"
      >
        <span className="text-[15px] leading-none">←</span> all training sandboxes
      </button>
      <h1 className="text-[17px] font-semibold tracking-[-0.01em] mb-[3px]">New training sandbox</h1>
      <p className="text-[12.5px] text-text-secondary mb-[18px] max-w-[76ch]">
        Start from an existing sandbox and change <b className="text-text-primary">one thing</b>. That is what makes the
        two comparable afterwards.
      </p>

      {/* 1 · Start from */}
      <Card>
        <H3>1 · Start from</H3>
        <select className={selCls} value={parentId} onChange={(e) => setParentId(e.target.value)}>
          {forkable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} · {p.version}
              {p.life === 'production' ? ' · production' : p.life === 'shadow' ? ' · shadow' : ''} — {p.specFeatures ?? '—'}{' '}
              features, {p.model}
            </option>
          ))}
          <option value="blank">blank — no parent, nothing inherited</option>
        </select>
        {blank && (
          <p className={ctxCls}>
            a blank sandbox has nothing to compare against, so it needs its own baseline run before it means anything
          </p>
        )}
      </Card>

      {/* 2 · Change one thing */}
      <Card className="mt-[14px]">
        <H3>2 · Change one thing</H3>
        <div className="flex gap-[7px] flex-wrap mb-[14px]">
          {CHANGE_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                'font-mono text-[12px] rounded-[7px] px-[13px] py-[7px] border cursor-pointer ' +
                (tab === t
                  ? 'bg-text-primary text-[#F1EFE8] border-text-primary'
                  : 'bg-surface-2 text-text-secondary border-border')
              }
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'Features' && (
          <div className="border border-border rounded-[8px] overflow-hidden">
            <DiffLine k="inherited">
              <span className="text-text-secondary">
                {blank ? 'nothing — blank sandbox' : `${parent?.specFeatures ?? 0} features from ${parentId}`}
              </span>
            </DiffLine>
            <DiffLine k="+ add" tone="add">
              <div className="flex gap-[7px] flex-wrap items-center">
                {added.map((f) => (
                  <button
                    key={f}
                    onClick={() => toggleFeature(f)}
                    className="font-mono text-[11px] bg-success-bg text-success rounded-[5px] px-[9px] py-[4px] cursor-pointer"
                  >
                    {f} <span className="opacity-60">×</span>
                  </button>
                ))}
                {CANDIDATE_FEATURES.filter((f) => !added.includes(f)).map((f) => (
                  <button
                    key={f}
                    onClick={() => toggleFeature(f)}
                    className="font-mono text-[11px] border border-border rounded-[5px] px-[9px] py-[4px] text-text-muted hover:text-text-primary hover:border-border-strong cursor-pointer"
                  >
                    + {f}
                  </button>
                ))}
              </div>
            </DiffLine>
            <DiffLine k="− remove" tone="rem">
              <span className="text-text-muted">nothing</span>
            </DiffLine>
          </div>
        )}
        {tab === 'Model' && (
          <select className={selCls} value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m, i) => (
              <option key={m} value={m}>
                {m}
                {i === 0 ? ' (inherited)' : ''}
              </option>
            ))}
          </select>
        )}
        {tab === 'Data range' && (
          <>
            <select className={selCls} value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map((r, i) => (
                <option key={r} value={r}>
                  {r}
                  {i === 0 ? ' (inherited)' : ''}
                </option>
              ))}
            </select>
            <p className={ctxCls}>a different range makes results incomparable with the parent — use only when that is the point</p>
          </>
        )}
        {tab === 'Train window' && (
          <select className={selCls} value={win} onChange={(e) => setWin(e.target.value)}>
            {WINDOWS.map((w, i) => (
              <option key={w} value={w}>
                {w}
                {i === 0 ? ' (inherited)' : ''}
              </option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-[10px] flex-wrap mt-[13px] px-[12px] py-[9px] bg-surface-1 rounded-[7px] text-[12px] text-text-secondary">
          <span className="font-mono text-[11px] text-success font-semibold">changes</span>
          {changeSummary || <span className="text-text-muted">nothing yet — this would just duplicate the parent</span>}
        </div>
      </Card>

      {/* Which weeks */}
      <Card className="mt-[14px]">
        <H3>Which weeks this sandbox will use</H3>
        <WeeksTimeline pct={windowPct(win)} rangeLabel={range.split(' · ')[0]} />
        <p className={ctxCls}>changing the train window moves the green bar · changing the data range moves the whole track</p>
      </Card>

      {/* 3 · Inherited unchanged */}
      <Card className="mt-[14px]">
        <H3>3 · Inherited unchanged</H3>
        <KV k="Vintage range" v={blank ? '—' : parent?.data.vintageRange ?? '—'} />
        <KV k="Model" v={model !== MODELS[0] ? 'changed above' : modelFamily(model)} />
        <KV k="Train window" v={win !== WINDOWS[0] ? 'changed above' : win.split(',')[0]} />
        <KV k="Scheme" v="walk-forward, refit weekly" />
        <p className={ctxCls}>pinned at creation — later revisions to the vintage store will not reach this sandbox</p>
      </Card>

      {/* 4 · Name it */}
      <Card className="mt-[14px]">
        <H3>4 · Name it &amp; say why</H3>
        <div className="flex items-center gap-[8px] font-mono text-[13px]">
          <span className="text-text-muted">sb-05× ·</span>
          <input className={selCls + ' flex-1'} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="block font-mono text-[11px] uppercase tracking-[0.07em] text-text-muted mt-[14px] mb-[6px]">
          What do you expect to happen?
        </label>
        <textarea
          className={selCls + ' resize-y min-h-[64px] leading-[1.6]'}
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
        />
        <p className={ctxCls}>written before the run, so the result can’t rewrite the reason</p>
      </Card>

      {/* actions */}
      <div className="flex gap-2 flex-wrap mt-[16px]">
        <button
          onClick={() => create(true)}
          className="font-mono text-[12px] font-semibold rounded-[7px] px-[16px] py-[8px] bg-accent-fill text-on-accent cursor-pointer"
        >
          Create and run
        </button>
        <button
          onClick={() => create(false)}
          className="font-mono text-[12px] font-semibold rounded-[7px] px-[16px] py-[8px] border border-accent-border text-accent-text bg-transparent cursor-pointer hover:bg-accent-bg"
        >
          Create as draft
        </button>
        <button
          onClick={onBack}
          className="font-mono text-[12px] font-semibold rounded-[7px] px-[16px] py-[8px] border border-border-strong text-text-secondary bg-transparent cursor-pointer hover:bg-surface-1"
        >
          Cancel
        </button>
      </div>
    </>
  );
}

function WeeksTimeline({ pct, rangeLabel }: { pct: number; rangeLabel: string }) {
  return (
    <div className="mt-[2px]">
      <div className="relative h-[26px] bg-surface-1 rounded-[6px] overflow-hidden border border-border">
        <div
          className="absolute top-0 bottom-0 right-0 bg-success-bg border-l-2 border-success grid place-items-center"
          style={{ width: `${pct}%` }}
        >
          <span className="font-mono text-[10px] text-success font-semibold">train window</span>
        </div>
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 w-px bg-border-strong opacity-40"
            style={{ left: `${((i + 1) / 10) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-text-muted mt-[5px]">
        <span>{rangeLabel.split(' → ')[0]}</span>
        <span>backtest folds every 4 wk</span>
        <span>now →</span>
      </div>
    </div>
  );
}

function DiffLine({ k, tone, children }: { k: string; tone?: 'add' | 'rem'; children: React.ReactNode }) {
  const kColor = tone === 'add' ? 'text-success' : tone === 'rem' ? 'text-danger' : 'text-text-muted';
  return (
    <div
      className={
        'flex gap-[14px] items-center px-[12px] py-[10px] border-b border-border last:border-0 text-[12.5px] ' +
        (tone ? '' : 'bg-surface-1')
      }
    >
      <span className={'font-mono text-[11px] w-[76px] shrink-0 ' + kColor}>{k}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

const selCls = 'w-full font-mono text-[12.5px] px-[11px] py-[9px] border border-border-strong rounded-[7px] bg-surface-2 text-text-primary';
const ctxCls = 'font-mono text-[10.5px] text-text-muted mt-[9px] leading-[1.5]';

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[11px]">{children}</h3>;
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-[7px] border-b border-border last:border-0 text-[12.5px]">
      <span className="text-text-secondary">{k}</span>
      <span className="font-mono text-[12px] text-right">{v}</span>
    </div>
  );
}
