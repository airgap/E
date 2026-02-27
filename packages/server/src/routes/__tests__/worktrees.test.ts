import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createTestDb } from '../../test-helpers';

// ---------------------------------------------------------------------------
// Test database
// ---------------------------------------------------------------------------

const testDb = createTestDb();

mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// ---------------------------------------------------------------------------
// Mock worktree service — mutable state per test
// ---------------------------------------------------------------------------

const defaultRecord = {
  id: 'wt-abc123',
  story_id: 'test-story',
  prd_id: null,
  workspace_path: '/test/workspace',
  worktree_path: '/test/workspace/.e/worktrees/test-story',
  branch_name: 'story/test-story',
  base_branch: 'main',
  base_commit: 'deadbeef',
  status: 'active' as string,
  created_at: 1000000,
  updated_at: 1000000,
};

let mockState = {
  list: { ok: true, data: [] } as any,
  listAll: [] as any[],
  getForStory: null as any,
  create: { ok: true, data: '/test/workspace/.e/worktrees/test-story' } as any,
  createRecord: { ok: true, data: { ...defaultRecord } } as any,
  remove: { ok: true } as any,
  removeRecord: { ok: true } as any,
  prune: { ok: true, data: 0 } as any,
  updateStatus: { ok: true, data: { ...defaultRecord, status: 'merging' } } as any,
};

mock.module('../../services/worktree-service', () => ({
  list: async () => mockState.list,
  listAll: () => mockState.listAll,
  getForStory: () => mockState.getForStory,
  create: async () => mockState.create,
  createRecord: async () => mockState.createRecord,
  remove: async () => mockState.remove,
  removeRecord: async () => mockState.removeRecord,
  prune: async () => mockState.prune,
  updateStatus: () => mockState.updateStatus,
}));

// ---------------------------------------------------------------------------
// Mock merge service — mutable state per test
// ---------------------------------------------------------------------------

let mockMergeResult: any = {
  ok: true,
  status: 'merged',
  commitSha: 'abc123',
  operationLog: [],
};

let mockRetryResult: any = {
  ok: true,
  status: 'merged',
  commitSha: 'abc123',
  operationLog: [],
};

mock.module('../../services/worktree-merge', () => ({
  merge: async () => mockMergeResult,
  retry: async () => mockRetryResult,
}));

// ---------------------------------------------------------------------------
// Mock LSP instance manager
// ---------------------------------------------------------------------------

mock.module('../../services/lsp-instance-manager', () => ({
  lspManager: {
    shutdownForRoot: () => {},
  },
}));

// ---------------------------------------------------------------------------
// Mock Bun.spawn — for status endpoint git commands
// ---------------------------------------------------------------------------

let spawnResults: Array<{ stdout: string; stderr: string; exitCode: number }> = [];
let spawnCallIndex = 0;

function makeReadableStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

const originalSpawn = Bun.spawn;

function setupSpawnMock() {
  spawnResults = [];
  spawnCallIndex = 0;

  (Bun as any).spawn = (_args: string[], _opts: any) => {
    const idx = spawnCallIndex++;
    const result = spawnResults[idx] ?? { stdout: '', stderr: '', exitCode: 0 };
    return {
      stdout: makeReadableStream(result.stdout),
      stderr: makeReadableStream(result.stderr),
      exited: Promise.resolve(result.exitCode),
    };
  };
}

function restoreSpawnMock() {
  (Bun as any).spawn = originalSpawn;
}

function mockSpawnResult(stdout: string, stderr: string, exitCode: number) {
  spawnResults.push({ stdout, stderr, exitCode });
}

// ---------------------------------------------------------------------------
// Import routes AFTER mocks are set up
// ---------------------------------------------------------------------------

import { worktreeRoutes as app } from '../worktrees';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMockState() {
  mockState = {
    list: { ok: true, data: [] },
    listAll: [],
    getForStory: null,
    create: { ok: true, data: '/test/workspace/.e/worktrees/test-story' },
    createRecord: { ok: true, data: { ...defaultRecord } },
    remove: { ok: true },
    removeRecord: { ok: true },
    prune: { ok: true, data: 0 },
    updateStatus: { ok: true, data: { ...defaultRecord, status: 'merging' } },
  };
  mockMergeResult = {
    ok: true,
    status: 'merged',
    commitSha: 'abc123',
    operationLog: [],
  };
  mockRetryResult = {
    ok: true,
    status: 'merged',
    commitSha: 'abc123',
    operationLog: [],
  };
}

