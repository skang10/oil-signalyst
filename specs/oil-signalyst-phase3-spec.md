# oil-signalyst — Phase 3 Spec: Frontend

**Version:** 1.0  
**Phase:** 3 — Frontend  
**Last updated:** 2026-07-01  
**Depends on:** Phase 2 spec v1.1  
**Stack:** React 18 · TypeScript · Vite · shadcn/ui · Tailwind · Recharts · Chart.js

---

## 1. Overview

Phase 3 builds the full frontend application that connects to the Phase 2 API. All data shown in the HTML prototypes (`oil-signalyst-dashboard.html`, `oil-signalyst-signals-page.html`) is replaced by live API responses.

**Phase 3 is complete when:**  
A user can open the app in a browser, switch roles, view live model outputs, evaluate signal candidates, and trigger a retraining run — all backed by the Phase 2 API.

**In scope:**
- React/TypeScript project scaffold (Vite)
- Role-based layout: 4 roles × access control
- Dashboard with 5 top tabs (Overview / EIA Forecast / Regime / Return Dist. / Market Data)
- 7 sidebar pages (Dashboard, History, Signals, Data Monitor, Model Monitor, Training Control, Settings)
- DS Agent floating panel (resizable, fullpage mode)
- Market data charts (Chart.js, 6 charts)
- Signal evaluation page (IC charts, OOS decay, rolling IC)
- API client layer (SWR for polling, React Query for mutations)
- User config persistence (PUT /api/users/me/config)

**Out of scope for Phase 3:** Authentication, multi-user, cloud deployment, real AIS/satellite data.

---

## 1b. HTML Prototype Reference

All three HTML prototypes are located in `design/prototypes/`. Each React page/component should match the visual design of its corresponding prototype exactly — colours, spacing, card structure, typography, and interactive behaviour — unless this spec explicitly overrides a detail.

| Prototype file | Canonical for |
|---|---|
| `oil-signalyst-dashboard.html` | AppShell layout · Sidebar · Topbar · RolePill · all Dashboard tabs · TraderView · RiskView · ResearcherView · DSView · EIATab · RegimeTab · ReturnsTab · ChartsTab · HistoryPage · SignalsPage · DataMonitorPage · ModelMonitorPage · TrainingPage · SettingsPage · DS Agent panel **expand/resize/fullpage behaviour** |
| `oil-signalyst-signals-page.html` | SignalEvaluatePage — 3 Chart.js charts (price vs signal overlay, rolling IC, OOS by year) · IC stats row · signal selector tabs · lag switcher · DS-only action buttons |
| `oil-signalyst-ds-agent.html` | DS Agent **conversation content** — tool call block visual design · confirm gate copy and layout · multi-step flow (evaluate → add_feature → run_training → deploy) · final summary green bubble |

> **Note on agent panel:** `oil-signalyst-dashboard.html` is the reference for the panel's three physical states (collapsed bubble / resizable panel / fullpage), drag handle behaviour, header actions, textarea input, and quick-action buttons. `oil-signalyst-ds-agent.html` is the reference for message content, tool call blocks, and confirm gate copy — these are independent of the panel's container design.

---

## 2. Decisions Log

| # | Decision |
|---|----------|
| D1 | Framework: React 18 + TypeScript + Vite. No Next.js — no server-side rendering needed for a local portfolio tool. |
| D2 | UI components: shadcn/ui (radix primitives). CSS variables match the prototype token system. |
| D3 | Styling: Tailwind CSS with custom CSS variables for the design system (see §6). |
| D4 | Data fetching: SWR for read endpoints (auto-revalidate every 60s). React Query for mutations (training, deploy). |
| D5 | Charts: Recharts for distribution/regime/SHAP bars. Chart.js for the 6 market data charts (time series). |
| D6 | Role state: stored in React context + localStorage. No backend auth in Phase 3. |
| D7 | DS Agent: mock response engine in Phase 3 (same logic as prototype). Real Claude API integration is Phase 4. |
| D8 | Polling: `GET /api/train/status/{job_id}` polled every 2s during active training run. |
| D9 | Signal evaluation page is a separate route `/signals/evaluate/:name`, not a modal. |
| D10 | Market data charts use mock data arrays in Phase 3. Real Yahoo/EIA time-series fetch is Phase 4. |
| D11 | PSI alert banner rendered if any model PSI > 0.20 (from `GET /api/models/status`). |
| D12 | History drawer is a Sheet component (shadcn). Opens without navigating away. |
| D13 | Training log: SSE stream from `GET /api/train/log/{job_id}` rendered line-by-line. |
| D14 | ModelCompareCard triggered by `job.status === 'complete'` from polling, not log string matching. On deploy, invalidate `useModelStatus` SWR cache. |
| D15 | Agent textarea: auto-grows up to 120px. Enter sends, Shift+Enter inserts newline. Height reset to `auto` after send. |

