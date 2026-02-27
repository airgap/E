import { editorStore, type EditorTab, type LayoutMode } from './editor.svelte';
import { uiStore, type SidebarTab } from './ui.svelte';
import { streamStore, type StreamSnapshot } from './stream.svelte';
import { searchStore } from './search.svelte';
import { terminalStore, type PersistedTerminalTab } from './terminal.svelte';
import { workspaceListStore } from './projects.svelte';
import { conversationStore } from './conversation.svelte';
import { gitStore } from './git.svelte';
import { settingsStore } from './settings.svelte';
import {
  sidebarLayoutStore,
  type FloatingPanelState,
  type PanelColumn,
} from './sidebarLayout.svelte';
import { api } from '$lib/api/client';
import type { TerminalPreferences } from '@e/shared';

const STORAGE_KEY = 'e-workspaces';

export interface SidebarLayoutSnapshot {
  // V2 format
  version?: 2;
  leftColumn?: PanelColumn | null;
  rightColumn?: PanelColumn | null;
  floatingPanels: FloatingPanelState[];
  // V1 compat (old snapshots may have this)
  pinnedTabs?: SidebarTab[];
}

export interface WorkspaceSnapshot {
  editorTabs: EditorTab[];
  activeEditorTabId: string | null;
  layoutMode: LayoutMode;
  splitRatio: number;
  previewTabId: string | null;
  activeConversationId: string | null;
  sidebarTab: SidebarTab;
  sidebarOpen: boolean;
  streamSnapshot: StreamSnapshot | null;
  searchQuery: string;
  searchIsRegex: boolean;
  terminalOpen: boolean;
  terminalHeight: number;
  terminalTabs?: PersistedTerminalTab[];
  terminalActiveTabId?: string | null;
  terminalPreferences?: TerminalPreferences;
  terminalMaximized?: boolean;
  sidebarLayout?: SidebarLayoutSnapshot;
}

export interface WorkspaceTab {
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  snapshot: WorkspaceSnapshot;
}

function createDefaultSnapshot(): WorkspaceSnapshot {
  return {
    editorTabs: [],
    activeEditorTabId: null,
    layoutMode: 'chat-only',
    splitRatio: 0.5,
    previewTabId: null,
    activeConversationId: null,
    sidebarTab: 'conversations',
    sidebarOpen: true,
    streamSnapshot: null,
    searchQuery: '',
    searchIsRegex: false,
    terminalOpen: false,
    terminalHeight: 250,
  };
}

interface PersistedWorkspace {
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  snapshot: {
    editorTabs: EditorTab[];
    activeEditorTabId: string | null;
    layoutMode: LayoutMode;
    splitRatio: number;
    previewTabId: string | null;
    activeConversationId: string | null;
    sidebarTab: SidebarTab;
    sidebarOpen: boolean;
    searchQuery: string;
    searchIsRegex: boolean;
    terminalOpen: boolean;
    terminalHeight: number;
    terminalTabs?: PersistedTerminalTab[];
    terminalActiveTabId?: string | null;
    terminalPreferences?: TerminalPreferences;
    terminalMaximized?: boolean;
    sidebarLayout?: SidebarLayoutSnapshot;
  };
}

interface PersistedState {
  workspaces: PersistedWorkspace[];
  activeWorkspaceId: string | null;
}

