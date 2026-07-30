import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconPlus, IconGitFork, IconChecklist, IconSettings2 } from '@tabler/icons-react';
import WorkbenchPage, { WorkbenchFooter } from '@/components/workbench/WorkbenchPage';
import NA from '@/components/workbench/NA';
import { useSandboxes } from '@/hooks/useSandboxes';
import { useExperiments } from '@/hooks/useExperiments';
import { fmt } from '@/lib/workbench';
import { cn } from '@/lib/utils';
import type { WorkbenchSandbox } from '@/lib/sandboxModel';
import { Pill, lifePill, lifeAccent, skillPct, dirPct } from './sandbox-ui';
import SandboxDetail from './SandboxDetail';
import NewSandbox from './NewSandbox';
import Automation from './Automation';

type View = 'list' | { kind: 'detail'; id: string } | 'new' | 'automation';

export default function SandboxesPage() {
  const navigate = useNavigate();
  const { sandboxes, isLoading } = useSandboxes();
  const { live, gate } = useExperiments();
  const [view, setView] = useState<View>('list');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [toast, setToast] = useState<string | null>(null);
  function fireToast(msg: string) {
    setToast(msg);
    window.clearTimeout((fireToast as unknown as { _t?: number })._t);
    (fireToast as unknown as { _t?: number })._t = window.setTimeout(() => setToast(null), 2400);
  }

  // ---- sub-views ----
  if (view === 'new') {
    return (
      <WorkbenchPage title="Training sandboxes">
        <NewSandbox live={live} onBack={() => setView('list')} />
        <WorkbenchFooter />
      </WorkbenchPage>
    );
  }
  if (view === 'automation') {
    return (
      <WorkbenchPage title="Training sandboxes">
        <Automation gate={gate} onBack={() => setView('list')} />
        <WorkbenchFooter />
      </WorkbenchPage>
    );
  }
  if (typeof view === 'object' && view.kind === 'detail') {
    const sb = sandboxes.find((s) => s.id === view.id);
    if (sb) {
      return (
        <WorkbenchPage title="Training sandboxes">
          <SandboxDetail
            sandbox={sb}
            all={sandboxes}
            onBack={() => setView('list')}
            onOpen={(id) => setView({ kind: 'detail', id })}
            onCompare={() => navigate('/compare')}
            onFork={() => setView('new')}
            onToast={fireToast}
          />
          {toast && <Toast>{toast}</Toast>}
          <WorkbenchFooter />
        </WorkbenchPage>
      );
    }
  }

  // ---- list ----
  const waiting = sandboxes.filter((s) => s.life === 'ready');
  const running = sandboxes
    .filter((s) => s.life === 'production' || s.life === 'shadow')
    .sort((a, b) => (a.life === 'production' ? -1 : 1));
  const training = sandboxes.filter((s) => s.life === 'training');
  const idle = sandboxes.filter((s) => s.life === 'idle');
  const archived = sandboxes.filter((s) => s.life === 'archived');

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function card(s: WorkbenchSandbox) {
    return (
      <SandboxCard
        key={s.id}
        s={s}
        selectMode={selectMode}
        selected={selected.has(s.id)}
        onToggle={() => toggle(s.id)}
        onOpen={() => setView({ kind: 'detail', id: s.id })}
      />
    );
  }

  return (
    <WorkbenchPage title="Training sandboxes">
      {/* action row */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <Btn onClick={() => setView('new')} icon={<IconPlus size={14} stroke={2} />}>New training sandbox</Btn>
        <Btn ghost onClick={() => setView('new')} icon={<IconGitFork size={14} stroke={1.75} />}>Fork production</Btn>
        <Btn
          hold
          onClick={() => {
            setSelectMode((m) => !m);
            setSelected(new Set());
          }}
          icon={<IconChecklist size={14} stroke={1.75} />}
        >
          {selectMode ? 'Cancel selection' : 'Select to compare'}
        </Btn>
        <div className="ml-auto">
          <Btn hold onClick={() => setView('automation')} icon={<IconSettings2 size={14} stroke={1.75} />}>Automation</Btn>
        </div>
      </div>

      {isLoading && <div className="text-[12px] text-text-muted">Loading sandboxes…</div>}

      <GroupLabel>waiting on your decision</GroupLabel>
      {waiting.length ? (
        <div className="flex flex-col gap-[10px]">{waiting.map(card)}</div>
      ) : (
        <div className="rounded-[10px] border border-dashed border-border p-[13px_16px] text-[12px] text-text-secondary">
          Nothing waiting. A challenger that clears its 8 shadow weeks shows up here — <NA />.
        </div>
      )}

      <GroupLabel>running the forecast</GroupLabel>
      {running.length ? (
        <div className="flex flex-col gap-[10px]">{running.map(card)}</div>
      ) : (
        <div className="text-[12px] text-text-muted">No production model deployed.</div>
      )}

      {training.length > 0 && (
        <>
          <GroupLabel>training now</GroupLabel>
          <div className="flex flex-col gap-[10px]">{training.map(card)}</div>
        </>
      )}

      <GroupLabel>idle</GroupLabel>
      {idle.length ? <div className="flex flex-col gap-[10px]">{idle.map(card)}</div> : <div className="text-[12px] text-text-muted">No idle runs.</div>}

      <GroupLabel>archived</GroupLabel>
      {archived.length ? (
        <div className="flex flex-col gap-[10px]">{archived.map(card)}</div>
      ) : (
        <div className="text-[12px] text-text-muted">No archived runs.</div>
      )}

      <p className="font-mono text-[11px] text-text-muted mt-5 leading-[1.6]">
        references — consensus and the Δ=0 floor (train-mean {fmt(live?.metrics.baseline ?? sandboxes[0]?.baseline, 2)}) sit
        outside the sandbox model and are pinned into every comparison.
      </p>

      {selectMode && (
        <div className="sticky bottom-3 mt-4 flex items-center justify-between gap-4 flex-wrap bg-surface-2 border border-border rounded-[11px] p-[12px_18px] shadow-sm">
          <span className="font-mono text-[13px] text-text-secondary">
            <b className="text-accent-text text-[15px]">{selected.size}</b> selected
          </span>
          <div className="flex gap-2">
            <Btn onClick={() => navigate('/compare', { state: { selected: [...selected] } })}>Compare selected</Btn>
            <Btn hold onClick={() => setSelected(new Set())}>Clear</Btn>
          </div>
        </div>
      )}

      {toast && <Toast>{toast}</Toast>}
      <WorkbenchFooter />
    </WorkbenchPage>
  );
}

function SandboxCard({
  s,
  selectMode,
  selected,
  onToggle,
  onOpen,
}: {
  s: WorkbenchSandbox;
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const pill = lifePill(s);
  const decide = s.life === 'ready';
  // Overview shows just "N features | model family" — folds and the ensemble/
  // window detail (e12-w150) live on the detail page.
  const specText = [
    s.specFeatures != null ? `${s.specFeatures} features` : null,
    s.model ? s.model.split(' · ')[0] : null,
  ]
    .filter(Boolean)
    .join('  |  ');
  // Lineage + status only — the "what changed" explanation lives on the detail page.
  const meta: React.ReactNode[] = [];
  if (s.forkParent) meta.push(<>forked from <b className="text-text-secondary">{s.forkParent}</b></>);
  if (s.liveSince && s.life === 'production') meta.push(<>live since {s.liveSince}</>);
  if (s.retiredAt) meta.push(<>{s.retiredAt}</>);

  return (
    <button
      type="button"
      onClick={selectMode ? onToggle : onOpen}
      className="w-full text-left bg-surface-2 border border-border rounded-[10px] p-[14px_17px] flex items-center gap-4 flex-wrap cursor-pointer hover:border-border-strong"
      style={lifeAccent(s.life)}
    >
      {selectMode && (
        <span
          className={cn(
            'w-[19px] h-[19px] rounded-[5px] border shrink-0 grid place-items-center text-[11px]',
            selected ? 'bg-accent-fill border-accent-fill text-on-accent' : 'bg-surface-2 border-border-strong'
          )}
        >
          {selected ? '✓' : ''}
        </span>
      )}
      <div className="flex-1 min-w-[230px]">
        <div className="font-mono text-[13px] font-semibold flex items-center gap-2 flex-wrap">
          {s.id} · {s.version || <NA short />}
          {pill && <Pill tone={pill.tone}>{pill.label}</Pill>}
        </div>
        {meta.length > 0 && (
          <div className="font-mono text-[11px] text-text-muted mt-[4px]">
            {meta.map((m, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {m}
              </span>
            ))}
          </div>
        )}
        {specText && <div className="mt-[7px] font-mono text-[11px] text-text-muted">{specText}</div>}
      </div>
      <div className="text-right min-w-[100px] ml-auto">
        {s.life === 'training' ? (
          <>
            <div className="font-mono text-[18px] font-semibold text-text-muted">—</div>
            <div className="font-mono text-[11px] text-text-muted">running · {s.trainingPct ?? 0}%</div>
          </>
        ) : (
          <>
            <div
              className="font-mono text-[18px] font-semibold tracking-[-0.02em]"
              style={s.life === 'ready' ? { color: 'var(--text-success)' } : undefined}
            >
              {fmt(s.mae, 2)}
            </div>
            <div className="font-mono text-[11px] text-text-muted">
              {s.life === 'ready' && s.vsProd != null
                ? `beats prod ${skillPct(s.mae, s.baseline)}`
                : s.spread != null
                  ? `±${s.spread.toFixed(1)} · dir ${dirPct(s.dirPct)}`
                  : `skill ${skillPct(s.mae, s.baseline)}`}
            </div>
          </>
        )}
      </div>
      {!selectMode && <div className="font-mono text-[11px] text-accent-text">{decide ? 'decide →' : 'open →'}</div>}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted mt-5 mb-[9px] first:mt-0">{children}</div>
  );
}

function Toast({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-7 left-1/2 -translate-x-1/2 z-[90] bg-text-primary text-[#EDEFF4] font-mono text-[12px] px-[18px] py-[11px] rounded-[8px] shadow-lg">
      {children}
    </div>
  );
}

function Btn({
  children,
  onClick,
  ghost,
  hold,
  icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  ghost?: boolean;
  hold?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-[6px] font-medium text-[12px] rounded-[7px] px-[14px] py-[8px] cursor-pointer border',
        ghost
          ? 'bg-transparent text-accent-text border-accent-border'
          : hold
            ? 'bg-transparent text-text-secondary border-border'
            : 'bg-accent-fill text-on-accent border-accent-fill'
      )}
    >
      {icon}
      {children}
    </button>
  );
}
