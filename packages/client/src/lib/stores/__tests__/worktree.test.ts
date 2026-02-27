import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { StreamLoopEvent, WorktreeInfo, WorktreeRecord, WorktreeStatus } from '@e/shared';

// Mock the API client before importing the store
vi.mock('$lib/api/client', () => ({
  api: {
    worktrees: {
      list: vi.fn(),
      create: vi.fn(),
      prune: vi.fn(),
      status: vi.fn(),
      merge: vi.fn(),
      remove: vi.fn(),
    },
  },
}));

import { worktreeStore, type WorktreeEntry } from '../worktree.svelte';
import { api } from '$lib/api/client';

// Helper to create a mock WorktreeEntry
function mockEntry(overrides: Partial<WorktreeEntry> = {}): WorktreeEntry {
  return {
    path: '/test/.e/worktrees/story-abc',
    branch: 'story/abc',
    head: 'abc123',
    storyId: 'abc',
    isMain: false,
    isLocked: false,
    isDirty: false,
    record: {
      id: 'rec1',
      story_id: 'abc',
      prd_id: null,
      workspace_path: '/test',
      worktree_path: '/test/.e/worktrees/story-abc',
      branch_name: 'story/abc',
      base_branch: 'main',
      base_commit: 'base123',
      status: 'active' as WorktreeStatus,
      created_at: Date.now(),
      updated_at: Date.now(),
    },
    ...overrides,
  };
}

function mockLoopEvent(
  event: StreamLoopEvent['event'],
  data: Partial<StreamLoopEvent['data']> = {},
): StreamLoopEvent {
  return {
    type: 'loop_event',
    loopId: 'loop1',
    event,
    data: {
      storyId: 'abc',
      ...data,
    },
  };
}

beforeEach(() => {
  worktreeStore.reset();
  vi.clearAllMocks();
});

// ============================================================================
// Initial state — ensure store starts clean
// ============================================================================
describe('worktreeStore initial state', () => {
  // Verifies the store starts in a clean empty state
  test('starts with empty worktrees', () => {
    expect(worktreeStore.worktrees).toEqual([]);
    expect(worktreeStore.loading).toBe(false);
    expect(worktreeStore.error).toBeNull();
    expect(worktreeStore.activeCount).toBe(0);
  });

  // Verifies byStatus returns empty arrays for all statuses
  test('byStatus returns empty groups initially', () => {
    const groups = worktreeStore.byStatus;
    expect(groups.active).toEqual([]);
    expect(groups.merging).toEqual([]);
    expect(groups.merged).toEqual([]);
    expect(groups.conflict).toEqual([]);
    expect(groups.abandoned).toEqual([]);
    expect(groups.cleanup_pending).toEqual([]);
    expect(groups.unknown).toEqual([]);
  });
});

// ============================================================================
// load() — fetches worktrees from API
// ============================================================================
describe('worktreeStore.load()', () => {
  // Verifies that worktrees are populated from API response
  test('loads worktrees from API', async () => {
    const entries: WorktreeEntry[] = [
      mockEntry(),
      mockEntry({ storyId: 'def', branch: 'story/def' }),
    ];
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({ ok: true, data: entries });

    await worktreeStore.load('/test');

    expect(api.worktrees.list).toHaveBeenCalledWith('/test');
    expect(worktreeStore.worktrees).toHaveLength(2);
    expect(worktreeStore.loading).toBe(false);
    expect(worktreeStore.error).toBeNull();
  });

  // Verifies error state is set when API fails
  test('sets error on API failure', async () => {
    vi.mocked(api.worktrees.list).mockRejectedValueOnce(new Error('Network error'));

    await worktreeStore.load('/test');

    expect(worktreeStore.error).toBe('Network error');
    expect(worktreeStore.worktrees).toEqual([]);
    expect(worktreeStore.loading).toBe(false);
  });

  // Verifies no-op for empty workspace path
  test('does nothing for empty workspace path', async () => {
    await worktreeStore.load('');

    expect(api.worktrees.list).not.toHaveBeenCalled();
  });

  // Verifies error set when API returns ok: false
  test('sets error when API returns ok: false', async () => {
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({ ok: false, data: [] });

    await worktreeStore.load('/test');

    expect(worktreeStore.error).toBe('Failed to load worktrees');
  });
});

