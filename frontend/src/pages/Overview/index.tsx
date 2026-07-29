import { Link } from 'react-router-dom';
import WorkbenchPage from '@/components/workbench/WorkbenchPage';
import Card from '@/components/shared/Card';
import { useReport } from '@/hooks/useReport';
import { useModelStatus } from '@/hooks/useModelStatus';
import { useRole } from '@/context/RoleContext';
import { cn } from '@/lib/utils';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(d: string): string {
  const [, m, day] = d.split('-');
  return `${MON[Number(m) - 1] ?? '?'} ${Number(day)}`;
}

/**
 * Overview — a faithful reproduction of the Stockcast "Overview" tab
 * (stockcast-sandbox.html), wired to this repo's real data. Exactly three
 * blocks, nothing else:
 *   1. the forecast hero (.fcast) — the number about to publish, with a
 *      build↔draw range bar placing our forecast against consensus;
 *   2. the provenance foot (.fc-foot) — which production sandbox it came from;
 *   3. "Last 5 releases" — forecast-vs-actual paired bars around a zero line,
 *      direction misses highlighted.
 * Input-side health and live-model diagnostics live on the standalone Data
 * Monitor / Model Monitor pages, not here — Overview is the at-a-glance surface.
 */
export default function OverviewPage() {
  const { role } = useRole();
  const { data: report } = useReport(role);
  const { data: status } = useModelStatus();

  const eia = status?.models.find((m) => m.type === 'eia');
  const lp = status?.live_performance;

  const forecast = report?.eia.forecast_mb ?? null;
  const consensus = report?.eia.consensus_mb ?? null;
  const direction = forecast == null ? '' : forecast < 0 ? 'crude draw' : 'crude build';
  const version = eia?.version ?? '—';

  // Build (+) sits left, draw (−) right, 0 in the centre. Domain expands to hold
  // whichever of the two points is largest so both dots stay on the bar.
  const domain = Math.max(4, Math.abs(forecast ?? 0), Math.abs(consensus ?? 0)) * 1.25;
  const pos = (v: number) => Math.min(96, Math.max(4, 50 - (v / domain) * 50));

  // The interpretive line: do we and consensus agree on direction, and by how much.
  let interp: { k: string; v: string } | null = null;
  if (forecast != null && consensus != null) {
    const sameSign = forecast < 0 === consensus < 0;
    if (sameSign) {
      const dir = forecast < 0 ? 'draw' : 'build';
      const diff = Math.abs(forecast - consensus);
      const bigger = Math.abs(forecast) > Math.abs(consensus);
      const word = forecast < 0 ? (bigger ? 'deeper' : 'shallower') : bigger ? 'bigger' : 'smaller';
      interp =
        diff < 0.05
          ? { k: `both call a ${dir}`, v: 'in line with consensus' }
          : { k: `both call a ${dir}`, v: `we see it ${diff.toFixed(1)} ${word}` };
    } else {
      interp = {
        k: 'we disagree on direction',
        v: `we ${forecast < 0 ? 'draw' : 'build'}, cons ${consensus < 0 ? 'draw' : 'build'}`,
      };
    }
  }

  const prints = (lp?.series ?? []).slice(-5);

  return (
    <WorkbenchPage title="This week">
      {/* 1 · forecast hero */}
      <Card className="!p-0 overflow-hidden mb-[14px]">
        <div className="flex flex-wrap">
          <div className="flex-1 min-w-[230px] p-[22px_26px] bg-[var(--text-primary)] text-[#EDEFF4]">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#7C879E]">
              next EIA release · from the daily pipeline
            </div>
            <div className="font-mono text-[44px] font-semibold tracking-[-0.03em] leading-[1.05] mt-[6px] text-[#F0C878]">
              {forecast == null ? '—' : `${forecast > 0 ? '+' : ''}${forecast.toFixed(1)}`}
              <span className="text-[18px] text-[#B8935A] ml-[6px]">Mb</span>
            </div>
            <div className="text-[13px] text-[#C6CCDA] mt-[1px]">{direction || '—'}</div>
          </div>
          <div className="flex-1 min-w-[240px] p-[22px_26px] border-l border-[#2A3550] bg-[#1B2338] text-[#EDEFF4]">
            {/* range bar — our forecast vs consensus on a build↔draw scale */}
            <div className="mb-[14px]">
              <div className="relative h-[6px] bg-[#2A3550] rounded-[3px] mb-[6px]">
                <span className="absolute left-1/2 top-[-3px] w-px h-[12px] bg-[#4A5678]" />
                {consensus != null && (
                  <span
                    className="absolute top-1/2 w-[11px] h-[11px] rounded-full -translate-x-1/2 -translate-y-1/2 bg-[#8792AB]"
                    style={{ left: `${pos(consensus)}%` }}
                  />
                )}
                {forecast != null && (
                  <span
                    className="absolute top-1/2 w-[11px] h-[11px] rounded-full -translate-x-1/2 -translate-y-1/2 bg-[#F0C878]"
                    style={{ left: `${pos(forecast)}%` }}
                  />
                )}
              </div>
              <div className="flex justify-between font-mono text-[8.5px] text-[#5C6784]">
                <span>build</span>
                <span>0</span>
                <span>draw</span>
              </div>
            </div>
            <Row k="our forecast" v={forecast == null ? '—' : `${forecast.toFixed(1)} Mb`} dot="#F0C878" />
            <Row k="consensus" v={consensus == null ? '—' : `${consensus.toFixed(1)} Mb`} dot="#8792AB" />
            {interp && <Row k={interp.k} v={interp.v} muted />}
          </div>
        </div>
        <div className="flex items-center gap-[11px] flex-wrap bg-[#141A29] text-[#8792AB] px-[26px] py-[11px] font-mono text-[11px]">
          <span>
            from <span className="text-[#8FA8F0]">eia · {version}</span> · production
          </span>
          <span className="text-[#3D4763]">·</span>
          <span>no challenger in shadow — deploys go straight to production</span>
        </div>
      </Card>

      {/* 2 · last 5 releases */}
      <Card>
        <div className="flex justify-between items-baseline">
          <h3 className="text-[11px] font-mono uppercase tracking-[0.08em] text-text-muted">
            {prints.length ? `Last ${prints.length} releases` : 'Recent releases'}
          </h3>
          <Link
            to="/history"
            className="font-mono text-[11px] text-accent-text underline underline-offset-2"
          >
            {lp?.n_prints ? `all ${lp.n_prints} releases →` : 'all releases →'}
          </Link>
        </div>
        {prints.length > 0 ? (
          <ReleasesChart prints={prints} />
        ) : (
          <p className="font-mono text-[12px] text-text-muted mt-[13px]">
            no scored releases yet — the live model has not been graded against a published print.
          </p>
        )}
      </Card>
    </WorkbenchPage>
  );
}

