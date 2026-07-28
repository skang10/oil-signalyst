import { useState } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import NA from '@/components/workbench/NA';
import { useSignals } from '@/hooks/useSignals';
import type { EiaModel } from '@/lib/workbench';
import { cn } from '@/lib/utils';
import StartRunPanel from './StartRunPanel';

const CHANGE_TABS = ['Features', 'Model', 'Data range', 'Train window'] as const;
type ChangeTab = (typeof CHANGE_TABS)[number];

/**
 * The Stockcast "New training sandbox" flow, reproduced faithfully. The backend
 * can't fork-with-one-change or persist a hypothesis, and it retrains on a fixed
 * feature set / split — so the "start from", "change one thing" and "inherited"
 * sections are a preview whose effect the server does not apply (marked NA), and
 * the actual run is the real EIA retrain in StartRunPanel below.
 */
export default function NewSandbox({
  live,
  onBack,
}: {
  live: EiaModel | undefined;
  onBack: () => void;
}) {
  const { data: signals } = useSignals();
  const pool = signals?.active ?? [];
  const [tab, setTab] = useState<ChangeTab>('Features');
  const [added, setAdded] = useState<string[]>([]);

  const poolNames = pool.map((p) => p.name).filter((n) => !added.includes(n));

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 font-mono text-[11px] text-text-secondary bg-none border-none cursor-pointer p-0 mb-[10px] hover:text-text-primary"
      >
        <IconArrowLeft size={12} /> training sandboxes
      </button>
      <div className="mb-3">
        <div className="text-[15px] font-medium">New training sandbox</div>
        <div className="text-[12px] text-text-muted mt-[2px]">
          Start from an existing sandbox and change <b>one thing</b> — that is what makes the two comparable.
          The fork config is a preview; the server retrains EIA on a fixed feature set (<NA short />), so the
          run below is a standard retrain.
        </div>
      </div>

      <Card title="1 · Start from">
        <select className="w-full font-mono text-[12px] p-[9px_11px] border border-border rounded-[7px] bg-surface-2">
          <option>{live ? `eia · ${live.version} · production` : 'production (none)'}</option>
          <option>blank — no parent, nothing inherited</option>
        </select>
        <p className="text-[11px] text-text-muted mt-2">
          The parent relationship isn’t stored server-side — <NA />.
        </p>
      </Card>

      <Card title="2 · Change one thing" className="mt-[14px]">
        <div className="flex gap-[7px] flex-wrap mb-3">
          {CHANGE_TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'font-mono text-[12px] border rounded-[7px] px-[13px] py-[7px] cursor-pointer',
                tab === t ? 'bg-text-primary text-surface-2 border-text-primary' : 'bg-surface-2 border-border text-text-secondary'
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'Features' ? (
          <div className="border border-border rounded-[8px] overflow-hidden">
            <Diff k="inherited" tone="base">
              {live ? <><NA short /> features from eia · {live.version}</> : <NA />}
            </Diff>
            <Diff k="+ add" tone="add">
              <div className="flex gap-[6px] flex-wrap items-center">
                {added.map((f) => (
                  <span key={f} className="font-mono text-[11px] bg-success-bg text-success rounded-[5px] px-[8px] py-[3px]">
                    {f}{' '}
                    <button type="button" className="opacity-60 cursor-pointer" onClick={() => setAdded((a) => a.filter((x) => x !== f))}>
                      ×
                    </button>
                  </span>
                ))}
                <select
                  className="font-mono text-[11px] border border-border rounded-[6px] px-[8px] py-[3px] bg-surface-2"
                  value=""
                  onChange={(e) => e.target.value && setAdded((a) => [...a, e.target.value])}
                >
                  <option value="">+ feature…</option>
                  {poolNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </Diff>
            <Diff k="− remove" tone="rem">
              <span className="text-text-muted">nothing</span>
            </Diff>
          </div>
        ) : (
          <div className="text-[12px] text-text-muted">
            {tab} change — the backend retrains on a fixed {tab === 'Model' ? 'model (TabPFN)' : tab === 'Data range' ? 'split (train 2012–2024 / test 2025→today)' : 'window'}, so this control has no effect yet (<NA />).
          </div>
        )}

        <div className="flex items-center gap-[10px] flex-wrap mt-3 p-[9px_12px] bg-surface-1 rounded-[7px] text-[12px] text-text-secondary">
          {added.length === 0 ? (
            <span className="text-text-muted">nothing changed yet — this would be an exact copy of the parent</span>
          ) : (
            <>
              <span className="font-mono text-[11px] text-success font-semibold">1 change (preview)</span>
              <span>a later comparison would attribute differences to these {added.length} feature{added.length > 1 ? 's' : ''} — once the backend applies fork config (<NA short />)</span>
            </>
          )}
        </div>
      </Card>

      <Card title="3 · Inherited unchanged" className="mt-[14px]">
        <KV k="Vintage range" v={<NA />} />
        <KV k="Model" v={live ? 'TabPFN' : <NA />} />
        <KV k="Train window" v={<NA />} />
        <KV k="Scheme" v="walk-forward, refit weekly" />
      </Card>

      <Card title="4 · Name it & say why" className="mt-[14px]">
        <input
          className="w-full font-mono text-[12px] p-[9px_11px] border border-border rounded-[7px] bg-surface-2"
          defaultValue="new-sandbox"
        />
        <label className="block font-mono text-[11px] uppercase tracking-[0.07em] text-text-muted mt-[14px] mb-[6px]">
          What do you expect to happen?
        </label>
        <textarea
          className="w-full font-mono text-[12px] p-[9px_11px] border border-border rounded-[7px] bg-surface-2 resize-y min-h-[56px] leading-[1.6]"
          placeholder="Written before the run, so the result can't rewrite the reason…"
        />
        <p className="text-[11px] text-text-muted mt-2">Name & hypothesis are kept in this browser only — not persisted (<NA />).</p>
      </Card>

      {/* The real run */}
      <div className="mt-[14px]">
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted mb-2">create and run</div>
        <StartRunPanel />
      </div>
    </>
  );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-surface-2 border border-border rounded-[10px] p-[16px_18px]', className)}>
      <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[11px]">{title}</h3>
      {children}
    </div>
  );
}

function Diff({ k, tone, children }: { k: string; tone: 'base' | 'add' | 'rem'; children: React.ReactNode }) {
  return (
    <div className={cn('flex gap-[14px] items-center p-[10px_12px] border-b border-border last:border-b-0 text-[12px]', tone === 'base' && 'bg-surface-1 text-text-secondary')}>
      <span className={cn('font-mono text-[11px] w-[76px] shrink-0', tone === 'add' ? 'text-success' : tone === 'rem' ? 'text-danger' : 'text-text-muted')}>{k}</span>
      <span className="flex-1">{children}</span>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-[7px] border-b border-border last:border-b-0 text-[12px]">
      <span className="text-text-secondary">{k}</span>
      <span className="font-mono text-[12px] text-right">{v}</span>
    </div>
  );
}
