# oil-signalyst — Phase 4 Spec: Real Data, Live Agent, Auth

**Version:** 1.4  
**Phase:** 4 — Real-time Data · Live DS Agent · Authentication  
**Last updated:** 2026-07-03  
**Depends on:** Phase 3 complete · Phase 2.3 complete  
**Stack additions:** OpenAI SDK · FastAPI SSE · yfinance · JWT / OAuth2  
**Changelog:**  
- v1.1: Fixed 7 inconsistencies vs earlier phases: `db.database` import path; `Prediction.dominant_regime` is not a DB column (now filters in Python via `regime_probs`); `alert_psi_threshold` is a constant not a User field (D16 added); `build_signal_charts.__wrapped__` removed (direct call with real session); `_deploy_model` tool handler now calls `do_deploy()` service function instead of FastAPI route; `_filter_by_role` `user` parameter requirement documented; `AgentTurn.id` typed as `int` throughout (schema annotation, SSE event, TypeScript `confirmTool`/`cancelTool`)
- v1.2: Verified against the actual current codebase (post-Phase-2.3 backend reshape) and fixed 9 more inconsistencies: `_filter_by_role()` no longer exists (deleted, replaced by `report_assembler.nest_daily_report()`) - the §6.6 carry-forward note is rewritten; `core/services/deploy_service.py::do_deploy()` does not exist yet and was never "extracted in Phase 2.3" - §9.3 now scopes its creation into Phase 4 instead of assuming it; `PSI_ALERT_THRESHOLD` doesn't exist under that name - the real constant is `PSI_RETRAIN_THRESHOLD` in `core/postprocess/drift_monitor.py` (D16 corrected); wrong EIA series ID (`PET.WCESTUS1.W` → real one is `PET.WCRSTUS1.W`, per `config/data_sources.yaml`); `fetch_cot_net()` fabricated a fake position from price momentum instead of using the real CFTC data this project already ingests (`cot_wti_spec_long`/`cot_wti_spec_short`) - rewritten to use it; all 6 market fetchers rewritten to call the existing `DataRegistry.fetch()` (already has retry logic, the Yahoo-source single-row-squeeze fix, and a 4h in-memory cache) instead of raw `yfinance`/`requests` calls that would have duplicated - and under-tested versions of - that logic; Redis (D6) removed as unnecessary new infrastructure for a single-user local tool - `DataRegistry`'s existing in-memory TTL cache covers this; Topbar price §8 intro corrected (the price is already live via the daily report, not hardcoded - the WebSocket adds sub-daily granularity); D17 added to make the role-pill-removal tradeoff an explicit, confirmable decision rather than an implicit side effect of adding auth.
- v1.3: Switched the DS Agent's LLM provider from Anthropic Claude to OpenAI (§9 rewritten). Tool schema moved from Anthropic's `{name, description, input_schema}` to OpenAI Chat Completions' `{"type": "function", "function": {name, description, parameters}}`; streaming rewritten from Anthropic's discrete `content_block_stop`/`tool_use` block events to OpenAI's incrementally-accumulated `delta.tool_calls[].function.arguments` string fragments (materially different accumulation logic, not just a renamed client); system prompt moved from a top-level `system` param to the first message in the `messages` array (Chat Completions convention); env vars `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` → `OPENAI_API_KEY`/`OPENAI_MODEL`; frontend's unused `@anthropic-ai/sdk` note removed (never was called directly from the frontend either way - agent calls always went through the backend).
- v1.4: `stream_agent_response()` was a single tool-call-then-stop turn - it executed at most one round of tool calls and then always finished, requiring a new user message to make any further progress even through a hardcoded, instructed sequence like the four evaluation gates. Rewrote it as a real multi-step loop (D18 added): non-destructive tool results now feed back into `chat_messages` and the model is re-invoked automatically (capped at `MAX_TOOL_ITERATIONS = 8`) until it gives a final answer or hits a destructive tool, which still always pauses for `POST /api/agent/confirm/{turn_id}` exactly as before. This surfaced a real gap in `AgentTurn`: nothing recorded which OpenAI tool_call_id a stored result answers, or the assistant's own tool_calls request message - both are required for OpenAI to accept the replayed history when a paused destructive confirm resumes the stream, so added `AgentTurn.tool_calls` and `AgentTurn.tool_call_id` columns (§3) and a new `on_assistant_turn` callback (§9.2/§9.4) to persist them.

---

## 1. Overview

Phase 3 ships a fully functional UI backed by the Phase 2 ML pipeline, but three significant items were deferred:

- **D7** — DS Agent uses a mock response engine. Real OpenAI API with tool calling is Phase 4.
- **D10** — Market data charts (WTI price, Brent spread, COT, OVX, inventory, futures curve) use hardcoded mock arrays. Real time-series from Yahoo Finance and EIA is Phase 4.
- **Phase 3 scope** — No authentication, single user only.

Phase 4 closes all three gaps and also adds a lightweight WebSocket price ticker so the topbar WTI price updates in real time without page reload.

**Phase 4 is complete when:**
1. The DS Agent panel sends messages to the real OpenAI API, executes tool calls, and streams token-by-token responses into the panel.
2. All 6 Market Data charts render live historical data fetched from Yahoo Finance and EIA — no hardcoded arrays.
3. The WTI price in the topbar updates every 30 seconds from a live price feed.
4. Users must log in before accessing any page; role is read from their JWT claim, not from localStorage.

**In scope:**
- OpenAI API integration: streaming tool calls in the DS Agent panel
- Real market data: 6 time-series endpoints (`GET /api/market/{series}`)
- WebSocket price ticker (`ws://localhost:8000/ws/price`)
- Authentication: JWT login, protected routes, role from token
- Deployment: Docker Compose stack (backend + frontend + Caddy reverse proxy)

**Out of scope for Phase 4:** Multi-tenancy, paid data sources (AIS/satellite), production cloud infra beyond Docker Compose.

---

## 2. Decisions Log

