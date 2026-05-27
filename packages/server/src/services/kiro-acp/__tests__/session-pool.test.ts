import { describe, test, expect, beforeEach, mock } from 'bun:test';

// Mock KiroAcpClient so the pool can exercise acquire/release without
// actually spawning kiro-cli (the tests run in CI without kiro-cli installed).
const spawnedClients: Array<{ closed: boolean; conversationHint?: string }> = [];
let exitListeners: Array<() => void> = [];

mock.module('../client', () => {
  class FakeKiroAcpClient {
    closed = false;
    conversationHint?: string;
    constructor(opts: { cwd?: string }) {
      this.conversationHint = opts.cwd;
      spawnedClients.push(this);
    }
    on(event: string, fn: (...args: any[]) => void) {
      if (event === 'exit') exitListeners.push(fn);
    }
    async initialize() {}
    async newSession() {
      return 'fake-session';
    }
    close() {
      this.closed = true;
    }
  }
  return { KiroAcpClient: FakeKiroAcpClient };
});

// Cap stays at default 8 (we don't reach it in these tests) — but for the LRU
// eviction test we lower it via env BEFORE importing the pool.
process.env.E_KIRO_POOL_MAX = '2';
const { acquire, release, activeConversations } = await import('../session-pool');

function resetPool() {
  for (const id of activeConversations()) release(id);
  spawnedClients.length = 0;
  exitListeners = [];
}

describe('kiro-acp session pool', () => {
  beforeEach(resetPool);

  test('acquire returns the same client for the same conversation id', async () => {
    const a = await acquire({ conversationId: 'c1', cwd: '/tmp' });
    const b = await acquire({ conversationId: 'c1', cwd: '/tmp' });
    expect(a).toBe(b);
    expect(spawnedClients).toHaveLength(1);
  });

  test('different conversation ids get different clients', async () => {
    await acquire({ conversationId: 'c1', cwd: '/tmp' });
    await acquire({ conversationId: 'c2', cwd: '/tmp' });
    expect(spawnedClients).toHaveLength(2);
  });

  test('release closes the subprocess and drops the entry', async () => {
    await acquire({ conversationId: 'c1', cwd: '/tmp' });
    release('c1');
    expect(spawnedClients[0].closed).toBe(true);
    // re-acquiring respawns a fresh client
    await acquire({ conversationId: 'c1', cwd: '/tmp' });
    expect(spawnedClients).toHaveLength(2);
  });

  test('LRU eviction at the cap evicts the oldest non-protected entry', async () => {
    // Cap is 2 (set via env above). Touch c1, then c2, then acquire c3:
    // c1 should be evicted; c2 and c3 remain.
    await acquire({ conversationId: 'c1', cwd: '/tmp' });
    await new Promise((r) => setTimeout(r, 5)); // ensure distinct timestamps
    await acquire({ conversationId: 'c2', cwd: '/tmp' });
    await new Promise((r) => setTimeout(r, 5));
    await acquire({ conversationId: 'c3', cwd: '/tmp' });
    const active = activeConversations();
    expect(active).toContain('c2');
    expect(active).toContain('c3');
    expect(active).not.toContain('c1');
    expect(spawnedClients[0].closed).toBe(true); // c1's client closed
  });

  test('touching a cache hit updates LRU order', async () => {
    // Acquire c1, c2; then re-acquire c1 (touch); then acquire c3 — c2 should
    // be the LRU (not c1) and get evicted.
    await acquire({ conversationId: 'c1', cwd: '/tmp' });
    await new Promise((r) => setTimeout(r, 5));
    await acquire({ conversationId: 'c2', cwd: '/tmp' });
    await new Promise((r) => setTimeout(r, 5));
    await acquire({ conversationId: 'c1', cwd: '/tmp' }); // touch
    await new Promise((r) => setTimeout(r, 5));
    await acquire({ conversationId: 'c3', cwd: '/tmp' });
    const active = activeConversations();
    expect(active).toContain('c1');
    expect(active).toContain('c3');
    expect(active).not.toContain('c2');
  });
});