// ============================================================================
// getForStory() — lookup worktree by story ID
// ============================================================================
describe('worktreeStore.getForStory()', () => {
  // Verifies story lookup returns the correct worktree entry
  test('returns entry for existing story', async () => {
    const entries = [mockEntry({ storyId: 'abc' }), mockEntry({ storyId: 'def' })];
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({ ok: true, data: entries });
    await worktreeStore.load('/test');

    const result = worktreeStore.getForStory('abc');
    expect(result).toBeDefined();
    expect(result?.storyId).toBe('abc');
  });

  // Verifies undefined is returned for non-existent story
  test('returns undefined for non-existent story', async () => {
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({ ok: true, data: [mockEntry()] });
    await worktreeStore.load('/test');

    const result = worktreeStore.getForStory('nonexistent');
    expect(result).toBeUndefined();
  });

  // Verifies undefined when store is empty
  test('returns undefined when store is empty', () => {
    const result = worktreeStore.getForStory('abc');
    expect(result).toBeUndefined();
  });
});

// ============================================================================
// Derived state — activeCount, byStatus
// ============================================================================
describe('worktreeStore derived state', () => {
  // Verifies activeCount counts non-main worktrees with records
  test('activeCount counts non-main worktrees with records', async () => {
    const entries = [
      mockEntry({ storyId: 'abc' }),
      mockEntry({ storyId: 'def' }),
      mockEntry({ storyId: null, isMain: true, record: null }), // main worktree
    ];
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({ ok: true, data: entries });
    await worktreeStore.load('/test');

    expect(worktreeStore.activeCount).toBe(2);
  });

  // Verifies byStatus groups worktrees correctly
  test('byStatus groups worktrees by record status', async () => {
    const entries = [
      mockEntry({
        storyId: 'a',
        record: { ...mockEntry().record!, status: 'active' as WorktreeStatus },
      }),
      mockEntry({
        storyId: 'b',
        record: { ...mockEntry().record!, status: 'merging' as WorktreeStatus },
      }),
      mockEntry({
        storyId: 'c',
        record: { ...mockEntry().record!, status: 'conflict' as WorktreeStatus },
      }),
      mockEntry({ storyId: 'd', record: null }), // no record → unknown
    ];
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({ ok: true, data: entries });
    await worktreeStore.load('/test');

    const groups = worktreeStore.byStatus;
    expect(groups.active).toHaveLength(1);
    expect(groups.merging).toHaveLength(1);
    expect(groups.conflict).toHaveLength(1);
    expect(groups.unknown).toHaveLength(1);
  });

  // Verifies main worktrees are excluded from byStatus
  test('byStatus excludes main worktrees', async () => {
    const entries = [mockEntry({ storyId: null, isMain: true }), mockEntry({ storyId: 'abc' })];
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({ ok: true, data: entries });
    await worktreeStore.load('/test');

    const total = Object.values(worktreeStore.byStatus).reduce((sum, arr) => sum + arr.length, 0);
    expect(total).toBe(1); // only non-main worktree
  });
});

// ============================================================================
// loadDetail() — fetches worktree status details
// ============================================================================
describe('worktreeStore.loadDetail()', () => {
  // Verifies detail status is fetched and cached
  test('fetches and caches detail status', async () => {
    const detailData = {
      branch: 'story/abc',
      dirtyFiles: ['file1.ts'],
      aheadBy: 3,
      behindBy: 1,
    };
    vi.mocked(api.worktrees.status).mockResolvedValueOnce({ ok: true, data: detailData });

    const result = await worktreeStore.loadDetail('abc');

    expect(api.worktrees.status).toHaveBeenCalledWith('abc');
    expect(result).toEqual(detailData);
    expect(worktreeStore.getDetail('abc')).toEqual(detailData);
  });

  // Verifies null is returned on API failure
  test('returns null on API failure', async () => {
    vi.mocked(api.worktrees.status).mockRejectedValueOnce(new Error('fail'));

    const result = await worktreeStore.loadDetail('abc');

    expect(result).toBeNull();
    expect(worktreeStore.getDetail('abc')).toBeNull();
  });
});

