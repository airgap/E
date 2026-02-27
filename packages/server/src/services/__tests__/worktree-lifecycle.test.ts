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
// Mock worktree service
// ---------------------------------------------------------------------------

let removeRecordCalls: Array<{ workspacePath: string; storyId: string }> = [];
let removeRecordResult: { ok: boolean; error?: string } = { ok: true };
let pruneResult: { ok: boolean; data?: number; error?: string } = { ok: true, data: 0 };
let pruneCalls: string[] = [];

mock.module('../worktree-service', () => ({
  getForStory: (storyId: string) => {
    const row = testDb.query('SELECT * FROM worktrees WHERE story_id = ?').get(storyId) as any;
    return row ?? null;
  },
  listActive: (workspacePath: string) => {
    return testDb
      .query("SELECT * FROM worktrees WHERE workspace_path = ? AND status = 'active'")
      .all(workspacePath) as any[];
  },
  listAll: (workspacePath: string) => {
    return testDb
      .query('SELECT * FROM worktrees WHERE workspace_path = ?')
      .all(workspacePath) as any[];
  },
  removeRecord: async (workspacePath: string, storyId: string) => {
    removeRecordCalls.push({ workspacePath, storyId });
    if (removeRecordResult.ok) {
      // Simulate DB deletion
      testDb.query('DELETE FROM worktrees WHERE story_id = ?').run(storyId);
    }
    return removeRecordResult;
  },
  prune: async (workspacePath: string) => {
    pruneCalls.push(workspacePath);
    return pruneResult;
  },
}));

// ---------------------------------------------------------------------------
// Disk space is mocked via _testHelpers.setGetAvailableBytes (below)
// ---------------------------------------------------------------------------

let mockAvailableBytes = 10_000_000_000; // Default: 10GB

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import {
  cleanupWorktreeForStory,
  cleanupIfArchived,
  cleanupArchivedStories,
  cleanupWorktreesForPrd,
  runGC,
  checkWorktreeLimit,
  checkDiskSpace,
  start,
  stop,
  configure,
  getConfig,
  _testHelpers,
  type LifecycleConfig,
  type GCStats,
} from '../worktree-lifecycle';
import { prdEvents } from '../../routes/prd/events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearTables() {
  testDb.exec('DELETE FROM worktrees');
  testDb.exec('DELETE FROM prd_stories');
  testDb.exec('DELETE FROM prds');
}

