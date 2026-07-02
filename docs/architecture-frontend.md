# Frontend Architecture

React 18 + Vite + TypeScript single-page app for oil-signalyst: role-gated
daily reports, EIA/regime/return-distribution detail tabs, prediction
history, signal research (active features + candidate evaluation), and a DS
Workbench (data/model monitoring, training control) with a scripted DS Agent
panel. Talks to the FastAPI backend directly over HTTP - no mock layer.

This file is the frontend deep-dive. See `docs/architecture.md` for the
system-level overview shared with the rest of the project, and
`docs/architecture-backend.md` for the API surface this consumes.

## Module Map

```
frontend/
├── src/
│   ├── main.tsx               # ReactDOM root, QueryClientProvider
│   ├── App.tsx                # BrowserRouter, route table, DSGuard (role=ds gate)
│   │
│   ├── context/
│   │   └── RoleContext.tsx    # Active role + user config, persisted to localStorage
│   │                          # (+ PUT /api/users/me/config on change)
│   │
│   ├── lib/
│   │   ├── api.ts             # fetch wrapper (BASE = VITE_API_URL, default localhost:8000)
│   │   ├── swr-keys.ts        # Centralised URL builders for SWR cache keys
│   │   ├── mock-market-data.ts# Literal chart data for the 6 Market Data tab charts (D10 - not API-backed)
│   │   └── utils.ts           # cn(), formatUsd(), etc.
│   │
│   ├── hooks/                 # One SWR/React Query hook per backend endpoint
│   │   ├── useReport.ts           # GET /api/reports/daily/{role}
│   │   ├── useHistory.ts          # GET /api/reports/history
│   │   ├── useHistoryDetail.ts    # GET /api/reports/history/{date}
│   │   ├── useModelStatus.ts      # GET /api/models/status
│   │   ├── useSignals.ts          # GET /api/signals
│   │   ├── useSignalEvaluation.ts # GET /api/signals/evaluate/{name}
│   │   └── useTraining.ts         # POST /api/train/start, useTrainStatus (poll),
│   │                              # useTrainLog (real EventSource/SSE), useDeployModel
│   │
│   ├── types/
│   │   ├── api.ts              # DailyReport / ModelStatus / TrainJob / SignalsResponse / ... contracts
│   │   └── roles.ts            # Role union + ROLE_PERMISSIONS (page/tab gating per role)
│   │
│   ├── components/
│   │   ├── layout/              # AppShell, Sidebar, Topbar, RolePill
│   │   ├── shared/               # MetricCard, TagBadge, SHAPBar, PSIBar, RegimeGrid, DistChart (Recharts), ...
│   │   ├── charts/               # Raw Chart.js components (new Chart()/`.destroy()` per mount, not react-chartjs-2)
│   │   └── agent/                # DS Agent panel (see below)
│   │
│   └── pages/
│       ├── Dashboard/            # Tab bar (Overview/EIA/Regime/Returns/Market Data) + 4 role-gated Overview views
│       ├── History/               # Prediction log + outcome drawer
│       ├── Signals/                # Active features + candidate list + per-signal Evaluate detail page
│       ├── DataMonitor/            # DS-only: source freshness, feature missing-rate bars
│       ├── ModelMonitor/           # DS-only: PSI trend, SHAP importance, stress test results
│       ├── Training/               # DS-only: config form, auto-trigger, live log, old-vs-new compare + deploy
│       └── Settings/               # Identity + alert-threshold config
│
└── public/
```

## Data Fetching

- **Reads**: SWR. Every hook in `hooks/` wraps a single backend endpoint;
  `useTrainStatus` additionally polls every 2s while a job is in flight.
- **Mutations**: React Query (`useMutation`) - `useStartTraining`,
  `useDeployModel`. `useDeployModel`'s `onSuccess` calls SWR's `mutate()` on
  `useModelStatus`'s key so the PSI/version banner updates immediately
  without a manual refetch.
- **Streaming**: `useTrainLog` opens a real `EventSource` against
  `GET /api/train/log/{job_id}` (`text/event-stream`) and closes it
  explicitly on the backend's `[done:status]` sentinel line - letting the
  stream end naturally would trigger the browser's default auto-reconnect
  and replay the whole log from the top.
- **Base URL**: `VITE_API_URL` env var, defaulting to `http://localhost:8000`
  in dev. The backend's CORS middleware allow-lists `http://localhost:5173`
  (the Vite dev server origin) - see `api/main.py`.

## Role Model

`RoleContext` holds one of `trader | risk | researcher | ds`, seeded from
and persisted to `localStorage` (no backend auth - this is a local
single-user tool; `role` is a client-side view switch, not an authorization
boundary the backend enforces). `ROLE_PERMISSIONS` in `types/roles.ts` gates:

- which sidebar pages are visible (`DSGuard` in `App.tsx` redirects
  non-`ds` roles away from `/data-monitor`, `/model-monitor`, `/training`)
- which Dashboard tabs are dimmed (EIA/Regime/Returns are de-emphasized,
  not hidden, for `trader`/`risk`)
- which Overview view renders (`TraderView` / `RiskView` /
  `ResearcherView` / `DSView`) for the same `GET /api/reports/daily/{role}`
  response - the backend returns the same full nested `DailyReport` shape
  regardless of role; only the frontend's rendering differs.

## DS Agent Panel

`components/agent/agent-mock-engine.tsx` drives a scripted conversation
(tool-call bubbles, confirm gates, quick actions) as a `useReducer` state
machine - it is **not** wired to a real LLM. This is deliberate, not a gap:
it's the Phase 3 placeholder for a real Claude-API-backed agent, planned for
a later phase. `AppShell` mounts the panel only for `role === 'ds'`, as a
real flex sibling of the page content (pushes the layout narrower when
open, rather than overlaying it - see `AgentPanel.tsx`'s `fullpage` prop).

Two dashboard elements are similarly still static placeholders, not backed
by any hook: `DSView.tsx`'s "DS Agent" preview bubble and "Last Training
Run" log card. Distinguish these from real gaps - they render fixed
example content by design, matching the agent engine's scripted scenario.

## Known Frontend/Backend Contract Notes

Fields in `types/api.ts` that render real backend data but originate from a
value the backend can't compute yet (documented on the backend side too,
see `architecture-backend.md`'s Known Architectural Simplifications):
EIA `breakdown.{gasoline,distillate,cushing}`, `regime.switch_trigger`,
`returns.condition_description`/`median_return`/`skewness`. These are
static placeholders returned by the backend, not fabricated client-side -
the frontend has no special-case handling for them, it just renders
whatever the API sends.

`TrainConfigCard`'s `cv_folds`/`gap_days` sliders are accepted by
`POST /api/train/start` but currently inert (no real k-fold CV in the
training pipeline - see `architecture-backend.md`). The cutoff-date field
defaults to blank rather than a hardcoded recent date, since forward-looking
labels (eia/returns) need trailing days of future data that don't exist yet
for a cutoff too close to "today".