/** Forecast-vs-actual paired bars around a zero baseline: forecast is the
 *  outlined bar, the published actual is filled. Above the line = build,
 *  below = draw. Weeks where the two land on opposite sides (a direction miss,
 *  `hit === false`) get a red backdrop. */
function ReleasesChart({
  prints,
}: {
  prints: { date: string; forecast: number; realized: number; hit: boolean }[];
}) {
  const n = prints.length;
  const maxAbs = Math.max(1, ...prints.flatMap((p) => [Math.abs(p.forecast), Math.abs(p.realized)]));
  const domain = maxAbs * 1.15;
  const MAXBAR = 68;
  const BASE = 100;
  const GROUP = 122;
  const BARW = 22;
  const vbW = 84 + (n - 1) * GROUP + 48;
  const center = (i: number) => 84 + i * GROUP;
  const h = (v: number) => (Math.abs(v) / domain) * MAXBAR;

  const hits = prints.filter((p) => p.hit).length;
  const misses = prints.filter((p) => !p.hit);
  const caption =
    `${hits} of ${n} direction${n === 1 ? '' : 's'} right` +
    (misses.length === 0
      ? ' · every week landed on the right side'
      : ` · ${misses.map((m) => shortDate(m.date)).join(', ')} landed on opposite sides`);

  const A = 'var(--text-accent)'; // forecast (outline)
  const B = 'var(--text-primary)'; // actual (filled)

  return (
    <>
      <div className="flex gap-[15px] flex-wrap font-mono text-[10px] text-text-muted mt-[13px]">
        <span className="flex items-center gap-[5px]">
          <i className="inline-block w-[10px] h-[10px] rounded-[2px]" style={{ border: `1.6px solid ${A}` }} />
          forecast
        </span>
        <span className="flex items-center gap-[5px]">
          <i className="inline-block w-[10px] h-[10px] rounded-[2px]" style={{ background: B }} />
          actual
        </span>
        <span>above the line = build · below = draw</span>
      </div>
      <svg viewBox={`0 0 ${vbW} 215`} width="100%" role="img" aria-label="Forecast versus actual, last releases">
        <line x1={30} y1={BASE} x2={vbW - 24} y2={BASE} stroke="var(--text-primary)" strokeWidth={1.2} />
        <text x={24} y={BASE + 4} fontSize={10} fill="var(--text-muted)" textAnchor="end">
          0
        </text>
        {prints.map((p, i) => {
          const c = center(i);
          const miss = !p.hit;
          const fh = h(p.forecast);
          const rh = h(p.realized);
          const barY = (v: number, bh: number) => (v >= 0 ? BASE - bh : BASE);
          const lblY = (v: number, bh: number) => (v >= 0 ? BASE - bh - 7 : BASE + bh + 13);
          return (
            <g key={p.date}>
              {miss && <rect x={c - 33} y={20} width={66} height={150} rx={5} fill="var(--bg-danger)" />}
              {/* forecast — outline */}
              <rect
                x={c - 24}
                y={barY(p.forecast, fh)}
                width={BARW}
                height={fh}
                rx={2}
                fill="none"
                stroke={A}
                strokeWidth={1.6}
              />
              <text x={c - 13} y={lblY(p.forecast, fh)} fontSize={9.5} fill={miss ? 'var(--text-danger)' : A} textAnchor="middle">
                {p.forecast > 0 ? '+' : ''}
                {p.forecast.toFixed(1)}
              </text>
              {/* actual — filled */}
              <rect x={c + 2} y={barY(p.realized, rh)} width={BARW} height={rh} rx={2} fill={miss ? 'var(--text-danger)' : B} />
              <text x={c + 13} y={lblY(p.realized, rh)} fontSize={9.5} fill={miss ? 'var(--text-danger)' : B} textAnchor="middle">
                {p.realized > 0 ? '+' : ''}
                {p.realized.toFixed(1)}
              </text>
              <text x={c} y={192} fontSize={11} fill={miss ? 'var(--text-danger)' : 'var(--text-secondary)'} textAnchor="middle">
                {shortDate(p.date)}
                {miss ? ' · miss' : ''}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="font-mono text-[11px] text-text-muted mt-[6px]">{caption}</p>
    </>
  );
}

function Row({ k, v, dot, muted }: { k: string; v: string; dot?: string; muted?: boolean }) {
  return (
    <div
      className={cn(
        'flex justify-between items-center text-[12.5px] py-[4px]',
        muted && 'border-t border-[#2A3550] mt-[5px] pt-[9px]'
      )}
    >
      <span className={cn('flex items-center gap-[7px]', muted ? 'text-[#7C879E]' : 'text-[#B4BCCC]')}>
        {dot && <i className="w-[9px] h-[9px] rounded-full inline-block" style={{ background: dot }} />}
        {k}
      </span>
      <span className={cn('font-mono', muted ? 'text-[#7C879E] text-[12px]' : 'text-[#EDEFF4] text-[13px]')}>{v}</span>
    </div>
  );
}