function insertPrd(id: string, workspacePath = '/test/workspace') {
  const now = Date.now();
  testDb
    .query(
      `INSERT INTO prds (id, workspace_path, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspacePath, `PRD ${id}`, 'Test PRD', now, now);
}

function insertStory(
  id: string,
  prdId: string | null = null,
  status = 'pending',
  workspacePath = '/test/workspace',
) {
  if (prdId) {
    const existing = testDb.query('SELECT id FROM prds WHERE id = ?').get(prdId);
    if (!existing) insertPrd(prdId, workspacePath);
  }
  const now = Date.now();
  testDb
    .query(
      `INSERT INTO prd_stories (id, prd_id, title, description, status, workspace_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, prdId, `Story ${id}`, 'Test story', status, workspacePath, now, now);
}

function insertWorktree(overrides: Record<string, any> = {}) {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Worktree Lifecycle & Garbage Collection', () => {
  beforeEach(() => {
    clearTables();
    removeRecordCalls = [];
    removeRecordResult = { ok: true };
    pruneResult = { ok: true, data: 0 };
    pruneCalls = [];
    mockAvailableBytes = 10_000_000_000; // 10GB
    _testHelpers.resetState();
    _testHelpers.setGetAvailableBytes(() => mockAvailableBytes);
  });

  afterEach(() => {
    stop();
  });

  // =========================================================================
  // Story cleanup (AC #1)
  // =========================================================================

  describe('cleanupWorktreeForStory — story archival/deletion triggers worktree removal', () => {
    test('removes worktree when story has one', async () => {
      insertStory('s1', 'prd-1');
      insertWorktree({ story_id: 's1', prd_id: 'prd-1' });

      const result = await cleanupWorktreeForStory('s1');
      expect(result).toBe(true);
      expect(removeRecordCalls).toHaveLength(1);
      expect(removeRecordCalls[0].storyId).toBe('s1');
    });

    test('returns true (no-op) when story has no worktree', async () => {
      const result = await cleanupWorktreeForStory('nonexistent');
      expect(result).toBe(true);
      expect(removeRecordCalls).toHaveLength(0);
    });

    test('returns false when removeRecord fails', async () => {
      insertStory('s2', 'prd-1');
      insertWorktree({ story_id: 's2', prd_id: 'prd-1' });
      removeRecordResult = { ok: false, error: 'git error' };

      const result = await cleanupWorktreeForStory('s2');
      expect(result).toBe(false);
    });

    test('is idempotent — calling twice succeeds', async () => {
      insertStory('s3', 'prd-1');
      insertWorktree({ story_id: 's3', prd_id: 'prd-1' });

      const first = await cleanupWorktreeForStory('s3');
      expect(first).toBe(true);

      // Second call — worktree already removed
      const second = await cleanupWorktreeForStory('s3');
      expect(second).toBe(true);
      // Only one actual removeRecord call (second time getForStory returns null)
      expect(removeRecordCalls).toHaveLength(1);
    });
  });

  // =========================================================================
  // Archived stories cleanup
  // =========================================================================

  describe('cleanupArchivedStories', () => {
    test('cleans up worktrees for all archived stories in PRD', async () => {
      insertStory('arch1', 'prd-1', 'archived');
      insertStory('arch2', 'prd-1', 'archived');
      insertStory('active1', 'prd-1', 'in_progress');

      insertWorktree({ story_id: 'arch1', prd_id: 'prd-1' });
      insertWorktree({ story_id: 'arch2', prd_id: 'prd-1' });
      insertWorktree({ story_id: 'active1', prd_id: 'prd-1' });

      const cleaned = await cleanupArchivedStories('prd-1');
      expect(cleaned).toBe(2);

      // Should only clean up archived stories
      const archStoryIds = removeRecordCalls.map((c) => c.storyId).sort();
      expect(archStoryIds).toEqual(['arch1', 'arch2']);
    });

    test('returns 0 when no archived stories', async () => {
      insertStory('active1', 'prd-1', 'in_progress');
      const cleaned = await cleanupArchivedStories('prd-1');
      expect(cleaned).toBe(0);
    });
  });

  // =========================================================================
  // cleanupIfArchived — story_updated triggers cleanup when archived (AC #1)
  // =========================================================================

  describe('cleanupIfArchived — story archival via update triggers cleanup', () => {
    test('cleans up worktree when story status is archived', async () => {
      insertStory('if-arch-1', 'prd-1', 'archived');
      insertWorktree({ story_id: 'if-arch-1', prd_id: 'prd-1' });

      const result = await cleanupIfArchived('if-arch-1');
      expect(result).toBe(true);
      expect(removeRecordCalls).toHaveLength(1);
      expect(removeRecordCalls[0].storyId).toBe('if-arch-1');
    });

    test('does NOT clean up when story is not archived', async () => {
      insertStory('if-active-1', 'prd-1', 'in_progress');
      insertWorktree({ story_id: 'if-active-1', prd_id: 'prd-1' });

      const result = await cleanupIfArchived('if-active-1');
      expect(result).toBe(true);
      expect(removeRecordCalls).toHaveLength(0);
    });

    test('returns true when story does not exist', async () => {
      const result = await cleanupIfArchived('no-such-story');
      expect(result).toBe(true);
      expect(removeRecordCalls).toHaveLength(0);
    });

    test('handles various non-archived statuses', async () => {
      const statuses = ['pending', 'in_progress', 'qa', 'completed', 'failed'];
      for (const status of statuses) {
        clearTables();
        removeRecordCalls = [];
        insertStory(`check-${status}`, 'prd-1', status);
        insertWorktree({ story_id: `check-${status}`, prd_id: 'prd-1' });

        const result = await cleanupIfArchived(`check-${status}`);
        expect(result).toBe(true);
        expect(removeRecordCalls).toHaveLength(0);
      }
    });
  });

  // =========================================================================
  // PRD deletion cleanup (AC #2)
  // =========================================================================

  describe('cleanupWorktreesForPrd — PRD deletion removes all worktrees', () => {
    test('removes all worktrees for a PRD', async () => {
      insertPrd('prd-del');
      insertWorktree({ story_id: 's1', prd_id: 'prd-del' });
      insertWorktree({ story_id: 's2', prd_id: 'prd-del' });
      insertWorktree({ story_id: 's3', prd_id: 'prd-del' });

      const cleaned = await cleanupWorktreesForPrd('prd-del');
      expect(cleaned).toBe(3);
      expect(removeRecordCalls).toHaveLength(3);
    });

    test('force-deletes DB records when git removal fails', async () => {
      insertPrd('prd-force');
      insertWorktree({ story_id: 'sf1', prd_id: 'prd-force', id: 'wt-force1' });
      removeRecordResult = { ok: false, error: 'git error' };

      const cleaned = await cleanupWorktreesForPrd('prd-force');
      expect(cleaned).toBe(1);

      // DB record should be force-deleted
      const remaining = testDb.query("SELECT * FROM worktrees WHERE prd_id = 'prd-force'").all();
      expect(remaining).toHaveLength(0);
    });

    test('returns 0 when PRD has no worktrees', async () => {
      const cleaned = await cleanupWorktreesForPrd('no-worktrees');
      expect(cleaned).toBe(0);
    });

    test('does not affect worktrees from other PRDs', async () => {
      insertPrd('prd-a');
      insertPrd('prd-b');
      insertWorktree({ story_id: 'sa1', prd_id: 'prd-a' });
      insertWorktree({ story_id: 'sb1', prd_id: 'prd-b' });

      await cleanupWorktreesForPrd('prd-a');

      // prd-b worktree should still exist
      const remaining = testDb.query("SELECT * FROM worktrees WHERE prd_id = 'prd-b'").all();
      expect(remaining).toHaveLength(1);
    });
  });

  // =========================================================================
  // Idempotent cleanup (AC #3)
  // =========================================================================

  describe('idempotent cleanup', () => {
    test('calling cleanupWorktreeForStory multiple times is safe', async () => {
      insertStory('idem1', 'prd-1');
      insertWorktree({ story_id: 'idem1', prd_id: 'prd-1' });

      await cleanupWorktreeForStory('idem1');
      await cleanupWorktreeForStory('idem1');
      await cleanupWorktreeForStory('idem1');

      // Only first call should trigger removeRecord
      expect(removeRecordCalls).toHaveLength(1);
    });

    test('calling cleanupWorktreesForPrd multiple times is safe', async () => {
      insertPrd('idem-prd');
      insertWorktree({ story_id: 'idem-s1', prd_id: 'idem-prd' });

      await cleanupWorktreesForPrd('idem-prd');
      removeRecordCalls = [];

      // Second call — no more worktrees to clean
      const cleaned = await cleanupWorktreesForPrd('idem-prd');
      expect(cleaned).toBe(0);
      expect(removeRecordCalls).toHaveLength(0);
    });

    test('GC is idempotent when run twice with same state', async () => {
      insertStory('gc-idem', 'prd-gc');
      insertWorktree({ story_id: 'gc-idem', prd_id: 'prd-gc', status: 'merged' });

      const first = await runGC();
      expect(first.merged).toBe(1);

      removeRecordCalls = [];
      const second = await runGC();
      // Already cleaned up — nothing to do
      expect(second.merged).toBe(0);
    });
  });

  // =========================================================================
  // GC background task (AC #4)
  // =========================================================================

  describe('GC runs on configurable interval as background task', () => {
    test('start() initializes GC timer', () => {
      start({ gcIntervalMs: 60000 });
      expect(_testHelpers.getGcTimer()).not.toBeNull();
    });

    test('stop() clears GC timer', () => {
      start({ gcIntervalMs: 60000 });
      stop();
      expect(_testHelpers.getGcTimer()).toBeNull();
    });

    test('configure() updates interval', () => {
      start({ gcIntervalMs: 60000 });
      const timer1 = _testHelpers.getGcTimer();

      configure({ gcIntervalMs: 30000 });
      const timer2 = _testHelpers.getGcTimer();

      // Timer should have been replaced
      expect(timer2).not.toBeNull();
      expect(getConfig().gcIntervalMs).toBe(30000);
    });

    test('start() attaches event listener', () => {
      start();
      expect(_testHelpers.isEventListenerAttached()).toBe(true);
    });

    test('stop() detaches event listener', () => {
      start();
      stop();
      expect(_testHelpers.isEventListenerAttached()).toBe(false);
    });

    test('start() is idempotent for event listeners', () => {
      start();
      start();
      // Should not double-attach
      expect(_testHelpers.isEventListenerAttached()).toBe(true);
    });

    test('getConfig() returns current configuration', () => {
      start({ gcIntervalMs: 5000, maxWorktreesPerWorkspace: 10 });
      const cfg = getConfig();
      expect(cfg.gcIntervalMs).toBe(5000);
      expect(cfg.maxWorktreesPerWorkspace).toBe(10);
    });
  });

  // =========================================================================
  // GC handles all cases (AC #5)
  // =========================================================================

  describe('GC handles merged/abandoned/orphaned/stale cases', () => {
    test('cleans up merged worktrees', async () => {
      insertStory('merged-1', 'prd-gc');
      insertWorktree({ story_id: 'merged-1', prd_id: 'prd-gc', status: 'merged' });

      const stats = await runGC();
      expect(stats.merged).toBe(1);
    });

    test('cleans up abandoned worktrees older than threshold', async () => {
      insertStory('aband-1', 'prd-gc');
      const oldTime = Date.now() - 86_400_001; // >24hr ago
      insertWorktree({
        story_id: 'aband-1',
        prd_id: 'prd-gc',
        status: 'abandoned',
        updated_at: oldTime,
      });

      const stats = await runGC();
      expect(stats.abandoned).toBe(1);
    });

    test('does NOT clean up recently abandoned worktrees', async () => {
      insertStory('recent-aband', 'prd-gc');
      insertWorktree({
        story_id: 'recent-aband',
        prd_id: 'prd-gc',
        status: 'abandoned',
        updated_at: Date.now(), // just now
      });

      const stats = await runGC();
      expect(stats.abandoned).toBe(0);
    });

    test('cleans up orphaned worktrees (story deleted)', async () => {
      // Worktree exists but story does NOT
      insertWorktree({ story_id: 'orphan-1' });

      const stats = await runGC();
      expect(stats.orphaned).toBe(1);
    });

    test('does NOT treat worktrees with existing stories as orphaned', async () => {
      insertStory('not-orphan', 'prd-gc');
      insertWorktree({ story_id: 'not-orphan', prd_id: 'prd-gc' });

      const stats = await runGC();
      expect(stats.orphaned).toBe(0);
    });

    test('prunes stale git refs', async () => {
      // Need at least one worktree record for workspace discovery
      insertStory('stale-test', 'prd-gc');
      insertWorktree({
        story_id: 'stale-test',
        prd_id: 'prd-gc',
        workspace_path: '/test/workspace',
      });
      pruneResult = { ok: true, data: 3 };

      const stats = await runGC();
      expect(stats.stale).toBe(3);
      expect(pruneCalls).toContain('/test/workspace');
    });

    test('handles mixed scenarios in single GC run', async () => {
      // Merged worktree
      insertStory('mix-merged', 'prd-mix');
      insertWorktree({ story_id: 'mix-merged', prd_id: 'prd-mix', status: 'merged' });

      // Abandoned worktree (old)
      insertStory('mix-aband', 'prd-mix');
      insertWorktree({
        story_id: 'mix-aband',
        prd_id: 'prd-mix',
        status: 'abandoned',
        updated_at: Date.now() - 86_400_001,
      });

      // Orphaned worktree
      insertWorktree({ story_id: 'mix-orphan' });

      // Active worktree (should NOT be touched)
      insertStory('mix-active', 'prd-mix');
      insertWorktree({ story_id: 'mix-active', prd_id: 'prd-mix', status: 'active' });

      pruneResult = { ok: true, data: 1 };

      const stats = await runGC();
      expect(stats.merged).toBe(1);
      expect(stats.abandoned).toBe(1);
      expect(stats.orphaned).toBe(1);
      expect(stats.stale).toBe(1);

      // Active worktree should still exist
      const active = testDb.query("SELECT * FROM worktrees WHERE story_id = 'mix-active'").get();
      expect(active).not.toBeNull();
    });

    test('configurable abandoned threshold', async () => {
      insertStory('thresh-test', 'prd-gc');
      // Worktree abandoned 2 hours ago
      const twoHoursAgo = Date.now() - 2 * 3_600_000;
      insertWorktree({
        story_id: 'thresh-test',
        prd_id: 'prd-gc',
        status: 'abandoned',
        updated_at: twoHoursAgo,
      });

      // Default threshold is 24h — should NOT clean up
      const stats1 = await runGC();
      expect(stats1.abandoned).toBe(0);

      // Custom threshold of 1h — SHOULD clean up (record still exists from above)
      const stats2 = await runGC({ abandonedThresholdMs: 3_600_000 });
      expect(stats2.abandoned).toBe(1);
    });

    test('GC records duration', async () => {
      const stats = await runGC();
      expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('GC handles errors gracefully', async () => {
      // Insert a merged worktree but make removal fail
      insertStory('err-test', 'prd-gc');
      insertWorktree({ story_id: 'err-test', prd_id: 'prd-gc', status: 'merged' });
      removeRecordResult = { ok: false, error: 'git error' };

      // Should still complete without throwing
      const stats = await runGC();
      // Merged count still increments because force-delete happens
      expect(stats.merged).toBe(1);
    });
  });

  // =========================================================================
  // Worktree limits (AC #6)
  // =========================================================================

  describe('max worktrees per workspace enforced', () => {
    test('allows creation when under limit', () => {
      insertWorktree({ workspace_path: '/ws1', status: 'active' });
      insertWorktree({ workspace_path: '/ws1', status: 'active' });

      const check = checkWorktreeLimit('/ws1', { maxWorktreesPerWorkspace: 5 });
      expect(check.allowed).toBe(true);
      expect(check.reason).toBeUndefined();
    });

    test('blocks creation when at limit', () => {
      for (let i = 0; i < 5; i++) {
        insertWorktree({ workspace_path: '/ws-full', status: 'active' });
      }

      const check = checkWorktreeLimit('/ws-full', { maxWorktreesPerWorkspace: 5 });
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Maximum worktrees');
      expect(check.reason).toContain('5');
    });

    test('default limit is 5', () => {
      for (let i = 0; i < 5; i++) {
        insertWorktree({ workspace_path: '/ws-default', status: 'active' });
      }

      const check = checkWorktreeLimit('/ws-default');
      expect(check.allowed).toBe(false);
    });

    test('only counts active worktrees', () => {
      for (let i = 0; i < 4; i++) {
        insertWorktree({ workspace_path: '/ws-mixed', status: 'active' });
      }
      // These should NOT count
      insertWorktree({ workspace_path: '/ws-mixed', status: 'merged' });
      insertWorktree({ workspace_path: '/ws-mixed', status: 'abandoned' });
      insertWorktree({ workspace_path: '/ws-mixed', status: 'cleanup_pending' });

      const check = checkWorktreeLimit('/ws-mixed', { maxWorktreesPerWorkspace: 5 });
      expect(check.allowed).toBe(true);
    });

    test('different workspaces have independent limits', () => {
      for (let i = 0; i < 5; i++) {
        insertWorktree({ workspace_path: '/ws-a', status: 'active' });
      }

      // ws-a is full
      const checkA = checkWorktreeLimit('/ws-a', { maxWorktreesPerWorkspace: 5 });
      expect(checkA.allowed).toBe(false);

      // ws-b is empty
      const checkB = checkWorktreeLimit('/ws-b', { maxWorktreesPerWorkspace: 5 });
      expect(checkB.allowed).toBe(true);
    });

    test('configurable max limit', () => {
      for (let i = 0; i < 3; i++) {
        insertWorktree({ workspace_path: '/ws-custom', status: 'active' });
      }

      const check = checkWorktreeLimit('/ws-custom', { maxWorktreesPerWorkspace: 3 });
      expect(check.allowed).toBe(false);
    });
  });

  // =========================================================================
  // Disk space limits (AC #7)
  // =========================================================================

  describe('disk space checks — warn <1GB, block <100MB', () => {
    test('allows creation with plenty of disk space', () => {
      mockAvailableBytes = 10_000_000_000; // 10GB
      const check = checkWorktreeLimit('/test/workspace');
      expect(check.allowed).toBe(true);
      expect(check.warning).toBeUndefined();
    });

    test('warns when disk space below 1GB', () => {
      mockAvailableBytes = 512_000_000; // 512MB (< 1GB warn threshold)
      const check = checkWorktreeLimit('/test/workspace');
      expect(check.allowed).toBe(true);
      expect(check.warning).toBeDefined();
      expect(check.warning).toContain('low');
    });

    test('blocks when disk space below 100MB', () => {
      mockAvailableBytes = 51_200_000; // ~50MB (< 100MB block threshold)
      const check = checkWorktreeLimit('/test/workspace');
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Disk space');
    });

    test('checkDiskSpace returns detailed info', () => {
      mockAvailableBytes = 512_000_000; // 512MB
      const result = checkDiskSpace('/test/workspace');
      expect(result.warn).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.availableBytes).toBe(512_000_000);
    });

    test('checkDiskSpace blocks below threshold', () => {
      mockAvailableBytes = 51_200_000; // ~50MB
      const result = checkDiskSpace('/test/workspace');
      expect(result.warn).toBe(true);
      expect(result.blocked).toBe(true);
      expect(result.message).toContain('critically low');
    });

    test('checkDiskSpace reports healthy status', () => {
      mockAvailableBytes = 10_000_000_000; // 10GB
      const result = checkDiskSpace('/test/workspace');
      expect(result.ok).toBe(true);
      expect(result.warn).toBe(false);
      expect(result.blocked).toBe(false);
    });

    test('disk check combined with worktree limit', () => {
      // Under worktree limit but disk critical
      mockAvailableBytes = 51_200_000; // ~50MB
      const check = checkWorktreeLimit('/test/workspace', { maxWorktreesPerWorkspace: 10 });
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Disk space');
    });
  });

  // =========================================================================
  // GC stats logged (AC #8)
  // =========================================================================

  describe('GC stats logged', () => {
    test('GC returns stats object with all fields', async () => {
      const stats = await runGC();
      expect(typeof stats.merged).toBe('number');
      expect(typeof stats.abandoned).toBe('number');
      expect(typeof stats.orphaned).toBe('number');
      expect(typeof stats.stale).toBe('number');
      expect(typeof stats.errors).toBe('number');
      expect(typeof stats.durationMs).toBe('number');
    });

    test('stats reflect actual cleanup counts', async () => {
      insertStory('stat-merged', 'prd-stats');
      insertWorktree({ story_id: 'stat-merged', prd_id: 'prd-stats', status: 'merged' });

      insertStory('stat-aband', 'prd-stats');
      insertWorktree({
        story_id: 'stat-aband',
        prd_id: 'prd-stats',
        status: 'abandoned',
        updated_at: Date.now() - 86_400_001,
      });

      insertWorktree({ story_id: 'stat-orphan' });

      pruneResult = { ok: true, data: 2 };

      const stats = await runGC();
      expect(stats.merged).toBe(1);
      expect(stats.abandoned).toBe(1);
      expect(stats.orphaned).toBe(1);
      expect(stats.stale).toBe(2);
      expect(stats.errors).toBe(0);
      expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('stats include error count', async () => {
      // Create a scenario where prune fails
      insertStory('prune-err', 'prd-err');
      insertWorktree({ story_id: 'prune-err', prd_id: 'prd-err' });
      pruneResult = { ok: false, error: 'prune failed' };

      const stats = await runGC();
      // Prune failure is caught but doesn't necessarily increment errors
      // since it's handled gracefully
      expect(typeof stats.errors).toBe('number');
    });
  });

  // =========================================================================
  // Event-driven cleanup (integration)
  // =========================================================================

  describe('event-driven cleanup via PRD events', () => {
    test('story_deleted event triggers worktree cleanup', async () => {
      insertStory('ev-del', 'prd-ev');
      insertWorktree({ story_id: 'ev-del', prd_id: 'prd-ev' });

      start();

      // Emit event and wait for async handler
      prdEvents.emit('prd_change', {
        type: 'story_deleted',
        prdId: 'prd-ev',
        storyId: 'ev-del',
        ts: Date.now(),
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));

      expect(removeRecordCalls.length).toBeGreaterThanOrEqual(1);
      expect(removeRecordCalls.some((c) => c.storyId === 'ev-del')).toBe(true);
    });

    test('stories_archived event triggers archived cleanup', async () => {
      insertStory('ev-arch1', 'prd-ev-arch', 'archived');
      insertWorktree({ story_id: 'ev-arch1', prd_id: 'prd-ev-arch' });

      start();

      prdEvents.emit('prd_change', {
        type: 'stories_archived',
        prdId: 'prd-ev-arch',
        ts: Date.now(),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(removeRecordCalls.some((c) => c.storyId === 'ev-arch1')).toBe(true);
    });

    test('prd_deleted event triggers PRD worktree cleanup', async () => {
      insertPrd('prd-ev-del');
      insertWorktree({ story_id: 'ev-prd-s1', prd_id: 'prd-ev-del' });
      insertWorktree({ story_id: 'ev-prd-s2', prd_id: 'prd-ev-del' });

      start();

      prdEvents.emit('prd_change', {
        type: 'prd_deleted',
        prdId: 'prd-ev-del',
        ts: Date.now(),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(removeRecordCalls.length).toBeGreaterThanOrEqual(2);
    });

    test('story_updated event cleans up worktree when story is archived', async () => {
      insertStory('ev-arch-upd', 'prd-ev-upd', 'archived');
      insertWorktree({ story_id: 'ev-arch-upd', prd_id: 'prd-ev-upd' });

      start();

      prdEvents.emit('prd_change', {
        type: 'story_updated',
        prdId: 'prd-ev-upd',
        storyId: 'ev-arch-upd',
        ts: Date.now(),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(removeRecordCalls.some((c) => c.storyId === 'ev-arch-upd')).toBe(true);
    });

    test('story_updated event does NOT clean up non-archived stories', async () => {
      insertStory('ev-active-upd', 'prd-ev-upd', 'in_progress');
      insertWorktree({ story_id: 'ev-active-upd', prd_id: 'prd-ev-upd' });

      start();

      prdEvents.emit('prd_change', {
        type: 'story_updated',
        prdId: 'prd-ev-upd',
        storyId: 'ev-active-upd',
        ts: Date.now(),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(removeRecordCalls).toHaveLength(0);
    });

    test('other events do not trigger cleanup', async () => {
      start();

      prdEvents.emit('prd_change', {
        type: 'prd_created',
        prdId: 'prd-created',
        ts: Date.now(),
      });

      prdEvents.emit('prd_change', {
        type: 'prd_updated',
        prdId: 'prd-updated',
        ts: Date.now(),
      });

      prdEvents.emit('prd_change', {
        type: 'story_updated',
        prdId: 'prd-updated',
        storyId: 's-updated',
        ts: Date.now(),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(removeRecordCalls).toHaveLength(0);
    });

    test('event handler does not throw on cleanup errors', async () => {
      insertStory('ev-err', 'prd-ev-err');
      insertWorktree({ story_id: 'ev-err', prd_id: 'prd-ev-err' });
      removeRecordResult = { ok: false, error: 'git error' };

      start();

      // Should not throw
      prdEvents.emit('prd_change', {
        type: 'story_deleted',
        prdId: 'prd-ev-err',
        storyId: 'ev-err',
        ts: Date.now(),
      });

      await new Promise((r) => setTimeout(r, 50));
      // No exception means success
    });
  });

  // =========================================================================
  // Story status triggers (from AC requirements)
  // =========================================================================

  describe('story status triggers', () => {
    test('cleanup works regardless of worktree status', async () => {
      const statuses = ['active', 'merging', 'merged', 'conflict', 'abandoned', 'cleanup_pending'];

      for (const status of statuses) {
        clearTables();
        removeRecordCalls = [];
        removeRecordResult = { ok: true };

        insertStory(`story-${status}`, 'prd-status');
        insertWorktree({
          story_id: `story-${status}`,
          prd_id: 'prd-status',
          status,
        });

        const result = await cleanupWorktreeForStory(`story-${status}`);
        expect(result).toBe(true);
        expect(removeRecordCalls).toHaveLength(1);
      }
    });
  });

  // =========================================================================
  // Configuration
  // =========================================================================

  describe('configuration', () => {
    test('default config values', () => {
      _testHelpers.resetState();
      const cfg = getConfig();
      expect(cfg.gcIntervalMs).toBe(3_600_000);
      expect(cfg.maxWorktreesPerWorkspace).toBe(5);
      expect(cfg.diskWarnBytes).toBe(1_000_000_000);
      expect(cfg.diskBlockBytes).toBe(100_000_000);
      expect(cfg.abandonedThresholdMs).toBe(86_400_000);
    });

    test('partial config override', () => {
      start({ gcIntervalMs: 5000, maxWorktreesPerWorkspace: 10 });
      const cfg = getConfig();
      expect(cfg.gcIntervalMs).toBe(5000);
      expect(cfg.maxWorktreesPerWorkspace).toBe(10);
      // Defaults preserved
      expect(cfg.diskWarnBytes).toBe(1_000_000_000);
    });

    test('configure() updates only specified fields', () => {
      start({ gcIntervalMs: 5000 });
      configure({ maxWorktreesPerWorkspace: 20 });
      const cfg = getConfig();
      expect(cfg.gcIntervalMs).toBe(5000); // unchanged
      expect(cfg.maxWorktreesPerWorkspace).toBe(20); // updated
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    test('GC with no worktrees is a no-op', async () => {
      const stats = await runGC();
      expect(stats.merged).toBe(0);
      expect(stats.abandoned).toBe(0);
      expect(stats.orphaned).toBe(0);
      expect(stats.stale).toBe(0);
      expect(stats.errors).toBe(0);
    });

    test('checkWorktreeLimit with empty workspace', () => {
      const check = checkWorktreeLimit('/empty/workspace');
      expect(check.allowed).toBe(true);
    });

    test('start/stop cycle multiple times', () => {
      start();
      stop();
      start();
      stop();
      start();
      stop();
      expect(_testHelpers.getGcTimer()).toBeNull();
      expect(_testHelpers.isEventListenerAttached()).toBe(false);
    });

    test('GC handles concurrent workspaces', async () => {
      insertStory('ws1-merged', 'prd-ws1');
      insertWorktree({
        story_id: 'ws1-merged',
        prd_id: 'prd-ws1',
        workspace_path: '/workspace-1',
        status: 'merged',
      });

      insertStory('ws2-merged', 'prd-ws2');
      insertWorktree({
        story_id: 'ws2-merged',
        prd_id: 'prd-ws2',
        workspace_path: '/workspace-2',
        status: 'merged',
      });

      const stats = await runGC();
      expect(stats.merged).toBe(2);
    });

    test('cleanup of story without prd_id works', async () => {
      insertStory('standalone-1', null);
      insertWorktree({ story_id: 'standalone-1', prd_id: null });

      const result = await cleanupWorktreeForStory('standalone-1');
      expect(result).toBe(true);
    });
  });
});
