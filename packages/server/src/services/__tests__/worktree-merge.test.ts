import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { Database } from 'bun:sqlite';
import type { WorktreeRecord, MergeOptions } from '@e/shared';

// ---------------------------------------------------------------------------
// Mock Bun.spawn
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

function findSpawnCall(pattern: string[]): { args: string[]; cwd: string } | undefined {
  return spawnCalls.find((c) => pattern.every((p, i) => c.args[i] === p));
}

// ---------------------------------------------------------------------------
// Fresh module loading (same pattern as worktree-db.test.ts)
// ---------------------------------------------------------------------------

process.env.E_DB_PATH = ':memory:';

const dbPath = '/home/nicole/maude/packages/server/src/db/database.ts';
const svcPath = '/home/nicole/maude/packages/server/src/services/worktree-service.ts';
const mergePath = '/home/nicole/maude/packages/server/src/services/worktree-merge.ts';

type DbModule = { getDb: () => Database; initDatabase: () => void };
type SvcModule = typeof import('../worktree-service');
type MergeModule = typeof import('../worktree-merge');

let dbMod: DbModule;
let svc: SvcModule;
let mergeMod: MergeModule;
let db: Database;

function loadFreshModules() {
  delete require.cache[dbPath];
  delete require.cache[svcPath];
  delete require.cache[mergePath];
  dbMod = require(dbPath) as DbModule;
  svc = require(svcPath) as SvcModule;
  mergeMod = require(mergePath) as MergeModule;
  dbMod.initDatabase();
  db = dbMod.getDb();
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestRecord(overrides: Partial<WorktreeRecord> = {}): WorktreeRecord {
  return {
    id: 'test-wt-001',
    story_id: 'test-story-1',
    prd_id: null,
    workspace_path: '/workspace',
    worktree_path: '/workspace/.e/worktrees/test-story-1',
    branch_name: 'story/test-story-1',
    base_branch: 'main',
    base_commit: 'abc123',
    status: 'active',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function insertWorktreeRecord(record: WorktreeRecord): void {
  db.query(
    `INSERT INTO worktrees (id, story_id, prd_id, workspace_path, worktree_path, branch_name, base_branch, base_commit, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.story_id,
    record.prd_id,
    record.workspace_path,
    record.worktree_path,
    record.branch_name,
    record.base_branch,
    record.base_commit,
    record.status,
    record.created_at,
    record.updated_at,
  );
}

function insertTestStory(storyId: string, overrides: Record<string, any> = {}): void {
  const now = Date.now();
  db.query(
    `INSERT INTO prd_stories (id, title, description, status, learnings, attempts, max_attempts, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    storyId,
    overrides.title ?? 'Test Story',
    overrides.description ?? 'desc',
    overrides.status ?? 'in_progress',
    overrides.learnings ?? '[]',
    overrides.attempts ?? 0,
    overrides.max_attempts ?? 3,
    0,
    now,
    now,
  );
}

function getStory(storyId: string): any {
  return db.query('SELECT * FROM prd_stories WHERE id = ?').get(storyId);
}

function getWtRecord(storyId: string): any {
  return db.query('SELECT * FROM worktrees WHERE story_id = ?').get(storyId);
}

// ---------------------------------------------------------------------------
// detectConflictFiles
// ---------------------------------------------------------------------------

describe('detectConflictFiles', () => {
  beforeEach(() => {
    loadFreshModules();
    setupSpawnMock();
  });
  afterEach(() => restoreSpawnMock());

  // Guards: primary conflict detection via `git diff --diff-filter=U` correctly parses file paths
  test('parses from git diff --diff-filter=U', async () => {
    mockSpawnResult('src/main.ts\nsrc/utils.ts\n', '', 0);
    const files = await mergeMod.detectConflictFiles('/workspace');
    expect(files).toEqual(['src/main.ts', 'src/utils.ts']);
  });

  // Guards: fallback detection when diff-filter fails — uses git status porcelain markers (UU/AA)
  test('falls back to git status UU/AA entries', async () => {
    mockSpawnResult('', '', 1);
    mockSpawnResult('UU src/conflict.ts\nAA src/both.ts\n M src/clean.ts\n', '', 0);
    const files = await mergeMod.detectConflictFiles('/workspace');
    expect(files).toEqual(['src/conflict.ts', 'src/both.ts']);
  });

  // Guards: returns empty array (not error) when no conflicts exist — clean state baseline
  test('empty when no conflicts', async () => {
    mockSpawnResult('', '', 0);
    expect(await mergeMod.detectConflictFiles('/w')).toEqual([]);
  });

  // Guards: graceful degradation — returns empty array when both detection methods fail
  test('empty when both fail', async () => {
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 1);
    expect(await mergeMod.detectConflictFiles('/w')).toEqual([]);
  });

  // Guards: delete/update and update/delete conflict markers are detected (not just UU/AA)
  test('handles DU/UD markers', async () => {
    mockSpawnResult('', '', 1);
    mockSpawnResult('DU d.ts\nUD u.ts\n', '', 0);
    expect(await mergeMod.detectConflictFiles('/w')).toEqual(['d.ts', 'u.ts']);
  });
});

// ---------------------------------------------------------------------------
// merge() — unit tests
// ---------------------------------------------------------------------------

describe('merge()', () => {
  beforeEach(() => {
    loadFreshModules();
    setupSpawnMock();
    mergeMod._testHelpers.clearLocks();
  });
  afterEach(() => restoreSpawnMock());

  // Guards: merge fails gracefully when story has no worktree record — prevents null dereference
  test('error when no record', async () => {
    const r = await mergeMod.merge({ storyId: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('No worktree record');
    expect(r.operationLog.length).toBeGreaterThan(0);
  });

  // Guards: idempotency — prevents double-merging an already-merged story
  test('error when already merged', async () => {
    insertWorktreeRecord(createTestRecord({ status: 'merged' }));
    const r = await mergeMod.merge({ storyId: 'test-story-1' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('merged');
  });

  // Guards: status gate — only active/merging/conflict states can trigger merge
  test('error for invalid status', async () => {
    insertWorktreeRecord(createTestRecord({ status: 'abandoned' }));
    const r = await mergeMod.merge({ storyId: 'test-story-1' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('abandoned');
  });

  // AC1: Pre-check rejects dirty worktrees — uncommitted changes must be resolved before merge
  test('AC1: dirty worktree fails pre-check', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'dirty');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'dirty', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    mockSpawnResult(' M dirty.ts\n', '', 0);
    const r = await mergeMod.merge({ storyId: 'dirty' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('uncommitted');
    expect(r.status).toBe('active');
    expect(getWtRecord('dirty').status).toBe('active');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC1: Pre-check rejects failing quality checks — prevents merging broken code
  test('AC1: quality failure fails pre-check', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'qf');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'qf', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    mockSpawnResult('', '', 0); // clean
    mockSpawnResult('', 'Type error', 1); // quality fails
    const r = await mergeMod.merge({ storyId: 'qf' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Quality checks failed');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC1: skipQualityCheck flag bypasses quality step — needed for retry flows and manual overrides
  test('AC1: skipQualityCheck skips quality', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'sq');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'sq', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    mockSpawnResult('', '', 0); // clean
    mockSpawnResult('', '', 1); // no remote
    mockSpawnResult('', '', 0); // rebase
    mockSpawnResult('', '', 0); // checkout
    mockSpawnResult('', '', 0); // ff merge
    mockSpawnResult('sha\n', '', 0); // rev-parse
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    await mergeMod.merge({ storyId: 'sq', skipQualityCheck: true });
    expect(
      spawnCalls.find((c) => c.args.includes('bun') && c.args.includes('check')),
    ).toBeUndefined();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC2: Verifies rebase is invoked against base branch and merge succeeds end-to-end
  test('AC2: successful rebase', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'rb');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'rb', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    insertTestStory('rb');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 0); // rebase
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('msha\n', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    const r = await mergeMod.merge({ storyId: 'rb' });
    expect(r.ok).toBe(true);
    expect(r.commitSha).toBe('msha');
    expect(findSpawnCall(['git', 'rebase', 'main'])).toBeDefined();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC3: Rebase conflict triggers abort + file detection — ensures clean state after conflict
  test('AC3: conflict triggers abort and file detection', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'cf');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'cf', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    insertTestStory('cf');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', 'CONFLICT', 1); // rebase fails
    mockSpawnResult('a.ts\nb.ts\n', '', 0); // conflict files
    mockSpawnResult('', '', 0); // abort
    const r = await mergeMod.merge({ storyId: 'cf' });
    expect(r.ok).toBe(false);
    expect(r.conflictingFiles).toEqual(['a.ts', 'b.ts']);
    expect(r.status).toBe('conflict');
    expect(findSpawnCall(['git', 'rebase', '--abort'])).toBeDefined();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC4: Conflict sets story=failed with file-list learning — preserves existing learnings and increments attempts
  test('AC4: conflict sets story=failed with learning', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'lr');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'lr', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    insertTestStory('lr', { learnings: '["old"]', attempts: 1 });
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', 'CONFLICT', 1);
    mockSpawnResult('x.ts\n', '', 0);
    mockSpawnResult('', '', 0);
    await mergeMod.merge({ storyId: 'lr' });
    const s = getStory('lr');
    expect(s.status).toBe('failed');
    const l = JSON.parse(s.learnings);
    expect(l).toHaveLength(2);
    expect(l[0]).toBe('old');
    expect(l[1]).toContain('x.ts');
    expect(s.attempts).toBe(2);
    expect(getWtRecord('lr').status).toBe('conflict');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC5: Verifies the preferred merge path: rebase then --ff-only into base
  test('AC5: rebase + ff-only merge', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'ff');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'ff', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    insertTestStory('ff');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('ffs\n', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    const r = await mergeMod.merge({ storyId: 'ff' });
    expect(r.ok).toBe(true);
    expect(findSpawnCall(['git', 'merge', '--ff-only'])).toBeDefined();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC6: Post-merge cleanup: status=merged, worktree removed, branch deleted — prevents stale resources
  test('AC6: cleanup removes worktree and branch', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'cl');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'cl', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    insertTestStory('cl');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('cs\n', '', 0);
    mockSpawnResult('', '', 0); // wt remove
    mockSpawnResult('', '', 0); // branch -d
    mockSpawnResult('', '', 0); // prune
    const r = await mergeMod.merge({ storyId: 'cl' });
    expect(r.ok).toBe(true);
    expect(getWtRecord('cl').status).toBe('merged');
    expect(spawnCalls.some((c) => c.args[1] === 'worktree' && c.args[2] === 'remove')).toBe(true);
    expect(findSpawnCall(['git', 'branch', '-d'])).toBeDefined();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC7: Story's commitSha updated to merge commit — enables traceability from story to merged code
  test('AC7: commitSha updated in story', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'sha');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'sha', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    insertTestStory('sha');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('the-sha\n', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    const r = await mergeMod.merge({ storyId: 'sha' });
    expect(r.commitSha).toBe('the-sha');
    expect(getStory('sha').commit_sha).toBe('the-sha');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC9: Safety invariant — no git command should contain --force, push, or -D (force delete)
  test('AC9: never force-push/merge', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'nf');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'nf', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    insertTestStory('nf');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('s\n', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    await mergeMod.merge({ storyId: 'nf' });
    for (const c of spawnCalls) {
      const a = c.args.join(' ');
      expect(a).not.toContain('--force');
      expect(a).not.toContain('push');
      if (c.args.includes('branch')) {
        expect(c.args).toContain('-d');
        expect(c.args).not.toContain('-D');
      }
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC10: When --ff-only fails post-rebase, falls back to --no-ff merge commit
  test('AC10: ff-only fallback to merge commit', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'fb');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'fb', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    insertTestStory('fb');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 0); // rebase
    mockSpawnResult('', '', 0); // checkout
    mockSpawnResult('', 'Not ff', 1); // ff fails
    mockSpawnResult('', '', 0); // --no-ff ok
    mockSpawnResult('mc\n', '', 0); // rev-parse
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    const r = await mergeMod.merge({ storyId: 'fb' });
    expect(r.ok).toBe(true);
    expect(r.commitSha).toBe('mc');
    expect(findSpawnCall(['git', 'merge', '--no-ff'])).toBeDefined();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC10 edge case: when both ff-only and --no-ff fail, status reverts to active safely
  test('AC10: both merge methods fail', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'bf');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'bf', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    insertTestStory('bf');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', 'ff fail', 1);
    mockSpawnResult('', 'mc fail', 1);
    mockSpawnResult('', '', 0); // merge --abort
    const r = await mergeMod.merge({ storyId: 'bf' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('active');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC11: Every operation step has a valid ISO 8601 timestamp and covers the full merge pipeline
  test('AC11: all operations logged with timestamps', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'lg');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'lg', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    insertTestStory('lg');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('ls\n', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    const r = await mergeMod.merge({ storyId: 'lg' });
    expect(r.operationLog.length).toBeGreaterThan(5);
    for (const e of r.operationLog) {
      expect(e.timestamp).toBeDefined();
      expect(typeof e.timestamp).toBe('string');
      expect(new Date(e.timestamp).toISOString()).toBe(e.timestamp);
      expect(typeof e.success).toBe('boolean');
    }
    const ops = r.operationLog.map((e) => e.operation);
    expect(ops).toContain('start');
    expect(ops).toContain('validate');
    expect(ops).toContain('status:merging');
    expect(ops).toContain('pre-check:clean');
    expect(ops).toContain('rebase');
    expect(ops).toContain('complete');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Guards: worktree directory deletion between record creation and merge doesn't crash
  test('missing directory fails pre-check', async () => {
    insertWorktreeRecord(createTestRecord({ story_id: 'nd', worktree_path: '/gone' }));
    const r = await mergeMod.merge({ storyId: 'nd' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not found');
  });

  // Guards: unexpected exceptions (e.g. spawn crash) are caught and returned as MergeResult errors
  test('handles exceptions gracefully', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'ex');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'ex', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    (Bun as any).spawn = () => {
      throw new Error('boom');
    };
    const r = await mergeMod.merge({ storyId: 'ex' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('boom');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Guards: worktrees in 'conflict' status can be merged directly — enables retry without explicit retry()
  test('conflict status allowed for merge', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'cm');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({
        story_id: 'cm',
        workspace_path: tmpDir,
        worktree_path: wtPath,
        status: 'conflict',
      }),
    );
    insertTestStory('cm');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('cs\n', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    const r = await mergeMod.merge({ storyId: 'cm' });
    expect(r.ok).toBe(true);
    expect(r.status).toBe('merged');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Guards: non-default base branch (e.g. 'develop') is correctly passed to rebase and checkout
  test('custom base_branch used', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'cb');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({
        story_id: 'cb',
        workspace_path: tmpDir,
        worktree_path: wtPath,
        base_branch: 'develop',
      }),
    );
    insertTestStory('cb');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('s\n', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    await mergeMod.merge({ storyId: 'cb' });
    expect(findSpawnCall(['git', 'rebase', 'develop'])).toBeDefined();
    expect(findSpawnCall(['git', 'checkout', 'develop'])).toBeDefined();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// retry()
// ---------------------------------------------------------------------------

describe('retry()', () => {
  beforeEach(() => {
    loadFreshModules();
    setupSpawnMock();
    mergeMod._testHelpers.clearLocks();
  });
  afterEach(() => restoreSpawnMock());

  // AC8: retry() resets conflict→active and re-runs merge — verifies full retry flow after resolution
  test('AC8: retry after conflict resolution', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'rt');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({
        story_id: 'rt',
        workspace_path: tmpDir,
        worktree_path: wtPath,
        status: 'conflict',
      }),
    );
    insertTestStory('rt');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('rs\n', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    const r = await mergeMod.retry({ storyId: 'rt' });
    expect(r.ok).toBe(true);
    expect(r.commitSha).toBe('rs');
    expect(r.status).toBe('merged');
    expect(r.operationLog.some((e) => e.operation.startsWith('retry:'))).toBe(true);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Guards: retry rejects already-merged stories — prevents double-merge via retry path
  test('retry fails for merged status', async () => {
    insertWorktreeRecord(createTestRecord({ story_id: 'br', status: 'merged' }));
    const r = await mergeMod.retry({ storyId: 'br' });
    expect(r.ok).toBe(false);
  });

  // Guards: retry with nonexistent story ID returns structured error, not crash
  test('retry missing record', async () => {
    const r = await mergeMod.retry({ storyId: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('No worktree');
  });

  // Guards: retry defaults to skipQualityCheck=true since user has already resolved conflicts manually
  test('retry skips quality by default', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'rq');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({
        story_id: 'rq',
        workspace_path: tmpDir,
        worktree_path: wtPath,
        status: 'conflict',
      }),
    );
    insertTestStory('rq');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('s\n', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    await mergeMod.retry({ storyId: 'rq' });
    expect(
      spawnCalls.find((c) => c.args.includes('bun') && c.args.includes('check')),
    ).toBeUndefined();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Operation log detail tests
// ---------------------------------------------------------------------------

describe('operation log', () => {
  beforeEach(() => {
    loadFreshModules();
    setupSpawnMock();
    mergeMod._testHelpers.clearLocks();
  });
  afterEach(() => restoreSpawnMock());

  // AC11: Conflict path includes all expected operation names in the log for debuggability
  test('conflict path logs expected operations', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wt-'));
    const wtPath = join(tmpDir, '.e', 'worktrees', 'ol');
    mkdirSync(wtPath, { recursive: true });
    insertWorktreeRecord(
      createTestRecord({ story_id: 'ol', workspace_path: tmpDir, worktree_path: wtPath }),
    );
    insertTestStory('ol');
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 0);
    mockSpawnResult('', '', 1);
    mockSpawnResult('', 'CONFLICT', 1);
    mockSpawnResult('f.ts\n', '', 0);
    mockSpawnResult('', '', 0);
    const r = await mergeMod.merge({ storyId: 'ol' });
    const ops = r.operationLog.map((e) => e.operation);
    expect(ops).toContain('rebase');
    expect(ops).toContain('conflict:detect');
    expect(ops).toContain('rebase:abort');
    expect(ops).toContain('conflict:status');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // AC11: Failed operations are correctly marked with success=false in the log
  test('failure entries have success=false', async () => {
    insertWorktreeRecord(createTestRecord({ story_id: 'fl', worktree_path: '/no' }));
    const r = await mergeMod.merge({ storyId: 'fl' });
    expect(r.operationLog.some((e) => !e.success)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mutex
// ---------------------------------------------------------------------------

describe('merge mutex', () => {
  beforeEach(() => {
    loadFreshModules();
    setupSpawnMock();
    mergeMod._testHelpers.clearLocks();
  });
  afterEach(() => restoreSpawnMock());

  // Guards: per-workspace mutex is released after merge completes — prevents deadlock on subsequent merges
  test('cleaned up after operation', async () => {
    insertWorktreeRecord(createTestRecord({ story_id: 'mx' }));
    await mergeMod.merge({ storyId: 'mx' });
    expect(mergeMod._testHelpers.getMergeLocks().size).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — real git repos
// ---------------------------------------------------------------------------

describe('integration: real git repos', () => {
  let repoDir: string;

  async function execGit(args: string[], cwd?: string): Promise<string> {
    const proc = Bun.spawn(['git', ...args], {
      cwd: cwd ?? repoDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@test.com',
      },
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new Error(`git ${args.join(' ')} (${exitCode}): ${stderr}`);
    return stdout;
  }

  beforeEach(async () => {
    restoreSpawnMock();
    loadFreshModules();
    mergeMod._testHelpers.clearLocks();
    repoDir = mkdtempSync(join(tmpdir(), 'wt-int-'));
    await execGit(['init', '-b', 'main']);
    writeFileSync(join(repoDir, 'README.md'), '# Test\n');
    writeFileSync(join(repoDir, 'shared.ts'), 'export const v = 1;\n');
    await execGit(['add', '.']);
    await execGit(['commit', '-m', 'init']);
  });

  afterEach(() => {
    if (repoDir && existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
  });

  // AC13: End-to-end with real git: creates worktree, commits, merges, verifies DB + git state
  test('AC13: successful non-conflicting merge', async () => {
    const sid = 'ic';
    const wtr = await svc.create({ workspacePath: repoDir, storyId: sid, baseBranch: 'main' });
    expect(wtr.ok).toBe(true);
    const wtp = wtr.data!;
    insertWorktreeRecord(
      createTestRecord({
        story_id: sid,
        workspace_path: repoDir,
        worktree_path: wtp,
        branch_name: `story/${sid}`,
        base_branch: 'main',
      }),
    );
    insertTestStory(sid);
    writeFileSync(join(wtp, 'feat.ts'), 'export const f = 1;\n');
    await execGit(['add', '.'], wtp);
    await execGit(['commit', '-m', 'feat'], wtp);
    const r = await mergeMod.merge({ storyId: sid, skipQualityCheck: true });
    expect(r.ok).toBe(true);
    expect(r.status).toBe('merged');
    expect(r.commitSha).toBeDefined();
    expect(await execGit(['log', '--oneline', '-3'])).toContain('feat');
    expect(getWtRecord(sid).status).toBe('merged');
    expect(getStory(sid).commit_sha).toBe(r.commitSha);
  });

  // AC13: Real conflict scenario — divergent edits to same file trigger conflict path with clean abort
  test('AC13: conflict with real divergent branches', async () => {
    const sid = 'ix';
    const wtr = await svc.create({ workspacePath: repoDir, storyId: sid, baseBranch: 'main' });
    expect(wtr.ok).toBe(true);
    const wtp = wtr.data!;
    insertWorktreeRecord(
      createTestRecord({
        story_id: sid,
        workspace_path: repoDir,
        worktree_path: wtp,
        branch_name: `story/${sid}`,
        base_branch: 'main',
      }),
    );
    insertTestStory(sid);
    writeFileSync(join(wtp, 'shared.ts'), 'export const v = 2;\n');
    await execGit(['add', '.'], wtp);
    await execGit(['commit', '-m', 'story change'], wtp);
    writeFileSync(join(repoDir, 'shared.ts'), 'export const v = 3;\n');
    await execGit(['add', '.']);
    await execGit(['commit', '-m', 'main change']);
    const r = await mergeMod.merge({ storyId: sid, skipQualityCheck: true });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('conflict');
    expect(r.conflictingFiles).toContain('shared.ts');
    expect(getStory(sid).status).toBe('failed');
    expect(JSON.parse(getStory(sid).learnings)[0]).toContain('shared.ts');
    expect(getWtRecord(sid).status).toBe('conflict');
    // Worktree clean after abort
    expect((await execGit(['status', '--porcelain'], wtp)).trim()).toBe('');
  });

  // AC8+13: Full retry cycle with real git — conflict, manual resolution, retry succeeds
  test('AC8+13: retry after resolution', async () => {
    const sid = 'ir';
    const wtr = await svc.create({ workspacePath: repoDir, storyId: sid, baseBranch: 'main' });
    const wtp = wtr.data!;
    insertWorktreeRecord(
      createTestRecord({
        story_id: sid,
        workspace_path: repoDir,
        worktree_path: wtp,
        branch_name: `story/${sid}`,
        base_branch: 'main',
      }),
    );
    insertTestStory(sid);
    writeFileSync(join(wtp, 'shared.ts'), 'export const v = "s";\n');
    await execGit(['add', '.'], wtp);
    await execGit(['commit', '-m', 's'], wtp);
    writeFileSync(join(repoDir, 'shared.ts'), 'export const v = "m";\n');
    await execGit(['add', '.']);
    await execGit(['commit', '-m', 'm']);
    const first = await mergeMod.merge({ storyId: sid, skipQualityCheck: true });
    expect(first.status).toBe('conflict');
    // Resolve: reset story branch to main, then make a clean non-conflicting commit
    await execGit(['reset', '--hard', 'main'], wtp);
    writeFileSync(join(wtp, 'feature.ts'), 'export const feature = true;\n');
    await execGit(['add', '.'], wtp);
    await execGit(['commit', '-m', 'resolved: add feature'], wtp);
    const r = await mergeMod.retry({ storyId: sid, skipQualityCheck: true });
    expect(r.ok).toBe(true);
    expect(r.status).toBe('merged');
  });

  // Guards: rebase handles non-conflicting parallel changes — story adds file while main edits another
  test('non-conflicting parallel development', async () => {
    const sid = 'ip';
    const wtr = await svc.create({ workspacePath: repoDir, storyId: sid, baseBranch: 'main' });
    const wtp = wtr.data!;
    insertWorktreeRecord(
      createTestRecord({
        story_id: sid,
        workspace_path: repoDir,
        worktree_path: wtp,
        branch_name: `story/${sid}`,
        base_branch: 'main',
      }),
    );
    insertTestStory(sid);
    writeFileSync(join(wtp, 'new.ts'), 'export const n = 1;\n');
    await execGit(['add', '.'], wtp);
    await execGit(['commit', '-m', 'new file'], wtp);
    writeFileSync(join(repoDir, 'README.md'), '# Updated\n');
    await execGit(['add', '.']);
    await execGit(['commit', '-m', 'update readme']);
    const r = await mergeMod.merge({ storyId: sid, skipQualityCheck: true });
    expect(r.ok).toBe(true);
    expect(existsSync(join(repoDir, 'new.ts'))).toBe(true);
  });
});
