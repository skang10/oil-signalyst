import { Link } from 'react-router-dom';
import WorkbenchPage from '@/components/workbench/WorkbenchPage';
import Card from '@/components/shared/Card';
import { useReport } from '@/hooks/useReport';
import { useModelStatus } from '@/hooks/useModelStatus';
import { useRole } from '@/context/RoleContext';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function shortDate(d: string): string {
  const [, m, day] = d.split('-');
  return `${MON[Number(m) - 1] ?? '?'} ${Number(day)}`;
}

/** "Wed Jul 30" from an ISO date-only string, built from local components so the
 *  weekday never shifts across the UTC-midnight boundary. */
function fmtReleaseDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '—';
  const dt = new Date(y, m - 1, d);
  return `${WD[dt.getDay()]} ${MON[m - 1]} ${d}`;
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

  // Conventional number line: draw (−) left, build (+) right, 0 in the centre.
  // Domain expands to hold whichever of the two points is largest so both dots
  // stay on the bar.
  const domain = Math.max(4, Math.abs(forecast ?? 0), Math.abs(consensus ?? 0)) * 1.25;
  const pos = (v: number) => Math.min(96, Math.max(4, 50 + (v / domain) * 50));

  const prints = (lp?.series ?? []).slice(-5);

  return (
    <WorkbenchPage title="This week">
      {/* 1 · this week's forecast — the number, and where it lands between build
          and draw against the market. The build↔draw axis is the signature. */}
      <Card className="mb-[14px] p-[20px_22px]">
        <div className="font-mono text-[10px] uppercase tracking-[0.11em] text-text-muted">next EIA release</div>
        {report?.eia.next_eia_release && (
          <div className="font-mono text-[13px] text-text-primary mt-[3px]">
            {fmtReleaseDate(report.eia.next_eia_release)} · 10:30 ET
          </div>
        )}

        <div className="font-mono text-[46px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-text-primary mt-[12px]">
          {forecast == null ? '—' : `${forecast > 0 ? '+' : ''}${forecast.toFixed(1)}`}
          <span className="text-[17px] font-normal text-text-muted ml-[5px]">Mb</span>
        </div>
        <div className="text-[12.5px] text-text-secondary mt-[6px]">our forecast{direction ? ` · ${direction}` : ''}</div>

        {forecast != null && (
          <div className="mt-[24px]">
            <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.09em] text-text-muted mb-[12px]">
              <span>draw</span>
              <span>build</span>
            </div>
            <div className="relative h-[2px] bg-border-strong rounded-full mx-[8px]">
              {/* zero */}
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-[15px] bg-border-strong" />
              {/* the gap between the market and us, drawn */}
              {consensus != null && (
                <span
                  className="absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full"
                  style={{
                    left: `${Math.min(pos(forecast), pos(consensus))}%`,
                    width: `${Math.abs(pos(forecast) - pos(consensus))}%`,
                    background: 'var(--border-accent)',
                  }}
                />
              )}
              {/* consensus — hollow */}
              {consensus != null && (
                <span
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-[12px] h-[12px] rounded-full bg-surface-2 border-2 border-text-muted"
                  style={{ left: `${pos(consensus)}%` }}
                />
              )}
              {/* our forecast — filled */}
              <span
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-[15px] h-[15px] rounded-full border-2 border-surface-2"
                style={{ left: `${pos(forecast)}%`, background: 'var(--fill-accent)', boxShadow: '0 1px 3px rgba(0,0,0,0.18)' }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1 mt-[15px] text-[12px]">
              <span className="flex items-center gap-[6px] text-text-secondary">
                <i className="w-[11px] h-[11px] rounded-full inline-block" style={{ background: 'var(--fill-accent)' }} />
                our <b className="font-mono font-semibold text-text-primary">{forecast.toFixed(1)} Mb</b>
              </span>
              {consensus != null && (
                <span className="flex items-center gap-[6px] text-text-secondary">
                  <i className="w-[11px] h-[11px] rounded-full inline-block bg-surface-2 border-2 border-text-muted" />
                  consensus <b className="font-mono font-semibold text-text-secondary">{consensus.toFixed(1)} Mb</b>
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mt-[18px] pt-[12px] border-t border-border font-mono text-[11px] text-text-muted">
          from <span className="text-accent-text">eia · {version}</span>
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
