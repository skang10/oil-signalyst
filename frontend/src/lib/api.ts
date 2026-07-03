const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// Access token lives in memory only (not localStorage) - an XSS payload
// that can run JS can already call fetch with in-memory state, but
// localStorage additionally survives and is trivially exfiltratable at
// leisure. The refresh token is an httpOnly cookie instead (never visible
// to JS at all) - see api/routes/auth.py.
let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}
// Exposed read-only for the one route that can't use the Authorization
// header (EventSource can't set custom headers - see useAgentStream.ts).
export function getAccessToken(): string | null {
  return accessToken;
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  // Dedupe concurrent 401s (e.g. several hooks firing at once on load) into
  // a single refresh call rather than one per failed request.
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = await res.json();
        setAccessToken(data.access_token);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function request<T>(path: string, init?: RequestInit, _retried = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } });

  if (res.status === 401 && !_retried) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, init, true);
    setAccessToken(null);
    window.location.href = '/login';
    throw new Error('401 - session expired');
  }

  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
};

export { BASE };
