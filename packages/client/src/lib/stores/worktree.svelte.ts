/**
 * Worktree store — tracks worktree state for the current workspace.
 *
 * Fetches via GET /api/worktrees, updates via SSE loop events.
 * Provides reactive state, CRUD wrappers, and getForStory() lookup.
 */

import type { WorktreeInfo, WorktreeRecord, WorktreeStatus, StreamLoopEvent } from '@e/shared';
import { api } from '../api/client';

/** Merged worktree entry combining git info and DB record. */
export interface WorktreeEntry extends WorktreeInfo {
  record: WorktreeRecord | null;
}

/** Detail status returned by the status endpoint. */
export interface WorktreeDetailStatus {
  branch: string;
  dirtyFiles: string[];
  aheadBy: number;
  behindBy: number;
}

function createWorktreeStore() {
  let worktrees = $state<WorktreeEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let detailCache = $state<Record<string, WorktreeDetailStatus>>({});

  return {
    // --- State getters ---
    get worktrees() {
      return worktrees;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get detailCache() {
      return detailCache;
    },

    /** Count of active worktrees (non-main, with a record). */
    get activeCount(): number {
      return worktrees.filter((w) => !w.isMain && w.record).length;
    },

    /** Worktrees grouped by their database status. */
    get byStatus(): Record<WorktreeStatus | 'unknown', WorktreeEntry[]> {
      const result: Record<string, WorktreeEntry[]> = {
        active: [],
        merging: [],
        merged: [],
        conflict: [],
        abandoned: [],
        cleanup_pending: [],
        unknown: [],
      };
      for (const w of worktrees) {
        if (w.isMain) continue;
        const status = w.record?.status ?? 'unknown';
        if (!result[status]) result[status] = [];
        result[status].push(w);
      }
      return result as Record<WorktreeStatus | 'unknown', WorktreeEntry[]>;
    },

    // --- Data loading ---

    /** Fetch all worktrees for a workspace from the API. */
    async load(workspacePath: string): Promise<void> {
      if (!workspacePath) return;
      loading = true;
      error = null;
      try {
        const res = await api.worktrees.list(workspacePath);
        if (res.ok) {
          worktrees = res.data;
        } else {
          error = 'Failed to load worktrees';
        }
      } catch (e: any) {
        error = e.message ?? 'Failed to load worktrees';
      } finally {
        loading = false;
      }
    },

    /** Get the worktree entry for a specific story ID, or undefined. */
    getForStory(storyId: string): WorktreeEntry | undefined {
      return worktrees.find((w) => w.storyId === storyId);
    },

    /** Fetch detail status (dirty files, ahead/behind) for a story's worktree. */
    async loadDetail(storyId: string): Promise<WorktreeDetailStatus | null> {
      try {
        const res = await api.worktrees.status(storyId);
        if (res.ok) {
          detailCache = { ...detailCache, [storyId]: res.data };
          return res.data;
        }
      } catch {
        // ignore
      }
      return null;
    },

    /** Get cached detail for a story, or null if not yet loaded. */
    getDetail(storyId: string): WorktreeDetailStatus | null {
      return detailCache[storyId] ?? null;
    },

    // --- Mutations ---

    /** Request a merge for a story's worktree. */
    async merge(
      storyId: string,
      opts?: { skipQualityCheck?: boolean; retry?: boolean },
    ): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.worktrees.merge(storyId, opts);
        if (res.ok) {
          // Update local state: mark as merging/merged
          worktrees = worktrees.map((w) =>
            w.storyId === storyId && w.record
              ? {
                  ...w,
                  record: {
                    ...w.record,
                    status: (res.data.status as WorktreeStatus) ?? 'merged',
                    updated_at: Date.now(),
                  },
                }
              : w,
          );
          return { ok: true };
        }
        return { ok: false, error: 'Merge failed' };
      } catch (e: any) {
        return { ok: false, error: e.message ?? 'Merge failed' };
      }
    },

    /** Remove a worktree for a story. */
    async remove(storyId: string, force?: boolean): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await api.worktrees.remove(storyId, force);
        if (res.ok) {
          worktrees = worktrees.filter((w) => w.storyId !== storyId);
          // Clean up detail cache
          const { [storyId]: _removed, ...rest } = detailCache;
          detailCache = rest;
          return { ok: true };
        }
        return { ok: false, error: 'Remove failed' };
      } catch (e: any) {
        return { ok: false, error: e.message ?? 'Remove failed' };
      }
    },

    // --- SSE event handling ---

    /** Handle incoming loop events related to worktrees. */
    handleLoopEvent(event: StreamLoopEvent): void {
      const { storyId, branchName, worktreePath, conflictingFiles } = event.data;
      if (!storyId) return;

      switch (event.event) {
        case 'worktree_created': {
          // Add a new entry if not already present
          const existing = worktrees.find((w) => w.storyId === storyId);
          if (!existing) {
            const newEntry: WorktreeEntry = {
              path: worktreePath ?? '',
              branch: branchName ?? null,
              head: '',
              storyId,
              isMain: false,
              isLocked: false,
              isDirty: false,
              record: {
                id: '',
                story_id: storyId,
                prd_id: null,
                workspace_path: '',
                worktree_path: worktreePath ?? '',
                branch_name: branchName ?? '',
                base_branch: null,
                base_commit: null,
                status: 'active',
                created_at: Date.now(),
                updated_at: Date.now(),
              },
            };
            worktrees = [...worktrees, newEntry];
          }
          break;
        }

        case 'worktree_merge_started': {
          worktrees = worktrees.map((w) =>
            w.storyId === storyId && w.record
              ? {
                  ...w,
                  record: {
                    ...w.record,
                    status: 'merging' as WorktreeStatus,
                    updated_at: Date.now(),
                  },
                }
              : w,
          );
          break;
        }

        case 'worktree_merge_completed': {
          worktrees = worktrees.map((w) =>
            w.storyId === storyId && w.record
              ? {
                  ...w,
                  record: {
                    ...w.record,
                    status: 'merged' as WorktreeStatus,
                    updated_at: Date.now(),
                  },
                }
              : w,
          );
          break;
        }

        case 'worktree_merge_conflict': {
          worktrees = worktrees.map((w) =>
            w.storyId === storyId && w.record
              ? {
                  ...w,
                  record: {
                    ...w.record,
                    status: 'conflict' as WorktreeStatus,
                    updated_at: Date.now(),
                  },
                }
              : w,
          );
          // Cache the conflict info for detail view
          if (conflictingFiles) {
            const prev = detailCache[storyId];
            detailCache = {
              ...detailCache,
              [storyId]: {
                branch: prev?.branch ?? branchName ?? '',
                dirtyFiles: conflictingFiles,
                aheadBy: prev?.aheadBy ?? 0,
                behindBy: prev?.behindBy ?? 0,
              },
            };
          }
          break;
        }
      }
    },

    /** Clear all state (e.g. on workspace switch). */
    reset(): void {
      worktrees = [];
      loading = false;
      error = null;
      detailCache = {};
    },
  };
}

export const worktreeStore = createWorktreeStore();
