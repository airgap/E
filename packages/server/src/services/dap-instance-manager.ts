/**
 * DAP Instance Manager — per-session debug adapter processes.
 *
 * Unlike LSP (keyed by workspace + language, long-lived), each debug run is a fresh
 * session. Adapters die when the run finishes, so we key by `sessionId` and clean up
 * aggressively. The transport framing is identical to LSP (Content-Length headers);
 * we reuse the LSP helpers directly.
 */

import { getAdapter, type AdapterInfo } from './dap-adapter-registry';
import { createLspParser, encodeLspMessage } from './lsp-instance-manager';

/** A WebSocket client consuming DAP traffic. */
export interface DapClient {
  id: string;
  send: (data: string) => void;
}

export interface DapInstanceInfo {
  sessionId: string;
  adapter: AdapterInfo;
  process: any;
  client: DapClient | null;
  startedAt: number;
  dead: boolean;
}

/** Hard cap — prevents a runaway of orphaned debug sessions. */
const MAX_SESSIONS = 10;

class DapInstanceManager {
  private sessions = new Map<string, DapInstanceInfo>();

  /**
   * Start an adapter for `sessionId`. Returns the instance on success; null if the
   * adapter is unknown, unavailable, or the session cap has been hit.
   *
   * The caller is expected to attach a client via `attachClient(sessionId, client)`
   * immediately after — stdout from the adapter is queued until a client is present,
   * but that's a nicety we skip for v1: clients attach on the same WebSocket open event
   * that creates the session.
   */
  start(sessionId: string, adapterId: string, cwd?: string): DapInstanceInfo | null {
    if (this.sessions.has(sessionId)) return this.sessions.get(sessionId) ?? null;

    if (this.sessions.size >= MAX_SESSIONS) {
      console.warn(`[dap-manager] session cap hit (${MAX_SESSIONS}); reject ${sessionId}`);
      return null;
    }

    const adapter = getAdapter(adapterId);
    if (!adapter) {
      console.warn(`[dap-manager] unknown adapter: ${adapterId}`);
      return null;
    }

    let proc: any;
    try {
      proc = Bun.spawn([adapter.command, ...adapter.args], {
        cwd: cwd ?? process.cwd(),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
    } catch (err) {
      console.error(`[dap-manager] failed to spawn ${adapter.command}:`, err);
      return null;
    }

    const info: DapInstanceInfo = {
      sessionId,
      adapter,
      process: proc,
      client: null,
      startedAt: Date.now(),
      dead: false,
    };
    this.sessions.set(sessionId, info);
    this.pipeStdout(info);
    this.pipeStderr(info);

    // Adapter death: surface as a session end and tear down.
    proc.exited.then((exitCode: number | null) => {
      if (info.client) {
        try {
          info.client.send(
            JSON.stringify({
              type: 'event',
              event: 'terminated',
              body: { exitCode: exitCode ?? 0 },
            }),
          );
        } catch {}
      }
      info.dead = true;
      this.sessions.delete(sessionId);
      console.log(`[dap-manager] session ${sessionId} exited (code=${exitCode ?? '?'})`);
    });

    console.log(
      `[dap-manager] started session ${sessionId} adapter=${adapterId} (total=${this.sessions.size})`,
    );
    return info;
  }

  attachClient(sessionId: string, client: DapClient): boolean {
    const info = this.sessions.get(sessionId);
    if (!info || info.dead) return false;
    info.client = client;
    return true;
  }

  detachClient(sessionId: string): void {
    const info = this.sessions.get(sessionId);
    if (info) info.client = null;
  }

  /** Forward a DAP message from the client to the adapter. */
  sendToAdapter(sessionId: string, message: any): boolean {
    const info = this.sessions.get(sessionId);
    if (!info || info.dead) return false;
    const stdin = info.process.stdin;
    if (!stdin || typeof stdin.write !== 'function') return false;
    try {
      stdin.write(encodeLspMessage(message));
      return true;
    } catch {
      return false;
    }
  }

  /** Stop a session — detaches, terminates the process, and deletes the entry. */
  stop(sessionId: string): void {
    const info = this.sessions.get(sessionId);
    if (!info) return;
    try {
      info.process.kill('SIGTERM');
    } catch {}
    info.dead = true;
    this.sessions.delete(sessionId);
  }

  getStats(): { total: number; sessions: string[] } {
    return {
      total: this.sessions.size,
      sessions: Array.from(this.sessions.keys()),
    };
  }

  private pipeStdout(info: DapInstanceInfo): void {
    const stdout = info.process.stdout;
    if (!stdout) return;
    const parser = createLspParser((msg) => {
      if (info.client) {
        try {
          info.client.send(JSON.stringify(msg));
        } catch {}
      }
    });
    (async () => {
      const reader = stdout.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } catch {
        // Stream error — adapter likely died; exit handler does cleanup.
      }
    })();
  }

  private pipeStderr(info: DapInstanceInfo): void {
    const stderr = info.process.stderr;
    if (!stderr) return;
    (async () => {
      const reader = stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          if (text.trim()) {
            console.error(`[dap:${info.sessionId}] ${text.trim()}`);
          }
        }
      } catch {
        // Stream closed
      }
    })();
  }
}

export const dapManager = new DapInstanceManager();