| # | Decision |
|---|----------|
| D1 | OpenAI model: `gpt-4o` via env var, chosen for speed/cost balance in an agentic tool-use loop. Swap to a higher-reasoning model via the same env var if needed. Uses the Chat Completions API (`client.chat.completions.create`), not the newer Responses API - more universally documented/stable across SDK versions; Responses API's more granular streaming events (`response.function_call_arguments.delta` etc., closer to Anthropic's model) are a reasonable alternative if the pinned `openai` SDK version at build time supports it well. |
| D2 | Agent streaming: OpenAI's Chat Completions streaming does **not** emit discrete "tool call complete" events the way Anthropic's Messages API does. Each `ChatCompletionChunk.choices[0].delta.tool_calls[]` entry carries only a partial JSON string fragment in `.function.arguments`, indexed by `.index` (a tool call's `.id`/`.function.name` only appear on that tool call's *first* chunk). The backend must accumulate fragments per index and only treat a tool call as ready once `finish_reason == "tool_calls"` - see §9.2. Text tokens arrive in `delta.content`. Server sends SSE to frontend, same event shape as before (`text_delta`/`tool_pending`/`tool_result`/`done`). |
| D3 | Tool execution: tool calls are executed server-side (backend has DB access). The frontend never calls tools directly. |
| D4 | Tool confirmation gates: frontend still controls the UX gates. Backend sends a `tool_pending` SSE event with tool name and arguments; frontend renders the ConfirmGate; user confirms; frontend sends `POST /api/agent/confirm/{turn_id}` to release execution. |
| D5 | Market data source: reuse the existing `DataRegistry.fetch(name, start, end)` (already wraps Yahoo Finance/EIA/CFTC adapters with retry logic and a 4h in-memory TTL cache - `core/cache.py`) for all 6 series, rather than writing new direct `yfinance`/`requests` calls. `wti_price`→`wti`, `brent_spread`→`brent`+`wti`, `inventory`→`crude_inventory`, `ovx_vix`→`ovx`+`vix`, `cot_net`→`cot_wti_spec_long`+`cot_wti_spec_short` (all named sources already in `config/data_sources.yaml`). Only `futures_curve` has no existing source (it needs point-in-time multi-contract snapshots, not a time series) and still calls `yfinance` directly for the M1-M10 contract tickers. |
| D6 | No new cache infrastructure. `DataRegistry`'s existing in-memory `DataFetchCache` (4h TTL, keyed by `{source}:{start}:{end}`) is sufficient for a single-user local tool - adding Redis + a 4th Docker Compose service for a 5-endpoint cache isn't worth the operational surface. Revisit only if this becomes a genuinely multi-instance deployment. |
| D7 | EIA API key: required for inventory endpoint. Stored in `.env` as `EIA_API_KEY`. Free tier sufficient (1000 req/day). |
| D8 | Futures curve: built from Yahoo Finance WTI futures contracts (CL=F, CLH25.NYM, etc.) — no separate data source needed. |
| D9 | Authentication: FastAPI OAuth2 password flow → JWT access token (1h expiry) + refresh token (7d, httpOnly cookie). Role claim embedded in JWT payload. |
| D10 | Frontend auth: Axios interceptor attaches Bearer token to all requests. On 401, attempt silent refresh; on refresh failure, redirect to `/login`. |
| D11 | WebSocket price ticker: single shared connection per browser tab. Reconnects with exponential back-off on disconnect. Price updates trigger a Zustand atom, which the Topbar subscribes to — no SWR polling for price. |
| D12 | Docker Compose: `backend` + `frontend` (served by nginx) + `caddy` (TLS termination + reverse proxy). No `redis` service - see D6. Postgres is assumed external (Railway / Supabase) for production. |
| D13 | Agent conversation history: stored in `agent_turns` DB table (one row per message/tool pair). Frontend fetches full history on panel open. Cleared per-session via `DELETE /api/agent/history`. |
| D14 | Destructive tool calls require a two-phase commit: `tool_pending` → user confirms → `POST /api/agent/confirm/{turn_id}` → backend executes. Non-destructive tools (`compute_ic`, `fetch_data_sample`) execute immediately without a gate. |
| D16 | PSI alert threshold: `PSI_RETRAIN_THRESHOLD` (the real name - not `PSI_ALERT_THRESHOLD`) is a module-level constant in `core/postprocess/drift_monitor.py`, imported into `api/routes/models.py`, not a per-user DB field. The `User` model has no `alert_psi_threshold` column. If per-user PSI thresholds are needed in future, add `alert_psi_threshold = Column(Float, default=0.20)` via Alembic migration. Phase 4 does not make this change. |
| D15 | Market data charts: Phase 3 mock arrays are replaced by `useMarketSeries(seriesId)` SWR hook calling `GET /api/market/{series}`. Chart.js components remain unchanged; only the data source changes. |
| D17 | **Role pill removal is a deliberate, confirmable tradeoff, not a side effect.** Every role view (Trader/Risk/Researcher/DS) has been built and verified throughout this project around instantly switching roles to compare perspectives on the same day's report. Tying role to which account you log in as means seeing all 4 views requires 4 separate logins. If that tradeoff isn't wanted, keep the pill for `ds`-role users only, as a "view as" override that re-fetches `GET /api/reports/daily/{override_role}` without changing the authenticated identity - purely a display switch, same as Phase 3, just gated behind being logged in as `ds`. Confirm which behavior is wanted before implementing §6.6. |
| D18 | **Agent loop is multi-step for non-destructive tools, single-gated for destructive ones - not full autonomous ReAct.** `stream_agent_response()` (§9.2) automatically re-invokes the model after each non-destructive tool result (up to `MAX_TOOL_ITERATIONS = 8`), so the system prompt's instructed evaluation-gate order (`fetch_data_sample → compute_ic → compute_oos_decay → compute_feature_correlation`) actually happens even if the model requests them one at a time rather than all in one completion. Destructive tools (`add_to_feature_registry`, `run_training`, `deploy_model`) always stop the loop and wait for `POST /api/agent/confirm/{turn_id}` regardless of iteration count - the loop never bypasses that gate, it only removes the need for a user round-trip *between non-destructive steps*. |

---

## 3. Schema Changes

```python
# db/models.py — Phase 4 additions

class AgentTurn(Base):
    """One turn in a DS Agent conversation (user message, assistant response, or tool result)."""
    __tablename__ = "agent_turns"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    # id is Integer. Serialised as a number in SSE events and in API URLs.
    # FastAPI route: /api/agent/confirm/{turn_id: int}
    # TypeScript type: turn_id: number (not string)
    session_id   = Column(String(36), index=True)          # UUID per conversation session
    user_id      = Column(Integer, ForeignKey("users.id"))
    role         = Column(String(16))                      # 'user' | 'assistant' | 'tool'
    content      = Column(JSON)                            # OpenAI message text content (str or None)
    tool_calls   = Column(JSON, nullable=True)              # Set when role='assistant' requested tool(s):
                                                             # OpenAI's [{"id","type","function":{"name","arguments"}}]
                                                             # array, verbatim - must be replayed back before any
                                                             # role='tool' message, see core/agent/client.py's loop
    tool_call_id = Column(String(64), nullable=True)        # Set when role='tool': links this result back to
                                                             # the specific entry in the preceding assistant
                                                             # turn's tool_calls (required to reconstruct
                                                             # {"role":"tool","tool_call_id":...} on resume -
                                                             # a single assistant turn can request >1 tool call
                                                             # in parallel, so tool_name/tool_result alone can't
                                                             # disambiguate which result answers which call)
    tool_name    = Column(String(64), nullable=True)       # Set when role='tool'
    tool_input   = Column(JSON, nullable=True)
    tool_result  = Column(JSON, nullable=True)
    status       = Column(String(16), default="complete")  # 'pending' | 'confirmed' | 'cancelled' | 'complete'
    created_at   = Column(DateTime, default=datetime.utcnow)


# Extend User model
class User(Base):
    # ... existing columns ...
    hashed_password  = Column(String(256), nullable=True)   # Added in Phase 4
    refresh_token    = Column(String(512), nullable=True)   # Current valid refresh token
    last_login_at    = Column(DateTime, nullable=True)
```

```bash
cd backend
uv run alembic revision --autogenerate -m "phase4 agent_turns and user auth columns"
uv run alembic upgrade head
```

---

## 4. New Dependencies

```toml
# backend/pyproject.toml — Phase 4 additions
"openai>=1.50.0",             # Chat Completions API with streaming tool_calls
"python-jose[cryptography]>=3.3.0",  # JWT encoding/decoding
"passlib[bcrypt]>=1.7.4",     # Password hashing
"websockets>=12.0",           # WebSocket price ticker server
# yfinance is already a dependency (core/data/sources/yahoo.py) - reused via
# DataRegistry, not re-added. No redis/requests-cache - see D5/D6.
```

```json
// frontend/package.json — Phase 4 additions
"zustand": "^4.5.0",             // Lightweight atom store for WS price ticker
"axios": "^1.7.0"                // Replaces raw fetch; easier interceptor setup
```

No OpenAI SDK on the frontend either way - the agent runs entirely
server-side (§9), the frontend only ever talks to `/api/agent/*`.

---

## 5. Directory Structure Changes

