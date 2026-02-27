/**
 * Commit groups store — manages AI-suggested commit groupings.
 *
 * Groups changed files into logical atomic commits, allows the user
 * to edit groups, drag files between them, and commit sequentially.
 *
 * State is persisted to sessionStorage so it survives HMR reloads
 * (which happen every time a commit changes watched files).
 */

import { api } from '$lib/api/client';
import { gitStore } from '$lib/stores/git.svelte';

export interface CommitGroup {
  id: string;
  name: string;
  message: string;
  files: string[];
  reason: string;
  status: 'pending' | 'committing' | 'committed' | 'failed';
  error?: string;
}

const STORAGE_KEY = 'e:commit-groups';

interface PersistedState {
  groups: CommitGroup[];
  error: string | null;
  nextId: number;
  /** When set, a "commit all" batch was in progress and should auto-resume. */
  batchWorkspacePath?: string | null;
}

function saveState(state: PersistedState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded or unavailable — ignore
  }
}

function loadState(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    // Reset any groups stuck in 'committing' back to 'pending'
    // (the commit was interrupted by the reload) and clear their errors
    for (const g of parsed.groups) {
      if (g.status === 'committing') {
        g.status = 'pending';
        g.error = undefined;
      }
    }
    // Also clear transient errors on failed groups caused by aborted requests
    // (e.g. HMR reload interrupted the fetch mid-flight)
    for (const g of parsed.groups) {
      if (g.status === 'failed' && g.error?.includes('connect to server')) {
        g.status = 'pending';
        g.error = undefined;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

function createCommitGroupsStore() {
  const restored = loadState();

  let groups = $state<CommitGroup[]>(restored?.groups ?? []);
  let loading = $state(false);
  let error = $state<string | null>(restored?.error ?? null);
  let commitProgress = $state<{ current: number; total: number } | null>(null);
  /** Status message from streaming operations (Smart Commit). */
  let statusMessage = $state<string | null>(null);
  /** Workspace path for an in-progress batch — persisted so we can resume after HMR. */
  let batchWorkspacePath: string | null = restored?.batchWorkspacePath ?? null;

  const hasGroups = $derived(groups.length > 0);
  const pendingGroups = $derived(groups.filter((g) => g.status === 'pending'));
  const committedGroups = $derived(groups.filter((g) => g.status === 'committed'));
  const allCommitted = $derived(groups.length > 0 && groups.every((g) => g.status === 'committed'));

  let nextId = restored?.nextId ?? 0;
  function genId(): string {
    return `cg-${++nextId}`;
  }

  /** Persist current state to sessionStorage. */
  function persist(): void {
    saveState({ groups, error, nextId, batchWorkspacePath });
  }

  return {
    get groups() {
      return groups;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get hasGroups() {
      return hasGroups;
    },
    get pendingGroups() {
      return pendingGroups;
    },
    get committedGroups() {
      return committedGroups;
    },
    get allCommitted() {
      return allCommitted;
    },
    get commitProgress() {
      return commitProgress;
    },
    get statusMessage() {
      return statusMessage;
    },

    /**
     * Request AI-suggested commit groups from the server.
     */
    async suggest(workspacePath: string): Promise<void> {
      loading = true;
      error = null;
      groups = [];

      try {
        const res = await api.git.suggestCommitGroups(workspacePath);
        if (res.ok && res.data?.groups) {
          groups = res.data.groups.map((g) => ({
            id: genId(),
            name: g.name,
            message: g.message,
            files: [...g.files],
            reason: g.reason,
            status: 'pending' as const,
          }));
        } else {
          error = res.error || 'Failed to get suggestions';
        }
      } catch (err) {
        error = String(err);
      } finally {
        loading = false;
        persist();
      }
    },

    /**
     * Update the commit message for a group.
     */
    setMessage(groupId: string, message: string) {
      const g = groups.find((g) => g.id === groupId);
      if (g) {
        g.message = message;
        persist();
      }
    },

    /**
     * Update the name for a group.
     */
    setName(groupId: string, name: string) {
      const g = groups.find((g) => g.id === groupId);
      if (g) {
        g.name = name;
        persist();
      }
    },

    /**
     * Move a file from one group to another.
     */
    moveFile(file: string, fromGroupId: string, toGroupId: string) {
      const from = groups.find((g) => g.id === fromGroupId);
      const to = groups.find((g) => g.id === toGroupId);
      if (!from || !to) return;

      from.files = from.files.filter((f) => f !== file);
      to.files = [...to.files, file];

      // Remove empty groups
      groups = groups.filter((g) => g.files.length > 0);
      persist();
    },

    /**
     * Remove a file from a group (it will be ungrouped / left for manual staging).
     */
    removeFile(groupId: string, file: string) {
      const g = groups.find((g) => g.id === groupId);
      if (g) {
        g.files = g.files.filter((f) => f !== file);
        groups = groups.filter((g) => g.files.length > 0);
        persist();
      }
    },

    /**
     * Add a new empty group.
     */
    addGroup(name: string = 'New group') {
      groups = [
        ...groups,
        {
          id: genId(),
          name,
          message: '',
          files: [],
          reason: 'User-created group',
          status: 'pending',
        },
      ];
      persist();
    },

    /**
     * Remove a group, returning its files to ungrouped.
     */
    removeGroup(groupId: string) {
      groups = groups.filter((g) => g.id !== groupId);
      persist();
    },

    /**
     * Commit a single group via the atomic server endpoint.
     *
     * The server handles unstage→stage→commit in one request, so HMR
     * reloads can't leave files partially staged. The client just sends
     * the file list and message and gets back success/failure.
     *
     * @param opts.noVerify — skip pre-commit hooks (used during batch commits
     *   so hooks only run once on the final group instead of N times).
     * @param opts.skipRefresh — skip restarting the git poll after commit
     *   (used during batch commits; the batch caller restarts polling once).
     */
    async commitGroup(
      workspacePath: string,
      groupId: string,
      opts?: { noVerify?: boolean; skipRefresh?: boolean },
    ): Promise<boolean> {
      const g = groups.find((g) => g.id === groupId);
      if (!g || g.status !== 'pending') return false;
      if (!g.message.trim()) {
        g.error = 'Commit message is required';
        persist();
        return false;
      }

      // Pause polling so `git status` doesn't race with the server-side
      // unstage→stage→commit. Also set a resume marker so that if an HMR
      // reload kills us between "set committing" and "got response", the
      // batch can be retried on the next page load.
      const standalone = !opts?.skipRefresh;
      if (standalone) {
        gitStore.stopPolling();
        batchWorkspacePath = workspacePath;
        persist();
      }

      g.status = 'committing';
      g.error = undefined;
      persist();

      try {
        // Single atomic request: server does unstage→stage→commit
        const res = await api.git.commitGroup(workspacePath, g.files, g.message, {
          noVerify: opts?.noVerify,
        });
        if (res.ok) {
          g.status = 'committed';
          persist();
          return true;
        } else {
          g.status = 'failed';
          g.error = ((res as Record<string, unknown>).error as string) || 'Commit failed';
          persist();
          return false;
        }
      } catch (err) {
        g.status = 'failed';
        g.error = String(err);
        persist();
        return false;
      } finally {
        // Standalone: clear resume marker and restart polling + refresh
        if (standalone) {
          batchWorkspacePath = null;
          persist();
          gitStore.startPolling(workspacePath);
        }
      }
    },

    /**
     * Commit all pending groups sequentially.
     *
     * Pre-commit hooks (lint, typecheck, tests) are skipped on all groups
     * except the last one. The final commit runs hooks normally, which
     * validates everything in a single pass instead of N times.
     *
     * Persists the batch-in-progress state so that if an HMR reload kills
     * this loop mid-flight, it auto-resumes when the store re-initializes.
     */
    async commitAll(workspacePath: string): Promise<{ success: number; failed: number }> {
      const pending = groups.filter((g) => g.status === 'pending');
      let success = 0;
      let failed = 0;

      // Mark batch in progress so we can resume after HMR
      batchWorkspacePath = workspacePath;
      persist();

      // Pause git polling during the batch to prevent concurrent git
      // operations (poll's `git status` vs our unstage/stage/commit).
      // This is what causes "Another git process seems to be running".
      gitStore.stopPolling();

      commitProgress = { current: 0, total: pending.length };

      for (let i = 0; i < pending.length; i++) {
        const g = pending[i];
        const isLast = i === pending.length - 1;
        commitProgress = { current: i + 1, total: pending.length };
        // Skip hooks on all but the last group — the final commit runs
        // the full pre-commit hook which validates the entire batch.
        // Skip per-group refresh to avoid git lock contention between
        // groups — we do a single refresh after the batch completes.
        const ok = await this.commitGroup(workspacePath, g.id, {
          noVerify: !isLast,
          skipRefresh: true,
        });
        if (ok) success++;
        else failed++;
      }

      // Batch complete — single refresh for final state, then resume polling
      batchWorkspacePath = null;
      commitProgress = null;
      persist();
      gitStore.startPolling(workspacePath);
      return { success, failed };
    },

    /**
     * Smart Commit: one-click analyze → group → stage → commit.
     *
     * Calls the server's streaming endpoint that does everything in one pass.
     * Groups appear in the store as they're identified, then flip to 'committed'
     * as each group is committed server-side. No user review step.
     */
    async smartCommit(
      workspacePath: string,
    ): Promise<{ ok: boolean; committed?: number; error?: string }> {
      loading = true;
      error = null;
      groups = [];
      commitProgress = null;

      // Pause git polling — server will be doing reset/add/commit cycles
      gitStore.stopPolling();
      batchWorkspacePath = workspacePath;
      persist();

      try {
        const result = await api.git.smartCommit(workspacePath, (event) => {
          switch (event.type) {
            case 'status':
              statusMessage = event.message || null;
              break;

            case 'groups':
              // Server determined the groups — populate the store
              if (event.groups) {
                groups = event.groups.map((g) => ({
                  id: genId(),
                  name: g.name,
                  message: g.message,
                  files: [...g.files],
                  reason: g.reason,
                  status: 'pending' as const,
                }));
                loading = false;
                commitProgress = { current: 0, total: groups.length };
                persist();
              }
              break;

            case 'committing':
              if (event.index != null && groups[event.index]) {
                groups[event.index].status = 'committing';
                commitProgress = {
                  current: (event.index ?? 0) + 1,
                  total: event.total ?? groups.length,
                };
                persist();
              }
              break;

            case 'committed':
              if (event.index != null && groups[event.index]) {
                groups[event.index].status = 'committed';
                persist();
              }
              break;

            case 'group-error':
              if (event.index != null && groups[event.index]) {
                groups[event.index].status = 'failed';
                groups[event.index].error = event.message;
                persist();
              }
              break;

            case 'error':
              error = event.message || 'Smart commit failed';
              persist();
              break;
          }
        });

        if (!result.ok) {
          error = result.error || 'Smart commit failed';
        }
        return {
          ok: result.ok,
          committed: result.committed,
          error: result.error,
        };
      } catch (err) {
        error = String(err);
        return { ok: false, error: String(err) };
      } finally {
        loading = false;
        commitProgress = null;
        statusMessage = null;
        batchWorkspacePath = null;
        persist();
        gitStore.startPolling(workspacePath);
      }
    },

    /**
     * Clear all groups and reset state.
     */
    clear() {
      groups = [];
      loading = false;
      error = null;
      commitProgress = null;
      statusMessage = null;
      batchWorkspacePath = null;
      persist();
    },

    /**
     * Resume an interrupted "commit all" batch (e.g. after HMR reload).
     * Called automatically on store init when persisted state indicates
     * a batch was in progress.
     */
    async resumeBatch(): Promise<void> {
      const wp = batchWorkspacePath;
      if (!wp) return;
      const remaining = groups.filter((g) => g.status === 'pending');
      if (remaining.length === 0) {
        // Nothing left to commit — batch must have finished right before reload
        batchWorkspacePath = null;
        persist();
        return;
      }
      console.log(
        '[commit-groups] Resuming interrupted batch: %d groups remaining',
        remaining.length,
      );
      await this.commitAll(wp);
    },
  };
}

export const commitGroupsStore = createCommitGroupsStore();

// Auto-resume interrupted batch after HMR reload.
// Deferred to the next microtask so the store is fully initialized
// and Svelte's reactivity is wired up before we start committing.
if (commitGroupsStore.pendingGroups.length > 0) {
  queueMicrotask(() => {
    commitGroupsStore.resumeBatch();
  });
}
