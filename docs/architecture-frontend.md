# Frontend Architecture

React 18 + Vite + TypeScript single-page app for oil-signalyst, behind a JWT
login: role-gated daily reports, EIA/regime/return-distribution detail tabs,
prediction history, signal research (feature pool + candidate evaluation),
and a DS Workbench (data/model monitoring, training control with run history)
with a real OpenAI-backed DS Agent panel. Talks to the FastAPI backend
directly over HTTP - no mock layer.

This file is the frontend deep-dive. See `docs/architecture.md` for the
system-level overview and `docs/architecture-backend.md` for the API surface
this consumes.

## Module Map

```
frontend/
├── src/
│   ├── main.tsx               # ReactDOM root, QueryClientProvider
│   ├── App.tsx                # BrowserRouter, AuthProvider, AuthGuard + DSGuard gates, route table
│   │
│   ├── context/
│   │   ├── AuthContext.tsx    # Logged-in user + access token (in memory), login/logout,
│   │   │                      # silent refresh on 401
│   │   └── RoleContext.tsx    # Active role (from the user) + user config
│   │                          # (+ PUT /api/users/me/config on change)
│   │
│   ├── lib/
│   │   ├── api.ts             # fetch wrapper: Bearer header, credentials:'include' for the
│   │   │                      # refresh cookie, transparent 401 -> refresh -> retry
│   │   ├── swr-keys.ts        # Centralised URL builders for SWR cache keys
│   │   ├── categoryColors.ts  # Feature-category -> badge color, shared by Data Monitor + Signals
│   │   └── utils.ts           # cn(), formatUsd(), etc.
│   │
│   ├── hooks/                 # One SWR/React Query hook per backend endpoint
│   │   ├── useReport.ts           # GET /api/reports/daily/{role}
│   │   ├── useHistory.ts          # GET /api/reports/history
│   │   ├── useHistoryDetail.ts    # GET /api/reports/history/{date}
│   │   ├── useStressTest.ts       # GET /api/reports/stress
│   │   ├── useModelStatus.ts      # GET /api/models/status
│   │   ├── useSignals.ts          # GET /api/signals
│   │   ├── useSignalEvaluation.ts # GET /api/signals/evaluate/{name}
│   │   ├── useFeaturePool.ts      # add/remove/ignore/restore pool mutations (+ cache invalidation)
│   │   ├── useTraining.ts         # start training, status poll, SSE log, deploy, useTrainJobs (history)
│   │   ├── useMarketSeries.ts     # GET /api/market/{series_id} (real Market Data charts)
│   │   ├── usePriceTicker.ts      # WebSocket /ws/price (live WTI ticker)
│   │   ├── useAgentStream.ts      # DS Agent SSE stream
│   │   ├── useChart.ts            # Chart.js lifecycle helper
│   │   └── useDragResize.ts       # Agent-panel resize
│   │
│   ├── types/
│   │   ├── api.ts              # DailyReport / ModelStatus / TrainJob(+Summary) / SignalsResponse /
│   │   │                       # PoolFeature / ... contracts
│   │   └── roles.ts            # Role union + ROLE_PERMISSIONS (page/tab gating, signalWrite, poolRemove)
│   │
│   ├── components/
│   │   ├── layout/              # AppShell, Sidebar, Topbar, RolePill
│   │   ├── shared/               # MetricCard, TagBadge, TrainBadges, SHAPBar, PSIBar, ... 
│   │   ├── charts/               # Raw Chart.js components (new Chart()/.destroy() per mount)
│   │   └── agent/                # DS Agent panel (real SSE, confirm gates)
│   │
│   └── pages/
│       ├── Login/               # Email/password -> JWT
│       ├── Dashboard/            # Tab bar (Overview/EIA/Regime/Returns/Market Data) + role-gated views
│       ├── History/               # Prediction log + outcome drawer
│       ├── Signals/                # Feature Pool table + candidate list + per-signal Evaluate page
│       ├── DataMonitor/            # DS-only: source freshness, feature missing-rate bars
│       ├── ModelMonitor/           # DS-only: PSI trend, SHAP importance, stress test results
│       ├── Training/               # DS-only: config, auto-trigger, live log, compare+deploy, run history
│       └── Settings/               # Identity + alert-threshold / retrain-mode config
│
└── public/
```

## Authentication

- **`AuthContext`** holds the logged-in user and the **access token in memory
  only** (not `localStorage` - an XSS payload that can run JS can already
  call fetch, but `localStorage` would additionally survive and be
  exfiltratable at leisure). The **refresh token is an httpOnly cookie**,
  never visible to JS.
- **`lib/api.ts`** attaches the `Bearer` header, sends `credentials:'include'`
  so the refresh cookie round-trips, and on a `401` transparently calls
  `/api/auth/refresh` once and retries; if refresh fails it redirects to
  `/login`. Concurrent 401s dedupe into a single refresh call.
