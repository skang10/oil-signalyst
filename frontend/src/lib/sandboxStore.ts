/**
 * A tiny in-memory store for sandboxes created through the New-sandbox flow in
 * mock mode. The base tree (`MOCK_SANDBOXES`) is static; anything the user spins
 * up this session is prepended here so it shows up in the list (under "training
 * now"). Not persisted — a reload clears it, same as the rest of mock mode.
 */
import type { WorkbenchSandbox } from '@/lib/sandboxModel';

let created: WorkbenchSandbox[] = [];
const listeners = new Set<() => void>();

export function getCreatedSandboxes(): WorkbenchSandbox[] {
  return created;
}

export function addCreatedSandbox(s: WorkbenchSandbox): void {
  created = [s, ...created];
  listeners.forEach((notify) => notify());
}

export function subscribeCreatedSandboxes(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
