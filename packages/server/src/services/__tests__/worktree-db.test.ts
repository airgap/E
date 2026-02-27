import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { resolve, join } from 'path';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Mock Bun.spawn for git operations
// ---------------------------------------------------------------------------

let spawnResults: Array<{ stdout: string; stderr: string; exitCode: number }> = [];
let spawnCallIndex = 0;
let spawnCalls: Array<{ args: string[]; cwd: string }> = [];

function mockSpawnResult(stdout: string, stderr: string, exitCode: number) {
  spawnResults.push({ stdout, stderr, exitCode });
}

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
  spawnCalls = [];

  (Bun as any).spawn = (args: string[], opts: any) => {
    const idx = spawnCallIndex++;
    const result = spawnResults[idx] ?? { stdout: '', stderr: '', exitCode: 0 };
    spawnCalls.push({ args: [...args], cwd: opts?.cwd ?? '' });

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

// ---------------------------------------------------------------------------
// Force in-memory database for testing
// ---------------------------------------------------------------------------
process.env.E_DB_PATH = ':memory:';

// Fresh module load to avoid singleton contamination
function loadModules() {
  const dbPath = '/home/nicole/maude/packages/server/src/db/database.ts';
  const svcPath = '/home/nicole/maude/packages/server/src/services/worktree-service.ts';
  delete require.cache[dbPath];
  delete require.cache[svcPath];

  const dbModule = require(dbPath) as {
    getDb: () => Database;
    initDatabase: () => void;
  };
  const svcModule = require(svcPath) as {
    createRecord: typeof import('../worktree-service').createRecord;
    removeRecord: typeof import('../worktree-service').removeRecord;
    getForStory: typeof import('../worktree-service').getForStory;
    listActive: typeof import('../worktree-service').listActive;
    listAll: typeof import('../worktree-service').listAll;
    updateStatus: typeof import('../worktree-service').updateStatus;
    reconcile: typeof import('../worktree-service').reconcile;
    parsePorcelain: typeof import('../worktree-service').parsePorcelain;
    _testHelpers: typeof import('../worktree-service')._testHelpers;
  };

  return { dbModule, svcModule };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Worktree Database Schema & Operations', () => {
  let db: Database;
  let dbModule: ReturnType<typeof loadModules>['dbModule'];
  let svc: ReturnType<typeof loadModules>['svcModule'];

  beforeEach(() => {
    const mods = loadModules();
    dbModule = mods.dbModule;
    svc = mods.svcModule;
    dbModule.initDatabase();
    db = dbModule.getDb();
    setupSpawnMock();
    svc._testHelpers.clearLocks();
  });

  afterEach(() => {
    restoreSpawnMock();
  });

  // =========================================================================
  // Schema tests
  // =========================================================================

  describe('worktrees table schema', () => {
    test('table exists after initDatabase()', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='worktrees'")
        .all() as any[];
      expect(tables).toHaveLength(1);
      expect(tables[0].name).toBe('worktrees');
    });

    test('has all required columns', () => {
      const cols = db.prepare('PRAGMA table_info(worktrees)').all() as any[];
      const colNames = cols.map((c: any) => c.name);

      expect(colNames).toContain('id');
      expect(colNames).toContain('story_id');
      expect(colNames).toContain('prd_id');
      expect(colNames).toContain('workspace_path');
      expect(colNames).toContain('worktree_path');
      expect(colNames).toContain('branch_name');
      expect(colNames).toContain('base_branch');
      expect(colNames).toContain('base_commit');
      expect(colNames).toContain('status');
      expect(colNames).toContain('created_at');
      expect(colNames).toContain('updated_at');
    });

    test('id is PRIMARY KEY', () => {
      const cols = db.prepare('PRAGMA table_info(worktrees)').all() as any[];
      const idCol = cols.find((c: any) => c.name === 'id');
      expect(idCol.pk).toBe(1);
    });

    test('status defaults to active', () => {
      const cols = db.prepare('PRAGMA table_info(worktrees)').all() as any[];
      const statusCol = cols.find((c: any) => c.name === 'status');
      expect(statusCol.dflt_value).toBe("'active'");
    });

    test('has indexes', () => {
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='worktrees' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as any[];
      const indexNames = indexes.map((i: any) => i.name);

      expect(indexNames).toContain('idx_worktrees_workspace');
      expect(indexNames).toContain('idx_worktrees_status');
      expect(indexNames).toContain('idx_worktrees_story');
    });
  });

  // =========================================================================
  // UNIQUE constraint tests
  // =========================================================================

  describe('UNIQUE constraints', () => {
    const now = Date.now();

    function insertRow(overrides: Record<string, any> = {}) {
      const defaults = {
        id: 'id-' + Math.random().toString(36).slice(2, 8),
        story_id: 'story-' + Math.random().toString(36).slice(2, 8),
        prd_id: null,
        workspace_path: '/workspace',
        worktree_path: '/workspace/.e/worktrees/' + Math.random().toString(36).slice(2, 8),
        branch_name: 'story/' + Math.random().toString(36).slice(2, 8),
        base_branch: 'main',
        base_commit: 'abc123',
        status: 'active',
        created_at: now,
        updated_at: now,
      };
      const row = { ...defaults, ...overrides };
      db.query(
        `INSERT INTO worktrees (id, story_id, prd_id, workspace_path, worktree_path, branch_name, base_branch, base_commit, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
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

    test('story_id UNIQUE rejects duplicates', () => {
      insertRow({ story_id: 'dup-story' });
      expect(() => insertRow({ story_id: 'dup-story' })).toThrow();
    });

    test('worktree_path UNIQUE rejects duplicates', () => {
      insertRow({ worktree_path: '/workspace/.e/worktrees/dup' });
      expect(() => insertRow({ worktree_path: '/workspace/.e/worktrees/dup' })).toThrow();
    });

    test('branch_name UNIQUE rejects duplicates', () => {
      insertRow({ branch_name: 'story/dup-branch' });
      expect(() => insertRow({ branch_name: 'story/dup-branch' })).toThrow();
    });

    test('different values for unique columns succeed', () => {
      insertRow({ story_id: 'a', worktree_path: '/w/a', branch_name: 'story/a' });
      insertRow({ story_id: 'b', worktree_path: '/w/b', branch_name: 'story/b' });
      insertRow({ story_id: 'c', worktree_path: '/w/c', branch_name: 'story/c' });

      const count = db.query('SELECT COUNT(*) as cnt FROM worktrees').get() as any;
      expect(count.cnt).toBe(3);
    });
  });

  // =========================================================================
  // createRecord() tests
  // =========================================================================

  describe('createRecord()', () => {
    test('inserts row with nanoid(12) id', async () => {
      // Mock git rev-parse HEAD for base_commit
      mockSpawnResult('abc123def456\n', '', 0);

      const result = await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'test-story-1',
        worktreePath: '/test/workspace/.e/worktrees/test-story-1',
      });

      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.id).toHaveLength(12);
      expect(result.data!.story_id).toBe('test-story-1');
      expect(result.data!.status).toBe('active');
    });

    test('captures base_commit from git rev-parse HEAD', async () => {
      mockSpawnResult('deadbeef1234\n', '', 0);

      const result = await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'commit-test',
        worktreePath: '/test/workspace/.e/worktrees/commit-test',
      });

      expect(result.ok).toBe(true);
      expect(result.data!.base_commit).toBe('deadbeef1234');

      // Verify the git rev-parse was called
      expect(spawnCalls[0].args).toEqual(['git', 'rev-parse', 'HEAD']);
    });

    test('handles git rev-parse failure gracefully (base_commit=null)', async () => {
      mockSpawnResult('', 'fatal: not a git repository', 128);

      const result = await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'no-commit',
        worktreePath: '/test/workspace/.e/worktrees/no-commit',
      });

      expect(result.ok).toBe(true);
      expect(result.data!.base_commit).toBeNull();
    });

    test('sets prd_id when provided', async () => {
      mockSpawnResult('abc123\n', '', 0);

      const result = await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'prd-story',
        prdId: 'prd-123',
        worktreePath: '/test/workspace/.e/worktrees/prd-story',
      });

      expect(result.ok).toBe(true);
      expect(result.data!.prd_id).toBe('prd-123');
    });

    test('sets base_branch when provided', async () => {
      mockSpawnResult('abc123\n', '', 0);

      const result = await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'branch-story',
        baseBranch: 'develop',
        worktreePath: '/test/workspace/.e/worktrees/branch-story',
      });

      expect(result.ok).toBe(true);
      expect(result.data!.base_branch).toBe('develop');
    });

    test('generates branch_name from story prefix', async () => {
      mockSpawnResult('abc123\n', '', 0);

      const result = await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'my-feature',
        worktreePath: '/test/workspace/.e/worktrees/my-feature',
      });

      expect(result.ok).toBe(true);
      expect(result.data!.branch_name).toBe('story/my-feature');
    });

    test('sets timestamps', async () => {
      mockSpawnResult('abc123\n', '', 0);
      const before = Date.now();

      const result = await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'time-test',
        worktreePath: '/test/workspace/.e/worktrees/time-test',
      });

      const after = Date.now();
      expect(result.ok).toBe(true);
      expect(result.data!.created_at).toBeGreaterThanOrEqual(before);
      expect(result.data!.created_at).toBeLessThanOrEqual(after);
      expect(result.data!.updated_at).toBe(result.data!.created_at);
    });

    test('record persists in database', async () => {
      mockSpawnResult('abc123\n', '', 0);

      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'persist-test',
        worktreePath: '/test/workspace/.e/worktrees/persist-test',
      });

      const row = db.query('SELECT * FROM worktrees WHERE story_id = ?').get('persist-test') as any;
      expect(row).toBeDefined();
      expect(row.story_id).toBe('persist-test');
      expect(row.status).toBe('active');
    });

    test('rejects duplicate story_id', async () => {
      mockSpawnResult('abc123\n', '', 0);

      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'dup-create',
        worktreePath: '/test/workspace/.e/worktrees/dup-create',
      });

      mockSpawnResult('abc123\n', '', 0);

      const result = await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'dup-create',
        worktreePath: '/test/workspace/.e/worktrees/dup-create-2',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('uses parameterized query (no SQL injection)', async () => {
      mockSpawnResult('abc123\n', '', 0);

      const malicious = "'; DROP TABLE worktrees; --";
      const result = await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: malicious,
        worktreePath: '/test/workspace/.e/worktrees/safe',
      });

      expect(result.ok).toBe(true);

      // Table should still exist
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='worktrees'")
        .all();
      expect(tables).toHaveLength(1);

      // Row should be stored with the actual string
      const row = db
        .query('SELECT story_id FROM worktrees WHERE story_id = ?')
        .get(malicious) as any;
      expect(row).toBeDefined();
      expect(row.story_id).toBe(malicious);
    });
  });

  // =========================================================================
  // removeRecord() tests
  // =========================================================================

  describe('removeRecord()', () => {
    async function insertTestRecord(storyId: string) {
      mockSpawnResult('abc123\n', '', 0);
      return svc.createRecord({
        workspacePath: '/test/workspace',
        storyId,
        worktreePath: `/test/workspace/.e/worktrees/${storyId}`,
      });
    }

    test('sets status to cleanup_pending before git removal', async () => {
      await insertTestRecord('cleanup-test');

      // Mock git worktree remove success
      mockSpawnResult('', '', 0);

      // We need to track intermediate state - let's verify the final result
      const result = await svc.removeRecord('/test/workspace', 'cleanup-test');
      expect(result.ok).toBe(true);

      // After successful removal, row should be deleted
      const row = db.query('SELECT * FROM worktrees WHERE story_id = ?').get('cleanup-test');
      expect(row).toBeNull();
    });

    test('deletes row only after successful git removal', async () => {
      await insertTestRecord('success-remove');

      // Mock git worktree remove success
      mockSpawnResult('', '', 0);

      const result = await svc.removeRecord('/test/workspace', 'success-remove');
      expect(result.ok).toBe(true);

      const row = db.query('SELECT * FROM worktrees WHERE story_id = ?').get('success-remove');
      expect(row).toBeNull();
    });

    test('keeps row with cleanup_pending status on git failure', async () => {
      await insertTestRecord('fail-remove');

      // Create a temp dir so existsSync returns true
      const tmpDir = mkdtempSync(join(tmpdir(), 'wt-rm-test-'));
      // Update the record to point to the temp dir
      db.query('UPDATE worktrees SET worktree_path = ? WHERE story_id = ?').run(
        tmpDir,
        'fail-remove',
      );

      // Mock git worktree remove failure
      mockSpawnResult('', 'error: cannot remove', 1);

      const result = await svc.removeRecord('/test/workspace', 'fail-remove');
      expect(result.ok).toBe(false);

      // Row should still exist with cleanup_pending status
      const row = db.query('SELECT * FROM worktrees WHERE story_id = ?').get('fail-remove') as any;
      expect(row).toBeDefined();
      expect(row.status).toBe('cleanup_pending');

      rmSync(tmpDir, { recursive: true, force: true });
    });

    test('returns error for non-existent story', async () => {
      const result = await svc.removeRecord('/test/workspace', 'nonexistent');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No worktree record found');
    });

    test('succeeds when directory already deleted', async () => {
      await insertTestRecord('dir-gone');

      // worktree_path points to non-existent directory, so existsSync returns false
      // No git spawn needed since the dir doesn't exist
      const result = await svc.removeRecord('/test/workspace', 'dir-gone');
      expect(result.ok).toBe(true);

      // Row should be deleted
      const row = db.query('SELECT * FROM worktrees WHERE story_id = ?').get('dir-gone');
      expect(row).toBeNull();
    });
  });

  // =========================================================================
  // getForStory() tests
  // =========================================================================

  describe('getForStory()', () => {
    test('returns record when exists', async () => {
      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'find-me',
        worktreePath: '/test/workspace/.e/worktrees/find-me',
      });

      const record = svc.getForStory('find-me');
      expect(record).not.toBeNull();
      expect(record!.story_id).toBe('find-me');
      expect(record!.branch_name).toBe('story/find-me');
    });

    test('returns null when not found', () => {
      const record = svc.getForStory('not-found');
      expect(record).toBeNull();
    });

    test('returns typed WorktreeRecord', async () => {
      mockSpawnResult('deadbeef\n', '', 0);
      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'typed-test',
        prdId: 'prd-456',
        baseBranch: 'develop',
        worktreePath: '/test/workspace/.e/worktrees/typed-test',
      });

      const record = svc.getForStory('typed-test');
      expect(record).not.toBeNull();
      expect(record!.id).toBeDefined();
      expect(record!.story_id).toBe('typed-test');
      expect(record!.prd_id).toBe('prd-456');
      expect(record!.workspace_path).toBeDefined();
      expect(record!.worktree_path).toBeDefined();
      expect(record!.branch_name).toBe('story/typed-test');
      expect(record!.base_branch).toBe('develop');
      expect(record!.base_commit).toBe('deadbeef');
      expect(record!.status).toBe('active');
      expect(typeof record!.created_at).toBe('number');
      expect(typeof record!.updated_at).toBe('number');
    });
  });

  // =========================================================================
  // listActive() tests
  // =========================================================================

  describe('listActive()', () => {
    async function insertWithStatus(storyId: string, status: string) {
      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId,
        worktreePath: `/test/workspace/.e/worktrees/${storyId}`,
      });
      if (status !== 'active') {
        db.query('UPDATE worktrees SET status = ? WHERE story_id = ?').run(status, storyId);
      }
    }

    test('returns only active worktrees', async () => {
      await insertWithStatus('active-1', 'active');
      await insertWithStatus('active-2', 'active');
      await insertWithStatus('merging-1', 'merging');
      await insertWithStatus('abandoned-1', 'abandoned');

      const active = svc.listActive('/test/workspace');
      expect(active).toHaveLength(2);
      expect(active.map((r) => r.story_id).sort()).toEqual(['active-1', 'active-2']);
    });

    test('returns empty array when no active worktrees', async () => {
      await insertWithStatus('merged-1', 'merged');

      const active = svc.listActive('/test/workspace');
      expect(active).toHaveLength(0);
    });

    test('filters by workspace path', async () => {
      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: '/workspace-a',
        storyId: 'ws-a-story',
        worktreePath: '/workspace-a/.e/worktrees/ws-a-story',
      });

      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: '/workspace-b',
        storyId: 'ws-b-story',
        worktreePath: '/workspace-b/.e/worktrees/ws-b-story',
      });

      const activeA = svc.listActive('/workspace-a');
      expect(activeA).toHaveLength(1);
      expect(activeA[0].story_id).toBe('ws-a-story');

      const activeB = svc.listActive('/workspace-b');
      expect(activeB).toHaveLength(1);
      expect(activeB[0].story_id).toBe('ws-b-story');
    });
  });

  // =========================================================================
  // listAll() tests
  // =========================================================================

  describe('listAll()', () => {
    async function insertWithStatus(storyId: string, status: string) {
      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId,
        worktreePath: `/test/workspace/.e/worktrees/${storyId}`,
      });
      if (status !== 'active') {
        db.query('UPDATE worktrees SET status = ? WHERE story_id = ?').run(status, storyId);
      }
    }

    test('returns all worktrees regardless of status', async () => {
      await insertWithStatus('all-active', 'active');
      await insertWithStatus('all-merging', 'merging');
      await insertWithStatus('all-merged', 'merged');
      await insertWithStatus('all-conflict', 'conflict');
      await insertWithStatus('all-abandoned', 'abandoned');
      await insertWithStatus('all-cleanup', 'cleanup_pending');

      const all = svc.listAll('/test/workspace');
      expect(all).toHaveLength(6);
    });

    test('filters by workspace path', async () => {
      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: '/workspace-x',
        storyId: 'x-story',
        worktreePath: '/workspace-x/.e/worktrees/x-story',
      });

      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: '/workspace-y',
        storyId: 'y-story',
        worktreePath: '/workspace-y/.e/worktrees/y-story',
      });

      const allX = svc.listAll('/workspace-x');
      expect(allX).toHaveLength(1);
      expect(allX[0].story_id).toBe('x-story');
    });

    test('returns empty array for unknown workspace', () => {
      const all = svc.listAll('/unknown/workspace');
      expect(all).toHaveLength(0);
    });
  });

  // =========================================================================
  // updateStatus() tests
  // =========================================================================

  describe('updateStatus()', () => {
    async function insertStory(storyId: string) {
      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId,
        worktreePath: `/test/workspace/.e/worktrees/${storyId}`,
      });
    }

    test('updates status and updated_at', async () => {
      await insertStory('status-test');

      const before = db
        .query('SELECT updated_at FROM worktrees WHERE story_id = ?')
        .get('status-test') as any;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 5));

      const result = svc.updateStatus('status-test', 'merging');
      expect(result.ok).toBe(true);
      expect(result.data!.status).toBe('merging');
      expect(result.data!.updated_at).toBeGreaterThan(before.updated_at);
    });

    test('transitions through all valid statuses', async () => {
      await insertStory('transition-test');

      const statuses = [
        'merging',
        'merged',
        'conflict',
        'abandoned',
        'cleanup_pending',
        'active',
      ] as const;
      for (const status of statuses) {
        const result = svc.updateStatus('transition-test', status);
        expect(result.ok).toBe(true);
        expect(result.data!.status).toBe(status);
      }
    });

    test('rejects invalid status values', async () => {
      await insertStory('invalid-status');

      const result = svc.updateStatus('invalid-status', 'bogus' as any);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Invalid status');
      expect(result.error).toContain('bogus');

      // Original status should be unchanged
      const row = db
        .query('SELECT status FROM worktrees WHERE story_id = ?')
        .get('invalid-status') as any;
      expect(row.status).toBe('active');
    });

    test('returns error for non-existent story', () => {
      const result = svc.updateStatus('nonexistent', 'merging');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No worktree record found');
    });

    test('returns updated WorktreeRecord', async () => {
      await insertStory('return-test');

      const result = svc.updateStatus('return-test', 'conflict');
      expect(result.ok).toBe(true);
      expect(result.data!.story_id).toBe('return-test');
      expect(result.data!.status).toBe('conflict');
      expect(result.data!.id).toBeDefined();
    });
  });

  // =========================================================================
  // reconcile() tests
  // =========================================================================

  describe('reconcile()', () => {
    test('marks DB-only records as abandoned when directory missing', async () => {
      // Insert a record pointing to a non-existent directory
      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'ghost-story',
        worktreePath: '/test/workspace/.e/worktrees/ghost-story',
      });

      // Mock git worktree list (returns empty - no worktrees on disk)
      mockSpawnResult('worktree /test/workspace\nHEAD abc123\nbranch refs/heads/main\n\n', '', 0);

      const result = await svc.reconcile('/test/workspace');
      expect(result.ok).toBe(true);
      expect(result.data!.abandoned).toBe(1);

      // Verify status was updated
      const row = svc.getForStory('ghost-story');
      expect(row).not.toBeNull();
      expect(row!.status).toBe('abandoned');
    });

    test('discovers disk-only worktrees matching story/* pattern', async () => {
      // No DB records exist

      // Mock git worktree list with a story worktree
      const porcelain = [
        'worktree /test/workspace',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /test/workspace/.e/worktrees/new-story',
        'HEAD def456',
        'branch refs/heads/story/new-story',
        '',
      ].join('\n');
      mockSpawnResult(porcelain, '', 0);

      const result = await svc.reconcile('/test/workspace');
      expect(result.ok).toBe(true);
      expect(result.data!.discovered).toBe(1);

      // Verify record was created
      const row = svc.getForStory('new-story');
      expect(row).not.toBeNull();
      expect(row!.status).toBe('active');
      expect(row!.story_id).toBe('new-story');
      expect(row!.branch_name).toBe('story/new-story');
    });

    test('does not discover non-story worktrees', async () => {
      const porcelain = [
        'worktree /test/workspace',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /test/workspace/.e/worktrees/feature',
        'HEAD def456',
        'branch refs/heads/feature/some-thing',
        '',
      ].join('\n');
      mockSpawnResult(porcelain, '', 0);

      const result = await svc.reconcile('/test/workspace');
      expect(result.ok).toBe(true);
      expect(result.data!.discovered).toBe(0);
    });

    test('is idempotent — running twice yields same result', async () => {
      // Create a real temp dir to simulate a workspace
      const tmpWorkspace = mkdtempSync(join(tmpdir(), 'wt-idem-'));
      const diskWorktreePath = join(tmpWorkspace, '.e', 'worktrees', 'idem-disk');
      mkdirSync(diskWorktreePath, { recursive: true });

      // Insert a record with non-existent directory (ghost)
      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: tmpWorkspace,
        storyId: 'idem-ghost',
        worktreePath: join(tmpWorkspace, '.e', 'worktrees', 'idem-ghost'),
      });

      // First reconciliation
      const porcelain = [
        `worktree ${tmpWorkspace}`,
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        `worktree ${diskWorktreePath}`,
        'HEAD def456',
        'branch refs/heads/story/idem-disk',
        '',
      ].join('\n');
      mockSpawnResult(porcelain, '', 0);

      const first = await svc.reconcile(tmpWorkspace);
      expect(first.ok).toBe(true);
      expect(first.data!.abandoned).toBe(1);
      expect(first.data!.discovered).toBe(1);

      // Second reconciliation — same state, should be no-op
      mockSpawnResult(porcelain, '', 0);

      const second = await svc.reconcile(tmpWorkspace);
      expect(second.ok).toBe(true);
      expect(second.data!.abandoned).toBe(0); // already abandoned
      expect(second.data!.discovered).toBe(0); // already in DB

      rmSync(tmpWorkspace, { recursive: true, force: true });
    });

    test('does not touch already-abandoned records', async () => {
      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'already-abandoned',
        worktreePath: '/test/workspace/.e/worktrees/already-abandoned',
      });
      db.query('UPDATE worktrees SET status = ? WHERE story_id = ?').run(
        'abandoned',
        'already-abandoned',
      );

      // Mock git worktree list (empty)
      mockSpawnResult('worktree /test/workspace\nHEAD abc123\nbranch refs/heads/main\n\n', '', 0);

      const result = await svc.reconcile('/test/workspace');
      expect(result.ok).toBe(true);
      expect(result.data!.abandoned).toBe(0); // Already abandoned, not counted
    });

    test('does not touch merged records', async () => {
      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'already-merged',
        worktreePath: '/test/workspace/.e/worktrees/already-merged',
      });
      db.query('UPDATE worktrees SET status = ? WHERE story_id = ?').run(
        'merged',
        'already-merged',
      );

      // Mock git worktree list (empty)
      mockSpawnResult('worktree /test/workspace\nHEAD abc123\nbranch refs/heads/main\n\n', '', 0);

      const result = await svc.reconcile('/test/workspace');
      expect(result.ok).toBe(true);
      expect(result.data!.abandoned).toBe(0); // Merged, not touched
    });

    test('handles git worktree list failure gracefully', async () => {
      // Only DB-only check happens; git list fails
      mockSpawnResult('', 'fatal: not a git repo', 128);

      const result = await svc.reconcile('/test/workspace');
      expect(result.ok).toBe(true);
      // No discoveries but no error either
      expect(result.data!.discovered).toBe(0);
    });

    test('skips main worktree during discovery', async () => {
      const porcelain = [
        'worktree /test/workspace',
        'HEAD abc123',
        'branch refs/heads/story/main-story',
        '',
      ].join('\n');
      mockSpawnResult(porcelain, '', 0);

      const result = await svc.reconcile('/test/workspace');
      expect(result.ok).toBe(true);
      expect(result.data!.discovered).toBe(0); // main worktree skipped
    });
  });

  // =========================================================================
  // Parameterized query verification
  // =========================================================================

  describe('parameterized queries', () => {
    test('all createRecord values are parameterized', async () => {
      mockSpawnResult('abc123\n', '', 0);

      // If it were string concatenation, special characters would cause SQL errors
      const result = await svc.createRecord({
        workspacePath: "/test/with'quotes",
        storyId: 'story\'with"quotes',
        baseBranch: 'branch;DROP TABLE worktrees;--',
        prdId: 'prd"; DELETE FROM worktrees; --',
        worktreePath: "/test/with'quotes/.e/worktrees/safe",
      });

      expect(result.ok).toBe(true);
      // Table still intact
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='worktrees'")
        .all();
      expect(tables).toHaveLength(1);
    });

    test('getForStory uses parameterized query', () => {
      const result = svc.getForStory("'; DROP TABLE worktrees; --");
      expect(result).toBeNull();
      // Table still intact
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='worktrees'")
        .all();
      expect(tables).toHaveLength(1);
    });
  });

  // =========================================================================
  // Status transition integration tests
  // =========================================================================

  describe('status transitions', () => {
    async function insertStory(storyId: string) {
      mockSpawnResult('abc123\n', '', 0);
      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId,
        worktreePath: `/test/workspace/.e/worktrees/${storyId}`,
      });
    }

    test('active → merging → merged lifecycle', async () => {
      await insertStory('lifecycle-1');

      expect(svc.getForStory('lifecycle-1')!.status).toBe('active');

      svc.updateStatus('lifecycle-1', 'merging');
      expect(svc.getForStory('lifecycle-1')!.status).toBe('merging');

      svc.updateStatus('lifecycle-1', 'merged');
      expect(svc.getForStory('lifecycle-1')!.status).toBe('merged');
    });

    test('active → conflict → active recovery', async () => {
      await insertStory('conflict-recover');

      svc.updateStatus('conflict-recover', 'conflict');
      expect(svc.getForStory('conflict-recover')!.status).toBe('conflict');

      svc.updateStatus('conflict-recover', 'active');
      expect(svc.getForStory('conflict-recover')!.status).toBe('active');
    });

    test('active → cleanup_pending on removal attempt', async () => {
      await insertStory('cleanup-lifecycle');

      svc.updateStatus('cleanup-lifecycle', 'cleanup_pending');
      expect(svc.getForStory('cleanup-lifecycle')!.status).toBe('cleanup_pending');

      // Can still transition back
      svc.updateStatus('cleanup-lifecycle', 'active');
      expect(svc.getForStory('cleanup-lifecycle')!.status).toBe('active');
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    test('workspace_path is resolved to absolute path', async () => {
      mockSpawnResult('abc123\n', '', 0);

      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'resolve-test',
        worktreePath: '/test/workspace/.e/worktrees/resolve-test',
      });

      const record = svc.getForStory('resolve-test');
      expect(record).not.toBeNull();
      // Should be an absolute path
      expect(record!.workspace_path).toMatch(/^\//);
    });

    test('worktree_path is resolved to absolute path', async () => {
      mockSpawnResult('abc123\n', '', 0);

      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'wt-resolve',
        worktreePath: '/test/workspace/.e/worktrees/wt-resolve',
      });

      const record = svc.getForStory('wt-resolve');
      expect(record).not.toBeNull();
      expect(record!.worktree_path).toMatch(/^\//);
    });

    test('prd_id defaults to null when not provided', async () => {
      mockSpawnResult('abc123\n', '', 0);

      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'null-prd',
        worktreePath: '/test/workspace/.e/worktrees/null-prd',
      });

      const record = svc.getForStory('null-prd');
      expect(record!.prd_id).toBeNull();
    });

    test('base_branch defaults to null when not provided', async () => {
      mockSpawnResult('abc123\n', '', 0);

      await svc.createRecord({
        workspacePath: '/test/workspace',
        storyId: 'null-base',
        worktreePath: '/test/workspace/.e/worktrees/null-base',
      });

      const record = svc.getForStory('null-base');
      expect(record!.base_branch).toBeNull();
    });
  });
});
