import { describe, test, expect, beforeEach, mock } from 'bun:test';
import type { TerminalSessionMeta, TerminalCreateRequest, TerminalCreateResponse } from '@e/shared';

let mockSessions: TerminalSessionMeta[] = [];
let lastCreateOpts: TerminalCreateRequest | null = null;
let mockAvailable = true;
let mockCreateResult: TerminalCreateResponse = {
  sessionId: 'term_test123',
  shell: '/bin/bash',
  pid: 12345,
  cwd: '/home/user',
};

const mockSessionManager = {
  get available() {
    return mockAvailable;
  },
  list: () => mockSessions,
  create: (opts: TerminalCreateRequest) => {
    lastCreateOpts = opts;
    return mockCreateResult;
  },
  kill: (id: string) => mockSessions.some((s) => s.id === id),
  attach: () => true,
  detach: () => {},
  resize: () => {},
  write: () => {},
  startLogging: (id: string) =>
    mockSessions.some((s) => s.id === id) ? { logFilePath: '/tmp/log.txt' } : null,
  stopLogging: (id: string) => mockSessions.some((s) => s.id === id),
  getLogFilePath: (id: string) => mockSessions.find((s) => s.id === id)?.logFilePath || null,
  detectShells: async () => [{ path: '/bin/bash', name: 'Bash', version: '5.1' }],
};

mock.module('../../services/terminal-session-manager', () => ({
  sessionManager: mockSessionManager,
}));
mock.module('../../ws', () => ({
  upgradeWebSocket: (fn: any) => (c: any) => {
    const handler = fn(c);
    return c.json({ ok: true });
  },
}));

import { terminalRoutes } from '../terminal';
import { Hono } from 'hono';

function makeSession(overrides: Partial<TerminalSessionMeta> = {}): TerminalSessionMeta {
  return {
    id: 'term_test1',
    shell: '/bin/bash',
    pid: 1234,
    cwd: '/home/user',
    cols: 80,
    rows: 24,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    exitCode: null,
    attached: false,
    logging: false,
    logFilePath: null,
    storyId: null,
    ...overrides,
  };
}

function createTestApp() {
  const app = new Hono();
  app.route('/terminal', terminalRoutes);
  return app;
}

describe('terminal routes', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    app = createTestApp();
    mockSessions = [];
    lastCreateOpts = null;
    mockAvailable = true;
  });

  describe('POST /sessions', () => {
    test('creates session', async () => {
      const res = await app.request('/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(201);
      const j = await res.json();
      expect(j.ok).toBe(true);
      expect(j.data.sessionId).toBe('term_test123');
    });

    test('passes storyId', async () => {
      await app.request('/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: 'story-abc', cwd: '/d' }),
      });
      expect(lastCreateOpts!.storyId).toBe('story-abc');
    });

    test('no storyId (backward compat)', async () => {
      await app.request('/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: '/d' }),
      });
      expect(lastCreateOpts!.storyId).toBeUndefined();
    });

    test('503 when unavailable', async () => {
      mockAvailable = false;
      const res = await app.request('/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(503);
    });
  });

  describe('GET /sessions', () => {
    test('returns list', async () => {
      mockSessions = [makeSession({ id: 'a' }), makeSession({ id: 'b' })];
      const j = await (await app.request('/terminal/sessions')).json();
      expect(j.data).toHaveLength(2);
    });

    test('includes storyId', async () => {
      mockSessions = [makeSession({ id: 'a', storyId: 'story-abc' }), makeSession({ id: 'b' })];
      const j = await (await app.request('/terminal/sessions')).json();
      expect(j.data[0].storyId).toBe('story-abc');
      expect(j.data[1].storyId).toBeNull();
    });
  });

  describe('GET /sessions/:id', () => {
    test('returns with storyId', async () => {
      mockSessions = [makeSession({ id: 'term_ws', storyId: 'story-xyz' })];
      const j = await (await app.request('/terminal/sessions/term_ws')).json();
      expect(j.data.storyId).toBe('story-xyz');
    });

    test('404 for unknown', async () => {
      const res = await app.request('/terminal/sessions/nope');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /sessions/:id', () => {
    test('kills session', async () => {
      mockSessions = [makeSession({ id: 'term_k' })];
      const j = await (await app.request('/terminal/sessions/term_k', { method: 'DELETE' })).json();
      expect(j.ok).toBe(true);
    });

    test('404 for unknown', async () => {
      expect((await app.request('/terminal/sessions/nope', { method: 'DELETE' })).status).toBe(404);
    });
  });

  describe('WebSocket storyId', () => {
    test('extracted from query', () => {
      const u = new URL('http://l/ws?storyId=story-abc&cols=120');
      expect(u.searchParams.get('storyId') || undefined).toBe('story-abc');
    });

    test('undefined when absent', () => {
      const u = new URL('http://l/ws?cols=80');
      expect(u.searchParams.get('storyId') || undefined).toBeUndefined();
    });

    test('empty becomes undefined', () => {
      const u = new URL('http://l/ws?storyId=&cols=80');
      expect(u.searchParams.get('storyId') || undefined).toBeUndefined();
    });

    test('passed to create', () => {
      mockSessionManager.create({ cwd: '/t', cols: 80, rows: 24, storyId: 'story-xyz' });
      expect(lastCreateOpts!.storyId).toBe('story-xyz');
    });
  });

  describe('metadata storyId', () => {
    test('has storyId', () => {
      expect(makeSession({ storyId: 'story-123' }).storyId).toBe('story-123');
    });

    test('null by default', () => {
      expect(makeSession().storyId).toBeNull();
    });

    test('list includes storyId', async () => {
      mockSessions = [
        makeSession({ id: 'a', storyId: 'sa' }),
        makeSession({ id: 'b' }),
        makeSession({ id: 'c', storyId: 'sc' }),
      ];
      const j = await (await app.request('/terminal/sessions')).json();
      expect(j.data[0].storyId).toBe('sa');
      expect(j.data[1].storyId).toBeNull();
      expect(j.data[2].storyId).toBe('sc');
    });
  });

  describe('backward compatibility', () => {
    test('minimal body works', async () => {
      expect(
        (
          await app.request('/terminal/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(201);
    });

    test('full body without storyId', async () => {
      await app.request('/terminal/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shell: '/bin/zsh', cwd: '/h', cols: 120, rows: 40 }),
      });
      expect(lastCreateOpts!.storyId).toBeUndefined();
    });

    test('empty sessions list', async () => {
      const j = await (await app.request('/terminal/sessions')).json();
      expect(j.data).toEqual([]);
    });
  });
});
