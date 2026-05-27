/**
 * KiroAcpClient — long-lived `kiro-cli acp` subprocess wrapped in a typed
 * JSON-RPC 2.0 (NDJSON) client.
 *
 * Protocol shape captured from a probe of kiro-cli 2.4.2:
 *   - Lines are NDJSON. NOT LSP-style Content-Length framing.
 *   - `initialize` once at startup; agent advertises capabilities.
 *   - `session/new` returns a `sessionId`. ONE session per E conversation.
 *   - `session/prompt` per user turn. Returns `{stopReason}` when done.
 *   - During a prompt, the server pushes `session/update` notifications with
 *     `update.sessionUpdate` discriminating between `agent_message_chunk`
 *     (text deltas), tool-call lifecycle, etc.
 *   - Kiro-specific `_kiro.dev/*` notifications are vendor extensions
 *     (metadata, subagent updates, commands list); consumers can ignore.
 *
 * One client wraps one subprocess wraps one Kiro session. The manager creates
 * one client per E conversation and reuses it across turns so context is
 * retained.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function resolveKiroBinary(): string {
  const home = homedir();
  for (const p of [
    join(home, '.local', 'bin', 'kiro-cli'),
    '/usr/local/bin/kiro-cli',
    '/usr/bin/kiro-cli',
  ]) {
    if (existsSync(p)) return p;
  }
  return 'kiro-cli'; // PATH fallback
}

export interface KiroPromptContent {
  type: 'text' | 'image';
  text?: string;
  data?: string; // base64 for image
  mimeType?: string;
}

export interface KiroSessionUpdate {
  /** Discriminator — `agent_message_chunk`, `tool_call`, `tool_call_update`, ... */
  sessionUpdate: string;
  content?: { type: string; text?: string };
  [k: string]: unknown;
}

type Pending = (msg: { result?: any; error?: any }) => void;

/**
 * Events the client emits (mirror of incoming notification subset).
 * Listeners typed via the `emit`/`on` overloads on the EventEmitter.
 */
export interface KiroAcpClientEvents {
  update: (update: KiroSessionUpdate) => void;
  /** Vendor `_kiro.dev/*` notification (passthrough; UI may ignore). */
  vendor: (method: string, params: any) => void;
  /** Subprocess exited unexpectedly (Promise-resolved methods get rejected). */
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export class KiroAcpClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private initialized = false;
  private sessionId: string | null = null;

  constructor(opts: { cwd?: string } = {}) {
    super();
    this.proc = spawn(resolveKiroBinary(), ['acp'], {
      cwd: opts.cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr.on('data', (chunk: Buffer) => {
      // Kiro is fairly chatty on stderr; only surface meaningful bits.
      const s = chunk.toString('utf8').trimEnd();
      if (s) console.error(`[kiro-acp:stderr] ${s}`);
    });
    this.proc.on('exit', (code, signal) => {
      // Reject any still-pending JSON-RPC calls so callers don't hang.
      for (const cb of this.pending.values()) {
        cb({ error: { code: -32000, message: `kiro-cli exited (${code ?? signal ?? '?'})` } });
      }
      this.pending.clear();
      this.emit('exit', code, signal);
    });
  }

  private onData(chunk: Buffer): void {
    this.buf += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        this.dispatch(msg);
      } catch (e) {
        console.error('[kiro-acp] failed to parse line:', line.slice(0, 200), e);
      }
    }
  }

  private dispatch(msg: any): void {
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const cb = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      cb(msg);
      return;
    }
    // Notification (no id) — vendor or session/update.
    if (typeof msg.method === 'string') {
      if (msg.method === 'session/update' && msg.params?.update) {
        this.emit('update', msg.params.update as KiroSessionUpdate);
      } else if (msg.method.startsWith('_kiro.dev/')) {
        this.emit('vendor', msg.method, msg.params);
      } else {
        // Unknown notification — log + drop (don't crash on protocol additions).
        console.debug('[kiro-acp] unhandled notification:', msg.method);
      }
    }
  }

  private call<T = any>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const req = { jsonrpc: '2.0', id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, (msg) => {
        if (msg.error) reject(new Error(msg.error.message ?? 'kiro-cli error'));
        else resolve(msg.result as T);
      });
      this.proc.stdin.write(JSON.stringify(req) + '\n', (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /** Handshake — must be called once before sessions can be created. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.call('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    this.initialized = true;
  }

  /** Create a fresh session. Returns the Kiro-side sessionId. */
  async newSession(
    opts: { cwd: string; mcpServers?: any[] } = { cwd: process.cwd() },
  ): Promise<string> {
    if (!this.initialized) await this.initialize();
    const res = await this.call<{ sessionId: string }>('session/new', {
      cwd: opts.cwd,
      mcpServers: opts.mcpServers ?? [],
    });
    this.sessionId = res.sessionId;
    return res.sessionId;
  }

  /**
   * Send a prompt. Notifications stream via the 'update' event for the
   * duration; this Promise resolves with the final result envelope
   * (`{stopReason: 'end_turn' | ...}`) when the turn ends.
   */
  async prompt(content: KiroPromptContent[]): Promise<{ stopReason: string }> {
    if (!this.sessionId) {
      throw new Error('KiroAcpClient.prompt called before newSession');
    }
    return this.call<{ stopReason: string }>('session/prompt', {
      sessionId: this.sessionId,
      prompt: content,
    });
  }

  /** Best-effort cancel of an in-flight prompt. ACP-spec method name. */
  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.call('session/cancel', { sessionId: this.sessionId });
    } catch {
      /* cancel is best-effort */
    }
  }

  /** Tear down the subprocess. Idempotent. */
  close(): void {
    if (!this.proc.killed) {
      try {
        this.proc.stdin.end();
      } catch {
        /* already closed */
      }
      this.proc.kill('SIGTERM');
    }
  }
}
