import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import {
  acquire,
  release,
  activeConversations,
  __setClientFactoryForTests,
  __resetClientFactoryForTests,
} from '../session-pool';

// Fake client objects the pool will hand out under our factory override.
// No mock.module — avoids leaking into sibling test files (Bun's
// mock.module is run-scoped, not file-scoped).
const spawnedClients: Array<{ closed: boolean; conversationHint?: string }> = [];

interface FakeClient {
  closed: boolean;
  conversationHint?: string;
  initialize(): Promise<void>;
  newSession(opts: { cwd: string }): Promise<string>;
  cancel(): Promise<void>;
  close(): void;
  on(event: string, fn: (...args: any[]) => void): void;
}

function makeFakeClient(opts: { cwd: string }): FakeClient {
  const c: FakeClient = {
    closed: false,
    conversationHint: opts.cwd,
    async initialize() {},
    async newSession() {
      return 'fake-session';
    },
    async cancel() {},
    close() {
      c.closed = true;
    },
    on(_event, _fn) {
      /* no-op — pool listens for 'exit' but our fakes never exit */
    },
  };
  spawnedClients.push(c);
  return c;
}

// Cap stays at default 8 (we don't reach it in these tests) — but for the
// LRU eviction test we lower it via env.
process.env.E_KIRO_POOL_MAX = '2';
__setClientFactoryForTests(makeFakeClient as any);

function resetPool() {
  for (const id of activeConversations()) release(id);
  spawnedClients.length = 0;
}

describe('kiro-acp session pool', () => {
  beforeEach(resetPool);
  // Restore the production factory once this suite finishes so other test
  // files in the same run get the real KiroAcpClient back.
  afterAll(() => {
    __resetClientFactoryForTests();
    delete process.env.E_KIRO_POOL_MAX;
  });

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
