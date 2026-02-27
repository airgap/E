/**
 * Remote Access API
 *
 * Client-side API for remote access configuration and monitoring.
 */

import type { RemoteSession, RemoteAccessMode } from '@e/shared';

const API_BASE = '/api/remote-access';

export interface RemoteAccessConfigData {
  enabled: boolean;
  tailscaleEnabled: boolean;
  sshTunnelEnabled: boolean;
  requireAuth: boolean;
}

export interface TailscaleStatusData {
  available: boolean;
  running: boolean;
  hostname?: string;
  ip?: string;
  error?: string;
}

export interface SSHTunnelCommandData {
  command: string;
  localPort: number;
  remoteHost?: string;
}

export interface RemoteAccessStatusResponse {
  config: RemoteAccessConfigData;
  tailscaleStatus: TailscaleStatusData;
  sshTunnel: SSHTunnelCommandData;
  activeClients: number;
  remoteClients: number;
}

/**
 * Get remote access configuration and status
 */
export async function getRemoteAccessStatus(): Promise<RemoteAccessStatusResponse> {
  const res = await fetch(`${API_BASE}/config`, {
    headers: {
      'X-CSRF-Token': await getCsrfToken(),
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch remote access status: ${res.statusText}`);
  }

  const json = await res.json();
  return json.data;
}

/**
 * Update remote access configuration
 */
export async function updateRemoteAccessConfig(
  config: Partial<RemoteAccessConfigData>,
): Promise<void> {
  const res = await fetch(`${API_BASE}/config`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': await getCsrfToken(),
    },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    throw new Error(`Failed to update remote access config: ${res.statusText}`);
  }
}

/**
 * Get Tailscale status
 */
export async function getTailscaleStatus(): Promise<TailscaleStatusData> {
  const res = await fetch(`${API_BASE}/tailscale/status`, {
    headers: {
      'X-CSRF-Token': await getCsrfToken(),
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Tailscale status: ${res.statusText}`);
  }

  const json = await res.json();
  return json.data;
}

/**
 * Configure Tailscale serve/funnel
 */
export async function configureTailscale(funnel = false): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE}/tailscale/configure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': await getCsrfToken(),
    },
    body: JSON.stringify({ funnel }),
  });

  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Failed to configure Tailscale');
  }

  const json = await res.json();
  return json.data;
}

/**
 * Stop Tailscale serve/funnel
 */
export async function stopTailscale(): Promise<void> {
  const res = await fetch(`${API_BASE}/tailscale/stop`, {
    method: 'POST',
    headers: {
      'X-CSRF-Token': await getCsrfToken(),
    },
  });

  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || 'Failed to stop Tailscale');
  }
}

/**
 * Get SSH tunnel command
 */
export async function getSSHTunnelCommand(remoteHost?: string): Promise<SSHTunnelCommandData> {
  const url = new URL(`${API_BASE}/ssh-tunnel`, window.location.origin);
  if (remoteHost) {
    url.searchParams.set('host', remoteHost);
  }

  const res = await fetch(url.toString(), {
    headers: {
      'X-CSRF-Token': await getCsrfToken(),
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch SSH tunnel command: ${res.statusText}`);
  }

  const json = await res.json();
  return json.data;
}

/**
 * Get list of active remote clients
 */
export async function getRemoteClients(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/clients`, {
    headers: {
      'X-CSRF-Token': await getCsrfToken(),
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch remote clients: ${res.statusText}`);
  }

  const json = await res.json();
  return json.data;
}

/**
 * Get CSRF token (cached)
 */
let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;

  const res = await fetch('/api/auth/csrf-token');
  if (!res.ok) {
    throw new Error('Failed to fetch CSRF token');
  }

  const json = await res.json();
  csrfToken = json.data.token;
  if (!csrfToken) {
    throw new Error('CSRF token is null');
  }
  return csrfToken;
}
