/**
 * Remote workspace client API (LYK-1115).
 *
 * Drives the SSH bootstrap on the LOCAL server, then retargets the client to the
 * forwarded remote origin via connectToRemote(). Control calls must always hit
 * the local server (not the remote we're connecting to), so they use a local
 * base that ignores the remote override.
 */
import { connectToRemote, disconnectFromRemote, getCsrfToken } from './client';

export type WorkspaceAuthMethod = 'key-file' | 'agent-forwarding';

export interface WorkspaceHost {
  id: string;
  label?: string;
  hostname: string;
  port: number;
  user: string;
  authMethod: WorkspaceAuthMethod;
  keyPath?: string;
}

export interface WorkspaceSession {
  hostId: string;
  hostname: string;
  localOrigin: string;
  localPort: number;
  remotePort: number;
  remotePid: number | null;
  startedAt: number;
}

/** Always target the local E server, even while connected to a remote. */
function localBase(): string {
  if (typeof window !== 'undefined') {
    const port = (window as { __TAURI_SIDECAR_PORT__?: number }).__TAURI_SIDECAR_PORT__;
    if (port) return `http://localhost:${port}/api`;
  }
  return '/api';
}

async function lf<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const csrf = getCsrfToken();
  if (csrf && init.method && init.method !== 'GET') headers['X-CSRF-Token'] = csrf;
  const res = await fetch(`${localBase()}/remote-workspace${path}`, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export async function listHosts(): Promise<WorkspaceHost[]> {
  return (await lf<{ hosts: WorkspaceHost[] }>('/hosts')).hosts;
}
export async function saveHost(host: Partial<WorkspaceHost>): Promise<WorkspaceHost[]> {
  return (await lf<{ hosts: WorkspaceHost[] }>('/hosts', { method: 'POST', body: JSON.stringify(host) }))
    .hosts;
}
export async function deleteHost(id: string): Promise<WorkspaceHost[]> {
  return (
    await lf<{ hosts: WorkspaceHost[] }>(`/hosts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  ).hosts;
}
export async function remoteStatus(): Promise<WorkspaceSession | null> {
  return (await lf<{ session: WorkspaceSession | null }>('/status')).session;
}

/** Bootstrap + tunnel the host, point the client at it, reload into the remote. */
export async function connectHost(id: string): Promise<WorkspaceSession> {
  const { session } = await lf<{ session: WorkspaceSession }>('/connect', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
  await connectToRemote(session.localOrigin);
  if (typeof location !== 'undefined') location.reload();
  return session;
}

/** Tear down the remote session and drop back to the local workspace. */
export async function disconnectHost(): Promise<void> {
  try {
    await lf('/disconnect', { method: 'POST' });
  } finally {
    disconnectFromRemote();
    if (typeof location !== 'undefined') location.reload();
  }
}