// ============================================================================
// merge() — triggers merge for a story worktree
// ============================================================================
describe('worktreeStore.merge()', () => {
  // Verifies successful merge updates local state
  test('updates worktree status on successful merge', async () => {
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({
      ok: true,
      data: [mockEntry({ storyId: 'abc' })],
    });
    await worktreeStore.load('/test');

    vi.mocked(api.worktrees.merge).mockResolvedValueOnce({
      ok: true,
      data: { storyId: 'abc', status: 'merged', operationLog: [] },
    });

    const result = await worktreeStore.merge('abc');

    expect(result.ok).toBe(true);
    const updated = worktreeStore.getForStory('abc');
    expect(updated?.record?.status).toBe('merged');
  });

  // Verifies error returned on merge failure
  test('returns error on merge failure', async () => {
    vi.mocked(api.worktrees.merge).mockRejectedValueOnce(new Error('Conflict'));

    const result = await worktreeStore.merge('abc');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Conflict');
  });
});

// ============================================================================
// remove() — removes a story worktree
// ============================================================================
describe('worktreeStore.remove()', () => {
  // Verifies successful removal removes entry from state
  test('removes worktree from state on success', async () => {
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({
      ok: true,
      data: [mockEntry({ storyId: 'abc' }), mockEntry({ storyId: 'def' })],
    });
    await worktreeStore.load('/test');

    vi.mocked(api.worktrees.remove).mockResolvedValueOnce({
      ok: true,
      data: { storyId: 'abc' },
    });

    const result = await worktreeStore.remove('abc');

    expect(result.ok).toBe(true);
    expect(worktreeStore.worktrees).toHaveLength(1);
    expect(worktreeStore.getForStory('abc')).toBeUndefined();
  });

  // Verifies force flag is passed through
  test('passes force flag to API', async () => {
    vi.mocked(api.worktrees.remove).mockResolvedValueOnce({
      ok: true,
      data: { storyId: 'abc' },
    });

    await worktreeStore.remove('abc', true);

    expect(api.worktrees.remove).toHaveBeenCalledWith('abc', true);
  });

  // Verifies error returned on removal failure
  test('returns error on removal failure', async () => {
    vi.mocked(api.worktrees.remove).mockRejectedValueOnce(new Error('Dirty'));

    const result = await worktreeStore.remove('abc');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Dirty');
  });

  // Verifies detail cache is cleaned up
  test('cleans up detail cache on removal', async () => {
    // Set up detail cache
    vi.mocked(api.worktrees.status).mockResolvedValueOnce({
      ok: true,
      data: { branch: 'story/abc', dirtyFiles: [], aheadBy: 0, behindBy: 0 },
    });
    await worktreeStore.loadDetail('abc');
    expect(worktreeStore.getDetail('abc')).not.toBeNull();

    vi.mocked(api.worktrees.list).mockResolvedValueOnce({
      ok: true,
      data: [mockEntry({ storyId: 'abc' })],
    });
    await worktreeStore.load('/test');

    vi.mocked(api.worktrees.remove).mockResolvedValueOnce({
      ok: true,
      data: { storyId: 'abc' },
    });
    await worktreeStore.remove('abc');

    expect(worktreeStore.getDetail('abc')).toBeNull();
  });
});

