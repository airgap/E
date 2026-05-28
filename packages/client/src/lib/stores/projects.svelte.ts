import { api } from '$lib/api/client';
import { settingsStore } from './settings.svelte';
import type { WorkspaceSummary } from '@e/shared';

const PINNED_STORAGE_KEY = 'e-pinned-workspaces-v1';

function loadPinned(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}
function persistPinned(set: Set<string>) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Drop silently — pins are convenience, not load-bearing.
  }
}

function createWorkspaceListStore() {
  let workspaces = $state<WorkspaceSummary[]>([]);
  let activeWorkspaceId = $state<string | null>(null);
  let loading = $state(false);
  /**
   * Client-side pinned-workspace IDs (LYK-1002). Persisted globally in
   * localStorage so pins survive across machines that share a profile.
   * Independent of server state — the server's WorkspaceSummary doesn't
   * carry pinning yet.
   */
  let pinnedIds = $state<Set<string>>(loadPinned());

  const activeWorkspace = $derived(workspaces.find((p) => p.id === activeWorkspaceId) ?? null);

  return {
    get workspaces() {
      return workspaces;
    },
    get activeWorkspaceId() {
      return activeWorkspaceId;
    },
    get activeWorkspace() {
      return activeWorkspace;
    },
    get loading() {
      return loading;
    },

    async loadWorkspaces() {
      loading = true;
      try {
        const res = await api.workspaces.list();
        workspaces = res.data;
      } catch {
        workspaces = [];
      }
      loading = false;
    },

    async createWorkspace(name: string, path: string) {
      try {
        const res = await api.workspaces.create({ name, path });
        await this.loadWorkspaces();
        activeWorkspaceId = res.data.id;
        settingsStore.update({ workspacePath: path });
        return res.data.id;
      } catch (e) {
        throw e;
      }
    },

    async switchWorkspace(id: string) {
      const workspace = workspaces.find((p) => p.id === id);
      if (!workspace) return;

      activeWorkspaceId = id;
      settingsStore.update({ workspacePath: workspace.path });

      // Update last-opened
      try {
        await api.workspaces.open(id);
      } catch {}
    },

    clearActiveWorkspace() {
      activeWorkspaceId = null;
    },

    async deleteWorkspace(id: string) {
      try {
        await api.workspaces.delete(id);
        if (activeWorkspaceId === id) activeWorkspaceId = null;
        await this.loadWorkspaces();
      } catch {}
    },

    setActiveWorkspaceId(id: string | null) {
      activeWorkspaceId = id;
      if (id) {
        const workspace = workspaces.find((p) => p.id === id);
        if (workspace) {
          settingsStore.update({ workspacePath: workspace.path });
        }
      }
    },

    // ── Pinning (LYK-1002) ──

    /** Whether `id` is currently pinned. */
    isPinned(id: string): boolean {
      return pinnedIds.has(id);
    },

    /** Pin a workspace so it sorts to the top of Open Recent. */
    pin(id: string) {
      if (pinnedIds.has(id)) return;
      pinnedIds = new Set([...pinnedIds, id]);
      persistPinned(pinnedIds);
    },

    unpin(id: string) {
      if (!pinnedIds.has(id)) return;
      const next = new Set(pinnedIds);
      next.delete(id);
      pinnedIds = next;
      persistPinned(pinnedIds);
    },

    togglePin(id: string) {
      if (pinnedIds.has(id)) this.unpin(id);
      else this.pin(id);
    },

    /**
     * Workspaces sorted "recent-style": pinned first (preserving their
     * recency order within the pinned group), then everything else by
     * lastOpened desc. Used by Open Recent / palette / welcome screen.
     */
    get recents(): WorkspaceSummary[] {
      const sorted = [...workspaces].sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
      const pinned: WorkspaceSummary[] = [];
      const rest: WorkspaceSummary[] = [];
      for (const w of sorted) {
        if (pinnedIds.has(w.id)) pinned.push(w);
        else rest.push(w);
      }
      return [...pinned, ...rest];
    },
  };
}

export const workspaceListStore = createWorkspaceListStore();