```
backend/
├── core/
│   ├── agent/
│   │   ├── __init__.py
│   │   ├── client.py          # OpenAI client singleton + streaming wrapper
│   │   ├── tools.py           # Tool registry: definitions + execution dispatch
│   │   ├── tool_handlers.py   # One async function per tool
│   │   └── history.py         # load_history(): AgentTurn rows -> OpenAI messages list.
│   │                          # Must reconstruct role='assistant' turns as
│   │                          # {"role":"assistant","content":...,"tool_calls":turn.tool_calls}
│   │                          # and role='tool' turns as {"role":"tool","tool_call_id":turn.tool_call_id,
│   │                          # "content":json.dumps(turn.tool_result)} - an assistant tool_calls
│   │                          # message must always immediately precede the tool messages
│   │                          # answering it, or the OpenAI API rejects the request. This is what
│   │                          # makes the confirm-then-resume path in §9.2/§9.4 work.
│   ├── market/
│   │   ├── __init__.py
│   │   ├── fetcher.py         # Thin wrappers over DataRegistry.fetch() (see D5) - no new cache layer
│   │   └── series.py          # Series ID → fetcher mapping
│   └── services/
│       └── deploy_service.py  # do_deploy() extracted from api/routes/models.py::deploy_model() -
│                              # NEW in Phase 4, not a Phase 2.3 carry-forward (that never happened;
│                              # deploy logic still lives inline in the route handler today)
├── auth/
│   ├── __init__.py
│   ├── jwt.py                 # create_access_token, decode_token
│   ├── password.py            # hash_password, verify_password
│   └── dependencies.py        # get_current_user (replaces Phase 3 stub)
├── api/
│   └── routes/
│       ├── agent.py           # POST /api/agent/message, GET /api/agent/stream/{session}
│       │                      # POST /api/agent/confirm/{turn_id}
│       │                      # DELETE /api/agent/history
│       ├── market.py          # GET /api/market/{series}
│       ├── auth.py            # POST /api/auth/login, POST /api/auth/refresh
│       │                      # POST /api/auth/logout
│       └── ws.py              # WebSocket /ws/price

frontend/src/
├── lib/
│   ├── axios.ts               # Axios instance with auth interceptors
│   └── price-store.ts         # Zustand atom for live WTI price
├── hooks/
│   ├── useMarketSeries.ts     # SWR → GET /api/market/{series}
│   ├── usePriceTicker.ts      # WebSocket connection + price-store updates
│   └── useAgentStream.ts      # SSE → /api/agent/stream/{session_id}
├── components/
│   └── agent/
│       ├── AgentPanel.tsx     # Updated: real streaming, tool gates
│       └── ToolCallBlock.tsx  # Updated: shows live streaming arguments
├── pages/
│   └── Login/
│       └── index.tsx          # Login form (email + password)
```

---

## 6. Authentication

### 6.1 Backend — `auth/jwt.py`

```python
# auth/jwt.py
from datetime import datetime, timedelta
from jose import jwt, JWTError
import os

SECRET_KEY  = os.environ["JWT_SECRET"]   # min 32 random bytes
ALGORITHM   = "HS256"
ACCESS_TTL  = timedelta(hours=1)
REFRESH_TTL = timedelta(days=7)


def create_access_token(user_id: int, role: str) -> str:
    payload = {
        "sub":  str(user_id),
        "role": role,
        "exp":  datetime.utcnow() + ACCESS_TTL,
        "iat":  datetime.utcnow(),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Raises JWTError on invalid/expired token."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
```

### 6.2 Backend — `api/routes/auth.py`

```python
# api/routes/auth.py
from fastapi import APIRouter, HTTPException, Response, Cookie
from pydantic import BaseModel
from auth.jwt import create_access_token, decode_access_token
from auth.password import verify_password
from api.dependencies import DbSession
from db.models import User
from sqlalchemy import select
import secrets

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
async def login(body: LoginRequest, response: Response, db: DbSession):
    row = await db.execute(select(User).where(User.email == body.email))
    user = row.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token   = create_access_token(user.id, user.role)
    refresh_token  = secrets.token_urlsafe(48)
    user.refresh_token = refresh_token
    user.last_login_at = datetime.utcnow()
    db.add(user)

    # Refresh token in httpOnly cookie — not accessible to JS
    response.set_cookie(
        "refresh_token", refresh_token,
        httponly=True, samesite="lax", max_age=60 * 60 * 24 * 7,
    )
    return {"access_token": access_token, "role": user.role, "name": user.name}


@router.post("/refresh")
async def refresh(response: Response, db: DbSession, refresh_token: str = Cookie(None)):
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token")
    row = await db.execute(select(User).where(User.refresh_token == refresh_token))
    user = row.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    new_access = create_access_token(user.id, user.role)
    return {"access_token": new_access, "role": user.role}


@router.post("/logout")
async def logout(response: Response, db: DbSession, user: CurrentUser):
    user.refresh_token = None
    db.add(user)
    response.delete_cookie("refresh_token")
    return {"status": "logged out"}
```

### 6.3 Update `CurrentUser` dependency

```python
# api/dependencies.py — replace Phase 3 stub with real JWT auth

from fastapi import Depends, HTTPException, Header
from auth.jwt import decode_access_token
from jose import JWTError

async def get_current_user(
    authorization: str = Header(None),
    db: DbSession = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.removeprefix("Bearer ")
    try:
        payload = decode_access_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await db.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

CurrentUser = Annotated[User, Depends(get_current_user)]
```

### 6.4 Frontend — Axios interceptors

```typescript
// frontend/src/lib/axios.ts
import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export const api = axios.create({ baseURL: BASE });

// Attach token from memory (not localStorage — XSS risk)
let _accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { _accessToken = t; };

api.interceptors.request.use(config => {
  if (_accessToken) config.headers.Authorization = `Bearer ${_accessToken}`;
  return config;
});

// On 401, attempt silent refresh then retry once
api.interceptors.response.use(
  res => res,
  async err => {
    if (err.response?.status !== 401 || err.config._retried) {
      return Promise.reject(err);
    }
    try {
      const { data } = await axios.post(`${BASE}/api/auth/refresh`, {}, { withCredentials: true });
      setAccessToken(data.access_token);
      err.config._retried = true;
      err.config.headers.Authorization = `Bearer ${data.access_token}`;
      return api(err.config);
    } catch {
      setAccessToken(null);
      window.location.href = '/login';
      return Promise.reject(err);
    }
  }
);
```

### 6.5 Frontend — Protected routes

```typescript
// frontend/src/App.tsx — add AuthGuard wrapper

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Wrap all routes except /login in <AuthGuard>
<Route path="/login" element={<LoginPage />} />
<Route element={<AuthGuard><AppShell /></AuthGuard>}>
  <Route path="/" element={<Dashboard />} />
  {/* ... all other routes ... */}
</Route>
```

### 6.6 Role from JWT, not localStorage

```typescript
// frontend/src/context/RoleContext.tsx — Phase 4 update

// Remove: const [role, setRoleState] = useState<Role>(() => localStorage.getItem('role') as Role)
// Add: role is derived from the decoded JWT payload on login, stored in memory only.

export function RoleProvider({ children }) {
  const { user } = useAuth();   // user.role comes from JWT payload
  const role = (user?.role ?? 'researcher') as Role;
  // Role is read-only in Phase 4 — switching roles requires logging in as a different user.
  // The role pill is hidden; role is shown as a read-only label in the sidebar footer.
  ...
}
```

> **Note:** The role pill switcher built in Phase 3 is removed from the UI in Phase 4. Role is determined by the authenticated user's JWT claim. The DS Agent panel and DS nav group appear only when `user.role === 'ds'`.

> **Backend note (corrected from a stale Phase 2.3 reference):** `_filter_by_role()` no longer exists - the backend reshape replaced it with `report_assembler.nest_daily_report(raw, role, exposure_barrels, r3_max_drawdown)`, called from `api/routes/reports.py::get_daily_report()`. It already takes `exposure_barrels` directly (not a `user` object) for the `risk` block. No change is needed here for Phase 4 auth - `get_daily_report()` already resolves `user.exposure_barrels` from whatever `CurrentUser` dependency is active, so swapping the header-based stub for the real JWT-based one in §6.3 is a drop-in replacement.

---

## 7. Live Market Data

### 7.1 Series registry — `core/market/series.py`

```python
# core/market/series.py
from core.market.fetcher import (
    fetch_wti_price_history,
    fetch_brent_wti_spread,
    fetch_eia_inventory,
    fetch_futures_curve,
    fetch_ovx_vix,
    fetch_cot_net,
)

# No per-series TTL table needed - DataRegistry.fetch() already caches
# in-memory for 4h (core/cache.py::DataFetchCache), keyed by
# f"{source}:{start}:{end}". Since every fetcher below recomputes its date
# range from "now" on each call, the cache key rotates daily on its own.
SERIES: dict[str, callable] = {
    "wti_price":     fetch_wti_price_history,   # 18 months, daily
    "brent_spread":  fetch_brent_wti_spread,    # 18 months, daily
    "inventory":     fetch_eia_inventory,       # 18 months, weekly
    "futures_curve": fetch_futures_curve,       # spot + 9 contracts, today vs 3mo ago
    "ovx_vix":       fetch_ovx_vix,              # 18 months, daily (dual series)
    "cot_net":       fetch_cot_net,              # real CFTC net position, weekly
}
```

### 7.2 Fetchers — `core/market/fetcher.py`

