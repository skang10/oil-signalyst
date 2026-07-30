import Card from '@/components/shared/Card';
import NA from '@/components/workbench/NA';
import { fmt } from '@/lib/workbench';
import type { WorkbenchSandbox } from '@/lib/sandboxModel';
import { Pill, lifePill, dirPct } from './sandbox-ui';

// A single thin left-accent colour for the header card, keyed to lifecycle —
// no ring halo, so the green (etc.) lives only on the pill + primary button.
const accentColor: Record<string, string> = {
  production: 'var(--fill-accent)',
  shadow: 'var(--border-warning)',
  ready: 'var(--border-success)',
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
      <div
        className="bg-surface-2 border border-border rounded-[12px] p-[20px_22px] mb-4"
        style={{ borderLeft: `4px solid ${accentColor[s.life] ?? 'var(--border-strong)'}` }}
      >
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
        <div className="flex gap-2 flex-wrap items-center mt-[15px]">
          {s.life === 'ready' && (
            <ActBtn tone="green" onClick={() => onToast(`${s.id} promoted to production · pointer moved`)}>
              Promote to production
            </ActBtn>
          )}
          {s.life === 'shadow' && <ActBtn disabled>Promote to production</ActBtn>}
          {s.life === 'idle' && (
            <ActBtn tone="blue" onClick={() => onToast(`${s.id} promoted to shadow · takes the exclusive slot · 8-week clock starts`)}>
              Promote to shadow
            </ActBtn>
          )}
          <ActBtn tone="outline" onClick={onCompare}>
            Compare with production
          </ActBtn>
          <ActBtn onClick={onFork}>Fork this</ActBtn>
          {s.life === 'shadow' && <ActBtn onClick={() => onToast(`stopped shadow for ${s.id}`)}>Stop shadow</ActBtn>}
          {(s.life === 'idle' || s.life === 'ready') && <ActBtn onClick={() => onToast(`archived ${s.id}`)}>Archive</ActBtn>}
        </div>
        {decisionNote(s) && (
          <p className="mt-[11px] font-mono text-[11px] text-text-secondary leading-[1.5] max-w-[74ch]">{decisionNote(s)}</p>
        )}
      </div>

      {/* Data + Training */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px]">
        <Card>
          <H3>Data</H3>
          <KV k="Vintage range" v={s.data.vintageRange} />
          <KV k="Backtest folds" v={s.data.folds} />
          {s.data.gap && <KV k="Gap" v={s.data.gap} danger />}
          <KV k="Revisions" v={s.data.revisions} />
        </Card>
        <Card>
          <H3>Training</H3>
          <KV k="Model" v={s.training.model} />
          <KV k="Train window" v={s.training.trainWindow} />
          <KV k="Scheme" v={s.training.scheme} />
          <KV k="Config" v={s.training.configHash} mono />
        </Card>
      </div>

      {/* Which weeks are used for what */}
      <Card className="mt-[14px]">
        <H3>Which weeks are used for what</H3>
        <WeeksUsage s={s} />
        <p className="font-mono text-[10.5px] text-text-muted mt-[2px] leading-[1.5]">
          the predicting model is fit on the same window as training — it sees every backtest week
        </p>
      </Card>

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
        <H3>Results</H3>
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

/** The one-line note under the action row, per lifecycle. */
function decisionNote(s: WorkbenchSandbox): string | null {
  switch (s.life) {
    case 'production':
      return 'This is the live pointer. The weekly rolling refresh keeps it current in place — a new config only goes live when you promote a challenger.';
    case 'shadow': {
      const left = 8 - (s.shadowWeek ?? 0);
      return `🔒 promotion unlocks after ${left} more shadow week${left === 1 ? '' : 's'}`;
    }
    case 'idle':
      return 'promoting takes the one validation slot · replaces the current challenger';
    default:
      return null;
  }
}

/** One button style for the whole header row so promote / compare / fork sit
 *  level. Only the primary decision is filled; compare is an accent outline and
 *  the rest are neutral outlines. */
function ActBtn({
  children,
  tone = 'ghost',
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  tone?: 'green' | 'blue' | 'outline' | 'ghost';
  disabled?: boolean;
  onClick?: () => void;
}) {
  const base = 'font-mono text-[12px] font-semibold rounded-[7px] px-[14px] py-[7px] border ';
  if (disabled) {
    return <button disabled className={base + 'bg-surface-1 text-text-muted border-border cursor-not-allowed'}>{children}</button>;
  }
  if (tone === 'green') {
    return (
      <button onClick={onClick} className={base + 'text-white border-transparent cursor-pointer'} style={{ background: 'var(--text-success)' }}>
        {children}
      </button>
    );
  }
  const cls =
    tone === 'blue'
      ? 'bg-accent-fill text-on-accent border-accent-fill'
      : tone === 'outline'
        ? 'bg-transparent text-accent-text border-accent-border hover:bg-accent-bg'
        : 'bg-transparent text-text-secondary border-border-strong hover:bg-surface-1';
  return <button onClick={onClick} className={base + cls + ' cursor-pointer'}>{children}</button>;
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

function rangeWeeks(vr: string | null): number {
  const m = vr?.match(/(\d{4})-W(\d+).*?(\d{4})-W(\d+)/)?.map(Number);
  if (!m) return 350;
  return Math.max(60, (m[3] - m[1]) * 52 + (m[4] - m[2]));
}
function endWeek(vr: string | null): [number, number] {
  const m = vr?.match(/(\d{4})-W(\d+)\s*(?:→|->)\s*(\d{4})-W(\d+)/);
  return m ? [Number(m[3]), Number(m[4])] : [2026, 30];
}

/** The Stockcast "which weeks are used for what" strip: one row each for the
 *  full vintage store, the rolling train window (green), the backtest folds
 *  (blue, a nested tail), and the live prediction (amber) at today. */
function WeeksUsage({ s }: { s: WorkbenchSandbox }) {
  const tot = rangeWeeks(s.data.vintageRange);
  const twRaw = s.training.trainWindow ?? '150';
  const tw = twRaw.startsWith('expanding') ? tot : Math.min(Number(twRaw.match(/(\d+)/)?.[1] ?? 150), tot);
  const scW = Math.min((s.specFolds ?? 34) * 4, tot);
  const [bY, bW] = endWeek(s.data.vintageRange);
  const X0 = 150;
  const X1 = 590;
  const W = X1 - X0;
  const px = (w: number) => (W * w) / tot;
  const trainX = X1 - px(tw);
  const scX = X1 - px(scW);
  const wl = (n: number) => {
    let w = bW - n;
    let y = bY;
    while (w < 1) {
      w += 52;
      y -= 1;
    }
    return `${y}-W${String(w).padStart(2, '0')}`;
  };
  const shadowWk = s.shadowWeek ?? 0;
  const swW = Math.max(px(shadowWk), 16);
  const predBox = X1 + 22;
  const SUB = 'var(--text-secondary)';
  const GREEN = 'var(--text-success)';
  const BLUE = 'var(--text-accent)';
  const AMBER = 'var(--text-warning)';
  return (
    <svg viewBox="0 0 700 172" width="100%" role="img" aria-label="Which weeks each step uses" className="mt-[2px]">
      <line x1={X1} y1={38} x2={X1} y2={128} stroke="var(--text-primary)" strokeWidth={1} />
      <text x={X1} y={30} fontSize={9.5} fill="var(--text-primary)" textAnchor="end">
        today · W{bW}
      </text>
      {/* data */}
      <text x={X0 - 12} y={53} fontSize={10.5} fill={SUB} textAnchor="end">data</text>
      <rect x={X0} y={44} width={W} height={15} rx={3.5} fill="var(--surface-1)" />
      <text x={X0 + 7} y={54.5} fontSize={9} fill="var(--text-muted)">{tot} weekly vintages</text>
      {/* train */}
      <text x={X0 - 12} y={83} fontSize={10.5} fill={SUB} textAnchor="end">trains on</text>
      <text x={trainX} y={72} fontSize={9} fill={GREEN} textAnchor="start">{wl(tw - 1)}</text>
      <rect x={trainX} y={76} width={X1 - trainX} height={15} rx={3.5} fill={GREEN} />
      <text x={(trainX + X1) / 2} y={86.5} fontSize={9} fill="#fff" textAnchor="middle">last {tw} weeks</text>
      {/* backtest */}
      <text x={X0 - 12} y={111} fontSize={10.5} fill={SUB} textAnchor="end">scored</text>
      <text x={scX} y={100} fontSize={9} fill={BLUE} textAnchor="start">{wl(scW - 1)}</text>
      <rect x={scX} y={104} width={X1 - scX} height={15} rx={3.5} fill={BLUE} />
      <text x={(scX + X1) / 2} y={114.5} fontSize={9} fill="#fff" textAnchor="middle">{Math.round(scW / 4)} folds · every 4 wk</text>
      {/* predict */}
      <text x={X0 - 12} y={139} fontSize={10.5} fill={SUB} textAnchor="end">predicts</text>
      {shadowWk > 0 && (
        <>
          <rect x={X1 - swW} y={131} width={swW} height={8} rx={2} fill={AMBER} />
          <text x={X1 - swW - 4} y={138} fontSize={8.5} fill={AMBER} textAnchor="end">{shadowWk} wk live</text>
        </>
      )}
      <path d={`M${X1} 135 L${predBox - 4} 135`} stroke={AMBER} strokeWidth={1.4} strokeDasharray="3 3" />
      <path d={`M${predBox - 9} 131 L${predBox - 3} 135 L${predBox - 9} 139`} fill="none" stroke={AMBER} strokeWidth={1.4} />
      <rect x={predBox} y={128} width={34} height={15} rx={3.5} fill={AMBER} />
      <text x={predBox + 17} y={138.5} fontSize={8.5} fill="#fff" textAnchor="middle">W{bW + 1}</text>
      <text x={X0} y={164} fontSize={9} fill="var(--text-muted)">
        {shadowWk > 0
          ? `the ${shadowWk} weeks before today were predicted live but not published — the only selection-free evidence`
          : `backtest grades one week in four · the model trains on the last ${tw} weeks`}
      </text>
    </svg>
  );
}
