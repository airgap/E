/**
 * Recent-files store — workspace-scoped MRU list of opened files.
 *
 * Powers Cmd-P's empty-query state (LYK-988): when the user opens Quick Open
 * without typing, the list shows files in most-recently-opened order with a
 * relative-time hint ("2m ago"). The editor store calls `recordOpen(path)`
 * from openFile(); this store dedupes, pushes to the front, caps the list,
 * and persists per-workspace in localStorage.
 *
 * Scope decision: keyed by workspace id (not global) — opening package.json
 * in repo A shouldn't surface it when you're working in repo B. When the
 * workspace isn't known yet (very early boot), we fall back to a `__none__`
 * bucket; entries there migrate forward the first time a workspace resolves.
 *
 * Storage shape changed in v2 to carry timestamps. v1 → v2 migration runs
 * at load: legacy `string[]` lists become `MruEntry[]` with `openedAt = 0`,
 * which is rendered as "" (no time hint) until the next open updates the ts.
 */

import { workspaceStore } from './workspace.svelte';

const MRU_CAP = 200;
const STORAGE_KEY = 'e-recent-files-v2';
const LEGACY_STORAGE_KEY = 'e-recent-files-v1';

interface MruEntry {
  path: string;
  openedAt: number; // Date.now() at last open; 0 = unknown (migrated from v1)
}

type PerWorkspaceMru = Record<string, MruEntry[]>;

/**
 * Best-effort migration from the v1 schema (`Record<string, string[]>`).
 * Returns the migrated state and silently deletes the legacy key on success.
 */
function migrateFromV1(): PerWorkspaceMru | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const out: PerWorkspaceMru = {};
    for (const [key, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue;
      out[key] = list.map((p) => ({ path: String(p), openedAt: 0 }));
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return out;
  } catch {
    return null;
  }
}

function loadFromStorage(): PerWorkspaceMru {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch {
    // Fall through to migration attempt.
  }
  return migrateFromV1() ?? {};
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
    /** Entries for the active workspace, newest first. */
    get mru(): MruEntry[] {
      return perWorkspace[bucketKey()] ?? [];
    },

    /**
     * Returns the MRU index (0 = most recent) of `path`, or -1 if not in
     * the list. Used by Quick Open to sort the empty-query result set.
     */
    indexOf(path: string): number {
      const list = perWorkspace[bucketKey()];
      if (!list) return -1;
      return list.findIndex((e) => e.path === path);
    },

    /** Timestamp (ms epoch) of last open for `path`, or 0 if unknown / absent. */
    openedAt(path: string): number {
      const list = perWorkspace[bucketKey()];
      if (!list) return 0;
      const entry = list.find((e) => e.path === path);
      return entry?.openedAt ?? 0;
    },

    /**
     * Record that the user just opened `path`. Dedupes — if already present,
     * the entry is lifted to the front with a fresh timestamp. Caps the list
     * at MRU_CAP to bound localStorage growth on long-lived workspaces.
     */
    recordOpen(path: string) {
      if (!path) return;
      const key = bucketKey();
      const existing = perWorkspace[key] ?? [];
      const next: MruEntry[] = [
        { path, openedAt: Date.now() },
        ...existing.filter((e) => e.path !== path),
      ].slice(0, MRU_CAP);
      perWorkspace = { ...perWorkspace, [key]: next };
      saveToStorage(perWorkspace);
    },

    /** Manual eviction (e.g. after a delete) so a deleted file doesn't haunt Cmd-P. */
    forget(path: string) {
      const key = bucketKey();
      const existing = perWorkspace[key];
      if (!existing) return;
      const next = existing.filter((e) => e.path !== path);
      perWorkspace = { ...perWorkspace, [key]: next };
      saveToStorage(perWorkspace);
    },
  };
}

export const recentFilesStore = createRecentFilesStore();

/**
 * Format a Date.now()-style timestamp as a compact relative string for the
 * Quick Open MRU row. Returns '' for 0 (unknown, e.g. v1-migrated entries)
 * so the UI can fall back to no hint at all.
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  if (!ts) return '';
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}
