/**
 * Remote workspace bootstrap (LYK-1115) — VS Code Remote-SSH-style.
 *
 * Given an SSH host, this:
 *   1. ensures E is installed there (runs install.sh over ssh if ~/.e/bin/e is absent),
 *   2. launches E headless on a localhost port on the remote (tracks the pid),
 *   3. opens a persistent `ssh -L <local>:localhost:<remote>` port-forward,
 *   4. health-checks the forwarded port.
 *
 * The client then points its API/WS base at localhost:<local> (connectToRemote),
 * so the whole UI runs locally while files, terminal, git, LSP, and the agent
 * execute on the remote. The "agent" is just E run headless.
 *
 * Testing note: the SSH path needs a real host; not exercised in CI/sandbox.
 */
import { getDb } from '../db/database';
import { SSHClient } from './loop/executor/ssh-remote/ssh-client';
import { DEFAULT_REMOTE_HOST_CONFIG, type RemoteHostConfig } from '@e/shared';

const INSTALL_URL = 'https://raw.githubusercontent.com/airgap/E/dev/install.sh';
const REMOTE_BIN = '~/.e/bin/e';

export type WorkspaceAuthMethod = 'key-file' | 'agent-forwarding';

export interface WorkspaceHost {
  id: string;
  label?: string;
  hostname: string;
  port: number; // ssh port
  user: string;
  authMethod: WorkspaceAuthMethod;
  keyPath?: string;
}

export interface WorkspaceSession {
  hostId: string;
  hostname: string;
  localOrigin: string; // e.g. "localhost:39812" — what the client connects to
  localPort: number;
  remotePort: number;
  remotePid: number | null;
  startedAt: number;
}

interface ActiveSession extends WorkspaceSession {
  tunnel: ReturnType<typeof Bun.spawn>;
}

let active: ActiveSession | null = null;

// ── settings persistence (saved hosts) ────────────────────────────────────
function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().query('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}
function setSetting(key: string, value: unknown): void {
  getDb().run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [
    key,
    JSON.stringify(value),
  ]);
}

export function listHosts(): WorkspaceHost[] {
  return getSetting<WorkspaceHost[]>('remoteWorkspaceHosts', []);
}
export function saveHost(host: WorkspaceHost): WorkspaceHost[] {
  const hosts = listHosts().filter((h) => h.id !== host.id);
  hosts.push(host);
  setSetting('remoteWorkspaceHosts', hosts);
  return hosts;
}
export function deleteHost(id: string): WorkspaceHost[] {
  const hosts = listHosts().filter((h) => h.id !== id);
  setSetting('remoteWorkspaceHosts', hosts);
  return hosts;
}

// ── helpers ────────────────────────────────────────────────────────────────
function toSSHClient(host: WorkspaceHost): SSHClient {
  const cfg: RemoteHostConfig = {
    ...DEFAULT_REMOTE_HOST_CONFIG,
    id: host.id,
    hostname: host.hostname,
    port: host.port,
    user: host.user,
    authMethod: host.authMethod,
    keyPath: host.keyPath,
  };
  return new SSHClient(cfg);
}

function randomPort(): number {
  return 39000 + Math.floor(Math.random() * 1000);
}

/** SSH args for a port-forward (mirrors SSHClient.buildSSHArgs). */
function tunnelArgs(host: WorkspaceHost, localPort: number, remotePort: number): string[] {
  const args = [
    'ssh',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-p', String(host.port),
  ];
  if (host.authMethod === 'key-file' && host.keyPath) args.push('-i', host.keyPath);
  else if (host.authMethod === 'agent-forwarding') args.push('-A');
  args.push('-N', '-L', `${localPort}:localhost:${remotePort}`, `${host.user}@${host.hostname}`);
  return args;
}

async function waitForHealth(localPort: number, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${localPort}/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

// ── connect / disconnect ────────────────────────────────────────────────────
export function getStatus(): WorkspaceSession | null {
  if (!active) return null;
  const { tunnel: _t, ...session } = active;
  return session;
}

export async function connect(host: WorkspaceHost): Promise<WorkspaceSession> {
  if (active) await disconnect();
  const ssh = toSSHClient(host);

  // 1. reachable?
  const probe = await ssh.exec('echo ok', { timeoutMs: 12_000 });
  if (probe.exitCode !== 0) {
    throw new Error(`SSH to ${host.hostname} failed: ${probe.stderr.trim() || 'unreachable'}`);
  }

  // 2. ensure E is installed
  const check = await ssh.exec(`test -x ${REMOTE_BIN} && echo present || echo absent`, {
    timeoutMs: 12_000,
  });
  if (check.stdout.trim().endsWith('absent')) {
    const install = await ssh.exec(`curl -fsSL ${INSTALL_URL} | bash`, { timeoutMs: 180_000 });
    if (install.exitCode !== 0) {
      throw new Error(`Installing E on ${host.hostname} failed: ${install.stderr.trim()}`);
    }
  }

  // 3. launch E headless on a remote localhost port; capture pid
  const remotePort = randomPort();
  const launch = await ssh.exec(
    // --headless: server only (no Electron/browser) on the remote host.
    `PORT=${remotePort} nohup ${REMOTE_BIN} --headless >/tmp/e-remote-${remotePort}.log 2>&1 & echo $!`,
    { timeoutMs: 15_000 },
  );
  const remotePid = parseInt(launch.stdout.trim(), 10) || null;

  // 4. open the SSH tunnel (persistent child process)
  const localPort = randomPort();
  const tunnel = Bun.spawn(tunnelArgs(host, localPort, remotePort), {
    stdout: 'ignore',
    stderr: 'pipe',
    env: process.env,
  });

  // 5. wait for the forwarded server to answer
  const healthy = await waitForHealth(localPort);
  if (!healthy) {
    try {
      tunnel.kill();
    } catch {}
    if (remotePid) await ssh.exec(`kill ${remotePid} 2>/dev/null`, { timeoutMs: 8_000 }).catch(() => {});
    throw new Error(`Remote E on ${host.hostname} did not become reachable through the tunnel.`);
  }

  active = {
    hostId: host.id,
    hostname: host.hostname,
    localOrigin: `localhost:${localPort}`,
    localPort,
    remotePort,
    remotePid,
    startedAt: Date.now(),
    tunnel,
  };
  return getStatus()!;
}

export async function disconnect(): Promise<void> {
  if (!active) return;
  const session = active;
  active = null;
  try {
    session.tunnel.kill();
  } catch {}
  if (session.remotePid) {
    const host = listHosts().find((h) => h.id === session.hostId);
    if (host) {
      await toSSHClient(host)
        .exec(`kill ${session.remotePid} 2>/dev/null`, { timeoutMs: 8_000 })
        .catch(() => {});
    }
  }
}