// ============================================================================
// SSE event handling — handleLoopEvent()
// ============================================================================
describe('worktreeStore.handleLoopEvent()', () => {
  // Verifies worktree_created adds a new entry
  test('worktree_created adds new entry', () => {
    worktreeStore.handleLoopEvent(
      mockLoopEvent('worktree_created', {
        storyId: 'new1',
        branchName: 'story/new1',
        worktreePath: '/test/.e/worktrees/story-new1',
      }),
    );

    const entry = worktreeStore.getForStory('new1');
    expect(entry).toBeDefined();
    expect(entry?.branch).toBe('story/new1');
    expect(entry?.record?.status).toBe('active');
  });

  // Verifies worktree_created does NOT duplicate if entry already exists
  test('worktree_created does not duplicate existing entry', async () => {
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({
      ok: true,
      data: [mockEntry({ storyId: 'abc' })],
    });
    await worktreeStore.load('/test');

    worktreeStore.handleLoopEvent(
      mockLoopEvent('worktree_created', { storyId: 'abc', branchName: 'story/abc' }),
    );

    expect(worktreeStore.worktrees).toHaveLength(1);
  });

  // Verifies worktree_merge_started transitions status to 'merging'
  test('worktree_merge_started updates status to merging', async () => {
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({
      ok: true,
      data: [mockEntry({ storyId: 'abc' })],
    });
    await worktreeStore.load('/test');

    worktreeStore.handleLoopEvent(mockLoopEvent('worktree_merge_started', { storyId: 'abc' }));

    expect(worktreeStore.getForStory('abc')?.record?.status).toBe('merging');
  });

  // Verifies worktree_merge_completed transitions status to 'merged'
  test('worktree_merge_completed updates status to merged', async () => {
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({
      ok: true,
      data: [mockEntry({ storyId: 'abc' })],
    });
    await worktreeStore.load('/test');

    worktreeStore.handleLoopEvent(mockLoopEvent('worktree_merge_completed', { storyId: 'abc' }));

    expect(worktreeStore.getForStory('abc')?.record?.status).toBe('merged');
  });

  // Verifies worktree_merge_conflict transitions status and caches conflict info
  test('worktree_merge_conflict updates status and caches conflict files', async () => {
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({
      ok: true,
      data: [mockEntry({ storyId: 'abc' })],
    });
    await worktreeStore.load('/test');

    worktreeStore.handleLoopEvent(
      mockLoopEvent('worktree_merge_conflict', {
        storyId: 'abc',
        branchName: 'story/abc',
        conflictingFiles: ['file1.ts', 'file2.ts'],
      }),
    );

    expect(worktreeStore.getForStory('abc')?.record?.status).toBe('conflict');
    const detail = worktreeStore.getDetail('abc');
    expect(detail?.dirtyFiles).toEqual(['file1.ts', 'file2.ts']);
  });

  // Verifies events without storyId are ignored
  test('ignores events without storyId', () => {
    worktreeStore.handleLoopEvent(mockLoopEvent('worktree_created', { storyId: undefined }));

    expect(worktreeStore.worktrees).toHaveLength(0);
  });

  // Verifies non-worktree events are ignored (no-op)
  test('ignores non-worktree events gracefully', async () => {
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({
      ok: true,
      data: [mockEntry({ storyId: 'abc' })],
    });
    await worktreeStore.load('/test');

    worktreeStore.handleLoopEvent(mockLoopEvent('story_started', { storyId: 'abc' }));

    // Status should remain unchanged
    expect(worktreeStore.getForStory('abc')?.record?.status).toBe('active');
  });
});

// ============================================================================
// reset() — clears all state
// ============================================================================
describe('worktreeStore.reset()', () => {
  // Verifies reset clears all state back to initial
  test('clears all state', async () => {
    vi.mocked(api.worktrees.list).mockResolvedValueOnce({
      ok: true,
      data: [mockEntry()],
    });
    await worktreeStore.load('/test');

    vi.mocked(api.worktrees.status).mockResolvedValueOnce({
      ok: true,
      data: { branch: 'test', dirtyFiles: [], aheadBy: 0, behindBy: 0 },
    });
    await worktreeStore.loadDetail('abc');

    // Confirm state is populated
    expect(worktreeStore.worktrees).toHaveLength(1);
    expect(worktreeStore.getDetail('abc')).not.toBeNull();

    worktreeStore.reset();

    expect(worktreeStore.worktrees).toEqual([]);
    expect(worktreeStore.loading).toBe(false);
    expect(worktreeStore.error).toBeNull();
    expect(worktreeStore.getDetail('abc')).toBeNull();
  });
});
