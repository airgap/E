/**
 * Remote Access Service
 *
 * Handles Tailscale integration and SSH tunnel generation for secure remote access.
 */

import { execSync } from 'child_process';
import { getDb } from '../db/database';

export interface RemoteAccessConfig {
  enabled: boolean;
  tailscaleEnabled: boolean;
  sshTunnelEnabled: boolean;
  requireAuth: boolean; // Always true for remote connections
}

export interface TailscaleStatus {
  available: boolean;
  running: boolean;
  hostname?: string;
  ip?: string;
  error?: string;
}

export interface SSHTunnelCommand {
  command: string;
  localPort: number;
  remoteHost?: string;
}

export interface RemoteClient {
  id: string;
  origin: string;
  connectedAt: number;
  isRemote: boolean;
  userAgent?: string;
}

// Active remote connections (in-memory tracking)
const remoteClients = new Map<string, RemoteClient>();

/**
 * Get remote access configuration from database
 */
export function getRemoteAccessConfig(): RemoteAccessConfig {
  const db = getDb();

  // Check if remote access is enabled
  const enabled = getSetting('remoteAccessEnabled', true);
  const tailscaleEnabled = getSetting('tailscaleEnabled', true);
  const sshTunnelEnabled = getSetting('sshTunnelEnabled', true);

  return {
    enabled,
    tailscaleEnabled,
    sshTunnelEnabled,
    requireAuth: true, // Always require auth for remote access
  };
}

/**
 * Update remote access configuration
 */
export function updateRemoteAccessConfig(config: Partial<RemoteAccessConfig>): void {
  const db = getDb();
  const upsert = db.query(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  if (config.enabled !== undefined) {
    upsert.run('remoteAccessEnabled', JSON.stringify(config.enabled));
  }
  if (config.tailscaleEnabled !== undefined) {
    upsert.run('tailscaleEnabled', JSON.stringify(config.tailscaleEnabled));
  }
  if (config.sshTunnelEnabled !== undefined) {
    upsert.run('sshTunnelEnabled', JSON.stringify(config.sshTunnelEnabled));
  }
}

/**
 * Check Tailscale status and availability
 */
export function getTailscaleStatus(): TailscaleStatus {
  try {
    // Check if tailscale is installed
    execSync('which tailscale', { stdio: 'ignore' });
  } catch {
    return { available: false, running: false, error: 'Tailscale not installed' };
  }

  try {
    // Get tailscale status
    const statusOutput = execSync('tailscale status --json', { encoding: 'utf8' });
    const status = JSON.parse(statusOutput);

    if (!status.Self) {
      return { available: true, running: false, error: 'Not logged in to Tailscale' };
    }

    return {
      available: true,
      running: true,
      hostname: status.Self.HostName,
      ip: status.Self.TailscaleIPs?.[0],
    };
  } catch (error: any) {
    return {
      available: true,
      running: false,
      error: `Failed to get status: ${error.message}`,
    };
  }
}

/**
 * Configure Tailscale serve/funnel for the E server port
 */
export function configureTailscale(
  port: number,
  funnel = false,
): { success: boolean; error?: string; url?: string } {
  const status = getTailscaleStatus();

  if (!status.available) {
    return { success: false, error: 'Tailscale not installed' };
  }

  if (!status.running) {
    return { success: false, error: 'Tailscale not running' };
  }

  try {
    const command = funnel
      ? `tailscale funnel --bg ${port}`
      : `tailscale serve --bg --https 443 http://localhost:${port}`;

    execSync(command, { stdio: 'ignore' });

    const protocol = funnel ? 'https' : 'https';
    const url = `${protocol}://${status.hostname}`;

    return { success: true, url };
  } catch (error: any) {
    return { success: false, error: `Failed to configure: ${error.message}` };
  }
}

/**
 * Stop Tailscale serve/funnel
 */
export function stopTailscale(): { success: boolean; error?: string } {
  try {
    execSync('tailscale serve reset', { stdio: 'ignore' });
    execSync('tailscale funnel reset', { stdio: 'ignore' });
    return { success: true };
  } catch (error: any) {
    return { success: false, error: `Failed to stop: ${error.message}` };
  }
}

/**
 * Generate SSH tunnel command for remote access
 */
export function generateSSHTunnelCommand(
  localPort: number,
  remoteHost?: string,
  remotePort = 22,
): SSHTunnelCommand {
  const host = remoteHost || '<your-server-ip>';
  const command = `ssh -L ${localPort}:localhost:${localPort} -N -f user@${host}`;

  return {
    command,
    localPort,
    remoteHost: host,
  };
}

/**
 * Register a remote client connection
 */
export function registerRemoteClient(id: string, origin: string, userAgent?: string): void {
  const isRemote = isOriginRemote(origin);

  remoteClients.set(id, {
    id,
    origin,
    connectedAt: Date.now(),
    isRemote,
    userAgent,
  });
}

/**
 * Unregister a remote client connection
 */
export function unregisterRemoteClient(id: string): void {
  remoteClients.delete(id);
}

/**
 * Get list of active remote clients
 */
export function getRemoteClients(): RemoteClient[] {
  return Array.from(remoteClients.values());
}

/**
 * Check if an origin is considered remote (not localhost/LAN)
 */
export function isOriginRemote(origin: string): boolean {
  if (!origin) return false;

  try {
    const url = new URL(origin);
    const hostname = url.hostname;

    // Localhost patterns (including IPv6 loopback)
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    ) {
      return false;
    }

    // Private network ranges (LAN) and CGNAT (Tailscale uses 100.64.0.0/10)
    if (
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
      hostname.match(/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./)
    ) {
      return false;
    }

    // Tailscale domains (.ts.net)
    if (hostname.endsWith('.ts.net')) {
      return true;
    }

    // Any other origin is considered remote
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a setting value from the database
 */
function getSetting(key: string, defaultValue: any): any {
  const db = getDb();
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return row ? JSON.parse(row.value) : defaultValue;
}
