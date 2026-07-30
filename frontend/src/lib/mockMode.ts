/**
 * Dev-only toggle deciding whether the API layer serves the local mock
 * fixtures (`mockData.ts`) or hits the real backend. Persisted to localStorage
 * and exposed as an external store so a banner can subscribe and every reader
 * flips together. Hard-off outside `import.meta.env.DEV` — production never
 * mocks, regardless of any stale localStorage value.
 */
const KEY = 'workbench:mockData';
export const mockAvailable = import.meta.env.DEV;

let enabled = readInitial();
const listeners = new Set<() => void>();

function readInitial(): boolean {
  if (!mockAvailable) return false;
  const stored = localStorage.getItem(KEY);
  if (stored === null) return true; // default ON in dev — the pipeline is idle locally
  return stored === '1';
}

export function isMockMode(): boolean {
  return enabled;
}

export function setMockMode(value: boolean): void {
  if (!mockAvailable || value === enabled) return;
  enabled = value;
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    // private mode / storage disabled — keep the in-memory value
  }
  listeners.forEach((notify) => notify());
}

export function subscribeMockMode(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
