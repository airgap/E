import { uuid } from '$lib/utils/uuid';
import { api } from '$lib/api/client';
import { detectLanguage } from './editor.svelte';

export type PrimaryTabKind =
  | 'chat'
  | 'diff'
  | 'file'
  | 'looper'
  | 'change-preview'
  | 'timeline'
  | 'canvas'
  | 'golem-tasks'
  | 'commit';

export interface PrimaryTab {
  id: string;
  conversationId: string | null; // null = new/draft
  title: string;
  kind?: PrimaryTabKind; // defaults to 'chat'
  /** For kind='diff': raw unified diff string */
  diffContent?: string;
  /** For kind='diff' | 'file': the file path */
  filePath?: string;
  /** For kind='diff': whether this is a staged diff */
  staged?: boolean;
  /** For kind='file': raw file content */
  fileContent?: string;
  /** For kind='file': detected language */
  language?: string;
  /** For kind='looper': the loop ID to display */
  loopId?: string;
  /** For kind='change-preview': the preview plan ID */
  changePreviewPlanId?: string;
  /** For kind='timeline': the conversation ID to replay */
  timelineConversationId?: string;
  /** For kind='canvas': the canvas ID to display */
  canvasId?: string;
  /** For kind='commit': the commit SHA to display */
  commitSha?: string;
  /** For kind='commit': workspace path (for diff fetches against that repo). */
  commitWorkspacePath?: string;
}

export interface PrimaryPane {
  id: string;
  tabs: PrimaryTab[];
  activeTabId: string | null;
}

const STORAGE_KEY = 'e-primary-pane';
const MAX_PANES = 10;

function load(): {
  panes: PrimaryPane[];
  activePaneId: string | null;
  sizes: number[];
} | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function makePane(conversationId: string | null = null, title = 'New chat'): PrimaryPane {
  const tabId = uuid();
  return {
    id: uuid(),
    tabs: [{ id: tabId, conversationId, title, kind: 'chat' }],
    activeTabId: tabId,
  };
}

/** Distribute 100% evenly across n panes. */
function evenSizes(n: number): number[] {
  if (n <= 0) return [];
  const each = 100 / n;
  return Array.from({ length: n }, () => each);
}

function makeEmptyPane(): PrimaryPane {
  return { id: uuid(), tabs: [], activeTabId: null };
}