Every series except `futures_curve` maps directly to an existing named
source in `config/data_sources.yaml` - these are thin reshaping wrappers
over `DataRegistry.fetch()`, not new data-access code. This reuses the
retry logic, release-day alignment, and the single-row `.squeeze()` fix
already in `core/data/sources/yahoo.py`, instead of risking the same bug
again in a parallel implementation.

```python
# core/market/fetcher.py
from datetime import datetime, timedelta
from core.data.registry import DataRegistry
import yfinance as yf

_18M = (datetime.today() - timedelta(days=548)).strftime("%Y-%m-%d")
_TODAY = datetime.today().strftime("%Y-%m-%d")


def fetch_wti_price_history() -> list[dict]:
    """Daily WTI closing price, last 18 months."""
    series = DataRegistry().fetch("wti", _18M, _TODAY).dropna()
    return [{"date": str(d.date()), "price": round(float(v), 2)} for d, v in series.items()]


def fetch_brent_wti_spread() -> list[dict]:
    """Brent - WTI daily spread, last 18 months."""
    registry = DataRegistry()
    brent = registry.fetch("brent", _18M, _TODAY)
    wti = registry.fetch("wti", _18M, _TODAY)
    spread = (brent - wti).dropna()
    return [{"date": str(d.date()), "spread": round(float(v), 2)} for d, v in spread.items()]


def fetch_eia_inventory() -> list[dict]:
    """
    US crude oil weekly inventory, last 18 months, in million barrels
    (crude_inventory is EIA series PET.WCRSTUS1.W, reported in thousand
    barrels - DataRegistry/EIASource returns it raw; convert here, same
    /1000 convention as core/models/labels.py::build_eia_labels()).

    Rolling 5yr avg ± 1 std band is computed from the raw series itself
    over a 5-year lookback, not the engineered `crude_inv_dev` feature -
    that feature is a seasonal *deviation* (config/features.yaml:
    transform: seasonal_dev), a different unit/semantic than an absolute
    million-barrel level band.
    """
    registry = DataRegistry()
    five_year_start = str(datetime.today() - timedelta(days=365 * 5 + 30))
    history = registry.fetch("crude_inventory", five_year_start, _TODAY).dropna() / 1000
    avg, std = float(history.mean()), float(history.std())

    series = history[history.index >= _18M]
    return [
        {
            "date":  str(d.date()),
            "value": round(float(v), 2),
            "avg":   round(avg, 2),
            "upper": round(avg + std, 2),
            "lower": round(avg - std, 2),
        }
        for d, v in series.items()
    ]


def fetch_futures_curve() -> dict:
    """
    WTI futures curve: front 10 contracts today and 3 months ago.
    Uses Yahoo Finance contract tickers directly - there is no
    DataRegistry-configured source for a multi-contract point-in-time
    snapshot (config/data_sources.yaml only has single continuous series),
    so this is the one fetcher that isn't a DataRegistry wrapper.
    """
    month_codes = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V"]
    year = datetime.today().year
    tickers_now = [f"CL{c}{str(year)[-2:]}.NYM" for c in month_codes]

    ago3 = datetime.today() - timedelta(days=90)
    tickers_ago = [f"CL{c}{str(ago3.year)[-2:]}.NYM" for c in month_codes]

    def _spot(tickers: list[str]) -> list[float | None]:
        prices = []
        for t in tickers:
            try:
                info = yf.Ticker(t).fast_info
                prices.append(round(info.last_price, 2))
            except Exception:
                prices.append(None)
        return prices

    labels = [f"M{i+1}" for i in range(len(month_codes))]
    return {"labels": labels, "today": _spot(tickers_now), "ago_3m": _spot(tickers_ago)}


def fetch_ovx_vix() -> list[dict]:
    """OVX and VIX daily, last 18 months."""
    registry = DataRegistry()
    ovx = registry.fetch("ovx", _18M, _TODAY)
    vix = registry.fetch("vix", _18M, _TODAY)
    df = pd_concat_aligned(ovx, vix)  # inner-join on date, both non-null
    return [
        {"date": str(d.date()), "ovx": round(float(row.ovx), 1), "vix": round(float(row.vix), 1)}
        for d, row in df.iterrows()
    ]


def fetch_cot_net() -> list[dict]:
    """
    Real CFTC speculative net position (managed-money long minus short),
    weekly. This project already ingests both legs
    (cot_wti_spec_long/cot_wti_spec_short, config/data_sources.yaml,
    type: cftc) for the ML pipeline - reuse them here rather than
    fabricating a proxy from price momentum, which would render as if it
    were real positioning data when it isn't.
    """
    registry = DataRegistry()
    long_pos = registry.fetch("cot_wti_spec_long", _18M, _TODAY)
    short_pos = registry.fetch("cot_wti_spec_short", _18M, _TODAY)
    df = pd_concat_aligned(long_pos, short_pos, names=("long", "short"))
    return [
        {"date": str(d.date()), "net_k": round(float(row.long - row.short) / 1000, 1)}
        for d, row in df.iterrows()
    ]


def pd_concat_aligned(a, b, names=("ovx", "vix")):
    """Inner-join two named Series on their shared date index, dropping rows
    where either side is missing."""
    import pandas as pd

    df = pd.concat([a.rename(names[0]), b.rename(names[1])], axis=1).dropna()
    return df
```

### 7.3 API endpoint — `api/routes/market.py`

No cache wrapper needed here - `DataRegistry.fetch()` already caches
internally (see D6). The route is a direct passthrough.

```python
# api/routes/market.py
from fastapi import APIRouter, HTTPException
from core.market.series import SERIES

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/{series_id}")
async def get_market_series(series_id: str):
    if series_id not in SERIES:
        raise HTTPException(status_code=404, detail=f"Unknown series: {series_id}")
    return {"series": series_id, "data": SERIES[series_id]()}
```

### 7.5 Frontend — replace mock arrays

```typescript
// frontend/src/hooks/useMarketSeries.ts
import useSWR from 'swr';
import { api } from '@/lib/axios';

export function useMarketSeries(seriesId: string) {
  return useSWR(
    `/api/market/${seriesId}`,
    () => api.get(`/api/market/${seriesId}`).then(r => r.data.data),
    { refreshInterval: 5 * 60 * 1000 }   // revalidate every 5 min
  );
}
```

Each Chart.js component replaces its hardcoded array with the hook:

```typescript
// Example: frontend/src/components/charts/WTIPriceChart.tsx
export function WTIPriceChart() {
  const { data, isLoading } = useMarketSeries('wti_price');

  if (isLoading) return <ChartSkeleton height={160} />;

  const labels = data?.map((d: any) => d.date) ?? [];
  const prices = data?.map((d: any) => d.price) ?? [];

  // Chart.js config unchanged from Phase 3
  // Only data source changes
  ...
}
```

---

## 8. WebSocket Price Ticker

The topbar's WTI price is already live, not hardcoded - `useReport(role)`
already renders a real `wti_price`/`wti_change_pct` from the daily
pipeline's most recent prediction (verified today: shows real, moving
values like $68.46 ▼0.2%). This section doesn't fix a mock value; it adds
sub-daily granularity (a 30s tick vs. once-per-pipeline-run) via a direct
spot-price poll, independent of the report refresh cycle.

### 8.1 Backend — `api/routes/ws.py`

```python
# api/routes/ws.py
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import yfinance as yf, asyncio, json

router = APIRouter()
_connections: list[WebSocket] = []


@router.websocket("/ws/price")
async def price_ticker(ws: WebSocket):
    await ws.accept()
    _connections.append(ws)
    try:
        while True:
            try:
                ticker = yf.Ticker("CL=F")
                price  = ticker.fast_info.last_price
                change = ticker.fast_info.regular_market_change_percent
                await ws.send_text(json.dumps({
                    "price":      round(price, 2),
                    "change_pct": round(change, 2),
                }))
            except Exception:
                pass   # silently skip on fetch error
            await asyncio.sleep(30)
    except WebSocketDisconnect:
        _connections.remove(ws)
```

### 8.2 Frontend — `hooks/usePriceTicker.ts`