---

## 3. Project Structure

```
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx                    # Router + RoleProvider
│   ├── types/
│   │   ├── api.ts                 # Response types (DailyReport, ModelStatus, etc.)
│   │   └── roles.ts               # Role enum + permission map
│   ├── lib/
│   │   ├── api.ts                 # Typed fetch wrappers
│   │   ├── swr-keys.ts            # SWR cache keys
│   │   └── utils.ts               # cn(), formatPct(), formatMB()
│   ├── context/
│   │   └── RoleContext.tsx        # currentRole + setRole + userConfig
│   ├── hooks/
│   │   ├── useReport.ts           # SWR → GET /api/reports/daily/{role}
│   │   ├── useModelStatus.ts      # SWR → GET /api/models/status
│   │   ├── useHistory.ts          # SWR → GET /api/reports/history
│   │   ├── useSignals.ts          # SWR → GET /api/signals/candidates + /active
│   │   └── useTraining.ts         # React Query → POST /api/train/start + SSE log
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx       # Sidebar + topbar + content area
│   │   │   ├── Sidebar.tsx        # Nav items, DS group visibility
│   │   │   ├── Topbar.tsx         # Price ticker, role pill, source dots
│   │   │   └── RolePill.tsx       # 4-button role switcher
│   │   ├── shared/
│   │   │   ├── MetricCard.tsx     # label + big number + sub
│   │   │   ├── TagBadge.tsx       # t-red / t-green / t-yellow / t-blue / t-muted
│   │   │   ├── SHAPBar.tsx        # Horizontal SHAP importance row
│   │   │   ├── DistChart.tsx      # 4-bucket return distribution bars (Recharts)
│   │   │   ├── RegimeGrid.tsx     # 2×2 regime probability cards
│   │   │   ├── InventoryBar.tsx   # Horizontal bar (crude/gasoline/distillate/cushing)
│   │   │   ├── PSIBar.tsx         # Feature/model PSI progress bar + label
│   │   │   ├── AlertBanner.tsx    # Warning strip with dismiss
│   │   │   └── LogMono.tsx        # Monospace training log stream
│   │   ├── agent/
│   │   │   ├── AgentBubble.tsx    # Fixed bottom-right button (DS only)
│   │   │   ├── AgentPanel.tsx     # Resizable right panel + fullpage toggle
│   │   │   ├── AgentMessage.tsx   # Bubble (agent/user), tool call block, gate
│   │   │   └── ConfirmGate.tsx    # ⚠ confirm/cancel block inside message
│   │   └── charts/
│   │       ├── WTIPriceChart.tsx  # Chart.js line + Regime background bands
│   │       ├── SpreadChart.tsx    # Brent-WTI spread line
│   │       ├── InventoryChart.tsx # EIA inventory vs 5yr band
│   │       ├── CurveChart.tsx     # Futures curve today vs 3mo ago
│   │       ├── VolatilityChart.tsx# OVX + VIX dual axis
│   │       └── COTChart.tsx       # COT net position bar chart
│   └── pages/
│       ├── Dashboard/
│       │   ├── index.tsx          # Tab router (overview/eia/regime/returns/charts)
│       │   ├── tabs/
│       │   │   ├── Overview/
│       │   │   │   ├── index.tsx  # Role-gated view switcher
│       │   │   │   ├── TraderView.tsx
│       │   │   │   ├── RiskView.tsx
│       │   │   │   ├── ResearcherView.tsx
│       │   │   │   └── DSView.tsx
│       │   │   ├── EIATab.tsx
│       │   │   ├── RegimeTab.tsx
│       │   │   ├── ReturnsTab.tsx
│       │   │   └── ChartsTab.tsx
│       ├── History/
│       │   ├── index.tsx          # Log list
│       │   └── HistoryDrawer.tsx  # Sheet with 4 tabs
│       ├── Signals/
│       │   ├── index.tsx          # Active features + candidates
│       │   └── evaluate/
│       │       └── [name].tsx     # Signal evaluation page (IC charts)
│       ├── DataMonitor/index.tsx  # DS only
│       ├── ModelMonitor/index.tsx # DS only
│       ├── Training/index.tsx     # DS only
│       └── Settings/index.tsx
├── public/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## 4. Role System

### 4.1 Role Enum

```typescript
// src/types/roles.ts
export type Role = 'trader' | 'risk' | 'researcher' | 'ds';

