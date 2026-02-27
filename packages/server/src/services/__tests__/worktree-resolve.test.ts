import { describe, test, expect, beforeEach, spyOn } from 'bun:test';
import { resolve } from 'path';
import { createTestDb } from '../../test-helpers';
import { mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Test database
// ---------------------------------------------------------------------------

const testDb = createTestDb();

mock.module('../../db/database', () => ({
  getDb: () => testDb,
  initDatabase: () => {},
}));

// Mock Bun.spawn (required by worktree-service module)
(Bun as any).spawn = () => {
  return {
    stdout: new ReadableStream({
      start(controller: ReadableStreamDefaultController) {
        controller.enqueue(new TextEncoder().encode(''));
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller: ReadableStreamDefaultController) {
        controller.enqueue(new TextEncoder().encode(''));
        controller.close();
      },
    }),
    exited: Promise.resolve(0),
  };
};

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { resolveWorkspacePath, getForStory } from '../worktree-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearWorktrees() {
  testDb.exec('DELETE FROM worktrees');
}

function insertWorktreeRecord(overrides: Record<string, any> = {}) {
  const defaults = {
    id: 'wt-test-' + Math.random().toString(36).slice(2, 8),
    story_id: 'test-story',
    prd_id: null,
    workspace_path: '/workspace/project',
    worktree_path: '/workspace/project/.e/worktrees/test-story',
    branch_name: 'story/test-story',
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

describe('resolveWorkspacePath', () => {
  beforeEach(() => {
    clearWorktrees();
  });

  // AC1: Returns worktree path for stories with active worktrees
  test('returns worktree path for active story', () => {
    insertWorktreeRecord({
      story_id: 'active-story',
      workspace_path: '/workspace/project',
      worktree_path: '/workspace/project/.e/worktrees/active-story',
      status: 'active',
    });
    const result = resolveWorkspacePath('/workspace/project', 'active-story');
    expect(result).toBe(resolve('/workspace/project/.e/worktrees/active-story'));
  });

  test('returns worktree path for merging story', () => {
    insertWorktreeRecord({
      story_id: 'merging-story',
      workspace_path: '/workspace/project',
      worktree_path: '/workspace/project/.e/worktrees/merging-story',
      branch_name: 'story/merging-story',
      status: 'merging',
    });
    const result = resolveWorkspacePath('/workspace/project', 'merging-story');
    expect(result).toBe(resolve('/workspace/project/.e/worktrees/merging-story'));
  });

  test('returns worktree path for conflict story', () => {
    insertWorktreeRecord({
      story_id: 'conflict-story',
      workspace_path: '/workspace/project',
      worktree_path: '/workspace/project/.e/worktrees/conflict-story',
      branch_name: 'story/conflict-story',
      status: 'conflict',
    });
    const result = resolveWorkspacePath('/workspace/project', 'conflict-story');
    expect(result).toBe(resolve('/workspace/project/.e/worktrees/conflict-story'));
  });

  // AC2: Returns workspacePath when storyId is null or no worktree
  test('returns workspacePath when storyId is null', () => {
    const result = resolveWorkspacePath('/workspace/project', null);
    expect(result).toBe(resolve('/workspace/project'));
  });

  test('returns workspacePath when storyId is undefined', () => {
    const result = resolveWorkspacePath('/workspace/project', undefined);
    expect(result).toBe(resolve('/workspace/project'));
  });

  test('returns workspacePath when storyId is empty string', () => {
    const result = resolveWorkspacePath('/workspace/project', '');
    expect(result).toBe(resolve('/workspace/project'));
  });

  test('returns workspacePath when no worktree record exists', () => {
    const result = resolveWorkspacePath('/workspace/project', 'nonexistent');
    expect(result).toBe(resolve('/workspace/project'));
  });

  // AC3: Graceful fallback with warning log
  test('logs warning when no worktree record for storyId', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    resolveWorkspacePath('/workspace/project', 'missing-story');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no worktree record for story missing-story'),
    );
    warnSpy.mockRestore();
  });

  test('logs warning when worktree has abandoned status', () => {
    insertWorktreeRecord({
      story_id: 'abandoned-story',
      workspace_path: '/workspace/project',
      worktree_path: '/workspace/project/.e/worktrees/abandoned-story',
      branch_name: 'story/abandoned-story',
      status: 'abandoned',
    });
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const result = resolveWorkspacePath('/workspace/project', 'abandoned-story');
    expect(result).toBe(resolve('/workspace/project'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("has status 'abandoned'"));
    warnSpy.mockRestore();
  });

  test('falls back for merged status', () => {
    insertWorktreeRecord({
      story_id: 'merged-story',
      workspace_path: '/workspace/project',
      worktree_path: '/workspace/project/.e/worktrees/merged-story',
      branch_name: 'story/merged-story',
      status: 'merged',
    });
    const result = resolveWorkspacePath('/workspace/project', 'merged-story');
    expect(result).toBe(resolve('/workspace/project'));
  });

  test('falls back for cleanup_pending status', () => {
    insertWorktreeRecord({
      story_id: 'cleanup-story',
      workspace_path: '/workspace/project',
      worktree_path: '/workspace/project/.e/worktrees/cleanup-story',
      branch_name: 'story/cleanup-story',
      status: 'cleanup_pending',
    });
    const result = resolveWorkspacePath('/workspace/project', 'cleanup-story');
    expect(result).toBe(resolve('/workspace/project'));
  });

  // Path resolution correctness
  test('resolves relative workspacePath to absolute', () => {
    const result = resolveWorkspacePath('./relative/path', null);
    expect(result).toBe(resolve('./relative/path'));
  });

  test('resolves worktree path correctly as absolute', () => {
    insertWorktreeRecord({
      story_id: 'abs-test',
      workspace_path: '/workspace/project',
      worktree_path: '/workspace/project/.e/worktrees/abs-test',
      branch_name: 'story/abs-test',
      status: 'active',
    });
    const result = resolveWorkspacePath('/workspace/project', 'abs-test');
    expect(result.startsWith('/')).toBe(true);
    expect(result).toContain('.e/worktrees/abs-test');
  });
});

describe('getForStory', () => {
  beforeEach(() => {
    clearWorktrees();
  });

  test('returns null for nonexistent story', () => {
    expect(getForStory('nonexistent')).toBeNull();
  });

  test('returns record for existing story', () => {
    insertWorktreeRecord({
      story_id: 'my-story',
      workspace_path: '/workspace/project',
      worktree_path: '/workspace/project/.e/worktrees/my-story',
      branch_name: 'story/my-story',
      status: 'active',
    });
    const record = getForStory('my-story');
    expect(record).not.toBeNull();
    expect(record!.story_id).toBe('my-story');
    expect(record!.status).toBe('active');
  });
});
