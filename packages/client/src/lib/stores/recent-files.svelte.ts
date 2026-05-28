/**
 * Recent-files store — workspace-scoped MRU list of opened files.
 *
 * Powers Cmd-P's empty-query state (LYK-988): when the user opens Quick Open
 * without typing, the list shows files in most-recently-opened order. The
 * editor store calls `recordOpen(path)` from openFile(); this store dedupes,
 * pushes to the front, caps the list, and persists per-workspace in
 * localStorage.
 *
 * Scope decision: keyed by workspace id (not global) — opening package.json
 * in repo A shouldn't surface it when you're working in repo B. When the
 * workspace isn't known yet (very early boot), we fall back to a `__none__`
 * bucket; entries there migrate forward the first time a workspace resolves.
 */

import { workspaceStore } from './workspace.svelte';

const MRU_CAP = 200;
const STORAGE_KEY = 'e-recent-files-v1';

type PerWorkspaceMru = Record<string, string[]>;

function loadFromStorage(): PerWorkspaceMru {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveToStorage(state: PerWorkspaceMru) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — drop silently; MRU isn't load-bearing.
  }
}

function createRecentFilesStore() {
  let perWorkspace = $state<PerWorkspaceMru>(loadFromStorage());

  function bucketKey(): string {
    return workspaceStore.activeWorkspaceId ?? '__none__';
  }

  return {
    /** Paths for the active workspace, newest first. */
    get mru(): string[] {
      return perWorkspace[bucketKey()] ?? [];
    },

    /**
     * Returns the MRU index (0 = most recent) of `path`, or -1 if not in
     * the list. Used by Quick Open to sort the empty-query result set.
     */
    indexOf(path: string): number {
      const list = perWorkspace[bucketKey()];
      return list ? list.indexOf(path) : -1;
    },

    /**
     * Record that the user just opened `path`. Dedupes — if already present,
     * the entry is lifted to the front. Caps the list at MRU_CAP to bound
     * localStorage growth on very long-lived workspaces.
     */
    recordOpen(path: string) {
      if (!path) return;
      const key = bucketKey();
      const existing = perWorkspace[key] ?? [];
      const next = [path, ...existing.filter((p) => p !== path)].slice(0, MRU_CAP);
      perWorkspace = { ...perWorkspace, [key]: next };
      saveToStorage(perWorkspace);
    },

    /** Manual eviction (e.g. after a delete) so a deleted file doesn't haunt Cmd-P. */
    forget(path: string) {
      const key = bucketKey();
      const existing = perWorkspace[key];
      if (!existing) return;
      const next = existing.filter((p) => p !== path);
      perWorkspace = { ...perWorkspace, [key]: next };
      saveToStorage(perWorkspace);
    },
  };
}

export const recentFilesStore = createRecentFilesStore();