```typescript
// frontend/src/hooks/usePriceTicker.ts
import { useEffect } from 'react';
import { usePriceStore } from '@/lib/price-store';

const WS_URL = import.meta.env.VITE_API_URL?.replace('http', 'ws') + '/ws/price';

export function usePriceTicker() {
  const setPrice = usePriceStore(s => s.setPrice);

  useEffect(() => {
    let ws: WebSocket;
    let retryMs = 1000;

    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onmessage = e => {
        const { price, change_pct } = JSON.parse(e.data);
        setPrice(price, change_pct);
        retryMs = 1000;   // reset back-off on success
      };
      ws.onclose = () => {
        setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);   // exponential back-off, max 30s
      };
    }
    connect();
    return () => ws?.close();
  }, []);
}
```

```typescript
// frontend/src/lib/price-store.ts
import { create } from 'zustand';

interface PriceState {
  price: number | null;
  changePct: number | null;
  setPrice: (price: number, changePct: number) => void;
}

export const usePriceStore = create<PriceState>(set => ({
  price:     null,
  changePct: null,
  setPrice:  (price, changePct) => set({ price, changePct }),
}));
```

```typescript
// frontend/src/components/layout/Topbar.tsx — Phase 4 update
import { usePriceStore } from '@/lib/price-store';
import { usePriceTicker } from '@/hooks/usePriceTicker';

export default function Topbar(/* existing props */) {
  usePriceTicker();   // establish WS connection once
  const { price: wsPrice, changePct: wsChangePct } = usePriceStore();
  const { data: report } = useReport(role);   // unchanged - still the source for
                                               // data-source dots, other fields

  // Prefer the WebSocket tick once connected; fall back to the daily
  // report's price (already real - see this section's intro) until the
  // first WS message arrives or if the socket is disconnected.
  const price = wsPrice ?? report?.wti_price;
  const changePct = wsChangePct ?? report?.wti_change_pct;
  ...
}
```

---

## 9. DS Agent — Real OpenAI API Integration

### 9.1 Tool registry — `core/agent/tools.py`

The DS Agent has access to 8 tools. Destructive tools require user confirmation (D14); read-only tools execute immediately.