export const ROLE_LABELS: Record<Role, string> = {
  trader:     'Trader',
  risk:       'Risk',
  researcher: 'Researcher',
  ds:         'DS',
};

export const ROLE_PERMISSIONS = {
  // Sidebar pages visible
  pages: {
    dashboard:     ['trader','risk','researcher','ds'],
    history:       ['trader','risk','researcher','ds'],
    signals:       ['researcher','ds'],   // trader/risk not shown; researcher read-only, DS write
    'data-monitor':['ds'],
    'model-monitor':['ds'],
    training:      ['ds'],
    settings:      ['trader','risk','researcher','ds'],
  },
  // Dashboard top tabs accessible (full opacity)
  dashTabs: {
    overview:   ['trader','risk','researcher','ds'],
    eia:        ['trader','risk','researcher','ds'],     // dimmed for trader/risk
    regime:     ['trader','risk','researcher','ds'],     // dimmed for trader/risk
    returns:    ['trader','risk','researcher','ds'],     // dimmed for trader/risk
    charts:     ['trader','risk','researcher','ds'],     // always full
  },
  // Signal management write access
  signalWrite: ['ds'],
  // DS Agent panel
  agentPanel: ['ds'],
} as const;
```

### 4.2 RoleContext

```typescript
// src/context/RoleContext.tsx
import { createContext, useContext, useState, useEffect } from 'react';
import type { Role } from '@/types/roles';

interface RoleContextValue {
  role: Role;
  setRole: (r: Role) => void;
  userConfig: UserConfig;
  setUserConfig: (c: UserConfig) => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>(
    () => (localStorage.getItem('role') as Role) ?? 'researcher'
  );
  const [userConfig, setUserConfigState] = useState<UserConfig>(
    () => JSON.parse(localStorage.getItem('userConfig') ?? 'null') ?? DEFAULT_CONFIG
  );

  function setRole(r: Role) {
    setRoleState(r);
    localStorage.setItem('role', r);
  }

  function setUserConfig(c: UserConfig) {
    setUserConfigState(c);
    localStorage.setItem('userConfig', JSON.stringify(c));
    // Also persist to backend
    api.put('/api/users/me/config', c).catch(console.error);
  }

  return (
    <RoleContext.Provider value={{ role, setRole, userConfig, setUserConfig }}>
      {children}
    </RoleContext.Provider>
  );
}

export const useRole = () => {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
};
```

---

## 5. API Client

### 5.1 Typed Endpoints

```typescript
// src/lib/api.ts
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  get:  <T>(path: string)                  => request<T>(path),
  post: <T>(path: string, body: unknown)   => request<T>(path, { method:'POST', body: JSON.stringify(body) }),
  put:  <T>(path: string, body: unknown)   => request<T>(path, { method:'PUT',  body: JSON.stringify(body) }),
};
```

### 5.2 SWR Hooks

```typescript
// src/hooks/useReport.ts
import useSWR from 'swr';
import { api } from '@/lib/api';
import type { DailyReport } from '@/types/api';
import type { Role } from '@/types/roles';

export function useReport(role: Role) {
  return useSWR<DailyReport>(
    `/api/reports/daily/${role}`,
    () => api.get(`/api/reports/daily/${role}`),
    { refreshInterval: 60_000 }   // revalidate every minute
  );
}

// src/hooks/useModelStatus.ts
export function useModelStatus() {
  return useSWR<ModelStatus>(
    '/api/models/status',
    () => api.get('/api/models/status'),
    { refreshInterval: 30_000 }
  );
}

// src/hooks/useTraining.ts
import { useMutation } from '@tanstack/react-query';

export function useStartTraining() {
  return useMutation({
    mutationFn: (params: TrainParams) => api.post<TrainJob>('/api/train/start', params),
  });
}

