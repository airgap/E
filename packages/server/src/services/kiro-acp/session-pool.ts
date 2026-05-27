/**
 * kiro-acp/session-pool.ts — keeps one KiroAcpClient alive per
 * E-conversation so context is retained across turns. (Each KiroAcpClient
 * wraps a `kiro-cli acp` subprocess that holds the session state in memory.)
 *
 * Lookup key is the conversation id so navigating away and back finds the
 * same persistent Kiro session.
 *
 * Bounded by an LRU policy (default cap from E_KIRO_POOL_MAX env or 8) so a
 * user with many open conversations doesn't accrue an unbounded number of
 * `kiro-cli acp` subprocesses. Eviction kills the subprocess (releasing both
 * its memory + Kiro's in-process session context); the next acquire for that
 * conversation respawns and re-handshakes — text continuity comes back, but
 * the model's prior-turn context is gone. That trade is acceptable: the
 * alternative was infinite resident processes; users picking the cap can
 * raise it via E_KIRO_POOL_MAX.
 */
import { KiroAcpClient } from './client';

interface Entry {
  client: KiroAcpClient;
  /** Resolves once newSession() has run — turn handlers await this so the
   *  first turn doesn't race the handshake. */
  ready: Promise<void>;
  /** Monotonic clock value at the last acquire(); LRU eviction picks the
   *  smallest. Touched on every acquire (cache hit AND miss path). */
  lastUsedAt: number;
}

const pool = new Map<string, Entry>();

const POOL_MAX = (() => {
  const raw = process.env.E_KIRO_POOL_MAX;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 8;
})();

/**
 * Evict the least-recently-used entry to make room. No-op when the pool is
 * below the cap. The protected id is the conversation about to be acquired —
 * we never evict the entry the caller is asking for, even if it's the LRU
 * (the cap+1 case).
 */
function evictLruIfNeeded(protectedId: string): void {
  if (pool.size < POOL_MAX) return;
  let lruId: string | null = null;
  let lruTs = Infinity;
  for (const [id, entry] of pool) {
    if (id === protectedId) continue;
    if (entry.lastUsedAt < lruTs) {
      lruTs = entry.lastUsedAt;
      lruId = id;
    }
  }
  if (lruId !== null) {
    console.log(
      `[kiro-acp] pool at cap (${POOL_MAX}); evicting LRU conversation ${lruId.slice(0, 8)}…`,
    );
    release(lruId);
  }
}

export interface AcquireOpts {
  conversationId: string;
  cwd: string;
}

/**
 * Get an existing client for this conversation, or spin up a fresh one
 * (initialize + session/new). Returns the client; the returned promise
 * resolves when the session is ready to accept prompt() calls.
 */
export async function acquire(opts: AcquireOpts): Promise<KiroAcpClient> {
  const existing = pool.get(opts.conversationId);
  if (existing) {
    existing.lastUsedAt = Date.now(); // touch on cache hit so the LRU order stays accurate
    await existing.ready;
    return existing.client;
  }
  // Make room before spawning — evict the LRU entry (other than this one) if
  // we're at the cap. release() inside kills the subprocess synchronously
  // (via SIGTERM); the freed slot is immediately taken by the new entry.
  evictLruIfNeeded(opts.conversationId);
  const client = new KiroAcpClient({ cwd: opts.cwd });
  const ready = (async () => {
    await client.initialize();
    await client.newSession({ cwd: opts.cwd });
  })();
  pool.set(opts.conversationId, { client, ready, lastUsedAt: Date.now() });
  // If the subprocess dies, drop the entry so the next acquire respawns.
  client.on('exit', () => {
    if (pool.get(opts.conversationId)?.client === client) {
      pool.delete(opts.conversationId);
    }
  });
  try {
    await ready;
  } catch (err) {
    pool.delete(opts.conversationId);
    client.close();
    throw err;
  }
  return client;
}

/** Tear down a conversation's session (subprocess kill + remove from pool). */
export function release(conversationId: string): void {
  const entry = pool.get(conversationId);
  if (!entry) return;
  pool.delete(conversationId);
  entry.client.close();
}

/** Tear down every active session. Used on server shutdown / HMR. */
export function clear(): void {
  for (const [id] of pool) release(id);
}

/** Snapshot of conversation ids with a live ACP session (debug / status). */
export function activeConversations(): string[] {
  return [...pool.keys()];
}