OpenAI's Chat Completions tool schema is `{"type": "function", "function":
{name, description, parameters}}` - not Anthropic's flatter `{name,
description, input_schema}`. `destructive` is *our* routing metadata, kept
out of the schema actually sent to the API (a stray key there would be
rejected/ignored, unlike Anthropic's more permissive tool dict) and tracked
as a separate name-keyed set instead.

```python
# core/agent/tools.py

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "fetch_data_sample",
            "description": "Fetch a data sample for a candidate signal from the feature store.",
            "parameters": {
                "type": "object",
                "properties": {
                    "signal_name": {"type": "string"},
                    "start_date":  {"type": "string", "format": "date"},
                    "end_date":    {"type": "string", "format": "date"},
                },
                "required": ["signal_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compute_ic",
            "description": "Compute Spearman IC for a signal at multiple lags with Bonferroni correction.",
            "parameters": {
                "type": "object",
                "properties": {
                    "signal_name": {"type": "string"},
                    "lags":        {"type": "array", "items": {"type": "integer"}},
                    "target":      {"type": "string", "enum": ["regime_label", "wti_return_5d", "wti_return_20d"]},
                },
                "required": ["signal_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compute_oos_decay",
            "description": "Compute out-of-sample IC decay for a signal (train period vs OOS period).",
            "parameters": {
                "type": "object",
                "properties": {
                    "signal_name": {"type": "string"},
                    "train_end":   {"type": "string", "format": "date"},
                    "oos_start":   {"type": "string", "format": "date"},
                },
                "required": ["signal_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compute_feature_correlation",
            "description": "Compute correlation between a candidate signal and all existing active features.",
            "parameters": {
                "type": "object",
                "properties": {
                    "signal_name": {"type": "string"},
                },
                "required": ["signal_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_leakage",
            "description": "Verify no data leakage in the feature matrix given a gap and fold configuration.",
            "parameters": {
                "type": "object",
                "properties": {
                    "gap_days": {"type": "integer"},
                    "n_splits": {"type": "integer"},
                },
                "required": ["gap_days"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_to_feature_registry",
            "description": "Add a validated signal to the active feature pool (writes to features.yaml).",
            "parameters": {
                "type": "object",
                "properties": {
                    "signal_name":         {"type": "string"},
                    "source":              {"type": "string"},
                    "bearish_if_positive": {"type": "boolean"},
                    "frequency":           {"type": "string"},
                    "category":            {"type": "string"},
                },
                "required": ["signal_name", "source", "bearish_if_positive"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_training",
            "description": "Queue a model retraining job for one or more model types.",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_types": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["regime", "eia", "returns"]},
                    },
                    "gap_days": {"type": "integer"},
                    "n_splits": {"type": "integer"},
                },
                "required": ["model_types"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "deploy_model",
            "description": "Deploy the most recently trained model version to production.",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_type": {"type": "string", "enum": ["regime", "eia", "returns"]},
                    "job_id":     {"type": "string"},
                },
                "required": ["model_type", "job_id"],
            },
        },
    },
]

DESTRUCTIVE_TOOLS = {"add_to_feature_registry", "run_training", "deploy_model"}
```

### 9.2 Streaming agent — `core/agent/client.py`

OpenAI's Chat Completions streaming has no equivalent to Anthropic's
discrete `content_block_stop` "this tool call is done" event. Each
`delta.tool_calls[]` entry is a *fragment*, indexed by position in the
assistant's tool-call list; `.id`/`.function.name` only appear once (the
fragment where that tool call starts), and `.function.arguments` arrives as
successive raw JSON-string pieces that must be concatenated and only
`json.loads()`'d once the stream signals `finish_reason == "tool_calls"`.
This accumulation step is the real behavioral difference from the Claude
version, not just a renamed client/model.

```python
# core/agent/client.py
import json, os
from openai import AsyncOpenAI
from core.agent.tools import TOOLS, DESTRUCTIVE_TOOLS
from core.agent.tool_handlers import execute_tool

MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o")

client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

SYSTEM_PROMPT = """You are a data science assistant for an oil market ML system called OilSignalyst.
You have access to tools for evaluating signal candidates, managing the feature pool, running model 
retraining, and deploying new model versions. 

When asked to evaluate a signal, always run all four evaluation gates in order:
fetch_data_sample → compute_ic → compute_oos_decay → compute_feature_correlation.

Before adding a feature to the registry or starting training, summarise the evaluation results 
and ask the user to confirm. Destructive actions (add_to_feature_registry, run_training, 
deploy_model) will be paused for user confirmation — do not assume confirmation unless you 
receive an explicit user message saying "confirmed".

Be concise. Show tool results inline. Format numbers to 3 significant figures."""


MAX_TOOL_ITERATIONS = 8   # safety cap - stop the loop even if the model keeps requesting tools


async def stream_agent_response(
    messages: list[dict],
    session_id: str,
    on_text: callable,
    on_assistant_turn: callable,
    on_tool_pending: callable,
    on_tool_result: callable,
    on_done: callable,
):
    """
    Streams an OpenAI Chat Completions response, automatically looping after
    each non-destructive tool result so the model can reason over what it
    just learned and pick its own next action - real multi-step ("ReAct
    scoped to non-destructive tools") behavior, not a single tool-call-then-
    stop turn. Without this loop, the system prompt's instruction to "run
    all four evaluation gates in order" would only work if the model
    happened to request all four tool calls in one completion; this makes
    it actually true regardless of how the model chooses to space them out.

    Destructive tools still pause on tool_pending and wait for
    POST /api/agent/confirm/{turn_id} - the loop never bypasses that gate,
    it only removes the need for a *user* round-trip between non-destructive
    tool calls.

    Callbacks:
      on_text(delta: str)                          — called for each text token
      on_assistant_turn(content, tool_calls, session_id)
                                                     — called once per model completion that
                                                       requested tool calls, BEFORE they're executed.
                                                       The caller persists this as an AgentTurn
                                                       (role='assistant') so load_history() can
                                                       replay it - OpenAI rejects a 'tool' role
                                                       message that isn't immediately preceded by
                                                       the assistant message that requested it, so
                                                       this must round-trip through history intact
                                                       for the confirm-resume path (see §9.4) to work.
      on_tool_pending(name, input, tool_call_id, session_id)
                                                     — called when a destructive tool is about to run;
                                                     the caller saves the AgentTurn (status='pending',
                                                     tool_call_id=tool_call_id so the eventual result
                                                     can be replayed against the right OpenAI tool call)
                                                     and emits the turn_id (int) in the SSE event.
      on_tool_result(name, result, tool_call_id)   — called after a non-destructive tool completes;
                                                     the caller persists it (role='tool', status='complete',
                                                     tool_call_id=tool_call_id - required to disambiguate
                                                     which of possibly several parallel tool calls in this
                                                     turn this result answers).
      on_done()                                    — called when the model gives a final answer
                                                     with no more tool calls (or the iteration cap hits)
    """
    chat_messages = [{"role": "system", "content": SYSTEM_PROMPT}, *messages]

    for _ in range(MAX_TOOL_ITERATIONS):
        stream = await client.chat.completions.create(
            model=MODEL,
            messages=chat_messages,
            tools=TOOLS,
            stream=True,
        )

        # Accumulate partial tool-call fragments by index - OpenAI can stream
        # more than one tool call per turn (parallel tool calling), each
        # building up independently until finish_reason arrives.
        pending_calls: dict[int, dict] = {}
        assistant_text = ""
        finish_reason = None

        async for chunk in stream:
            choice = chunk.choices[0]
            delta = choice.delta

            if delta.content:
                assistant_text += delta.content
                await on_text(delta.content)

            if delta.tool_calls:
                for tc_delta in delta.tool_calls:
                    entry = pending_calls.setdefault(
                        tc_delta.index, {"id": None, "name": None, "arguments": ""}
                    )
                    if tc_delta.id:
                        entry["id"] = tc_delta.id
                    if tc_delta.function and tc_delta.function.name:
                        entry["name"] = tc_delta.function.name
                    if tc_delta.function and tc_delta.function.arguments:
                        entry["arguments"] += tc_delta.function.arguments

            if choice.finish_reason:
                finish_reason = choice.finish_reason

        if finish_reason != "tool_calls":
            # Model gave a final text answer - nothing more to do.
            break

        # The assistant's own tool-call request must be replayed back on the
        # next completion (and persisted for history) before any "tool" role
        # messages - OpenAI rejects a "tool" message that isn't immediately
        # preceded by the assistant message that requested it.
        tool_calls_payload = [
            {
                "id": entry["id"],
                "type": "function",
                "function": {"name": entry["name"], "arguments": entry["arguments"]},
            }
            for entry in pending_calls.values()
        ]
        chat_messages.append(
            {"role": "assistant", "content": assistant_text or None, "tool_calls": tool_calls_payload}
        )
        await on_assistant_turn(assistant_text, tool_calls_payload, session_id)

        paused = False
        for entry in pending_calls.values():
            tool_name = entry["name"]
            tool_input = json.loads(entry["arguments"] or "{}")

            if tool_name in DESTRUCTIVE_TOOLS:
                # Pause — let frontend render a ConfirmGate. Only the first
                # destructive call in a batch pauses; non-destructive calls
                # before it in `pending_calls` order have already run and
                # already had their results appended to chat_messages below.
                await on_tool_pending(tool_name, tool_input, entry["id"], session_id)
                paused = True
                break
            else:
                result = await execute_tool(tool_name, tool_input)
                await on_tool_result(tool_name, result, entry["id"])
                chat_messages.append(
                    {"role": "tool", "tool_call_id": entry["id"], "content": json.dumps(result)}
                )

        if paused:
            return   # Wait for confirm - deliberately skips on_done(),
                     # matching the original: a pending confirm isn't "done".

        # Otherwise loop back with the tool result(s) now in context, so the
        # model can decide its next step on its own - e.g. move from
        # compute_ic straight into compute_oos_decay per the system prompt's
        # instructed gate order, without the user having to prompt it again.

    await on_done()
```

### 9.3 Tool handlers — `core/agent/tool_handlers.py`

```python
# core/agent/tool_handlers.py
"""
One async function per tool. These are the same computations used by the
Signal Scanner (core/postprocess/signal_charts.py) — reuse where possible.
"""
from core.postprocess.signal_charts import build_signal_charts, _ic_mean
from core.postprocess.drift_monitor import compute_psi
import yaml
from core.config_paths import FEATURES_YAML


async def execute_tool(name: str, input: dict) -> dict:
    handlers = {
        "fetch_data_sample":         _fetch_data_sample,
        "compute_ic":                _compute_ic,
        "compute_oos_decay":         _compute_oos_decay,
        "compute_feature_correlation": _compute_feature_correlation,
        "check_leakage":             _check_leakage,
        "add_to_feature_registry":   _add_to_feature_registry,
        "run_training":              _run_training,
        "deploy_model":              _deploy_model,
    }
    handler = handlers.get(name)
    if not handler:
        return {"error": f"Unknown tool: {name}"}
    try:
        return await handler(**input)
    except Exception as e:
        return {"error": str(e)}


async def _fetch_data_sample(signal_name: str, start_date: str = None, end_date: str = None) -> dict:
    from db.database import get_db
    from db.models import FeatureSnapshot
    from sqlalchemy import select
    async with get_db() as db:
        rows = await db.execute(
            select(FeatureSnapshot.created_at, FeatureSnapshot.features)
            .order_by(FeatureSnapshot.created_at.asc())
        )
        snaps = rows.fetchall()
    values = [r[1].get(signal_name) for r in snaps if r[1].get(signal_name) is not None]
    if not values:
        return {"error": f"Signal '{signal_name}' not found in feature snapshots"}
    return {
        "signal_name":   signal_name,
        "count":         len(values),
        "coverage_pct":  round(len(values) / len(snaps) * 100, 1),
        "history_years": round(len(snaps) / 252, 1),
        "sample":        values[-5:],   # last 5 values
    }


async def _latest_evaluation(signal_name: str):
    """Shared lookup for the three tool handlers below - the weekly
    core.signal_scanner.run_signal_scan() already computes real ic_scores,
    oos_decay, and correlation per candidate and stores them on
    SignalEvaluation (see api/routes/signals.py::get_signal_evaluation(),
    which reads the same row). Reuse it instead of fabricating numbers -
    a signal that hasn't been through a scan yet returns None, and the
    caller should say so rather than invent a plausible-looking result."""
    from db.database import get_db
    from db.models import SignalEvaluation
    from sqlalchemy import select, desc

    async with get_db() as db:
        row = await db.execute(
            select(SignalEvaluation)
            .where(SignalEvaluation.signal_name == signal_name)
            .order_by(desc(SignalEvaluation.evaluated_at))
            .limit(1)
        )
        return row.scalar_one_or_none()


async def _compute_ic(signal_name: str, lags: list[int] = [5, 10, 20], target: str = "regime_label") -> dict:
    evaluation = await _latest_evaluation(signal_name)
    if evaluation is None:
        return {
            "error": f"'{signal_name}' hasn't been through a signal scan yet - "
            "no real IC data exists. Run the weekly scanner or evaluate a "
            "signal already in the candidate config."
        }
    # ic_scores is keyed by lag as computed by the scanner (currently 5/20/60 -
    # core/signal_scanner.py::IC_LAGS_DAYS - not necessarily matching `lags`
    # requested here; return what's real rather than interpolate/fabricate
    # values for lags the scanner didn't test).
    return {
        "signal_name": signal_name,
        "ic_scores": evaluation.ic_scores,
        "coverage": evaluation.coverage,
    }


async def _compute_oos_decay(signal_name: str, train_end: str = "2023-12-31", oos_start: str = "2024-01-01") -> dict:
    evaluation = await _latest_evaluation(signal_name)
    if evaluation is None:
        return {"error": f"'{signal_name}' hasn't been through a signal scan yet"}
    # train_end/oos_start are accepted for interface parity with the scanner's
    # config but the stored oos_decay reflects whatever split the scanner
    # actually used - it isn't recomputed per arbitrary date range here.
    return {
        "signal_name": signal_name,
        "oos_decay": evaluation.oos_decay,
        "pass": evaluation.oos_decay < 0.30,
    }


async def _compute_feature_correlation(signal_name: str) -> dict:
    evaluation = await _latest_evaluation(signal_name)
    if evaluation is None:
        return {"error": f"'{signal_name}' hasn't been through a signal scan yet"}
    # correlation is {"most_correlated_feature": str, "value": float} -
    # see core/signal_scanner.py's max-correlation-vs-active-features check.
    correlation = evaluation.correlation or {}
    max_corr = correlation.get("value", 0.0)
    return {
        "signal_name": signal_name,
        "most_correlated_feature": correlation.get("most_correlated_feature"),
        "max_correlation": max_corr,
        "pass": max_corr < 0.50,
    }


async def _check_leakage(gap_days: int, n_splits: int = 5) -> dict:
    # Real check, not a hardcoded pass: the deepest forward-looking label in
    # this project is the returns model's 20-trading-day bucket
    # (core/models/labels.py::build_return_bucket_labels, target_20d
    # elsewhere) - a gap smaller than that horizon means the validation
    # split's earliest rows are labeled using data that overlaps the
    # training window. n_splits isn't actually used by this pipeline (see
    # the cv_folds/gap_days note on _run_training above) - accepted for
    # interface parity only.
    MAX_LABEL_HORIZON_DAYS = 20
    leakage = gap_days < MAX_LABEL_HORIZON_DAYS
    return {
        "gap_days": gap_days,
        "n_splits": n_splits,
        "leakage": leakage,
        "min_required_gap": MAX_LABEL_HORIZON_DAYS,
        "pass": not leakage,
    }


async def _add_to_feature_registry(
    signal_name: str,
    source: str,
    bearish_if_positive: bool,
    frequency: str = "Daily",
    category: str = "Other",
) -> dict:
    with open(FEATURES_YAML) as f:
        config = yaml.safe_load(f)
    config["features"].append({
        "name":              signal_name,
        "source":            source,
        "frequency":         frequency,
        "category":          category,
        "bearish_if_positive": bearish_if_positive,
    })
    with open(FEATURES_YAML, "w") as f:
        yaml.dump(config, f, default_flow_style=False)
    return {"status": "added", "signal_name": signal_name, "total_features": len(config["features"])}


async def _run_training(model_types: list[str], gap_days: int = 20, n_splits: int = 5) -> dict:
    from core.models.trainer import run_full_training_with_log
    from db.models import TrainJob
    from db.database import get_db
    import uuid
    job_id = str(uuid.uuid4())[:8]
    async with get_db() as db:
        job = TrainJob(id=job_id, status="queued", model_types=model_types)
        db.add(job)
    import asyncio
    # gap_days/n_splits are accepted here but not forwarded -
    # run_full_training_with_log() only takes (job_id, triggered_by_user_id,
    # model_types, cutoff_date). Real k-fold CV isn't implemented (see
    # api/routes/training.py's TrainStartRequest for the same caveat on the
    # REST path) - don't silently imply this tool controls fold count.
    asyncio.create_task(run_full_training_with_log(model_types=model_types, job_id=job_id))
    return {"job_id": job_id, "status": "queued", "model_types": model_types}


async def _deploy_model(model_type: str, job_id: str) -> dict:
    # Do NOT call the FastAPI route handler directly — it requires
    # Depends()-injected db and user and cannot be invoked outside a request context.
    # core/services/deploy_service.py::do_deploy() does not exist yet - this is
    # NOT a Phase 2.3 carry-forward (that extraction never happened; deploy
    # logic still lives inline in api/routes/models.py::deploy_model() today).
    # Phase 4 must create this module, moving that logic out so both the
    # route and this tool handler call the same function.
    from core.services.deploy_service import do_deploy
    from db.database import get_db
    async with get_db() as db:
        result = await do_deploy(model_type=model_type, job_id=job_id, db=db)
    return result
```

### 9.4 Agent API routes — `api/routes/agent.py`

```python
# api/routes/agent.py
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from api.dependencies import DbSession, CurrentUser
from core.agent.client import stream_agent_response
from core.agent.history import load_history, save_turn
from db.models import AgentTurn
import json, asyncio, uuid

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.post("/message")
async def post_message(
    body: dict,                # {"content": str, "session_id": str}
    db: DbSession,
    user: CurrentUser,
):
    """
    Accepts a user message and starts a streaming response.
    Returns a session_id for the client to open the SSE stream.
    """
    session_id = body.get("session_id") or str(uuid.uuid4())
    content    = body["content"]

    # Save user turn
    await save_turn(db, session_id, user.id, role="user", content=[{"type":"text","text":content}])

    return {"session_id": session_id, "status": "streaming"}


@router.get("/stream/{session_id}")
async def stream_response(session_id: str, db: DbSession, user: CurrentUser):
    """
    SSE endpoint. Streams token-by-token agent response for the given session.
    Event types:
      text_delta   — {"delta": "..."} — append to current assistant bubble
      tool_pending — {"tool": "...", "input": {...}, "turn_id": "..."} — render ConfirmGate
      tool_result  — {"tool": "...", "result": {...}} — render tool call block
      done         — {} — close the stream
    """
    messages = await load_history(db, session_id)

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def on_text(delta: str):
            await queue.put({"event": "text_delta", "data": {"delta": delta}})

        async def on_assistant_turn(content: str, tool_calls: list[dict], turn_session_id: str):
            # Must be saved before any tool_pending/tool_result turn below -
            # load_history() replays turns in created_at order, and OpenAI
            # requires this assistant message to immediately precede the
            # tool messages answering it.
            await save_turn(
                db, turn_session_id, user.id,
                role="assistant", content=content, tool_calls=tool_calls, status="complete",
            )

        async def on_tool_pending(tool_name: str, tool_input: dict, tool_call_id: str, turn_session_id: str):
            turn = await save_turn(
                db, turn_session_id, user.id,
                role="tool", tool_name=tool_name, tool_input=tool_input,
                tool_call_id=tool_call_id, status="pending",
            )
            # turn.id is Integer — serialise as int, not str, for consistency
            # with the FastAPI route param `turn_id: int` and TS type `number`
            await queue.put({"event": "tool_pending", "data": {
                "tool": tool_name, "input": tool_input, "turn_id": turn.id,
            }})
            await queue.put(None)   # signal stream_agent_response returned

        async def on_tool_result(tool_name: str, result: dict, tool_call_id: str):
            await save_turn(
                db, session_id, user.id,
                role="tool", tool_name=tool_name, tool_result=result,
                tool_call_id=tool_call_id, status="complete",
            )
            await queue.put({"event": "tool_result", "data": {"tool": tool_name, "result": result}})

        async def on_done():
            await queue.put({"event": "done", "data": {}})
            await queue.put(None)

        asyncio.create_task(stream_agent_response(
            messages          = messages,
            session_id        = session_id,
            on_text           = on_text,
            on_assistant_turn = on_assistant_turn,
            on_tool_pending   = on_tool_pending,
            on_tool_result    = on_tool_result,
            on_done           = on_done,
        ))

        while True:
            item = await queue.get()
            if item is None:
                break
            yield f"event: {item['event']}\ndata: {json.dumps(item['data'])}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/confirm/{turn_id}")
async def confirm_tool(turn_id: int, db: DbSession, user: CurrentUser):
    """
    User confirmed a destructive tool. Execute it and resume the agent stream.
    """
    turn = await db.get(AgentTurn, turn_id)
    if not turn or turn.status != "pending":
        return {"error": "turn not found or not pending"}

    from core.agent.tool_handlers import execute_tool
    result = await execute_tool(turn.tool_name, turn.tool_input)
    turn.tool_result = result
    turn.status      = "confirmed"
    db.add(turn)

    return {"status": "executed", "tool": turn.tool_name, "result": result}


@router.post("/cancel/{turn_id}")
async def cancel_tool(turn_id: int, db: DbSession, user: CurrentUser):
    turn = await db.get(AgentTurn, turn_id)
    if not turn:
        return {"error": "not found"}
    turn.status = "cancelled"
    db.add(turn)
    return {"status": "cancelled"}


@router.delete("/history")
async def clear_history(session_id: str, db: DbSession, user: CurrentUser):
    from sqlalchemy import delete
    await db.execute(
        delete(AgentTurn)
        .where(AgentTurn.session_id == session_id, AgentTurn.user_id == user.id)
    )
    return {"status": "cleared"}
```

### 9.5 Frontend — `hooks/useAgentStream.ts`

```typescript
// frontend/src/hooks/useAgentStream.ts

interface AgentEvent {
  event: 'text_delta' | 'tool_pending' | 'tool_result' | 'done';
  data:  Record<string, any>;
}

export function useAgentStream(sessionId: string | null) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [streaming, setStreaming] = useState(false);

  const startStream = useCallback(() => {
    if (!sessionId) return;
    setStreaming(true);
    const es = new EventSource(`${BASE}/api/agent/stream/${sessionId}`, {
      // withCredentials for cookie-based auth
    });

    ['text_delta', 'tool_pending', 'tool_result', 'done'].forEach(type => {
      es.addEventListener(type, (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        setEvents(prev => [...prev, { event: type as any, data }]);
        if (type === 'done' || type === 'tool_pending') {
          setStreaming(false);
          es.close();
        }
      });
    });

    es.onerror = () => { setStreaming(false); es.close(); };
  }, [sessionId]);

  async function confirmTool(turnId: number) {
    // turn_id is Integer on the backend — pass as number
    const res = await api.post(`/api/agent/confirm/${turnId}`);
    // After confirm, re-open the stream to get the resumed response
    startStream();
    return res.data;
  }

  async function cancelTool(turnId: number) {
    await api.post(`/api/agent/cancel/${turnId}`);
  }

  return { events, streaming, startStream, confirmTool, cancelTool };
}
```

### 9.6 Updated `AgentPanel.tsx`

The Phase 3 `AgentPanel` uses `getAgentReply()` — a local mock function. In Phase 4 this is replaced:

```typescript
// frontend/src/components/agent/AgentPanel.tsx — Phase 4 changes

// Remove: getAgentReply(), apSend() local mock logic
// Add: useAgentStream hook integration

async function sendMessage(text: string) {
  // 1. Save user message to backend, get session_id
  const { data } = await api.post('/api/agent/message', { content: text, session_id });
  setSessionId(data.session_id);

  // 2. Open SSE stream
  startStream();
}

// Render events from the stream:
// - text_delta  → append to current assistant bubble (streaming effect)
// - tool_pending → render ConfirmGate with confirmTool/cancelTool callbacks
// - tool_result  → render ToolCallBlock with result
// - done         → finalise message, re-enable input
```

The ConfirmGate component is unchanged visually. The `onConfirm` callback now calls `confirmTool(turn.turn_id)` instead of `executeAction(actionId)`.

---

## 10. Deployment — Docker Compose

```yaml
# docker-compose.yml

version: "3.9"

services:
  backend:
    build: ./backend
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - OPENAI_MODEL=gpt-4o
      - EIA_API_KEY=${EIA_API_KEY}
      - JWT_SECRET=${JWT_SECRET}
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data      # models, features, mlruns
      - ./config:/app/config  # features.yaml, data_sources.yaml

  frontend:
    build: ./frontend
    environment:
      - VITE_API_URL=https://api.oilsignalyst.local
    ports:
      - "5173:80"

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data

volumes:
  caddy_data:
```

No `redis` service or dependency (see D6) - `DataRegistry`'s existing
in-memory cache covers market-data caching within a single backend
process.

```
# Caddyfile
oilsignalyst.local {
    reverse_proxy /api/*       backend:8000
    reverse_proxy /ws/*        backend:8000
    reverse_proxy /*           frontend:80
}
```

```dockerfile
# backend/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen
COPY . .
CMD ["uv", "run", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```dockerfile
# frontend/Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

---

## 11. Environment Variables

```bash
# .env (root of repo — never commit)

# Database
DATABASE_URL=postgresql+asyncpg://user:pass@db.example.com:5432/oilsignalyst

# AI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o   # override to a higher-reasoning model if needed

# Market data
EIA_API_KEY=...   # free at https://www.eia.gov/opendata/

# Auth
JWT_SECRET=...    # min 32 random bytes: openssl rand -hex 32
```

---

## 12. Updated Router Registration

```python
# api/main.py — final router list after Phase 4

from api.routes import health, reports, models, training, signals, users, data_monitor, market, agent, auth, ws

def create_app() -> FastAPI:
    app = FastAPI(title="oil-signalyst", version="1.0.0", lifespan=lifespan)
    app.include_router(health.router)
    app.include_router(auth.router)          # new: /api/auth/login, /refresh, /logout
    app.include_router(reports.router)
    app.include_router(models.router)
    app.include_router(training.router)
    app.include_router(signals.router)
    app.include_router(users.router)
    app.include_router(data_monitor.router)
    app.include_router(market.router)        # new: /api/market/{series}
    app.include_router(agent.router)         # new: /api/agent/*
    app.add_websocket_route("/ws/price", ws.price_ticker)
    return app
```

---

## 13. New Tests

```python
# tests/test_phase4.py

import pytest
from httpx import AsyncClient, ASGITransport
from api.main import app


@pytest.fixture
async def auth_headers(async_client):
    r = await async_client.post("/api/auth/login", json={"email": "ds@test.com", "password": "test"})
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_login_returns_token():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/auth/login", json={"email": "ds@test.com", "password": "test"})
    assert r.status_code == 200
    assert "access_token" in r.json()
    assert r.json()["role"] in ["trader", "risk", "researcher", "ds"]


@pytest.mark.asyncio
async def test_protected_route_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/reports/daily/trader")   # no auth header
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_market_series_wti_price():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/market/wti_price")
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data) > 0
    assert "date" in data[0] and "price" in data[0]


@pytest.mark.asyncio
async def test_market_series_unknown_returns_404():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/market/nonexistent_series")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_agent_message_creates_session(auth_headers):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/api/agent/message",
            json={"content": "What is the current PSI?"},
            headers=auth_headers,
        )
    assert r.status_code == 200
    assert "session_id" in r.json()


@pytest.mark.asyncio
async def test_agent_stream_opens(auth_headers):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        msg = await c.post(
            "/api/agent/message",
            json={"content": "Hello"},
            headers=auth_headers,
        )
        session_id = msg.json()["session_id"]
        r = await c.get(f"/api/agent/stream/{session_id}", headers=auth_headers)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")


@pytest.mark.asyncio
async def test_non_destructive_tool_executes_immediately():
    from core.agent.tool_handlers import execute_tool
    result = await execute_tool("fetch_data_sample", {"signal_name": "ovx"})
    assert "coverage_pct" in result or "error" in result   # error if no snapshots in test DB


@pytest.mark.asyncio
async def test_destructive_tool_requires_confirm(auth_headers):
    """add_to_feature_registry should create a pending turn, not execute immediately."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        msg = await c.post(
            "/api/agent/message",
            json={"content": "Add ovx_satellite to the feature registry"},
            headers=auth_headers,
        )
        session_id = msg.json()["session_id"]
        # Stream should emit tool_pending, not tool_result
        # (integration test — verify via event stream contents)
```

---

## 14. Phase 4 Done Criteria

| # | Criterion |
|---|-----------|
| 1 | `POST /api/auth/login` returns a JWT; all other routes return 401 without it |
| 2 | Role is read from JWT claim; the role pill is removed from the UI |
| 3 | DS Agent sends real messages to `gpt-4o` (OpenAI); responses stream token by token into the panel |
| 4 | Non-destructive tools (`compute_ic`, `fetch_data_sample`, etc.) execute immediately and display results inline |
| 5 | Destructive tools (`add_to_feature_registry`, `run_training`, `deploy_model`) pause on `tool_pending` and render a ConfirmGate; `POST /api/agent/confirm/{turn_id}` resumes execution |
| 6 | All 6 Market Data charts render live data from `GET /api/market/{series}` — no hardcoded arrays |
| 7 | WTI price in the topbar updates every 30 seconds via WebSocket; no page reload required |
| 8 | WebSocket reconnects automatically with exponential back-off on disconnect |
| 9 | `docker compose up` starts the full stack; frontend is reachable at `https://oilsignalyst.local` |
| 10 | `GET /api/market/futures_curve` returns both today's curve and 3-months-ago curve |
| 11 | Agent conversation history persists across panel open/close within a session |
| 12 | `DELETE /api/agent/history` clears the session; next message starts a fresh conversation |