- **`AuthGuard`** (`App.tsx`) redirects unauthenticated users to `/login`;
  `DSGuard` additionally gates the DS Workbench routes.

## Data Fetching

- **Reads**: SWR. Every hook in `hooks/` wraps a single backend endpoint;
  `useTrainStatus` polls every 2s while a job is in flight, `useTrainJobs`
  slow-polls the history list.
- **Mutations**: React Query (`useMutation`) - training start/deploy and the
  feature-pool add/remove/ignore/restore actions. `onSuccess` handlers call
  SWR's `mutate()` to invalidate the affected read keys (e.g. deploy refreshes
  model status *and* the training-history deploy states; pool actions refresh
  `/api/signals` and any open Evaluate page) so the UI updates without a
  manual refetch.
- **Streaming**: `useTrainLog` and `useAgentStream` open real `EventSource`
  connections and close on the backend's `[done:...]` sentinel (letting the
  stream end naturally would trigger the browser's auto-reconnect and replay
  from the top). EventSource can't set headers, so the token goes as a query
  param.
- **WebSocket**: `usePriceTicker` connects to `/ws/price` for the live WTI
  ticker with exponential-backoff reconnect.
- **Base URL**: `VITE_API_URL` (default `http://localhost:8000` in dev). In
  the Docker path the nginx frontend container reverse-proxies `/api` + `/ws`
  same-origin, so no CORS; in dev the backend allow-lists `localhost:5173`.

## Role Model

`AuthContext` provides the logged-in user's `role` (`trader | risk |
researcher | ds`); `RoleContext` exposes it (for a `ds` user the `RolePill`
can preview other roles' views). `ROLE_PERMISSIONS` in `types/roles.ts` gates:

- which sidebar pages are visible (`DSGuard` redirects non-`ds` roles away
  from `/data-monitor`, `/model-monitor`, `/training`);
- which Dashboard tabs are dimmed (EIA/Regime/Returns for `trader`/`risk`);
- which Overview view renders for the same `GET /api/reports/daily/{role}`
  response;
- **`signalWrite`** (`researcher` + `ds`) - who sees add/ignore/restore
  controls; **`poolRemove`** (`ds` only) - who sees the pool remove button.

These flags **control what the UI shows; the backend independently enforces
the same split** with its `ResearcherOrDS`/`DSOnly` route guards, so hiding a
button is not the security boundary.

## DS Agent Panel

`components/agent/` drives a **real** DS Agent conversation backed by the
backend's OpenAI tool-use loop (`useAgentStream` over `GET
/api/agent/stream/{session_id}`). Destructive tool calls (add-to-pool,
run-training, deploy) surface a `ConfirmGate` that calls
`/api/agent/confirm/{turn_id}` before the backend executes them. `AppShell`
mounts the panel only for `role === 'ds'`, as a real flex sibling of the page
content (pushes the layout narrower when open rather than overlaying it).

`DSView`'s "Last Training Run" card renders the real latest job (via
`useTrainJobs`), not a placeholder.

## Signals Page

- **Feature Pool** card: every `pool_features` entry with category
  (color-coded, shared map with Data Monitor), source/frequency, health stats
  (missing-rate + PSI joined from `/api/models/status`), and a live /
  pending-retrain / removed badge. Removing an in-use feature confirms first
  (it would break daily predictions until retrain).
- **Candidates** list: color-coded by adoption state (in-pool green, snoozed
  greyed with a countdown, plain candidate neutral). The **Evaluate** page
  shows IC/OOS charts (served warm from the backend chart cache) plus real
  Add / Ignore actions.
- **Ignored** section: 30-day snoozed candidates with an auto-restore
  countdown and a "Restore now" button.

## Training Page

Config form + auto-trigger mode + live SSE log + old-vs-new compare/deploy,
plus a **Training History** table (`useTrainJobs`): every past run with a
trigger badge (manual / auto:psi / auto:sunday / agent), expandable to its
persisted log and comparison, with a redeploy (rollback) action for
superseded runs. The cutoff-date field defaults to **today - 90 days** (the
most recent value that still leaves a valid validation window; a cutoff too
close to today has no forward-looking labels to validate against).

## Known Frontend/Backend Contract Notes

Fields in `types/api.ts` that render real backend data but originate from a
value the backend can't compute yet (documented on the backend side too, see
`architecture-backend.md`'s Known Architectural Simplifications): EIA
`breakdown.{gasoline,distillate,cushing}`, `regime.switch_trigger`,
`returns.condition_description`/`median_return`/`skewness`. These are static
placeholders returned by the backend, not fabricated client-side - the
frontend just renders whatever the API sends.
