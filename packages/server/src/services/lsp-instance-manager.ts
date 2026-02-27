/**
 * LSP Instance Manager — manages per-(language, rootPath) LSP server instances.
 *
 * Key features:
 * - Instances keyed by (language, rootPath) — worktrees naturally get distinct LSP servers
 * - Lazy-started: spawned on first client connection
 * - Same (language, rootPath) reuses the existing instance
 * - Max 20 total instances with LRU eviction (idle instances evicted first)
 * - shutdownForRoot(path) stops all LSP instances for a given root path
 * - Thread-safe: multiple clients can connect to the same instance
 */

import { resolve } from 'path';
import { getLspCommand } from './lsp-registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A connected client (typically a WebSocket connection). */
export interface LspClient {
  /** Unique client identifier. */
  id: string;
  /** Send a JSON-RPC message to the client. */
  send: (data: string) => void;
}

/** Internal state for a managed LSP instance. */
export interface LspInstanceInfo {
  /** Composite key: `${language}:${resolvedRootPath}`. */
  key: string;
  /** Language identifier (e.g. "typescript"). */
  language: string;
  /** Resolved absolute root path. */
  rootPath: string;
  /** The LSP subprocess. */
  process: any;
  /** Connected clients receiving LSP output. */
  clients: Map<string, LspClient>;
  /** Timestamp of last access (for LRU eviction). */
  lastAccessed: number;
  /** Whether the process has been shut down. */
  dead: boolean;
}

/** Stats for monitoring. */
export interface LspManagerStats {
  total: number;
  active: number;
  idle: number;
  byRoot: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// LSP JSON-RPC helpers (shared with routes/lsp.ts)
// ---------------------------------------------------------------------------

/**
 * Parse LSP JSON-RPC messages from a stdio stream.
 * Protocol: `Content-Length: N\r\n\r\n{...json...}`
 */
export function createLspParser(onMessage: (msg: any) => void) {
  let buffer = '';
  let contentLength = -1;

  return {
    feed(chunk: string) {
      buffer += chunk;

      while (true) {
        if (contentLength < 0) {
          const headerEnd = buffer.indexOf('\r\n\r\n');
          if (headerEnd < 0) break;

          const header = buffer.slice(0, headerEnd);
          const match = header.match(/Content-Length:\s*(\d+)/i);
          if (!match) {
            buffer = buffer.slice(headerEnd + 4);
            continue;
          }

          contentLength = parseInt(match[1], 10);
          buffer = buffer.slice(headerEnd + 4);
        }

        if (buffer.length < contentLength) break;

        const body = buffer.slice(0, contentLength);
        buffer = buffer.slice(contentLength);
        contentLength = -1;

        try {
          onMessage(JSON.parse(body));
        } catch {
          // Skip malformed JSON
        }
      }
    },
  };
}

/**
 * Encode a JSON-RPC message with Content-Length header for LSP stdio.
 */
export function encodeLspMessage(msg: any): string {
  const body = JSON.stringify(msg);
  return `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`;
}

// ---------------------------------------------------------------------------
// LSP Instance Manager
// ---------------------------------------------------------------------------

/** Maximum number of concurrent LSP instances. */
const DEFAULT_MAX_INSTANCES = 20;

export class LspInstanceManager {
  private instances = new Map<string, LspInstanceInfo>();
  private maxInstances: number;

  /**
   * Dependency injection for testing:
   * - spawnFn: spawns the LSP process
   * - getLspCommandFn: resolves language -> command + args
   */
  private spawnFn: (args: string[], opts: any) => any;
  private getLspCommandFn: typeof getLspCommand;

  constructor(options?: {
    maxInstances?: number;
    spawnFn?: (args: string[], opts: any) => any;
    getLspCommandFn?: typeof getLspCommand;
  }) {
    this.maxInstances = options?.maxInstances ?? DEFAULT_MAX_INSTANCES;
    this.spawnFn = options?.spawnFn ?? Bun.spawn;
    this.getLspCommandFn = options?.getLspCommandFn ?? getLspCommand;
  }

  /** Build the composite key for a (language, rootPath) pair. */
  makeKey(language: string, rootPath: string): string {
    return `${language}:${resolve(rootPath)}`;
  }