function clearTables() {
  testDb.exec('DELETE FROM worktrees');
  testDb.exec('DELETE FROM prd_stories');
  testDb.exec('DELETE FROM prds');
}

function insertPrd(id: string) {
  const now = Date.now();
  testDb
    .query(
      `INSERT INTO prds (id, workspace_path, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, '/test/workspace', `PRD ${id}`, 'Test PRD', now, now);
}

function insertStory(id: string, prdId: string | null = null) {
  if (prdId) {
    // Ensure PRD exists for FK constraint
    const existing = testDb.query('SELECT id FROM prds WHERE id = ?').get(prdId);
    if (!existing) insertPrd(prdId);
  }
  const now = Date.now();
  testDb
    .query(
      `INSERT INTO prd_stories (id, prd_id, title, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, prdId, `Story ${id}`, 'Test story description', now, now);
}

function insertWorktreeRow(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'wt-' + Math.random().toString(36).slice(2, 8),
    story_id: 'story-' + Math.random().toString(36).slice(2, 8),
    prd_id: null,
    workspace_path: '/test/workspace',
    worktree_path: '/test/workspace/.e/worktrees/' + Math.random().toString(36).slice(2, 8),
    branch_name: 'story/' + Math.random().toString(36).slice(2, 8),
    base_branch: 'main',
    base_commit: 'abc123',
    status: 'active',
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  const row = { ...defaults, ...overrides };
  testDb
    .query(
      `INSERT INTO worktrees (id, story_id, prd_id, workspace_path, worktree_path, branch_name, base_branch, base_commit, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.story_id,
      row.prd_id,
      row.workspace_path,
      row.worktree_path,
      row.branch_name,
      row.base_branch,
      row.base_commit,
      row.status,
      row.created_at,
      row.updated_at,
    );
  return row;
}

function jsonReq(path: string, method: string, body?: any): RequestInit {
  const init: any = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return init;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Worktree Routes', () => {
  beforeEach(() => {
    resetMockState();
    clearTables();
  });

  // =========================================================================
  // GET / — list worktrees
  // =========================================================================

  describe('GET / — list worktrees', () => {
    test('returns 400 if workspacePath query param is missing', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('workspacePath');
    });

    test('returns empty array when no worktrees exist', async () => {
      const res = await app.request('/?workspacePath=/test/workspace');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toEqual([]);
    });

    test('returns merged git + DB worktree info', async () => {
      const gitInfo = {
        path: '/test/workspace/.e/worktrees/my-story',
        branch: 'story/my-story',
        head: 'abc123',
        storyId: 'my-story',
        isMain: false,
        isLocked: false,
        isDirty: true,
      };
      const dbRecord = { ...defaultRecord, story_id: 'my-story' };

      mockState.list = { ok: true, data: [gitInfo] };
      mockState.listAll = [dbRecord];

      const res = await app.request('/?workspacePath=/test/workspace');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].storyId).toBe('my-story');
      expect(json.data[0].isDirty).toBe(true);
      expect(json.data[0].record).toBeDefined();
      expect(json.data[0].record.story_id).toBe('my-story');
    });

    test('includes DB-only records (abandoned/stale)', async () => {
      mockState.list = { ok: true, data: [] };
      mockState.listAll = [{ ...defaultRecord, status: 'abandoned', story_id: 'abandoned-story' }];

      const res = await app.request('/?workspacePath=/test/workspace');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].storyId).toBe('abandoned-story');
      expect(json.data[0].record.status).toBe('abandoned');
    });

    test('does not duplicate records present in both git and DB', async () => {
      const gitInfo = {
        path: '/test/workspace/.e/worktrees/s1',
        branch: 'story/s1',
        head: 'abc',
        storyId: 's1',
        isMain: false,
        isLocked: false,
        isDirty: false,
      };
      const dbRecord = { ...defaultRecord, story_id: 's1' };

      mockState.list = { ok: true, data: [gitInfo] };
      mockState.listAll = [dbRecord];

      const res = await app.request('/?workspacePath=/test/workspace');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
    });

    test('handles git list failure gracefully (returns DB-only)', async () => {
      mockState.list = { ok: false, error: 'git failed' };
      mockState.listAll = [{ ...defaultRecord, story_id: 'db-only' }];

      const res = await app.request('/?workspacePath=/test/workspace');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].storyId).toBe('db-only');
    });

    test('returns git worktrees without DB records (record=null)', async () => {
      const gitInfo = {
        path: '/test/workspace',
        branch: 'main',
        head: 'abc',
        storyId: null,
        isMain: true,
        isLocked: false,
        isDirty: false,
      };
      mockState.list = { ok: true, data: [gitInfo] };
      mockState.listAll = [];

      const res = await app.request('/?workspacePath=/test/workspace');
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].isMain).toBe(true);
      expect(json.data[0].record).toBeNull();
    });
  });

  // =========================================================================
  // POST / — create worktree
  // =========================================================================

  describe('POST / — create worktree', () => {
    test('returns 400 if workspacePath is missing', async () => {
      const res = await app.request('/', jsonReq('/', 'POST', { storyId: 'x' }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('workspacePath');
    });

    test('returns 400 if storyId is missing', async () => {
      const res = await app.request('/', jsonReq('/', 'POST', { workspacePath: '/test' }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('storyId');
    });

    test('returns 400 if workspacePath is not a string', async () => {
      const res = await app.request(
        '/',
        jsonReq('/', 'POST', { workspacePath: 123, storyId: 'x' }),
      );
      expect(res.status).toBe(400);
    });

    test('returns 400 if storyId is not a string', async () => {
      const res = await app.request(
        '/',
        jsonReq('/', 'POST', { workspacePath: '/test', storyId: 42 }),
      );
      expect(res.status).toBe(400);
    });

    test('returns 400 if story does not exist', async () => {
      const res = await app.request(
        '/',
        jsonReq('/', 'POST', { workspacePath: '/test', storyId: 'nonexistent' }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('not found');
    });

    test('returns 409 if worktree already active for storyId', async () => {
      insertStory('active-story');
      mockState.getForStory = { ...defaultRecord, story_id: 'active-story', status: 'active' };

      const res = await app.request(
        '/',
        jsonReq('/', 'POST', { workspacePath: '/test', storyId: 'active-story' }),
      );
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('already active');
    });

    test('returns 409 if worktree is in merging state', async () => {
      insertStory('merging-story');
      mockState.getForStory = { ...defaultRecord, story_id: 'merging-story', status: 'merging' };

      const res = await app.request(
        '/',
        jsonReq('/', 'POST', { workspacePath: '/test', storyId: 'merging-story' }),
      );
      expect(res.status).toBe(409);
    });

    test('returns 201 on successful creation', async () => {
      insertStory('new-story', 'prd-1');
      mockState.getForStory = null; // No existing worktree
      mockState.create = { ok: true, data: '/test/.e/worktrees/new-story' };
      mockState.createRecord = {
        ok: true,
        data: { ...defaultRecord, story_id: 'new-story', prd_id: 'prd-1' },
      };

      const res = await app.request(
        '/',
        jsonReq('/', 'POST', {
          workspacePath: '/test',
          storyId: 'new-story',
          baseBranch: 'develop',
        }),
      );
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.story_id).toBe('new-story');
    });

    test('returns 400 on git create failure', async () => {
      insertStory('fail-story');
      mockState.getForStory = null;
      mockState.create = { ok: false, error: 'Branch already exists' };

      const res = await app.request(
        '/',
        jsonReq('/', 'POST', { workspacePath: '/test', storyId: 'fail-story' }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Branch already exists');
    });

    test('returns 400 on DB record creation failure', async () => {
      insertStory('db-fail');
      mockState.getForStory = null;
      mockState.create = { ok: true, data: '/test/.e/worktrees/db-fail' };
      mockState.createRecord = { ok: false, error: 'UNIQUE constraint failed' };

      const res = await app.request(
        '/',
        jsonReq('/', 'POST', { workspacePath: '/test', storyId: 'db-fail' }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('UNIQUE');
    });

    test('allows creation when existing worktree is abandoned', async () => {
      insertStory('recover-story');
      mockState.getForStory = { ...defaultRecord, story_id: 'recover-story', status: 'abandoned' };
      mockState.create = { ok: true, data: '/test/.e/worktrees/recover-story' };
      mockState.createRecord = {
        ok: true,
        data: { ...defaultRecord, story_id: 'recover-story' },
      };

      const res = await app.request(
        '/',
        jsonReq('/', 'POST', { workspacePath: '/test', storyId: 'recover-story' }),
      );
      expect(res.status).toBe(201);
    });

    test('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: 'not json',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Invalid JSON');
    });
  });

  // =========================================================================
  // DELETE /:storyId — remove worktree
  // =========================================================================

  describe('DELETE /:storyId — remove worktree', () => {
    test('returns 404 for non-existent worktree', async () => {
      mockState.getForStory = null;

      const res = await app.request('/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('No worktree found');
    });

    test('returns 409 with uncommittedFiles if dirty (no force)', async () => {
      mockState.getForStory = { ...defaultRecord };
      mockState.remove = {
        ok: false,
        error: 'Worktree has uncommitted changes (3 file(s))',
        dirtyFiles: [' M src/a.ts', ' M src/b.ts', '?? src/c.ts'],
      };

      const res = await app.request('/test-story', { method: 'DELETE' });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.uncommittedFiles).toBeDefined();
      expect(json.uncommittedFiles).toHaveLength(3);
    });

    test('returns 200 on successful clean removal', async () => {
      mockState.getForStory = { ...defaultRecord, story_id: 'clean-story' };
      mockState.remove = { ok: true };

      // Insert a DB row so the route can delete it
      insertWorktreeRow({ story_id: 'clean-story' });

      const res = await app.request('/clean-story', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.storyId).toBe('clean-story');

      // Verify DB row was deleted
      const row = testDb.query('SELECT * FROM worktrees WHERE story_id = ?').get('clean-story');
      expect(row).toBeNull();
    });

    test('returns 200 with ?force=true even with dirty files', async () => {
      mockState.getForStory = { ...defaultRecord };
      mockState.removeRecord = { ok: true };

      const res = await app.request('/test-story?force=true', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.storyId).toBe('test-story');
    });

    test('DELETE with force delegates to removeRecord', async () => {
      mockState.getForStory = { ...defaultRecord };
      mockState.removeRecord = { ok: true };

      const res = await app.request('/test-story?force=true', { method: 'DELETE' });
      expect(res.status).toBe(200);
    });

    test('returns 400 when remove fails for non-dirty reason', async () => {
      mockState.getForStory = { ...defaultRecord };
      mockState.remove = { ok: false, error: 'Git error: lock file exists' };

      const res = await app.request('/test-story', { method: 'DELETE' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('lock file');
    });

    test('returns 400 when force removeRecord fails', async () => {
      mockState.getForStory = { ...defaultRecord };
      mockState.removeRecord = { ok: false, error: 'Git removal failed' };

      const res = await app.request('/test-story?force=true', { method: 'DELETE' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
    });
  });

  // =========================================================================
  // GET /:storyId/status — detailed worktree status
  // =========================================================================

  describe('GET /:storyId/status — detailed status', () => {
    beforeEach(() => {
      setupSpawnMock();
    });

    afterEach(() => {
      restoreSpawnMock();
    });

    test('returns 404 for non-existent worktree', async () => {
      mockState.getForStory = null;

      const res = await app.request('/nonexistent/status');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
    });

    test('returns branch, dirtyFiles, aheadBy, behindBy', async () => {
      mockState.getForStory = { ...defaultRecord };

      // Mock git status --porcelain (dirty files)
      mockSpawnResult(' M src/app.ts\n?? new-file.ts\n', '', 0);
      // Mock git rev-list (ahead/behind)
      mockSpawnResult('2\t5\n', '', 0);

      const res = await app.request('/test-story/status');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.branch).toBe('story/test-story');
      expect(json.data.dirtyFiles).toHaveLength(2);
      expect(json.data.dirtyFiles[0]).toContain('src/app.ts');
      expect(json.data.dirtyFiles[1]).toContain('new-file.ts');
      expect(json.data.behindBy).toBe(2);
      expect(json.data.aheadBy).toBe(5);
    });

    test('returns empty dirtyFiles when worktree is clean', async () => {
      mockState.getForStory = { ...defaultRecord };

      // Mock git status --porcelain (clean)
      mockSpawnResult('', '', 0);
      // Mock git rev-list
      mockSpawnResult('0\t0\n', '', 0);

      const res = await app.request('/test-story/status');
      const json = await res.json();
      expect(json.data.dirtyFiles).toEqual([]);
      expect(json.data.aheadBy).toBe(0);
      expect(json.data.behindBy).toBe(0);
    });

    test('handles git status failure gracefully', async () => {
      mockState.getForStory = { ...defaultRecord };

      // Mock git status failure
      mockSpawnResult('', 'fatal: not a git repository', 128);
      // Mock git rev-list
      mockSpawnResult('0\t3\n', '', 0);

      const res = await app.request('/test-story/status');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.dirtyFiles).toEqual([]);
    });

    test('handles git rev-list failure gracefully', async () => {
      mockState.getForStory = { ...defaultRecord };

      // Mock git status
      mockSpawnResult(' M file.ts\n', '', 0);
      // Mock git rev-list failure
      mockSpawnResult('', 'fatal: bad revision', 128);

      const res = await app.request('/test-story/status');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.aheadBy).toBe(0);
      expect(json.data.behindBy).toBe(0);
    });

    test('uses base_branch from DB record for rev-list comparison', async () => {
      mockState.getForStory = { ...defaultRecord, base_branch: 'develop' };

      // Mock git status
      mockSpawnResult('', '', 0);
      // Mock git rev-list (develop...HEAD)
      mockSpawnResult('1\t4\n', '', 0);

      const res = await app.request('/test-story/status');
      const json = await res.json();
      expect(json.data.behindBy).toBe(1);
      expect(json.data.aheadBy).toBe(4);
    });

    test('defaults to main when base_branch is null', async () => {
      mockState.getForStory = { ...defaultRecord, base_branch: null };

      // Mock git status
      mockSpawnResult('', '', 0);
      // Mock git rev-list (main...HEAD)
      mockSpawnResult('0\t2\n', '', 0);

      const res = await app.request('/test-story/status');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.aheadBy).toBe(2);
    });
  });

  // =========================================================================
  // POST /:storyId/merge — delegate to merge service
  // =========================================================================

  describe('POST /:storyId/merge — merge worktree', () => {
    test('returns 404 for non-existent worktree', async () => {
      mockState.getForStory = null;

      const res = await app.request('/nonexistent/merge', { method: 'POST' });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
    });

    test('returns 409 if already merged', async () => {
      mockState.getForStory = { ...defaultRecord, status: 'merged' };

      const res = await app.request('/test-story/merge', { method: 'POST' });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('already merged');
    });

    test('returns 202 on successful merge', async () => {
      mockState.getForStory = { ...defaultRecord, status: 'active' };
      mockMergeResult = {
        ok: true,
        status: 'merged',
        commitSha: 'abc123',
        operationLog: [],
      };

      const res = await app.request('/test-story/merge', { method: 'POST' });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.storyId).toBe('test-story');
      expect(json.data.status).toBe('merged');
    });

    test('returns 400 on merge failure', async () => {
      mockState.getForStory = { ...defaultRecord, status: 'active' };
      mockMergeResult = {
        ok: false,
        error: 'Pre-check failed',
        status: 'active',
        operationLog: [],
      };

      const res = await app.request('/test-story/merge', { method: 'POST' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
    });

    test('returns 409 on merge conflict', async () => {
      mockState.getForStory = { ...defaultRecord, status: 'active' };
      mockMergeResult = {
        ok: false,
        error: 'Merge conflict',
        status: 'conflict',
        conflictingFiles: ['file.ts'],
        operationLog: [],
      };

      const res = await app.request('/test-story/merge', { method: 'POST' });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.conflictingFiles).toEqual(['file.ts']);
    });

    test('uses retry for conflict state', async () => {
      mockState.getForStory = { ...defaultRecord, status: 'conflict' };
      mockRetryResult = {
        ok: true,
        status: 'merged',
        commitSha: 'def456',
        operationLog: [],
      };

      const res = await app.request('/test-story/merge', { method: 'POST' });
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.commitSha).toBe('def456');
    });
  });

  // =========================================================================
  // POST /prune — cleanup stale worktrees
  // =========================================================================

  describe('POST /prune — cleanup worktrees', () => {
    test('returns 400 if workspacePath is missing', async () => {
      const res = await app.request('/prune', jsonReq('/prune', 'POST', {}));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toContain('workspacePath');
    });

    test('returns prunedGit and prunedDb counts', async () => {
      mockState.prune = { ok: true, data: 2 };

      // Insert some stale DB records
      insertWorktreeRow({
        story_id: 'abandoned-1',
        workspace_path: '/test/workspace',
        status: 'abandoned',
      });
      insertWorktreeRow({
        story_id: 'cleanup-1',
        workspace_path: '/test/workspace',
        status: 'cleanup_pending',
      });
      // Active record should NOT be pruned
      insertWorktreeRow({
        story_id: 'active-1',
        workspace_path: '/test/workspace',
        status: 'active',
      });

      const res = await app.request(
        '/prune',
        jsonReq('/prune', 'POST', { workspacePath: '/test/workspace' }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.prunedGit).toBe(2);
      expect(json.data.prunedDb).toBe(2);

      // Verify only active record remains
      const remaining = testDb
        .query('SELECT * FROM worktrees WHERE workspace_path = ?')
        .all('/test/workspace') as any[];
      expect(remaining).toHaveLength(1);
      expect(remaining[0].story_id).toBe('active-1');
    });

    test('returns 0 when nothing to prune', async () => {
      mockState.prune = { ok: true, data: 0 };

      const res = await app.request(
        '/prune',
        jsonReq('/prune', 'POST', { workspacePath: '/test/workspace' }),
      );
      const json = await res.json();
      expect(json.data.prunedGit).toBe(0);
      expect(json.data.prunedDb).toBe(0);
    });

    test('handles git prune failure gracefully (prunedGit=0)', async () => {
      mockState.prune = { ok: false, error: 'git error' };

      const res = await app.request(
        '/prune',
        jsonReq('/prune', 'POST', { workspacePath: '/test/workspace' }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.prunedGit).toBe(0);
    });

    test('accepts workspacePath from query param', async () => {
      mockState.prune = { ok: true, data: 1 };

      const res = await app.request('/prune?workspacePath=/test/workspace', { method: 'POST' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('does not prune active or merging records', async () => {
      mockState.prune = { ok: true, data: 0 };

      insertWorktreeRow({
        story_id: 'keep-active',
        workspace_path: '/test/workspace',
        status: 'active',
      });
      insertWorktreeRow({
        story_id: 'keep-merging',
        workspace_path: '/test/workspace',
        status: 'merging',
      });

      const res = await app.request(
        '/prune',
        jsonReq('/prune', 'POST', { workspacePath: '/test/workspace' }),
      );
      const json = await res.json();
      expect(json.data.prunedDb).toBe(0);

      const remaining = testDb
        .query('SELECT * FROM worktrees WHERE workspace_path = ?')
        .all('/test/workspace') as any[];
      expect(remaining).toHaveLength(2);
    });

    test('only prunes records for the specified workspace', async () => {
      mockState.prune = { ok: true, data: 0 };

      insertWorktreeRow({
        story_id: 'ws-a-stale',
        workspace_path: '/workspace-a',
        status: 'abandoned',
      });
      insertWorktreeRow({
        story_id: 'ws-b-stale',
        workspace_path: '/workspace-b',
        status: 'abandoned',
      });

      const res = await app.request(
        '/prune',
        jsonReq('/prune', 'POST', { workspacePath: '/workspace-a' }),
      );
      const json = await res.json();
      expect(json.data.prunedDb).toBe(1);

      // workspace-b record should still exist
      const wbRows = testDb
        .query('SELECT * FROM worktrees WHERE workspace_path = ?')
        .all('/workspace-b') as any[];
      expect(wbRows).toHaveLength(1);
    });
  });

  // =========================================================================
  // Route registration
  // =========================================================================

  describe('route structure', () => {
    test('POST to /prune does not conflict with /:storyId/merge', async () => {
      mockState.prune = { ok: true, data: 0 };

      const res = await app.request(
        '/prune',
        jsonReq('/prune', 'POST', { workspacePath: '/test/workspace' }),
      );
      // Should hit prune endpoint, not merge endpoint
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveProperty('prunedGit');
      expect(json.data).toHaveProperty('prunedDb');
    });

    test('GET /:storyId/status does not conflict with GET /', async () => {
      setupSpawnMock();
      mockState.getForStory = { ...defaultRecord };
      mockSpawnResult('', '', 0); // git status
      mockSpawnResult('0\t0\n', '', 0); // git rev-list

      const res = await app.request('/some-story/status');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveProperty('branch');
      restoreSpawnMock();
    });
  });

  // =========================================================================
  // HTTP status code validation
  // =========================================================================

  describe('HTTP status codes', () => {
    test('POST / returns 201 on success', async () => {
      insertStory('status-test');
      mockState.getForStory = null;

      const res = await app.request(
        '/',
        jsonReq('/', 'POST', { workspacePath: '/test', storyId: 'status-test' }),
      );
      expect(res.status).toBe(201);
    });

    test('POST / returns 400 for validation errors', async () => {
      const res = await app.request('/', jsonReq('/', 'POST', {}));
      expect(res.status).toBe(400);
    });

    test('POST / returns 409 for conflicts', async () => {
      insertStory('conflict-test');
      mockState.getForStory = { ...defaultRecord, status: 'active' };

      const res = await app.request(
        '/',
        jsonReq('/', 'POST', { workspacePath: '/test', storyId: 'conflict-test' }),
      );
      expect(res.status).toBe(409);
    });

    test('DELETE returns 404 for missing worktree', async () => {
      mockState.getForStory = null;
      const res = await app.request('/missing', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    test('DELETE returns 409 for dirty worktree', async () => {
      mockState.getForStory = { ...defaultRecord };
      mockState.remove = {
        ok: false,
        error: 'Uncommitted changes',
        dirtyFiles: [' M file.ts'],
      };

      const res = await app.request('/test-story', { method: 'DELETE' });
      expect(res.status).toBe(409);
    });

    test('POST /:storyId/merge returns 202 on success', async () => {
      mockState.getForStory = { ...defaultRecord, status: 'active' };
      mockMergeResult = { ok: true, status: 'merged', commitSha: 'abc', operationLog: [] };

      const res = await app.request('/test-story/merge', { method: 'POST' });
      expect(res.status).toBe(202);
    });

    test('POST /:storyId/merge returns 409 for conflict', async () => {
      mockState.getForStory = { ...defaultRecord, status: 'active' };
      mockMergeResult = { ok: false, error: 'conflict', status: 'conflict', operationLog: [] };

      const res = await app.request('/test-story/merge', { method: 'POST' });
      expect(res.status).toBe(409);
    });
  });

  // =========================================================================
  // Response envelope consistency
  // =========================================================================

  describe('response envelope', () => {
    test('all success responses have ok: true', async () => {
      // GET /
      mockState.list = { ok: true, data: [] };
      const listRes = await app.request('/?workspacePath=/test');
      expect((await listRes.json()).ok).toBe(true);

      // POST / (need a story)
      insertStory('envelope-test');
      mockState.getForStory = null;
      const createRes = await app.request(
        '/',
        jsonReq('/', 'POST', { workspacePath: '/test', storyId: 'envelope-test' }),
      );
      expect((await createRes.json()).ok).toBe(true);
    });

    test('all error responses have ok: false and error string', async () => {
      // Missing workspacePath
      const res1 = await app.request('/');
      const json1 = await res1.json();
      expect(json1.ok).toBe(false);
      expect(typeof json1.error).toBe('string');

      // Non-existent story
      const res2 = await app.request(
        '/',
        jsonReq('/', 'POST', { workspacePath: '/test', storyId: 'missing' }),
      );
      const json2 = await res2.json();
      expect(json2.ok).toBe(false);
      expect(typeof json2.error).toBe('string');
    });
  });
});
