import Card from '@/components/shared/Card';
import NA from '@/components/workbench/NA';
import { fmt } from '@/lib/workbench';
import type { WorkbenchSandbox } from '@/lib/sandboxModel';
import { Pill, lifePill, lifeAccent, skillPct, dirPct } from './sandbox-ui';

// Light tint for the decision strip, keyed to lifecycle.
const decisionTint: Record<string, string> = {
  ready: 'bg-success-bg border-success-border',
  shadow: 'bg-warning-bg border-warning-border',
  idle: 'bg-accent-bg border-accent-border',
  production: 'bg-surface-1 border-border',
};

export default function SandboxDetail({
  sandbox: s,
  all,
  onBack,
  onOpen,
  onCompare,
  onFork,
  onToast,
}: {
  sandbox: WorkbenchSandbox;
  all: WorkbenchSandbox[];
  onBack: () => void;
  onOpen: (id: string) => void;
  onCompare: () => void;
  onFork: () => void;
  onToast: (msg: string) => void;
}) {
  const pill = lifePill(s);
  const kids = all.filter((x) => x.forkParent === s.id);
  const metricLabel = s.model?.startsWith('LightGBM') || s.model?.startsWith('TabPFN') ? 'MAE' : 'MAE';

  return (
    <>
      {/* header */}
      <div className="bg-surface-2 border border-border rounded-[12px] p-[20px_22px] mb-4" style={lifeAccent(s.life)}>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-[6px] font-mono text-[12px] text-text-secondary border border-border-strong rounded-[7px] px-[11px] py-[5px] mb-[13px] hover:bg-surface-1 hover:text-text-primary"
        >
          <span className="text-[15px] leading-none">←</span> all training sandboxes
        </button>
        <h2 className="font-mono text-[16px] font-semibold flex items-center gap-[9px] flex-wrap text-text-primary">
          {s.id} · {s.version || <NA short />}
          {pill && <Pill tone={pill.tone}>{pill.label}</Pill>}
        </h2>
        <div className="font-mono text-[11.5px] text-text-secondary mt-[7px] leading-[1.6]">
          {s.forkParent ? (
            <>
              forked from{' '}
              <button className="text-accent-text underline underline-offset-2" onClick={() => onOpen(s.forkParent!)}>
                {s.forkParent}
              </button>
              {s.forkParentLife ? ` (${s.forkParentLife})` : ''}
            </>
          ) : (
            <>{s.change}</>
          )}
          {kids.length > 0 && (
            <div className="mt-[5px] text-text-muted">
              forked into{' '}
              {kids.map((k, i) => (
                <span key={k.id}>
                  {i > 0 && ' · '}
                  <button className="text-accent-text underline underline-offset-2" onClick={() => onOpen(k.id)}>
                    {k.id}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <Decision sandbox={s} onToast={onToast} />
        <div className="flex gap-2 flex-wrap mt-3">
          <HeadBtn primary onClick={onCompare}>
            Compare with production
          </HeadBtn>
          <HeadBtn onClick={onFork}>Fork this</HeadBtn>
          {s.life === 'shadow' && <HeadBtn onClick={() => onToast(`stopped shadow for ${s.id}`)}>Stop shadow</HeadBtn>}
          {(s.life === 'idle' || s.life === 'ready') && (
            <HeadBtn onClick={() => onToast(`archived ${s.id}`)}>Archive</HeadBtn>
          )}
        </div>
      </div>

      {/* Data + Training */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px]">
        <Card>
          <H3>Data · pinned</H3>
          <KV k="Vintage range" v={s.data.vintageRange} />
          <KV k="Backtest folds" v={s.data.folds} />
          {s.data.gap && <KV k="Gap" v={s.data.gap} danger />}
          <KV k="Revisions" v={s.data.revisions} />
          <p className="font-mono text-[10.5px] text-text-muted mt-[9px] leading-[1.5]">
            reads a frozen slice of the vintage store — later revisions cannot reach it
          </p>
        </Card>
        <Card>
          <H3>Training</H3>
          <KV k="Model" v={s.training.model} />
          <KV k="Train window" v={s.training.trainWindow} />
          <KV k="Scheme" v={s.training.scheme} />
          <KV k="Config" v={s.training.configHash} mono />
          {s.training.lastRun && (
            <p className="font-mono text-[10.5px] text-text-muted mt-[9px] leading-[1.5]">
              last run {s.training.lastRun} · reproducible from this sandbox alone
            </p>
          )}
        </Card>
      </div>

      {/* Features */}
      <Card className="mt-[14px]">
        <H3>
          Features{' '}
          {s.features.length ? (
            <span className="font-mono text-[10px] text-text-muted bg-surface-1 rounded-[3px] px-[5px] py-[1px] ml-1">
              {s.features.length}
            </span>
          ) : null}
        </H3>
        {s.features.length === 0 ? (
          <NA />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            {[0, 1].map((col) => (
              <table key={col} className="w-full text-[12px]">
                <tbody>
                  {s.features
                    .filter((_, i) => i % 2 === col)
                    .map((f) => (
                      <tr key={f.name} className="border-b border-border last:border-0">
                        <td className="py-[7px]">
                          <span className={cnMono(f.added)}>{f.name}</span>
                          {f.added && <span className="ml-2 text-[10px] text-pro">◆</span>}
                        </td>
                        <td className="py-[7px] text-right text-text-muted text-[11px]">{f.desc}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ))}
          </div>
        )}
      </Card>

      {/* Results */}
      <Card className="mt-[14px]">
        <H3>Results · walk-forward</H3>
        {s.results.length === 0 || s.results[0].evidence === 'running' ? (
          <p className="font-mono text-[12px] text-text-muted">
            {s.life === 'training' ? 'still training — no scores yet.' : <NA />}
          </p>
        ) : (
          <>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
                  <th className="py-[7px] font-medium">Window</th>
                  <th className="py-[7px] font-medium text-right">{metricLabel}</th>
                  <th className="py-[7px] font-medium text-right">Dir</th>
                  <th className="py-[7px] font-medium text-right">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {s.results.map((r) => (
                  <tr key={r.window} className="border-t border-border">
                    <td className="py-[8px]">{r.window}</td>
                    <td className="py-[8px] text-right font-mono">{fmt(r.mae, 2)}</td>
                    <td className="py-[8px] text-right font-mono">{dirPct(r.dir)}</td>
                    <td className="py-[8px] text-right">
                      <Pill tone={r.evidence === 'live' ? 'ready' : 'idle'}>{r.evidence}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="font-mono text-[10.5px] text-text-muted mt-[9px] leading-[1.5]">
              baseline train-mean {fmt(s.baseline, 2)} · replay folds are point-in-time safe but were seen while choosing
              this fork — only live / shadow weeks are untouched evidence
            </p>
          </>
        )}
      </Card>

      {/* Gate */}
      {s.gate.length > 0 && (
        <Card className="mt-[14px]">
          <H3>
            Deployment gate <span className="text-text-muted normal-case font-normal">· every rule must pass</span>
          </H3>
          <div className="flex gap-[9px] flex-wrap">
            {s.gate.map((g) => (
              <span
                key={g.rule}
                className={
                  'font-mono text-[11px] rounded-[6px] px-[9px] py-[5px] border ' +
                  (g.pass ? 'bg-success-bg border-success-border text-success' : 'bg-danger-bg border-danger-border text-danger')
                }
                title={g.value}
              >
                {g.pass ? '✓' : '✕'} {g.rule}
                {g.value ? ` · ${g.value}` : ''}
              </span>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function Decision({ sandbox: s, onToast }: { sandbox: WorkbenchSandbox; onToast: (m: string) => void }) {
  let node: React.ReactNode = null;
  if (s.life === 'production') {
    node = (
      <span className="font-mono text-[11px] text-text-secondary leading-[1.5]">
        This is the live pointer. The weekly rolling refresh keeps it current in place — a new config only goes live when
        you promote a challenger.
      </span>
    );
  } else if (s.life === 'ready') {
    node = (
      <>
        <DBtn go tone="success" onClick={() => onToast(`${s.id} promoted to production · pointer moved`)}>
          Promote to production
        </DBtn>
        <span className="font-mono text-[11px] text-text-secondary">passed 8 shadow weeks · beats prod {skillPct(s.mae, s.baseline)}</span>
      </>
    );
  } else if (s.life === 'shadow') {
    const left = 8 - (s.shadowWeek ?? 0);
    node = (
      <>
        <DBtn disabled>Promote to production</DBtn>
        <span className="font-mono text-[11px] text-text-secondary">🔒 unlocks after {left} more shadow week{left === 1 ? '' : 's'}</span>
      </>
    );
  } else if (s.life === 'idle') {
    node = (
      <>
        <DBtn go onClick={() => onToast(`${s.id} promoted to shadow · takes the exclusive slot · 8-week clock starts`)}>
          Promote to shadow
        </DBtn>
        <span className="font-mono text-[11px] text-text-secondary">takes the one validation slot · replaces the current challenger</span>
      </>
    );
  } else {
    return null;
  }
  return (
    <div
      className={
        'flex items-center gap-3 flex-wrap mt-[14px] p-[12px_14px] rounded-[9px] border ' +
        (decisionTint[s.life] ?? 'bg-surface-1 border-border')
      }
    >
      {node}
    </div>
  );
}

function DBtn({
  children,
  go,
  tone = 'accent',
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  go?: boolean;
  tone?: 'accent' | 'success';
  disabled?: boolean;
  onClick?: () => void;
}) {
  const base = 'font-semibold text-[13px] rounded-[8px] px-[18px] py-[9px] ';
  if (disabled) {
    return <button disabled className={base + 'bg-surface-1 text-text-muted border border-border cursor-not-allowed'}>{children}</button>;
  }
  if (go && tone === 'success') {
    return (
      <button onClick={onClick} className={base + 'text-white cursor-pointer'} style={{ background: 'var(--text-success)' }}>
        {children}
      </button>
    );
  }
  return <button onClick={onClick} className={base + 'bg-accent-fill text-on-accent cursor-pointer'}>{children}</button>;
}

function HeadBtn({ children, primary, onClick }: { children: React.ReactNode; primary?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        'font-mono text-[11px] rounded-[6px] px-[12px] py-[6px] border cursor-pointer ' +
        (primary
          ? 'bg-accent-fill text-on-accent border-accent-fill font-semibold'
          : 'bg-transparent text-text-secondary border-border-strong hover:bg-surface-1')
      }
    >
      {children}
    </button>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted mb-[11px]">{children}</h3>;
}

function KV({ k, v, mono, danger }: { k: string; v: React.ReactNode; mono?: boolean; danger?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-[7px] border-b border-border last:border-0 text-[12.5px]">
      <span className="text-text-secondary">{k}</span>
      <span className={'font-mono text-[12px] text-right ' + (danger ? 'text-danger' : '')}>
        {v == null || v === '' ? <NA short /> : v}
      </span>
    </div>
  );
}

function cnMono(added?: boolean): string {
  return 'font-mono text-[12px]' + (added ? ' text-pro font-medium' : '');
}