  /**
   * Connect a client to an LSP instance for (language, rootPath).
   *
   * Lazy-starts the LSP process if it doesn't exist.
   * Returns the instance info on success, or null if the language is unsupported.
   */
  connect(language: string, rootPath: string, client: LspClient): LspInstanceInfo | null {
    const resolvedRoot = resolve(rootPath);
    const key = this.makeKey(language, resolvedRoot);

    // Reuse existing instance
    let instance = this.instances.get(key);
    if (instance && !instance.dead) {
      instance.lastAccessed = Date.now();
      instance.clients.set(client.id, client);
      return instance;
    }

    // Clean up dead instance if present
    if (instance?.dead) {
      this.instances.delete(key);
    }

    // Resolve the LSP command
    const cmdInfo = this.getLspCommandFn(language);
    if (!cmdInfo) return null;

    // Evict if at capacity
    if (this.instances.size >= this.maxInstances) {
      const evicted = this.evictLRU();
      if (!evicted) {
        console.warn(
          `[lsp-manager] Cannot create instance for ${key}: at capacity (${this.maxInstances}) with no instances to evict`,
        );
        return null;
      }
    }

    // Spawn new LSP process
    let proc: any;
    try {
      proc = this.spawnFn([cmdInfo.command, ...cmdInfo.args], {
        cwd: resolvedRoot,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
    } catch (err) {
      console.error(`[lsp-manager] Failed to spawn ${cmdInfo.command} for ${key}: ${err}`);
      return null;
    }

    const clients = new Map<string, LspClient>();
    clients.set(client.id, client);

    instance = {
      key,
      language,
      rootPath: resolvedRoot,
      process: proc,
      clients,
      lastAccessed: Date.now(),
      dead: false,
    };

    this.instances.set(key, instance);

    // Pipe stdout -> all connected clients
    this.pipeStdout(instance);

    // Log stderr
    this.pipeStderr(instance);

    console.log(`[lsp-manager] Started LSP instance: ${key} (total: ${this.instances.size})`);
    return instance;
  }

  /**
   * Send a JSON-RPC message to the LSP process for (language, rootPath).
   */
  sendToLsp(language: string, rootPath: string, message: any): boolean {
    const key = this.makeKey(language, rootPath);
    const instance = this.instances.get(key);
    if (!instance || instance.dead) return false;

    const stdin = instance.process.stdin;
    if (!stdin || typeof stdin === 'number') return false;

    try {
      const encoded = encodeLspMessage(message);
      if (typeof stdin.write === 'function') {
        stdin.write(encoded);
      }
      instance.lastAccessed = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Disconnect a client from an LSP instance.
   *
   * The instance stays alive (idle) for potential reuse.
   * Idle instances are candidates for LRU eviction.
   */
  disconnect(language: string, rootPath: string, clientId: string): void {
    const key = this.makeKey(language, rootPath);
    const instance = this.instances.get(key);
    if (!instance) return;

    instance.clients.delete(clientId);
    // Instance stays alive — eligible for LRU eviction when at capacity
  }

  /**
   * Shutdown all LSP instances for a given root path.
   *
   * Called when a worktree is removed to clean up its LSP servers.
   */
  shutdownForRoot(rootPath: string): number {
    const resolvedRoot = resolve(rootPath);
    let count = 0;

    for (const [key, instance] of this.instances) {
      if (instance.rootPath === resolvedRoot) {
        this.shutdownInstance(instance);
        this.instances.delete(key);
        count++;
      }
    }

    if (count > 0) {
      console.log(
        `[lsp-manager] Shut down ${count} instance(s) for root: ${resolvedRoot} (remaining: ${this.instances.size})`,
      );
    }

    return count;
  }

  /**
   * Shutdown all managed LSP instances.
   */
  shutdownAll(): void {
    for (const instance of this.instances.values()) {
      this.shutdownInstance(instance);
    }
    const count = this.instances.size;
    this.instances.clear();
    if (count > 0) {
      console.log(`[lsp-manager] Shut down all ${count} instance(s)`);
    }
  }

  /**
   * Get an existing instance (without creating one).
   */
  getInstance(language: string, rootPath: string): LspInstanceInfo | null {
    const key = this.makeKey(language, rootPath);
    const instance = this.instances.get(key);
    if (!instance || instance.dead) return null;
    return instance;
  }

  /**
   * Get stats about managed instances.
   */
  getStats(): LspManagerStats {
    const byRoot: Record<string, string[]> = {};
    let active = 0;
    let idle = 0;

    for (const instance of this.instances.values()) {
      if (instance.dead) continue;

      const rootKey = instance.rootPath;
      if (!byRoot[rootKey]) byRoot[rootKey] = [];
      byRoot[rootKey].push(instance.language);

      if (instance.clients.size > 0) {
        active++;
      } else {
        idle++;
      }
    }

    return {
      total: this.instances.size,
      active,
      idle,
      byRoot,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal methods
  // ---------------------------------------------------------------------------

  /**
   * Evict the least recently used idle instance.
   * Returns true if an instance was evicted, false if none could be evicted.
   */
  private evictLRU(): boolean {
    let oldest: LspInstanceInfo | null = null;
    let oldestTime = Infinity;

    // Prefer evicting idle instances (no connected clients)
    for (const instance of this.instances.values()) {
      if (instance.dead) continue;
      if (instance.clients.size === 0 && instance.lastAccessed < oldestTime) {
        oldest = instance;
        oldestTime = instance.lastAccessed;
      }
    }

    // If no idle instance found, evict the oldest overall
    if (!oldest) {
      oldestTime = Infinity;
      for (const instance of this.instances.values()) {
        if (instance.dead) continue;
        if (instance.lastAccessed < oldestTime) {
          oldest = instance;
          oldestTime = instance.lastAccessed;
        }
      }
    }

    if (oldest) {
      console.log(
        `[lsp-manager] Evicting LRU instance: ${oldest.key} (idle: ${oldest.clients.size === 0}, lastAccessed: ${new Date(oldest.lastAccessed).toISOString()})`,
      );
      this.shutdownInstance(oldest);
      this.instances.delete(oldest.key);
      return true;
    }

    return false;
  }

  /**
   * Gracefully shutdown an LSP instance.
   * Sends `shutdown` request -> `exit` notification -> kill fallback.
   */
  private shutdownInstance(instance: LspInstanceInfo): void {
    if (instance.dead) return;
    instance.dead = true;

    const proc = instance.process;
    const stdin = proc.stdin;

    const writeTo = (msg: string) => {
      if (stdin && typeof stdin !== 'number') {
        try {
          if (typeof stdin.write === 'function') {
            stdin.write(msg);
          }
        } catch {
          // stdin may be closed
        }
      }
    };

    // Send LSP shutdown -> exit sequence
    try {
      writeTo(
        encodeLspMessage({
          jsonrpc: '2.0',
          id: 'shutdown',
          method: 'shutdown',
          params: null,
        }),
      );

      setTimeout(() => {
        try {
          writeTo(
            encodeLspMessage({
              jsonrpc: '2.0',
              method: 'exit',
            }),
          );
        } catch {}

        setTimeout(() => {
          try {
            proc.kill();
          } catch {}
        }, 500);
      }, 500);
    } catch {
      try {
        proc.kill();
      } catch {}
    }

    // Clear client references
    instance.clients.clear();
  }

  /** Pipe LSP process stdout to all connected clients. */
  private pipeStdout(instance: LspInstanceInfo): void {
    const stdout = instance.process.stdout;
    if (!stdout || typeof stdout === 'number') return;

    const parser = createLspParser((msg) => {
      const json = JSON.stringify(msg);
      for (const client of instance.clients.values()) {
        try {
          client.send(json);
        } catch {
          // Client disconnected — will be cleaned up
        }
      }
    });

    (async () => {
      const reader = (stdout as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } catch {
        // Process exited or stream closed
      }
    })();
  }

  /** Pipe LSP process stderr to console. */
  private pipeStderr(instance: LspInstanceInfo): void {
    const stderr = instance.process.stderr;
    if (!stderr || typeof stderr === 'number') return;

    (async () => {
      const reader = (stderr as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          console.warn(`[LSP ${instance.language}@${instance.rootPath}] stderr:`, text.trim());
        }
      } catch {
        // Stream closed
      }
    })();
  }

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  /** @internal — exposed for unit tests. */
  readonly _testHelpers = {
    getInstances: () => this.instances,
    getMaxInstances: () => this.maxInstances,
  };
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

/** Global LSP instance manager. */
export const lspManager = new LspInstanceManager();