function createPrimaryPaneStore() {
  let panes = $state<PrimaryPane[]>([makeEmptyPane()]);
  let activePaneId = $state<string>(panes[0].id);
  /** Flex sizes (percentage, sum = 100), one entry per pane. */
  let sizes = $state<number[]>([100]);

  let isSplit = $derived(panes.length > 1);

  // Legacy compat: single splitRatio for the two-pane case
  let splitRatio = $derived(panes.length === 2 ? sizes[0] / 100 : 0.5);

  function persist() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          panes: $state.snapshot(panes),
          activePaneId,
          sizes: $state.snapshot(sizes),
        }),
      );
    } catch {}
  }

  function getPane(paneId: string): PrimaryPane | undefined {
    return panes.find((p) => p.id === paneId);
  }

  function activePane(): PrimaryPane {
    return panes.find((p) => p.id === activePaneId) ?? panes[0];
  }

  function activeTab(paneId?: string): PrimaryTab | null {
    const pane = paneId ? getPane(paneId) : activePane();
    if (!pane) return null;
    return pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0] ?? null;
  }

  return {
    get panes() {
      return panes;
    },
    get activePaneId() {
      return activePaneId;
    },
    get sizes() {
      return sizes;
    },
    get splitRatio() {
      return splitRatio;
    },
    get isSplit() {
      return isSplit;
    },
    activePane,
    activeTab,

    /** Open or focus a conversation tab in the given (or active) pane. */
    openConversation(conversationId: string | null, title: string, paneId?: string) {
      const targetId = paneId ?? activePaneId;
      const pane = panes.find((p) => p.id === targetId);
      if (!pane) return;

      const existing = pane.tabs.find(
        (t) => (t.kind === 'chat' || !t.kind) && t.conversationId === conversationId,
      );
      if (existing) {
        pane.activeTabId = existing.id;
      } else {
        const tab: PrimaryTab = { id: uuid(), conversationId, title, kind: 'chat' };
        pane.tabs.push(tab);
        pane.activeTabId = tab.id;
      }
      activePaneId = targetId;
      persist();
    },

    updateTabTitle(conversationId: string, title: string) {
      for (const pane of panes) {
        for (const tab of pane.tabs) {
          if (tab.conversationId === conversationId && tab.title !== title) {
            tab.title = title;
          }
        }
      }
      persist();
    },

    setActiveTab(paneId: string, tabId: string) {
      const pane = panes.find((p) => p.id === paneId);
      if (!pane) {
        if (import.meta.env.DEV) {
          console.warn(`[primaryPaneStore] setActiveTab: pane "${paneId}" not found`);
        }
        return;
      }
      if (!pane.tabs.some((t) => t.id === tabId)) {
        if (import.meta.env.DEV) {
          console.warn(
            `[primaryPaneStore] setActiveTab: tab "${tabId}" not found in pane "${paneId}"`,
          );
        }
        return;
      }
      pane.activeTabId = tabId;
      activePaneId = paneId;
      persist();
    },

    closeTab(paneId: string, tabId: string) {
      const pane = panes.find((p) => p.id === paneId);
      if (!pane) return;

      const idx = pane.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;

      pane.tabs.splice(idx, 1);
      if (pane.activeTabId === tabId) {
        pane.activeTabId = pane.tabs[Math.max(0, idx - 1)]?.id ?? null;
      }
      persist();
    },

    setFocusedPane(paneId: string) {
      activePaneId = paneId;
    },

    /** Move tab `fromId` to sit before `toId` within the same pane (drag-reorder). */
    reorderTab(paneId: string, fromId: string, toId: string) {
      const pane = panes.find((p) => p.id === paneId);
      if (!pane || fromId === toId) return;
      const from = pane.tabs.findIndex((t) => t.id === fromId);
      if (from === -1) return;
      const [moved] = pane.tabs.splice(from, 1);
      const to = pane.tabs.findIndex((t) => t.id === toId);
      pane.tabs.splice(to === -1 ? pane.tabs.length : to, 0, moved);
      persist();
    },

    /**
     * Drag-and-drop: split a tab out into a new pane.
     *
     * Pulls `tabId` from `sourcePaneId`, inserts a new pane at `insertAt` with
     * just that tab, donating half of the donor pane's size (matches splitOpen).
     * If the source pane becomes empty as a result, it's removed and its size
     * donated to a neighbour. No-op if the source pane has a single tab and the
     * split would land adjacent to it (would just rebuild the same pane in
     * place).
     */
    splitTabOut(sourcePaneId: string, tabId: string, insertAt: number) {
      if (panes.length >= MAX_PANES) return;
      const srcIdx = panes.findIndex((p) => p.id === sourcePaneId);
      if (srcIdx === -1) return;
      const src = panes[srcIdx];
      const tabIdx = src.tabs.findIndex((t) => t.id === tabId);
      if (tabIdx === -1) return;
      // Splitting a single-tab pane onto itself is a no-op.
      if (src.tabs.length === 1 && (insertAt === srcIdx || insertAt === srcIdx + 1)) return;

      const clampedInsert = Math.max(0, Math.min(insertAt, panes.length));
      const donorIdx = clampedInsert > 0 ? clampedInsert - 1 : 0;
      const donorSize = sizes[donorIdx] ?? 100 / panes.length;
      const half = donorSize / 2;

      const [moved] = src.tabs.splice(tabIdx, 1);
      if (src.activeTabId === tabId) {
        src.activeTabId = src.tabs[Math.max(0, tabIdx - 1)]?.id ?? null;
      }

      const newPane: PrimaryPane = {
        id: uuid(),
        tabs: [moved],
        activeTabId: moved.id,
      };
      sizes[donorIdx] = half;
      sizes.splice(clampedInsert, 0, half);
      panes.splice(clampedInsert, 0, newPane);
      activePaneId = newPane.id;

      // GC the now-empty source pane (donate size to a neighbour).
      if (src.tabs.length === 0 && panes.length > 1) {
        const emptyIdx = panes.findIndex((p) => p.id === src.id);
        if (emptyIdx !== -1) {
          const removed = sizes[emptyIdx];
          panes.splice(emptyIdx, 1);
          sizes.splice(emptyIdx, 1);
          const donate = emptyIdx > 0 ? emptyIdx - 1 : 0;
          sizes[donate] = (sizes[donate] ?? 0) + removed;
        }
      }
      persist();
    },

    // ── Content tabs (diff / file) ──

    /**
     * Open a git diff in a new tab in the active pane (or reuse an existing
     * tab for the same file+staged combo).
     */
    openDiffTab(filePath: string, diffContent: string, staged: boolean) {
      const pane = panes.find((p) => p.id === activePaneId) ?? panes[0];
      if (!pane) return;

      const label = `${filePath.split('/').pop() ?? filePath} (${staged ? 'staged' : 'unstaged'})`;

      // Reuse existing tab for same file+staged combo
      const existing = pane.tabs.find(
        (t) => t.kind === 'diff' && t.filePath === filePath && t.staged === staged,
      );
      if (existing) {
        existing.diffContent = diffContent;
        pane.activeTabId = existing.id;
        activePaneId = pane.id;
        persist();
        return;
      }

      const tab: PrimaryTab = {
        id: uuid(),
        conversationId: null,
        title: label,
        kind: 'diff',
        filePath,
        diffContent,
        staged,
      };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      activePaneId = pane.id;
      persist();
    },

    /**
     * Open a file in a new tab in the active pane (or reuse an existing tab
     * for the same file path).
     */
    openFileTab(filePath: string, fileContent: string, language: string) {
      const pane = panes.find((p) => p.id === activePaneId) ?? panes[0];
      if (!pane) return;

      const fileName = filePath.split('/').pop() ?? filePath;

      // Reuse existing tab for same file
      const existing = pane.tabs.find((t) => t.kind === 'file' && t.filePath === filePath);
      if (existing) {
        existing.fileContent = fileContent;
        existing.language = language; // refresh in case detection changed (e.g. .sass)
        pane.activeTabId = existing.id;
        activePaneId = pane.id;
        persist();
        return;
      }

      const tab: PrimaryTab = {
        id: uuid(),
        conversationId: null,
        title: fileName,
        kind: 'file',
        filePath,
        fileContent,
        language,
      };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      activePaneId = pane.id;
      persist();
    },

    /**
     * Re-point any open file/diff tabs after a rename — handles both an exact
     * file match and files nested under a renamed directory (prefix match).
     */
    renameFileTab(oldPath: string, newPath: string) {
      let changed = false;
      for (const pane of panes) {
        for (const tab of pane.tabs) {
          if (tab.kind !== 'file' && tab.kind !== 'diff') continue;
          if (!tab.filePath) continue;
          let next: string | null = null;
          if (tab.filePath === oldPath) next = newPath;
          else if (tab.filePath.startsWith(oldPath + '/'))
            next = newPath + tab.filePath.slice(oldPath.length);
          if (next) {
            tab.filePath = next;
            tab.title = next.split('/').pop() ?? next;
            changed = true;
          }
        }
      }
      if (changed) persist();
    },

    /** Close any file/diff tabs for a deleted path (or under a deleted directory). */
    closeFileTabByPath(path: string) {
      let changed = false;
      for (const pane of panes) {
        for (let i = pane.tabs.length - 1; i >= 0; i--) {
          const tab = pane.tabs[i];
          if ((tab.kind !== 'file' && tab.kind !== 'diff') || !tab.filePath) continue;
          if (tab.filePath === path || tab.filePath.startsWith(path + '/')) {
            pane.tabs.splice(i, 1);
            if (pane.activeTabId === tab.id)
              pane.activeTabId = pane.tabs[Math.max(0, i - 1)]?.id ?? null;
            changed = true;
          }
        }
      }
      if (changed) persist();
    },

    /**
     * Open (or focus) a Looper dashboard tab for the given loop ID.
     */
    openLooperTab(loopId: string, title = 'Looper') {
      // Search ALL panes for an existing looper tab with this loopId
      for (const p of panes) {
        const existing = p.tabs.find((t) => t.kind === 'looper' && t.loopId === loopId);
        if (existing) {
          p.activeTabId = existing.id;
          activePaneId = p.id;
          persist();
          return;
        }
      }

      // No existing tab — create in the active pane
      const pane = panes.find((p) => p.id === activePaneId) ?? panes[0];
      if (!pane) return;

      const tab: PrimaryTab = {
        id: uuid(),
        conversationId: null,
        title,
        kind: 'looper',
        loopId,
      };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      activePaneId = pane.id;
      persist();
    },

    /**
     * Open (or focus) a change preview tab for the given plan ID.
     */
    openChangePreviewTab(planId: string, title = 'Review Changes') {
      const pane = panes.find((p) => p.id === activePaneId) ?? panes[0];
      if (!pane) return;

      // Reuse existing preview tab for same plan
      const existing = pane.tabs.find(
        (t) => t.kind === 'change-preview' && t.changePreviewPlanId === planId,
      );
      if (existing) {
        pane.activeTabId = existing.id;
        activePaneId = pane.id;
        persist();
        return;
      }

      const tab: PrimaryTab = {
        id: uuid(),
        conversationId: null,
        title,
        kind: 'change-preview',
        changePreviewPlanId: planId,
      };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      activePaneId = pane.id;
      persist();
    },

    /**
     * Open (or focus) a timeline replay tab for the given conversation ID.
     */
    openTimelineTab(targetConversationId: string, title = 'Timeline') {
      const pane = panes.find((p) => p.id === activePaneId) ?? panes[0];
      if (!pane) return;

      // Reuse existing timeline tab for same conversation
      const existing = pane.tabs.find(
        (t) => t.kind === 'timeline' && t.timelineConversationId === targetConversationId,
      );
      if (existing) {
        pane.activeTabId = existing.id;
        activePaneId = pane.id;
        persist();
        return;
      }

      const tab: PrimaryTab = {
        id: uuid(),
        conversationId: null,
        title,
        kind: 'timeline',
        timelineConversationId: targetConversationId,
      };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      activePaneId = pane.id;
      persist();
    },

    /**
     * Open (or focus) a canvas tab for the given canvas ID.
     */
    openCanvasTab(canvasId: string, title = 'Canvas') {
      const pane = panes.find((p) => p.id === activePaneId) ?? panes[0];
      if (!pane) return;

      // Reuse existing canvas tab for same canvas
      const existing = pane.tabs.find((t) => t.kind === 'canvas' && t.canvasId === canvasId);
      if (existing) {
        existing.title = title;
        pane.activeTabId = existing.id;
        activePaneId = pane.id;
        persist();
        return;
      }

      const tab: PrimaryTab = {
        id: uuid(),
        conversationId: null,
        title,
        kind: 'canvas',
        canvasId,
      };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      activePaneId = pane.id;
      persist();
    },

    /**
     * Open (or focus) a commit view tab for the given SHA.
     */
    openCommitTab(sha: string, workspacePath: string, title?: string) {
      for (const p of panes) {
        const existing = p.tabs.find((t) => t.kind === 'commit' && t.commitSha === sha);
        if (existing) {
          p.activeTabId = existing.id;
          activePaneId = p.id;
          persist();
          return;
        }
      }
      const pane = panes.find((p) => p.id === activePaneId) ?? panes[0];
      if (!pane) return;
      const tab: PrimaryTab = {
        id: uuid(),
        conversationId: null,
        title: title ?? `commit ${sha.slice(0, 7)}`,
        kind: 'commit',
        commitSha: sha,
        commitWorkspacePath: workspacePath,
      };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      activePaneId = pane.id;
      persist();
    },

    /**
     * Open (or focus) a golem parallel tasks tab for the given loop ID.
     */
    openGolemTasksTab(loopId: string, title = 'Task Stream') {
      // Search ALL panes for an existing golem-tasks tab with this loopId
      for (const p of panes) {
        const existing = p.tabs.find((t) => t.kind === 'golem-tasks' && t.loopId === loopId);
        if (existing) {
          p.activeTabId = existing.id;
          activePaneId = p.id;
          persist();
          return;
        }
      }

      // No existing tab — create in the active pane
      const pane = panes.find((p) => p.id === activePaneId) ?? panes[0];
      if (!pane) return;

      const tab: PrimaryTab = {
        id: uuid(),
        conversationId: null,
        title,
        kind: 'golem-tasks',
        loopId,
      };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      activePaneId = pane.id;
      persist();
    },

    /**
     * Refresh the content of any open file tabs matching the given path.
     * Called when the agent modifies a file to keep the PrimaryPane tab in sync.
     */
    async refreshFileTab(filePath: string) {
      let found = false;
      for (const pane of panes) {
        for (const tab of pane.tabs) {
          if (tab.kind === 'file' && tab.filePath === filePath) {
            found = true;
          }
        }
      }
      if (!found) return;
      try {
        const res = await api.files.read(filePath);
        const newContent = res.data.content;
        // Replace the tab object (preserving id) and reassign the tabs array so
        // Svelte's rune reactivity reliably notifies downstream derivations —
        // in-place `tab.fileContent = newContent` wasn't propagating through
        // the CodeEditor's `$effect` that reads `tab.content`.
        for (const pane of panes) {
          const idx = pane.tabs.findIndex((t) => t.kind === 'file' && t.filePath === filePath);
          if (idx < 0) continue;
          const replacement = { ...pane.tabs[idx], fileContent: newContent };
          pane.tabs = [...pane.tabs.slice(0, idx), replacement, ...pane.tabs.slice(idx + 1)];
        }
        persist();
      } catch {
        // File may have been deleted
      }
    },

    // ── Split ──

    /**
     * Add a new split pane to the right of the active pane (or at the end).
     * The active pane donates half its size to the new pane.
     */
    splitOpen(conversationId: string | null, title = 'New chat') {
      if (panes.length >= MAX_PANES) return;

      const activeIdx = panes.findIndex((p) => p.id === activePaneId);
      const insertAt = activeIdx === -1 ? panes.length : activeIdx + 1;

      const newPane = makePane(conversationId, title);

      // Steal half from the pane to the left of the insertion point
      const donorIdx = insertAt > 0 ? insertAt - 1 : 0;
      const donorSize = sizes[donorIdx] ?? 100 / panes.length;
      const half = donorSize / 2;

      sizes[donorIdx] = half;
      sizes.splice(insertAt, 0, half);
      panes.splice(insertAt, 0, newPane);

      activePaneId = newPane.id;
      persist();
    },

    /**
     * Close the pane with the given id (or the active pane).
     * Its size is donated back to the adjacent pane.
     */
    closePane(paneId?: string) {
      const id = paneId ?? activePaneId;
      const idx = panes.findIndex((p) => p.id === id);
      if (idx === -1 || panes.length <= 1) return;

      const removedSize = sizes[idx];
      // Give size to the left neighbour, or the right if we're at index 0
      const donorIdx = idx > 0 ? idx - 1 : 1;
      sizes[donorIdx] += removedSize;

      panes.splice(idx, 1);
      sizes.splice(idx, 1);

      // Re-focus: prefer left neighbour
      const newActive = panes[Math.max(0, idx - 1)];
      activePaneId = newActive.id;
      persist();
    },

    /** Legacy alias used by PrimaryTabBar close-split button. */
    closeSplit() {
      this.closePane();
    },

    /**
     * Resize the divider between pane[dividerIdx] and pane[dividerIdx+1].
     * delta is in percentage points (positive = grow left pane).
     */
    resizeDivider(dividerIdx: number, delta: number) {
      if (dividerIdx < 0 || dividerIdx >= panes.length - 1) return;
      const minSize = 10; // minimum 10% per pane
      const left = sizes[dividerIdx];
      const right = sizes[dividerIdx + 1];
      const newLeft = Math.max(minSize, Math.min(left + right - minSize, left + delta));
      const newRight = left + right - newLeft;
      sizes[dividerIdx] = newLeft;
      sizes[dividerIdx + 1] = newRight;
      persist();
    },

    /** Legacy: called by editorStore with a 0-1 ratio for the 2-pane case. */
    setSplitRatio(ratio: number) {
      if (panes.length === 2) {
        const clamped = Math.max(0.15, Math.min(0.85, ratio));
        sizes[0] = clamped * 100;
        sizes[1] = (1 - clamped) * 100;
        persist();
      }
    },

    // ── Persistence ──

    init() {
      const saved = load();
      if (!saved || !Array.isArray(saved.panes) || saved.panes.length === 0) return;
      panes.splice(0, panes.length, ...saved.panes);
      // Re-derive language for file tabs so extensions whose support was added
      // after the tab was persisted (e.g. .sass/.scss) highlight on next load.
      for (const pane of panes) {
        for (const tab of pane.tabs) {
          if (tab.kind === 'file' && tab.filePath) {
            tab.language = detectLanguage(tab.filePath.split('/').pop() ?? tab.filePath);
          }
        }
      }
      activePaneId = saved.activePaneId ?? panes[0].id;
      // Handle old format (splitRatio) or new format (sizes)
      if (Array.isArray(saved.sizes) && saved.sizes.length === saved.panes.length) {
        sizes.splice(0, sizes.length, ...saved.sizes);
      } else {
        sizes.splice(0, sizes.length, ...evenSizes(panes.length));
      }
    },
  };
}

export const primaryPaneStore = createPrimaryPaneStore();