// SSE log stream
export function useTrainLog(jobId: string | null, onLine: (line: string) => void) {
  useEffect(() => {
    if (!jobId) return;
    const es = new EventSource(`${BASE}/api/train/log/${jobId}`);
    es.onmessage = (e) => onLine(e.data);
    es.onerror = () => es.close();
    return () => es.close();
  }, [jobId]);
}
```

---

## 6. Design System

CSS variables are set on `:root` in `src/index.css` and map directly to the prototype token names. This ensures the React components use identical colors to the HTML prototypes.

```css
/* src/index.css */
:root {
  --surface-0: #F7F6F2;
  --surface-1: #F1EFE8;
  --surface-2: #FFFFFF;
  --border: rgba(0,0,0,0.08);
  --border-strong: rgba(0,0,0,0.14);
  --text-primary: #2C2C2A;
  --text-secondary: #5F5E5A;
  --text-muted: #888780;
  --text-danger: #A32D2D;
  --text-success: #3B6D11;
  --text-warning: #854F0B;
  --text-accent: #185FA5;
  --text-pro: #534AB7;
  --bg-danger: #FCEBEB;
  --bg-success: #EAF3DE;
  --bg-warning: #FAEEDA;
  --bg-accent: #E6F1FB;
  --bg-pro: #EEEDFE;
  --border-danger: #F09595;
  --border-success: #97C459;
  --border-warning: #EF9F27;
  --border-accent: #85B7EB;
  --fill-accent: #378ADD;
  --on-accent: #FFFFFF;
  --radius: 8px;
}
```

Tailwind config extends these as CSS variable references:

```typescript
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        surface: { 0: 'var(--surface-0)', 1: 'var(--surface-1)', 2: 'var(--surface-2)' },
        danger:  { DEFAULT: 'var(--text-danger)', bg: 'var(--bg-danger)', border: 'var(--border-danger)' },
        success: { DEFAULT: 'var(--text-success)', bg: 'var(--bg-success)', border: 'var(--border-success)' },
        warning: { DEFAULT: 'var(--text-warning)', bg: 'var(--bg-warning)', border: 'var(--border-warning)' },
        accent:  { DEFAULT: 'var(--text-accent)', bg: 'var(--bg-accent)', border: 'var(--border-accent)', fill: 'var(--fill-accent)' },
      },
      borderRadius: { DEFAULT: 'var(--radius)' },
    },
  },
};
```

---

## 7. Page Specifications

### 7.1 Dashboard

> Visual reference: `oil-signalyst-dashboard.html` — Dashboard page, all 5 tabs, all 4 role views

**Route:** `/`

The dashboard renders a top tab bar and switches content based on `activeTab` state. Tabs are:

| Tab key | Label | Full access | Dimmed (opacity 0.5, still clickable) |
|---|---|---|---|
| `overview` | Overview | all roles | — |
| `eia` | EIA Forecast | researcher, ds | trader, risk |
| `regime` | Regime | researcher, ds | trader, risk |
| `returns` | Return Dist. | researcher, ds | trader, risk |
| `charts` | Market Data | all roles | — |

```typescript
// pages/Dashboard/index.tsx
function Dashboard() {
  const [activeTab, setActiveTab] = useState<DashTab>('overview');
  const { role } = useRole();

  // When role changes to trader/risk, only bounce back if on a dimmed tab
  useEffect(() => {
    const dimmedTabs: DashTab[] = ['eia', 'regime', 'returns'];
    if ((role === 'trader' || role === 'risk') && dimmedTabs.includes(activeTab)) {
      setActiveTab('overview');
    }
  }, [role]);

  return (
    <div className="flex flex-col h-full">
      <DashTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 overflow-y-auto p-[18px] bg-surface-0">
        <PSIAlertBanner />
        {activeTab === 'overview'  && <OverviewTab />}
        {activeTab === 'eia'       && <EIATab />}
        {activeTab === 'regime'    && <RegimeTab />}
        {activeTab === 'returns'   && <ReturnsTab />}
        {activeTab === 'charts'    && <ChartsTab />}
      </div>
    </div>
  );
}
```

#### Overview Tab — role-gated views

```typescript
// pages/Dashboard/tabs/Overview/index.tsx
function OverviewTab() {
  const { role } = useRole();
  const { data: report } = useReport(role);

  if (!report) return <Skeleton />;

  return (
    <>
      {role === 'trader'     && <TraderView report={report} />}
      {role === 'risk'       && <RiskView report={report} />}
      {role === 'researcher' && <ResearcherView report={report} />}
      {role === 'ds'         && <DSView report={report} />}
    </>
  );
}
```

**TraderView** renders:
- 3 metric cards: Signal / Kelly Position / Stop Loss
- 2-column: WTI 5-day price trend (mini bar chart) + Regime 2×2 grid
- 3-column: EIA summary / COT percentile / OVX
- Full-width return distribution (dist bars + stats row)

**RiskView** renders:
- 4 metric cards: VaR 95% / CVaR / Current Exposure / Hedge Ratio
- 2-column: full return distribution stats + stress test summary
- 2-column: R3 historical performance + hedge recommendations (with option cost estimates)

**ResearcherView** renders:
- Regime 2×2 grid (full width)
- 2-column: SHAP bars + candidate signal card (read-only, link to Signals page)
- 2-column: EIA summary card + return distribution summary card (both with ↗ deep-link to detail tabs)

**DSView** renders:
- 3 model status cards (with PSI badges)
- Agent conversation preview card (link to DS Agent panel)
- Last training log snippet

#### EIA Tab

Reads `report.eia` from the daily report. Renders:
- Header: big number (forecast MB) + confidence interval + vs consensus
- Inventory breakdown: 4 horizontal bars (crude / gasoline / distillate / cushing)
- 2-column: SHAP bar chart + historical accuracy table (direction acc, MAE, vs consensus MAE)
- Price impact banner (if `abs(forecast - consensus) > user config threshold`)

#### Regime Tab

Reads `report.regime`. Renders:
- 2×2 probability grid (dominant card highlighted)
- Support signals table: signal name / value / bullish/bearish tag
- 2-column: regime duration progress bar + switch warning box

#### Returns Tab

Reads `report.returns`. Renders:
- Condition context banner (Regime weights used)
- 4-bucket bar chart with labels
- 4 metric cards: Expected Return / VaR 95% / Skewness / Price Range
- Decision grid (2×2): Airlines / Oil Producers / Trader / Options Strategy

#### Charts Tab (Market Data)

Uses Chart.js 4 via `react-chartjs-2`. All 6 charts load on first tab visit and destroy/re-create on revisit.

```typescript
// pages/Dashboard/tabs/ChartsTab.tsx
import { useRef, useEffect } from 'react';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

