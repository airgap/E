import { api } from '$lib/api/client';
import { settingsStore } from './settings.svelte';
import type { WorkspaceSummary } from '@e/shared';

function createWorkspaceListStore() {
  let workspaces = $state<WorkspaceSummary[]>([]);
  let activeWorkspaceId = $state<string | null>(null);
  let loading = $state(false);

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
  };
}

export const workspaceListStore = createWorkspaceListStore();
