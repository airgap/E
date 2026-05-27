/**
 * kiro-acp/session-pool.ts — keeps one KiroAcpClient alive per
 * E-conversation so context is retained across turns. (Each KiroAcpClient
 * wraps a `kiro-cli acp` subprocess that holds the session state in memory.)
 *
 * Lookup key is the conversation id so navigating away and back finds the
 * same persistent Kiro session. Eviction is manual via release() / clear()
 * for now; later we can add an LRU + per-process memory pressure heuristic.
 */
import { KiroAcpClient } from './client';

interface Entry {
  client: KiroAcpClient;
  /** Resolves once newSession() has run — turn handlers await this so the
   *  first turn doesn't race the handshake. */
  ready: Promise<void>;
}

const pool = new Map<string, Entry>();

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
    await existing.ready;
    return existing.client;
  }
  const client = new KiroAcpClient({ cwd: opts.cwd });
  const ready = (async () => {
    await client.initialize();
    await client.newSession({ cwd: opts.cwd });
  })();
  pool.set(opts.conversationId, { client, ready });
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