function loadFromStorage(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveToStorage(workspaces: WorkspaceTab[], activeId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    const persisted: PersistedState = {
      activeWorkspaceId: activeId,
      workspaces: workspaces.map((w) => ({
        workspaceId: w.workspaceId,
        workspaceName: w.workspaceName,
        workspacePath: w.workspacePath,
        snapshot: {
          editorTabs: w.snapshot.editorTabs,
          activeEditorTabId: w.snapshot.activeEditorTabId,
          layoutMode: w.snapshot.layoutMode,
          splitRatio: w.snapshot.splitRatio,
          previewTabId: w.snapshot.previewTabId,
          activeConversationId: w.snapshot.activeConversationId,
          sidebarTab: w.snapshot.sidebarTab,
          sidebarOpen: w.snapshot.sidebarOpen,
          // Do NOT persist: streamSnapshot, search results, terminal connections
          searchQuery: w.snapshot.searchQuery,
          searchIsRegex: w.snapshot.searchIsRegex,
          terminalOpen: w.snapshot.terminalOpen,
          terminalHeight: w.snapshot.terminalHeight,
          terminalTabs: w.snapshot.terminalTabs,
          terminalActiveTabId: w.snapshot.terminalActiveTabId,
          terminalPreferences: w.snapshot.terminalPreferences,
          terminalMaximized: w.snapshot.terminalMaximized,
          sidebarLayout: w.snapshot.sidebarLayout,
        },
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {}
}

function createWorkspaceStore() {
  let workspaces = $state<WorkspaceTab[]>([]);
  let activeWorkspaceId = $state<string | null>(null);

  const activeWorkspace = $derived(
    workspaces.find((w) => w.workspaceId === activeWorkspaceId) ?? null,
  );
  const hasWorkspaces = $derived(workspaces.length > 0);

  function captureSnapshot(): WorkspaceSnapshot {
    const layoutState = sidebarLayoutStore.captureState();
    const termState = terminalStore.captureState();
    return {
      editorTabs: [...editorStore.tabs],
      activeEditorTabId: editorStore.activeTabId,
      layoutMode: editorStore.layoutMode,
      splitRatio: editorStore.splitRatio,
      previewTabId: editorStore.previewTabId,
      activeConversationId: conversationStore.activeId,
      sidebarTab: uiStore.sidebarTab,
      sidebarOpen: uiStore.sidebarOpen,
      streamSnapshot: streamStore.isStreaming ? streamStore.captureState() : null,
      searchQuery: searchStore.query,
      searchIsRegex: searchStore.isRegex,
      terminalOpen: termState.isOpen,
      terminalHeight: termState.panelHeight,
      terminalTabs: termState.tabs,
      terminalActiveTabId: termState.activeTabId,
      terminalPreferences: termState.preferences,
      terminalMaximized: termState.maximized,
      sidebarLayout: {
        version: 2,
        leftColumn: layoutState.leftColumn,
        rightColumn: layoutState.rightColumn,
        floatingPanels: layoutState.floatingPanels,
      },
    };
  }

  function restoreSnapshot(snapshot: WorkspaceSnapshot) {
    editorStore.restoreState({
      tabs: snapshot.editorTabs,
      activeTabId: snapshot.activeEditorTabId,
      layoutMode: snapshot.layoutMode,
      splitRatio: snapshot.splitRatio,
      previewTabId: snapshot.previewTabId,
    });

    uiStore.restoreState({
      sidebarTab: snapshot.sidebarTab,
      sidebarOpen: snapshot.sidebarOpen,
    });

    streamStore.restoreState(snapshot.streamSnapshot);

    searchStore.restoreState({
      query: snapshot.searchQuery,
      isRegex: snapshot.searchIsRegex,
    });

    terminalStore.restoreState({
      isOpen: snapshot.terminalOpen,
      panelHeight: snapshot.terminalHeight,
      maximized: snapshot.terminalMaximized,
      tabs: snapshot.terminalTabs,
      activeTabId: snapshot.terminalActiveTabId,
      preferences: snapshot.terminalPreferences,
    });

    // Restore sidebar layout if present (backward compatible with old V1 snapshots)
    if (snapshot.sidebarLayout) {
      const sl = snapshot.sidebarLayout;
      if (sl.version === 2) {
        // New V2 format
        sidebarLayoutStore.restoreState({
          version: 2,
          leftColumn: sl.leftColumn ?? null,
          rightColumn: sl.rightColumn ?? null,
          floatingPanels: sl.floatingPanels ?? [],
        });
      } else if (sl.pinnedTabs) {
        // Old V1 format — migration handled by restoreState
        sidebarLayoutStore.restoreState({
          pinnedTabIds: sl.pinnedTabs,
          floatingPanels: sl.floatingPanels ?? [],
        });
      }
    }
  }

  function persist() {
    saveToStorage(workspaces, activeWorkspaceId);
  }

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
    get hasWorkspaces() {
      return hasWorkspaces;
    },

    async init() {
      const saved = loadFromStorage();
      if (saved && saved.workspaces.length > 0) {
        workspaces = saved.workspaces.map((pw) => ({
          ...pw,
          snapshot: {
            ...createDefaultSnapshot(),
            ...pw.snapshot,
            // Stream state is never persisted
            streamSnapshot: null,
          },
        }));
        activeWorkspaceId = saved.activeWorkspaceId;

        // Restore the active workspace
        const active = workspaces.find((w) => w.workspaceId === activeWorkspaceId);
        if (active) {
          restoreSnapshot(active.snapshot);
          workspaceListStore.setActiveWorkspaceId(active.workspaceId);
          gitStore.startPolling(active.workspacePath);
        }
      } else {
        // No localStorage state — try to recover from the server.
        // Auto-open the most recently used workspace so features like
        // Commentary don't show "open a workspace" on fresh sessions.
        await this._recoverFromServer();
      }
    },

    /** Fetch workspaces from the server and auto-open the most recent one. */
    async _recoverFromServer() {
      try {
        const res = await api.workspaces.list();
        const serverWorkspaces = res.data;
        if (!serverWorkspaces || serverWorkspaces.length === 0) return;

        // Pick the most recently opened workspace
        const sorted = [...serverWorkspaces].sort(
          (a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0),
        );
        const best = sorted[0];

        // Open it as if the user clicked it
        this.openWorkspace({ id: best.id, name: best.name, path: best.path });
      } catch {
        // Server not ready or no workspaces — nothing to recover
      }
    },

    openWorkspace(project: { id: string; name: string; path: string }) {
      // If already open, just switch to it
      const existing = workspaces.find((w) => w.workspaceId === project.id);
      if (existing) {
        this.switchWorkspace(project.id);
        return;
      }

      // Capture current workspace state before switching
      if (activeWorkspaceId) {
        const current = workspaces.find((w) => w.workspaceId === activeWorkspaceId);
        if (current) {
          current.snapshot = captureSnapshot();
        }
      }

      // Create new workspace
      const workspace: WorkspaceTab = {
        workspaceId: project.id,
        workspaceName: project.name,
        workspacePath: project.path,
        snapshot: createDefaultSnapshot(),
      };

      workspaces = [...workspaces, workspace];
      activeWorkspaceId = project.id;

      // Restore the fresh snapshot (clears stores)
      restoreSnapshot(workspace.snapshot);

      // Set project context
      workspaceListStore.setActiveWorkspaceId(project.id);
      gitStore.stopPolling();
      gitStore.startPolling(project.path);

      // Clear conversation for new workspace
      conversationStore.setActive(null);

      persist();
    },

    switchWorkspace(wsId: string) {
      if (wsId === activeWorkspaceId) return;

      const target = workspaces.find((w) => w.workspaceId === wsId);
      if (!target) return;

      // 1. Capture current workspace snapshot
      if (activeWorkspaceId) {
        const current = workspaces.find((w) => w.workspaceId === activeWorkspaceId);
        if (current) {
          current.snapshot = captureSnapshot();
        }
      }

      // 2. Switch
      activeWorkspaceId = wsId;

      // 3. Restore target snapshot
      restoreSnapshot(target.snapshot);

      // 4. Update workspace list store + git polling
      workspaceListStore.setActiveWorkspaceId(wsId);
      gitStore.stopPolling();
      gitStore.startPolling(target.workspacePath);

      // 5. Restore conversation context
      if (target.snapshot.activeConversationId) {
        // The conversation will be reloaded by the chat component
        // We just clear current to trigger reload
        conversationStore.setActive(null);
      } else {
        conversationStore.setActive(null);
      }

      // 6. Refresh active editor tab if any
      if (target.snapshot.activeEditorTabId) {
        const activeTab = target.snapshot.editorTabs.find(
          (t) => t.id === target.snapshot.activeEditorTabId,
        );
        if (activeTab) {
          editorStore.refreshFile(activeTab.filePath);
        }
      }

      persist();
    },

    closeWorkspace(wsId: string) {
      const idx = workspaces.findIndex((w) => w.workspaceId === wsId);
      if (idx < 0) return;

      const workspace = workspaces[idx];

      // If stream is running in this workspace, abort it
      if (workspace.snapshot.streamSnapshot?.abortController) {
        workspace.snapshot.streamSnapshot.abortController.abort();
      }
      // Also check if this is the active workspace with a live stream
      if (wsId === activeWorkspaceId && streamStore.isStreaming) {
        streamStore.cancel();
      }

      workspaces = workspaces.filter((w) => w.workspaceId !== wsId);

      // If we closed the active workspace, switch to adjacent
      if (wsId === activeWorkspaceId) {
        if (workspaces.length > 0) {
          const nextIdx = Math.min(idx, workspaces.length - 1);
          this.switchWorkspace(workspaces[nextIdx].workspaceId);
        } else {
          activeWorkspaceId = null;
          // Clear all stores to empty state
          restoreSnapshot(createDefaultSnapshot());
          workspaceListStore.setActiveWorkspaceId(null);
          gitStore.stopPolling();
          conversationStore.setActive(null);
        }
      }

      persist();
    },

    /** Update the active workspace's snapshot without a full switch */
    updateActiveSnapshot() {
      if (!activeWorkspaceId) return;
      const current = workspaces.find((w) => w.workspaceId === activeWorkspaceId);
      if (current) {
        current.snapshot = captureSnapshot();
        persist();
      }
    },

    /** Check if a workspace has unsaved editor tabs */
    hasDirtyTabs(wsId: string): boolean {
      const ws = workspaces.find((w) => w.workspaceId === wsId);
      if (!ws) return false;
      // If it's the active workspace, check live editor state
      if (wsId === activeWorkspaceId) {
        return editorStore.dirtyTabs.length > 0;
      }
      // Otherwise check snapshot
      return ws.snapshot.editorTabs.some((t) => t.content !== t.originalContent);
    },

    /** Check if a workspace has an active stream */
    hasActiveStream(wsId: string): boolean {
      if (wsId === activeWorkspaceId) {
        return streamStore.isStreaming;
      }
      const ws = workspaces.find((w) => w.workspaceId === wsId);
      if (!ws) return false;
      const ss = ws.snapshot.streamSnapshot;
      return ss !== null && (ss.status === 'streaming' || ss.status === 'connecting');
    },

    /** Called when a workspace is deleted externally */
    onWorkspaceDeleted(wsId: string) {
      this.closeWorkspace(wsId);
    },
  };
}

export const workspaceStore = createWorkspaceStore();

// Persist the workspace snapshot whenever the active conversation changes,
// so page reloads restore the most recent conversation — not a stale one.
conversationStore.onActiveChange(() => {
  workspaceStore.updateActiveSnapshot();
});

// Persist on page unload so the snapshot is always fresh (e.g. mid-stream
// reload captures the correct activeConversationId for reconnection).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    workspaceStore.updateActiveSnapshot();
  });
}