// Each sub-chart is a separate component:
// <WTIPriceChart /> <SpreadChart /> <InventoryChart />
// <CurveChart /> <VolatilityChart /> <COTChart />
//
// Each wraps: <div style={{ position:'relative', height: 160 }}><canvas ref={canvasRef} /></div>
// useEffect → new Chart(canvas, config) on mount, chart.destroy() on unmount
```

Data source for Phase 3: mock arrays matching prototype. Phase 4 will replace with API calls to `GET /api/market-data/{series}`.

---

### 7.2 History Page

> Visual reference: `oil-signalyst-dashboard.html` — History page + history drawer (4 tabs)

**Route:** `/history`

```typescript
function HistoryPage() {
  const { data: history } = useHistory();   // GET /api/reports/history
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="content-inner">
      <PageHeader title="History" sub="Past predictions vs actual outcomes" />
      <Card className="mb-3">
        {history?.predictions.map(p => (
          <HistoryRow key={p.date} prediction={p} onClick={() => setSelected(p.date)} />
        ))}
      </Card>
      <AccuracyCard rolling30={history?.rolling_accuracy} />
      <HistoryDrawer predictionDate={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
```

**HistoryDrawer** is a shadcn `<Sheet side="right" className="w-[376px]">` with 4 tabs: Summary / Regime / Features / Outcome. The Outcome tab shows "Pending" until `actual_return` is filled by the Phase 2 outcome backfill job.

---

### 7.3 Signals Page

> Visual reference: `oil-signalyst-dashboard.html` — Signals page (active features + candidate rows)
> Visual reference: `oil-signalyst-signals-page.html` — Signal evaluation page (3 charts, IC stats, lag switcher)

**Route:** `/signals`  
**Evaluate route:** `/signals/evaluate/:name`

```typescript
function SignalsPage() {
  const { role } = useRole();
  const { data } = useSignals();    // GET /api/signals/active + /candidates
  const canWrite = ROLE_PERMISSIONS.signalWrite.includes(role);

  return (
    <div className="content-inner">
      <PageHeader title="Signals" sub="Active Features · Signal Scanner Candidates" />

      <Card className="mb-3">
        <CardLabel>Active Features ({data?.active.length})</CardLabel>
        <FeatureTagCloud features={data?.active} />
      </Card>

      <Card>
        <CardLabel>New Signal Candidates</CardLabel>
        {data?.candidates.map(c => (
          <SignalRow
            key={c.name}
            candidate={c}
            onEvaluate={() => navigate(`/signals/evaluate/${c.name}`)}
            canAdd={canWrite}
          />
        ))}
      </Card>
    </div>
  );
}
```

**Signal Evaluation Page** (`/signals/evaluate/:name`) renders:
- Signal selector tabs at top (switch between candidates)
- Stats row: IC(5d) / IC(20d) / OOS Decay / Coverage / Recommendation
- 3 Chart.js charts in sequence:
  1. Price vs signal overlay (dual-axis line chart)
  2. Rolling IC (52-week window) with lag switcher (5d/10d/20d)
  3. Year-by-year OOS comparison (grouped bar chart, train IC vs OOS IC)
- Candidate list at bottom (click to switch active signal)
- Action buttons: Add to feature pool / Ignore (DS only)

---

### 7.4 Data Monitor Page

> Visual reference: `oil-signalyst-dashboard.html` — Data Monitor page (source status, missing rate bars, PSI bars, feature pool table)

**Route:** `/data-monitor` · **DS only**

Reads from `GET /api/models/status` (data quality section) and `GET /api/signals/active`.

Sections:
1. 3 metric cards: Data Sources / Feature Coverage / Max Publication Lag
2. Data source status list (with `pulse` dot animation for live sources, warning highlight for delayed sources)
3. Feature missing rate bars (per feature, last 30 days)
4. Feature PSI distribution drift bars (per feature, with Stable/Watch/Alert labels)
5. Current feature pool table: 14 rows × 4 columns (Feature Name / Source / Frequency / Category)
   - Reads from `GET /api/signals/active`
   - Right-aligned link: "Signals ↗" navigates to `/signals`
   - Table uses striped rows (surface-1 / surface-2 alternating), no external scroll
   - Categories rendered as colour-coded tags: Futures Curve=blue / Inventory=green / Positioning=purple / Volatility=yellow / Macro=muted

---

### 7.5 Model Monitor Page

> Visual reference: `oil-signalyst-dashboard.html` — Model Monitor page (model cards, PSI trends, SHAP bars, version history, stress test)

**Route:** `/model-monitor` · **DS only**

Reads from `GET /api/models/status`.

Sections:
1. 3 model status cards (Regime / EIA / Returns) with PSI badges
2. 2-column: PSI trend bars + OOS Brier metrics table
3. 2-column: SHAP global importance bars + model version history table
4. Stress test table (3 historical scenarios)

---

### 7.6 Training Control Page

> Visual reference: `oil-signalyst-dashboard.html` — Training Control page (config card, trigger modes, log stream, model compare card)

**Route:** `/training` · **DS only**

```typescript
function TrainingPage() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const { mutate: startTraining, isPending } = useStartTraining();

  useTrainLog(jobId, (line) => setLogLines(prev => [...prev, line]));

  async function handleStart(params: TrainParams) {
    const job = await startTraining(params);
    setJobId(job.job_id);
    setLogLines([]);
  }

  return (
    <div className="content-inner">
      <PSIAlertBanner />
      <div className="grid grid-cols-2 gap-3 mb-3">
        <TrainConfigCard onSubmit={handleStart} isPending={isPending} />
        <AutoTriggerCard />
      </div>
      <TrainLogCard lines={logLines} />
      {logLines.some(l => l.includes('OOS Brier')) && (
        <ModelCompareCard jobId={jobId} />
      )}
    </div>
  );
}
```

**TrainConfigCard** contains:
- Checkbox group: which models to retrain
- Date picker: training cutoff date
- Slider: TimeSeriesSplit folds (3–10, default 5)
- Slider: validation gap days (5–60, default 20)
- Start Training button

**TrainLogCard** renders `<LogMono>` with SSE-streamed lines. Lines containing `OOS Brier` trigger the `ModelCompareCard` to appear below.

**ModelCompareCard** appears when the `GET /api/train/status/{job_id}` poll (every 2s) returns `status === 'complete'`. Do not trigger on log string matching. Once visible, renders `result.old_metrics` vs `result.new_metrics` and a Deploy Model button (calls `POST /api/models/{type}/deploy`). On deploy success, invalidate the `useModelStatus` SWR cache so the PSI banner updates immediately.

---

### 7.7 DS Agent Panel

> Visual reference: `oil-signalyst-dashboard.html` — Agent bubble button, panel expand/resize/fullpage states, drag handle, header actions, textarea input
> Visual reference: `oil-signalyst-ds-agent.html` — Conversation content, tool call blocks, confirm gate copy and 3-step flow, final summary bubble

```typescript
// components/agent/AgentPanel.tsx
interface AgentPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type AgentMode = 'panel' | 'fullpage';
```

**States:**
1. **Collapsed** — hidden, bubble button visible (bottom-right, 48px circle)
2. **Panel** — slides in from right, default width 360px, resizable (280–780px) via drag handle on left edge
3. **Fullpage** — expands to fill main area (left = sidebar width, top = 46px, right = 0)

**Drag-to-resize:**
```typescript
// Drag handle: onMouseDown → track dx → update panel width
// Min: 280px, Max: 780px, cursor: col-resize during drag
```

**Input textarea behaviour:**
- Auto-grows with content: `el.style.height = Math.min(el.scrollHeight, 120) + 'px'`
- `Enter` → send message; `Shift+Enter` → newline (no send)
- Cleared and height reset to `auto` after send
- Placeholder: "Describe what you want to do..."
- Hint text below: "Enter to send · Shift+Enter for newline" (font-size 11px, text-muted)

**Fullpage toggle:**
```typescript
function toggleFullpage() {
  if (mode === 'panel') {
    savedWidth.current = panelWidth;
    setMode('fullpage');
  } else {
    setPanelWidth(savedWidth.current);
    setMode('panel');
  }
}
```

**Message rendering:**

Each message can contain:
- Plain text bubble
- Tool call blocks (`<ToolCallBlock name="compute_ic" args={...} result={...} />`)
- Confirm gate (`<ConfirmGate title="..." detail="..." onConfirm={...} onCancel={...} />`)

**Confirm gate flow:**

```
User: "Evaluate signals first, then retrain"
  → Agent runs: fetch_data_sample → compute_ic → compute_oos_decay → compute_feature_correlation
  → Agent shows ConfirmGate 1: "Modify features.yaml"
    → [Confirm add ✓] → executeAction('add_feature')
      → add_to_feature_registry tool call
      → ConfirmGate 2: "Start returns model retraining"
        → [Confirm training ✓] → executeAction('run_training')
          → POST /api/train/start
          → Training log streams in panel
          → ConfirmGate 3: "Replace production model"
            → [Confirm deploy ✓] → POST /api/models/returns/deploy
              → Final summary message (green bubble)
```

In Phase 3, the Agent response engine is the same mock logic as the prototype. Phase 4 will replace `getAgentReply()` with a real streaming Claude API call that has tool_use capability.

---

### 7.8 Settings Page

> Visual reference: `oil-signalyst-dashboard.html` — Settings page (identity card, thresholds card, save/reset buttons)

**Route:** `/settings`

Reads/writes `UserConfig` via `useRole().userConfig` + `setUserConfig()`.

```typescript
interface UserConfig {
  name: string;
  role: Role;
  commodity: 'WTI' | 'Brent';
  forecastHorizon: number;        // trading days, default 20
  alerts: {
    downside_risk_threshold: number;   // default 0.45
    psi_threshold: number;             // default 0.20
    eia_surprise_threshold: number;    // MB, default 1.5
  };
}
```

On save: `PUT /api/users/me/config` (Phase 2 endpoint). Response is the persisted config; update local state with response to avoid drift.

---

## 8. Shared Components Spec

### 8.1 DistChart

```typescript
interface DistChartProps {
  buckets: {
    label: string;      // e.g. "<−10%"
    pct: number;        // 0–1
    color: 'danger' | 'warning' | 'success' | 'accent';
  }[];
  height?: number;      // default 80px
}
```

Uses Recharts `BarChart` with no axis lines, no gridlines, labels rendered as custom `<Label>` above each bar.

### 8.2 RegimeGrid

```typescript
interface RegimeGridProps {
  regimes: {
    id: 'R1' | 'R2' | 'R3' | 'R4';
    label: string;
    prob: number;       // 0–1
    color: string;
    isDominant: boolean;
  }[];
}
```

Dominant card gets `bg-danger border-danger` styling. Progress bar below each probability.

### 8.3 PSIBar

```typescript
interface PSIBarProps {
  label: string;
  value: number;
  // Thresholds from user config
  stableMax?: number;   // default 0.10
  warnMax?: number;     // default 0.20
}
// Color: value < stableMax → success, < warnMax → warning, else → danger
```

### 8.4 ConfirmGate

```typescript
interface ConfirmGateProps {
  title: string;
  detail: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;   // true after either button clicked
}
```

Once either button is clicked: both disabled, opacity 0.5, result message appears below.

---

## 9. API Response Types

```typescript
// src/types/api.ts

interface DailyReport {
  date: string;
  role: Role;
  wti_price: number;
  wti_change_pct: number;

  trader?: {
    signal: 'LONG' | 'SHORT' | 'FLAT';
    kelly_position: number;         // 0–1
    stop_loss_price: number;
    stop_loss_pct: number;
    expected_return: number;
    price_5d_history: number[];     // last 5 closing prices
    brent_wti_spread: number;
    cot_net_percentile: number;     // 0–100, e.g. 22 = 22nd percentile (bearish)
    ovx: number;                    // CBOE Crude Oil Volatility Index, e.g. 28.4
  };

  risk?: {
    var_95: number;
    cvar_95: number;
    current_exposure_mbbls: number;
    hedge_ratio: number;
    recommended_hedge_ratio: number;
    r3_historical_max_drawdown: number;
  };

  eia: {
    forecast_mb: number;
    interval_80_low: number;
    interval_80_high: number;
    consensus_mb: number;
    surprise_mb: number;
    breakdown: {
      crude: number;
      gasoline: number;
      distillate: number;
      cushing: number;
    };
    shap_drivers: { name: string; contribution_mb: number }[];
    historical_direction_accuracy: number;
    historical_mae: number;
    consensus_mae: number;
  };

  regime: {
    probabilities: Record<'R1'|'R2'|'R3'|'R4', number>;
    dominant: 'R1' | 'R2' | 'R3' | 'R4';
    duration_weeks: number;
    historical_avg_duration: number;
    switch_probability_4w: number;
    support_signals: {
      name: string;
      value: string;
      direction: 'bullish' | 'bearish' | 'neutral';
    }[];
    switch_trigger: string;
  };

  returns: {
    condition_description: string;
    buckets: {
      label: string;
      pct: number;
      color: 'danger'|'warning'|'success'|'accent';
    }[];
    expected_return: number;
    median_return: number;
    var_95: number;
    skewness: number;
    price_range_low: number;
    price_range_high: number;
    downside_prob: number;
    tail_prob: number;
    upside_prob: number;
  };
}

interface ModelStatus {
  models: {
    type: 'regime' | 'eia' | 'returns';
    version: string;
    deployed_at: string;
    mlflow_run_id: string;
    metrics: {
      primary: number;     // accuracy for regime, MAE for eia, Brier for returns
      psi: number;
    };
    psi_alert: boolean;    // psi > user config threshold
  }[];
  data_sources: {
    name: string;
    status: 'ok' | 'delayed' | 'error';
    lag_hours: number | null;
    last_updated: string;
  }[];
  feature_coverage_7d: number;
}

interface TrainJob {
  job_id: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  model_types: string[];
  started_at: string | null;
  completed_at: string | null;
  result?: {
    old_metrics: Record<string, number>;
    new_metrics: Record<string, number>;
    improvement_pct: number;
  };
}
```

---

## 10. Routing

```typescript
// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RoleProvider } from '@/context/RoleContext';
import AppShell from '@/components/layout/AppShell';

export default function App() {
  return (
    <RoleProvider>
      <BrowserRouter>
        <AppShell>
          <Routes>
            <Route path="/"                    element={<Dashboard />} />
            <Route path="/history"             element={<HistoryPage />} />
            <Route path="/signals"             element={<SignalsPage />} />
            <Route path="/signals/evaluate/:name" element={<SignalEvaluatePage />} />
            <Route path="/data-monitor"        element={<DSGuard><DataMonitorPage /></DSGuard>} />
            <Route path="/model-monitor"       element={<DSGuard><ModelMonitorPage /></DSGuard>} />
            <Route path="/training"            element={<DSGuard><TrainingPage /></DSGuard>} />
            <Route path="/settings"            element={<SettingsPage />} />
            <Route path="*"                    element={<Navigate to="/" />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </RoleProvider>
  );
}

// Guard component for DS-only pages
function DSGuard({ children }: { children: React.ReactNode }) {
  const { role } = useRole();
  if (role !== 'ds') return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

---

## 11. Environment Variables

```bash
# frontend/.env.local
VITE_API_URL=http://localhost:8000

# frontend/.env.production
VITE_API_URL=https://api.oilsignalyst.example.com
```

---

## 12. Build & Dev

```bash
cd frontend
npm install
npm run dev       # Vite dev server → http://localhost:5173
npm run build     # Production build → dist/
npm run preview   # Preview production build locally
```

The Phase 2 backend must be running for API calls to succeed. For pure frontend development, a mock service worker (MSW) can intercept API calls and return fixture data — not required for Phase 3 but recommended.

---

## 13. Phase 3 Done Criteria

| # | Criterion |
|---|-----------|
| 1 | All 4 role views render correctly from live `GET /api/reports/daily/{role}` |
| 2 | Dashboard tabs switch without page reload; charts tab renders 6 Chart.js charts |
| 3 | History drawer opens with correct data for each prediction row |
| 4 | Signal evaluation page renders 3 charts (price/signal, rolling IC, OOS by year) |
| 5 | Training page: start job → SSE log streams → compare card appears → deploy button works |
| 6 | DS Agent panel: opens/closes/resizes/fullpage all work; confirm gates block destructive actions |
| 7 | PSI alert banner appears when any model PSI > threshold from user config |
| 8 | Settings page persists to `PUT /api/users/me/config` and updates UI immediately |
| 9 | DS nav group (Data Monitor / Model Monitor / Training Control) hidden for non-DS roles |
| 10 | Role pill switches role and updates all gated content without page reload |
