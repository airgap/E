import type {
  ShellProfile,
  TerminalTab,
  TerminalLayout,
  TerminalBranch,
  TerminalLeaf,
  TerminalPreferences,
  TerminalSessionMeta,
  TerminalCommandBlock,
  SplitDirection,
  RichContentType,
} from '@e/shared';
import { DEFAULT_TERMINAL_PREFERENCES } from '@e/shared';

// ── localStorage keys ──
const PREFS_KEY = 'e-terminal-preferences';
const TABS_KEY = 'e-terminal-tabs';

// ── Session metadata tracked on the client side ──
export interface SessionMeta {
  id: string;
  shell: string;
  pid: number;
  cwd: string;
  exitCode: number | null;
  attached: boolean;
  /** Whether session output logging is active */
  logging: boolean;
  /** Path to the active log file (if logging) */
  logFilePath: string | null;
}

/** Last command exit code per session (for exit code badge display) */
export interface CommandStatus {
  /** The command ID from shell integration */
  commandId: string;
  /** Exit code: 0 = success, non-zero = failure */
  exitCode: number;
  /** Timestamp of the command completion */
  timestamp: number;
}

// ── Persisted tab shape (no live session references) ──
export interface PersistedTerminalTab {
  id: string;
  label: string;
  layout: TerminalLayout;
  focusedSessionId: string;
  profileId?: string;
}

// ── Rich content entry for a command block ──
export interface RichContentEntry {
  contentType: RichContentType;
  data: string;
}

// ── Navigation direction for split pane focus ──
export type SplitNavigationDirection = 'up' | 'down' | 'left' | 'right';

// ── Helpers ──

let nextId = 1;
function uid(): string {
  return `term-${Date.now()}-${nextId++}`;
}

function loadPreferences(): TerminalPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_TERMINAL_PREFERENCES };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_TERMINAL_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_TERMINAL_PREFERENCES };
}

function savePreferences(prefs: TerminalPreferences) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function loadPersistedTabs(): { tabs: PersistedTerminalTab[]; activeTabId: string | null } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return null;
}

function saveTabState(tabs: TerminalTab[], activeTabId: string | null) {
  if (typeof window === 'undefined') return;
  try {
    const persisted: PersistedTerminalTab[] = tabs.map((t) => ({
      id: t.id,
      label: t.label,
      layout: t.layout,
      focusedSessionId: t.focusedSessionId,
      profileId: t.profileId,
    }));
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: persisted, activeTabId }));
  } catch {
    // ignore
  }
}

/** Collect all session IDs referenced in a layout tree */
function collectSessionIds(layout: TerminalLayout): string[] {
  if (layout.type === 'leaf') return [layout.sessionId];
  return [...collectSessionIds(layout.first), ...collectSessionIds(layout.second)];
}

/** Create a default leaf layout for a new session */
function makeLeaf(sessionId: string): TerminalLayout {
  return { type: 'leaf', sessionId };
}

// ── Layout tree manipulation helpers ──

/**
 * Split a leaf node identified by sessionId into a branch with the original
 * leaf and a new leaf. Returns the new layout tree (immutable) and the new sessionId.
 */
function splitLeafInLayout(
  layout: TerminalLayout,
  targetSessionId: string,
  direction: SplitDirection,
): { layout: TerminalLayout; newSessionId: string | null } {
  if (layout.type === 'leaf') {
    if (layout.sessionId === targetSessionId) {
      const newSessionId = uid();
      const branch: TerminalBranch = {
        type: 'split',
        direction,
        ratio: 0.5,
        first: { type: 'leaf', sessionId: targetSessionId },
        second: { type: 'leaf', sessionId: newSessionId },
      };
      return { layout: branch, newSessionId };
    }
    return { layout, newSessionId: null };
  }

  // Recurse into branch children
  const firstResult = splitLeafInLayout(layout.first, targetSessionId, direction);
  if (firstResult.newSessionId !== null) {
    return {
      layout: { ...layout, first: firstResult.layout },
      newSessionId: firstResult.newSessionId,
    };
  }

  const secondResult = splitLeafInLayout(layout.second, targetSessionId, direction);
  if (secondResult.newSessionId !== null) {
    return {
      layout: { ...layout, second: secondResult.layout },
      newSessionId: secondResult.newSessionId,
    };
  }

  return { layout, newSessionId: null };
}

/**
 * Remove a leaf node from the layout tree. Returns the sibling's subtree
 * (promoting it up), or null if the root leaf was removed.
 */
function removeLeafFromLayout(
  layout: TerminalLayout,
  targetSessionId: string,
): TerminalLayout | null {
  if (layout.type === 'leaf') {
    // If this is the target, return null to signal removal
    return layout.sessionId === targetSessionId ? null : layout;
  }

  // Check if either direct child is the target leaf
  if (layout.first.type === 'leaf' && layout.first.sessionId === targetSessionId) {
    return layout.second; // Promote sibling
  }
  if (layout.second.type === 'leaf' && layout.second.sessionId === targetSessionId) {
    return layout.first; // Promote sibling
  }

  // Recurse deeper
  const firstResult = removeLeafFromLayout(layout.first, targetSessionId);
  if (firstResult !== null && firstResult !== layout.first) {
    return { ...layout, first: firstResult };
  }

  const secondResult = removeLeafFromLayout(layout.second, targetSessionId);
  if (secondResult !== null && secondResult !== layout.second) {
    return { ...layout, second: secondResult };
  }

  return layout;
}

/**
 * Update the ratio of a branch that is the direct parent of a given session.
 * We use a path approach: find the branch containing the target sessionId as a leaf descendant.
 */
function setRatioInLayout(
  layout: TerminalLayout,
  parentFirst: string,
  parentSecond: string,
  ratio: number,
): TerminalLayout {
  if (layout.type === 'leaf') return layout;

  // Check if this branch's children match
  const firstIds = collectSessionIds(layout.first);
  const secondIds = collectSessionIds(layout.second);
  if (firstIds.includes(parentFirst) && secondIds.includes(parentSecond)) {
    return { ...layout, ratio };
  }

  // Recurse
  return {
    ...layout,
    first: setRatioInLayout(layout.first, parentFirst, parentSecond, ratio),
    second: setRatioInLayout(layout.second, parentFirst, parentSecond, ratio),
  };
}

/**
 * Update ratio at a specific branch node. The branch is identified by matching
 * its direct first/second child session sets.
 */
function setBranchRatio(
  layout: TerminalLayout,
  branchFirstSessionId: string,
  branchSecondSessionId: string,
  ratio: number,
): TerminalLayout {
  return setRatioInLayout(layout, branchFirstSessionId, branchSecondSessionId, ratio);
}

/**
 * Replace a session ID in a layout tree (used when a fresh server session
 * is created to replace a stale persisted session reference).
 */
function replaceSessionInLayout(
  layout: TerminalLayout,
  oldId: string,
  newId: string,
): TerminalLayout {
  if (layout.type === 'leaf') {
    return layout.sessionId === oldId ? { type: 'leaf', sessionId: newId } : layout;
  }
  return {
    ...layout,
    first: replaceSessionInLayout(layout.first, oldId, newId),
    second: replaceSessionInLayout(layout.second, oldId, newId),
  };
}

/** Collect all leaf nodes in order (left-to-right, top-to-bottom depth-first) */
function collectLeaves(layout: TerminalLayout): TerminalLeaf[] {
  if (layout.type === 'leaf') return [layout];
  return [...collectLeaves(layout.first), ...collectLeaves(layout.second)];
}

/**
 * For navigation: get the position context of a leaf in the tree.
 * Returns geometric regions for each leaf to determine adjacency.
 */
interface LeafRegion {
  sessionId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function computeLeafRegions(layout: TerminalLayout, x = 0, y = 0, w = 1, h = 1): LeafRegion[] {
  if (layout.type === 'leaf') {
    return [{ sessionId: layout.sessionId, x, y, w, h }];
  }

  if (layout.direction === 'horizontal') {
    const firstW = w * layout.ratio;
    const secondW = w - firstW;
    return [
      ...computeLeafRegions(layout.first, x, y, firstW, h),
      ...computeLeafRegions(layout.second, x + firstW, y, secondW, h),
    ];
  } else {
    const firstH = h * layout.ratio;
    const secondH = h - firstH;
    return [
      ...computeLeafRegions(layout.first, x, y, w, firstH),
      ...computeLeafRegions(layout.second, x, y + firstH, w, secondH),
    ];
  }
}

/**
 * Find the best adjacent leaf in a given direction from the focused leaf.
 * Uses geometric regions to determine which leaf is the best neighbor.
 */
function findAdjacentLeaf(
  regions: LeafRegion[],
  focusedId: string,
  direction: SplitNavigationDirection,
): string | null {
  const focused = regions.find((r) => r.sessionId === focusedId);
  if (!focused) return null;

  const focusCenterX = focused.x + focused.w / 2;
  const focusCenterY = focused.y + focused.h / 2;

  let candidates: LeafRegion[] = [];

  switch (direction) {
    case 'left':
      candidates = regions.filter(
        (r) => r.sessionId !== focusedId && r.x + r.w <= focused.x + 0.001,
      );
      break;
    case 'right':
      candidates = regions.filter(
        (r) => r.sessionId !== focusedId && r.x >= focused.x + focused.w - 0.001,
      );
      break;
    case 'up':
      candidates = regions.filter(
        (r) => r.sessionId !== focusedId && r.y + r.h <= focused.y + 0.001,
      );
      break;
    case 'down':
      candidates = regions.filter(
        (r) => r.sessionId !== focusedId && r.y >= focused.y + focused.h - 0.001,
      );
      break;
  }

  if (candidates.length === 0) return null;

  // Pick the candidate closest to the center of the focused pane
  let best = candidates[0];
  let bestDist = Infinity;

  for (const c of candidates) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const dist = Math.abs(cx - focusCenterX) + Math.abs(cy - focusCenterY);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }

  return best.sessionId;
}

// ── Store ──

function createTerminalStore() {
  // --- Panel state ---
  let isOpen = $state(false);
  let panelHeight = $state(250);
  let maximized = $state(false);

  // --- Tabs ---
  let tabs = $state<TerminalTab[]>([]);
  let activeTabId = $state<string | null>(null);

  // --- Sessions (live, not persisted) ---
  let sessions = $state<Map<string, SessionMeta>>(new Map());

  // --- Shell profiles (populated by server) ---
  let profiles = $state<ShellProfile[]>([]);

  // --- Preferences ---
  let preferences = $state<TerminalPreferences>(loadPreferences());

  // --- Command exit code tracking (for exit code badges) ---
  let lastCommandStatus = $state<Map<string, CommandStatus>>(new Map());

  // --- Agent terminal tab ---
  /** The tab ID of the dedicated Agent terminal tab (null if not created) */
  let agentTabId = $state<string | null>(null);
  /** Set of session IDs that belong to agent tabs (read-only, no PTY) */
  let agentSessionIds = $state<Set<string>>(new Set());

  // --- UI toggles ---
  let searchOpenSessions = $state<Set<string>>(new Set());
  let broadcastTabIds = $state<Set<string>>(new Set());

  // --- Session reconnection (for page reload persistence) ---
  /** Server sessions available for reconnection (populated during reconciliation) */
  let reconnectableSessions = $state<Map<string, TerminalSessionMeta>>(new Map());

  // --- Pending commands (for task runner) ---
  /** Commands to send to a session after it is created (keyed by sessionId) */
  let pendingCommands = $state<Map<string, string>>(new Map());

  // --- Command blocks (Warp-style block-based output) ---
  /** Per-session list of command blocks, keyed by session ID */
  let commandBlocks = $state<Map<string, TerminalCommandBlock[]>>(new Map());
  /** Pending command text keyed by command ID (received before command_start) */
  let pendingCommandTexts = $state<Map<string, string>>(new Map());
  /** Whether block rendering is enabled (requires shell integration) */
  let blockRenderingEnabled = $state<Set<string>>(new Set());

  // --- Rich content per command block ---
  /** Rich content entries keyed by blockId, each block can have multiple rich items */
  let richContent = $state<Map<string, RichContentEntry[]>>(new Map());
  /** Per-block toggle: whether to show rich (true) or raw terminal (false) view */
  let richViewActive = $state<Map<string, boolean>>(new Map());

  // --- Screen reader announcements ---
  /** Message to be announced to screen readers via aria-live region */
  let announcement = $state('');

  // --- Derived state ---
  const activeTab = $derived(tabs.find((t) => t.id === activeTabId) ?? null);
  const activeSessionId = $derived(activeTab?.focusedSessionId ?? null);
  const tabCount = $derived(tabs.length);
  const connected = $derived(sessions.size > 0);

  // --- Internal helpers ---
  function persistTabs() {
    saveTabState(tabs, activeTabId);
  }

  function persistPrefs() {
    savePreferences(preferences);
  }

  /** Find the tab containing a given session ID */
  function findTabBySession(sessionId: string): TerminalTab | null {
    for (const tab of tabs) {
      const ids = collectSessionIds(tab.layout);
      if (ids.includes(sessionId)) return tab;
    }
    return null;
  }

  return {
    // ── Getters ──
    get isOpen() {
      return isOpen;
    },
    get panelHeight() {
      return panelHeight;
    },
    get maximized() {
      return maximized;
    },
    get tabs() {
      return tabs;
    },
    get activeTabId() {
      return activeTabId;
    },
    get activeTab() {
      return activeTab;
    },
    get activeSessionId() {
      return activeSessionId;
    },
    get tabCount() {
      return tabCount;
    },
    get sessions() {
      return sessions;
    },
    get profiles() {
      return profiles;
    },
    get preferences() {
      return preferences;
    },
    get searchOpen() {
      return activeSessionId ? searchOpenSessions.has(activeSessionId) : false;
    },
    get broadcastInput() {
      return activeTabId ? broadcastTabIds.has(activeTabId) : false;
    },
    get connected() {
      return connected;
    },

    /** Raw command blocks map (for reactive watching in effects like TerminalAudio) */
    get commandBlocksMap(): ReadonlyMap<string, TerminalCommandBlock[]> {
      return commandBlocks;
    },

    /** Raw rich content map (for reactive watching in effects like TerminalAudio) */
    get richContentMap(): ReadonlyMap<string, RichContentEntry[]> {
      return richContent;
    },

    get lastCommandStatus() {
      return lastCommandStatus;
    },

    /** Current screen reader announcement (consumed by aria-live region) */
    get announcement() {
      return announcement;
    },

    /** Send a screen reader announcement via the aria-live region */
    announce(message: string) {
      // Clear first so repeating the same message triggers a new announcement
      announcement = '';
      requestAnimationFrame(() => {
        announcement = message;
      });
    },

    /** Get the last command status for a specific session */
    getCommandStatus(sessionId: string): CommandStatus | undefined {
      return lastCommandStatus.get(sessionId);
    },

    // ── Panel lifecycle ──

    toggle() {
      isOpen = !isOpen;
      if (isOpen && tabs.length === 0) {
        this.createTab();
      }
    },

    open() {
      isOpen = true;
      if (tabs.length === 0) {
        this.createTab();
      }
    },

    close() {
      isOpen = false;
      maximized = false;
    },

    toggleMaximize() {
      maximized = !maximized;
    },

    setMaximized(v: boolean) {
      maximized = v;
    },

    setPanelHeight(h: number) {
      panelHeight = Math.max(100, Math.min(600, h));
    },

    // ── Tab management ──

    createTab(profileId?: string): string {
      const sessionId = uid();
      const tabId = uid();
      const tabIndex = tabs.length + 1;

      // Use profile name for label if available
      let label = `Terminal ${tabIndex}`;
      if (profileId) {
        const profile = profiles.find((p) => p.id === profileId);
        if (profile) {
          label = profile.name;
        }
      }

      const tab: TerminalTab = {
        id: tabId,
        label,
        layout: makeLeaf(sessionId),
        focusedSessionId: sessionId,
        profileId,
      };

      tabs = [...tabs, tab];
      activeTabId = tabId;
      persistTabs();
      this.announce(`Terminal tab ${label} created`);
      return tabId;
    },

    closeTab(tabId: string) {
      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx < 0) return;

      const tab = tabs[idx];
      const closedLabel = tab.label;

      // Destroy all sessions belonging to this tab
      const sessionIds = collectSessionIds(tab.layout);
      const newSessions = new Map(sessions);
      for (const sid of sessionIds) {
        newSessions.delete(sid);
      }
      sessions = newSessions;

      tabs = tabs.filter((t) => t.id !== tabId);

      // Clean up broadcast state for closed tab
      if (broadcastTabIds.has(tabId)) {
        const next = new Set(broadcastTabIds);
        next.delete(tabId);
        broadcastTabIds = next;
      }

      // Clean up agent tab state if this was the agent tab
      if (agentTabId === tabId) {
        agentTabId = null;
        const nextAgentSessions = new Set(agentSessionIds);
        for (const sid of sessionIds) {
          nextAgentSessions.delete(sid);
        }
        agentSessionIds = nextAgentSessions;
      }

      // If we closed the active tab, pick an adjacent one
      if (activeTabId === tabId) {
        if (tabs.length > 0) {
          const nextIdx = Math.min(idx, tabs.length - 1);
          activeTabId = tabs[nextIdx].id;
        } else {
          activeTabId = null;
        }
      }

      persistTabs();
      this.announce(`Terminal tab ${closedLabel} closed. ${tabs.length} tabs remaining`);
    },

    activateTab(tabId: string) {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        activeTabId = tabId;
        persistTabs();
        const idx = tabs.indexOf(tab);
        this.announce(`Tab ${tab.label}, ${idx + 1} of ${tabs.length}`);
      }
    },

    renameTab(tabId: string, label: string) {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        tab.label = label;
        tabs = [...tabs]; // trigger reactivity
        persistTabs();
      }
    },

    cycleTab(direction: 1 | -1 = 1) {
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx < 0) return;
      const next = (idx + direction + tabs.length) % tabs.length;
      activeTabId = tabs[next].id;
      persistTabs();
    },

    // ── Split pane management ──

    /**
     * Split the currently focused pane in the active tab.
     * Creates a new session in the new split.
     */
    splitActive(direction: SplitDirection): string | null {
      const tab = activeTab;
      if (!tab) return null;

      const result = splitLeafInLayout(tab.layout, tab.focusedSessionId, direction);
      if (!result.newSessionId) return null;

      // Update the tab with new layout and focus the new pane
      tab.layout = result.layout;
      tab.focusedSessionId = result.newSessionId;
      tabs = [...tabs]; // trigger reactivity
      persistTabs();
      this.announce(`Terminal split ${direction === 'horizontal' ? 'horizontally' : 'vertically'}`);

      return result.newSessionId;
    },

    /**
     * Close a specific split pane by session ID. Removes the leaf from the
     * layout tree and promotes the sibling. If this was the last pane in
     * the tab, closes the tab entirely.
     */
    closeSplit(sessionId: string) {
      const tab = findTabBySession(sessionId);
      if (!tab) return;

      // Remove session from live session tracking
      const newSessions = new Map(sessions);
      newSessions.delete(sessionId);
      sessions = newSessions;

      const newLayout = removeLeafFromLayout(tab.layout, sessionId);

      if (newLayout === null) {
        // This was the last pane — close the tab (AC #10)
        this.closeTab(tab.id);
        return;
      }

      tab.layout = newLayout;

      // If the focused session was the one we closed, focus the first remaining leaf
      if (tab.focusedSessionId === sessionId) {
        const leaves = collectLeaves(newLayout);
        tab.focusedSessionId = leaves.length > 0 ? leaves[0].sessionId : '';
      }

      tabs = [...tabs]; // trigger reactivity
      persistTabs();
      this.announce('Terminal pane closed');
    },

    /**
     * Focus a specific split pane by session ID.
     */
    focusSplit(sessionId: string) {
      const tab = findTabBySession(sessionId);
      if (!tab) return;

      tab.focusedSessionId = sessionId;

      // Also activate this tab if it's not the current one
      if (activeTabId !== tab.id) {
        activeTabId = tab.id;
      }

      tabs = [...tabs]; // trigger reactivity
      persistTabs();
    },

    /**
     * Navigate focus between split panes using directional movement.
     * Uses geometric regions to find the best adjacent pane.
     */
    navigateSplit(direction: SplitNavigationDirection) {
      const tab = activeTab;
      if (!tab) return;

      const regions = computeLeafRegions(tab.layout);
      if (regions.length < 2) return; // No splits to navigate

      const nextId = findAdjacentLeaf(regions, tab.focusedSessionId, direction);
      if (nextId) {
        tab.focusedSessionId = nextId;
        tabs = [...tabs]; // trigger reactivity
        persistTabs();
      }
    },

    /**
     * Update the split ratio of a branch in the active tab's layout tree.
     * The branch is identified by a session ID from its first child subtree
     * and a session ID from its second child subtree.
     */
    setSplitRatio(firstChildSessionId: string, secondChildSessionId: string, ratio: number) {
      const tab = activeTab;
      if (!tab) return;

      const clamped = Math.max(0.15, Math.min(0.85, ratio));
      tab.layout = setBranchRatio(tab.layout, firstChildSessionId, secondChildSessionId, clamped);
      tabs = [...tabs]; // trigger reactivity
      persistTabs();
    },

    /**
     * Check if the active tab has any splits (more than one leaf).
     */
    get hasSplits(): boolean {
      if (!activeTab) return false;
      return activeTab.layout.type === 'split';
    },

    // ── Session tracking ──

    registerSession(meta: SessionMeta) {
      const newSessions = new Map(sessions);
      newSessions.set(meta.id, meta);
      sessions = newSessions;
    },

    unregisterSession(sessionId: string) {
      const newSessions = new Map(sessions);
      newSessions.delete(sessionId);
      sessions = newSessions;
    },

    setCwd(sessionId: string, cwd: string) {
      const meta = sessions.get(sessionId);
      if (meta) {
        const newSessions = new Map(sessions);
        newSessions.set(sessionId, { ...meta, cwd });
        sessions = newSessions;
      }
    },

    setExitCode(sessionId: string, exitCode: number) {
      const meta = sessions.get(sessionId);
      if (meta) {
        const newSessions = new Map(sessions);
        newSessions.set(sessionId, { ...meta, exitCode });
        sessions = newSessions;
        const shell = meta.shell ? meta.shell.split('/').pop() : 'terminal';
        this.announce(`Terminal session ${shell} exited with code ${exitCode}`);
      }
    },

    // ── Session logging ──

    /** Mark a session as logging (called when server confirms logging started) */
    setLogging(sessionId: string, logFilePath: string) {
      const meta = sessions.get(sessionId);
      if (meta) {
        const newSessions = new Map(sessions);
        newSessions.set(sessionId, { ...meta, logging: true, logFilePath });
        sessions = newSessions;
        this.announce('Session logging started');
      }
    },

    /** Mark a session as not logging (called when server confirms logging stopped) */
    clearLogging(sessionId: string) {
      const meta = sessions.get(sessionId);
      if (meta) {
        const newSessions = new Map(sessions);
        // Keep logFilePath so user can still "Open Log File" after stopping
        newSessions.set(sessionId, { ...meta, logging: false });
        sessions = newSessions;
        this.announce('Session logging stopped');
      }
    },

    /** Check if logging is active for a session */
    isLogging(sessionId: string): boolean {
      return sessions.get(sessionId)?.logging ?? false;
    },

    /** Get the log file path for a session */
    getLogFilePath(sessionId: string): string | null {
      return sessions.get(sessionId)?.logFilePath ?? null;
    },

    /** Update the last command status for a session (from shell integration) */
    setCommandStatus(sessionId: string, commandId: string, exitCode: number) {
      const newMap = new Map(lastCommandStatus);
      newMap.set(sessionId, { commandId, exitCode, timestamp: Date.now() });
      lastCommandStatus = newMap;
    },

    /** Clear command status for a session */
    clearCommandStatus(sessionId: string) {
      const newMap = new Map(lastCommandStatus);
      newMap.delete(sessionId);
      lastCommandStatus = newMap;
    },

    // ── Command blocks (Warp-style) ──

    /** Get command blocks for a session */
    getCommandBlocks(sessionId: string): TerminalCommandBlock[] {
      return commandBlocks.get(sessionId) ?? [];
    },

    /** Check if block rendering is enabled for a session */
    isBlockRenderingEnabled(sessionId: string): boolean {
      return blockRenderingEnabled.has(sessionId);
    },

    /** Enable block rendering for a session (called when shell integration is detected) */
    enableBlockRendering(sessionId: string) {
      const next = new Set(blockRenderingEnabled);
      next.add(sessionId);
      blockRenderingEnabled = next;
    },

    /** Store pending command text (arrives before command_start) */
    setPendingCommandText(commandId: string, text: string) {
      const next = new Map(pendingCommandTexts);
      next.set(commandId, text);
      pendingCommandTexts = next;
    },

    /** Start a new command block */
    startCommandBlock(sessionId: string, commandId: string, startRow: number) {
      const blocks = commandBlocks.get(sessionId) ?? [];
      const pendingText = pendingCommandTexts.get(commandId) ?? '';

      // Clean up pending text
      if (pendingText) {
        const nextPending = new Map(pendingCommandTexts);
        nextPending.delete(commandId);
        pendingCommandTexts = nextPending;
      }

      const block: TerminalCommandBlock = {
        id: commandId,
        commandText: pendingText,
        startRow,
        endRow: -1,
        exitCode: null,
        collapsed: false,
        startedAt: Date.now(),
        finishedAt: 0,
      };

      const newBlocks = new Map(commandBlocks);
      newBlocks.set(sessionId, [...blocks, block]);
      commandBlocks = newBlocks;
    },

    /** End a command block with exit code and end row */
    endCommandBlock(sessionId: string, commandId: string, exitCode: number, endRow: number) {
      const blocks = commandBlocks.get(sessionId);
      if (!blocks) return;

      const newBlocks = new Map(commandBlocks);
      newBlocks.set(
        sessionId,
        blocks.map((b) => {
          if (b.id === commandId) {
            return { ...b, exitCode, endRow, finishedAt: Date.now() };
          }
          // Smart auto-collapse: when a new command finishes, collapse previous
          // successful blocks that have many lines of output to reduce noise
          if (b.exitCode === 0 && b.endRow >= 0 && !b.collapsed) {
            const lines = b.endRow - b.startRow;
            if (lines > 50) {
              return { ...b, collapsed: true };
            }
          }
          return b;
        }),
      );
      commandBlocks = newBlocks;
    },

    /** Toggle collapse state of a command block */
    toggleBlockCollapse(sessionId: string, commandId: string) {
      const blocks = commandBlocks.get(sessionId);
      if (!blocks) return;

      const newBlocks = new Map(commandBlocks);
      newBlocks.set(
        sessionId,
        blocks.map((b) => (b.id === commandId ? { ...b, collapsed: !b.collapsed } : b)),
      );
      commandBlocks = newBlocks;
    },

    /** Collapse all blocks for a session */
    collapseAllBlocks(sessionId: string) {
      const blocks = commandBlocks.get(sessionId);
      if (!blocks) return;

      const newBlocks = new Map(commandBlocks);
      newBlocks.set(
        sessionId,
        blocks.map((b) => ({ ...b, collapsed: true })),
      );
      commandBlocks = newBlocks;
    },

    /** Expand all blocks for a session */
    expandAllBlocks(sessionId: string) {
      const blocks = commandBlocks.get(sessionId);
      if (!blocks) return;

      const newBlocks = new Map(commandBlocks);
      newBlocks.set(
        sessionId,
        blocks.map((b) => ({ ...b, collapsed: false })),
      );
      commandBlocks = newBlocks;
    },

    /** Clear all command blocks for a session */
    clearCommandBlocks(sessionId: string) {
      const newBlocks = new Map(commandBlocks);
      newBlocks.delete(sessionId);
      commandBlocks = newBlocks;
    },

    // ── Rich content ──

    /** Add rich content for a command block */
    addRichContent(blockId: string, contentType: RichContentType, data: string) {
      const entries = richContent.get(blockId) ?? [];
      const next = new Map(richContent);

      // Progress updates replace previous progress entries (real-time update)
      if (contentType === 'progress') {
        const filtered = entries.filter((e) => e.contentType !== 'progress');
        next.set(blockId, [...filtered, { contentType, data }]);
      } else {
        next.set(blockId, [...entries, { contentType, data }]);
      }
      richContent = next;

      // Auto-activate rich view when content arrives
      if (!richViewActive.has(blockId)) {
        const nextView = new Map(richViewActive);
        nextView.set(blockId, true);
        richViewActive = nextView;
      }
    },

    /** Get all rich content entries for a command block */
    getRichContent(blockId: string): RichContentEntry[] {
      return richContent.get(blockId) ?? [];
    },

    /** Check if a block has rich content */
    hasRichContent(blockId: string): boolean {
      const entries = richContent.get(blockId);
      return !!entries && entries.length > 0;
    },

    /** Toggle between rich view and raw terminal view for a block */
    toggleRichView(blockId: string) {
      const nextView = new Map(richViewActive);
      nextView.set(blockId, !this.isRichViewActive(blockId));
      richViewActive = nextView;
    },

    /** Check if rich view is active for a block */
    isRichViewActive(blockId: string): boolean {
      return richViewActive.get(blockId) ?? false;
    },

    /** Clear rich content for a session's blocks */
    clearRichContent(sessionId: string) {
      const blocks = commandBlocks.get(sessionId) ?? [];
      if (blocks.length === 0) return;
      const nextContent = new Map(richContent);
      const nextView = new Map(richViewActive);
      for (const b of blocks) {
        nextContent.delete(b.id);
        nextView.delete(b.id);
      }
      richContent = nextContent;
      richViewActive = nextView;
    },

    /** @deprecated use registerSession/unregisterSession instead */
    setConnected(v: boolean) {
      // Legacy compatibility: if called with false, clear all sessions
      // If called with true, it's a no-op (sessions are tracked individually now)
      if (!v) {
        sessions = new Map();
      }
    },

    // ── Profiles ──

    setProfiles(p: ShellProfile[]) {
      profiles = p;
    },

    /** Get a profile by its ID */
    getProfile(profileId: string): ShellProfile | undefined {
      return profiles.find((p) => p.id === profileId);
    },

    // ── Preferences ──

    setPreferences(prefs: TerminalPreferences) {
      preferences = prefs;
      savePreferences(prefs);
    },

    updatePreferences(partial: Partial<TerminalPreferences>) {
      preferences = { ...preferences, ...partial };
      persistPrefs();
    },

    resetPreferences() {
      preferences = { ...DEFAULT_TERMINAL_PREFERENCES };
      persistPrefs();
    },

    // ── Search & broadcast toggles ──

    toggleSearch() {
      const sid = activeSessionId;
      if (!sid) return;
      if (searchOpenSessions.has(sid)) {
        this.closeSearchForSession(sid);
      } else {
        this.openSearchForSession(sid);
      }
    },

    setSearchOpen(v: boolean) {
      const sid = activeSessionId;
      if (!sid) return;
      if (v) {
        this.openSearchForSession(sid);
      } else {
        this.closeSearchForSession(sid);
      }
    },

    isSearchOpen(sessionId: string): boolean {
      return searchOpenSessions.has(sessionId);
    },

    openSearchForSession(sessionId: string) {
      const next = new Set(searchOpenSessions);
      next.add(sessionId);
      searchOpenSessions = next;
    },

    closeSearchForSession(sessionId: string) {
      const next = new Set(searchOpenSessions);
      next.delete(sessionId);
      searchOpenSessions = next;
    },

    toggleBroadcast() {
      if (!activeTabId) return;
      const next = new Set(broadcastTabIds);
      const wasActive = next.has(activeTabId);
      if (wasActive) {
        next.delete(activeTabId);
      } else {
        next.add(activeTabId);
      }
      broadcastTabIds = next;
      this.announce(
        wasActive
          ? 'Broadcast input disabled'
          : 'Broadcast input enabled — typing is sent to all panes in this tab',
      );
    },

    setBroadcast(v: boolean) {
      if (!activeTabId) return;
      const next = new Set(broadcastTabIds);
      if (v) {
        next.add(activeTabId);
      } else {
        next.delete(activeTabId);
      }
      broadcastTabIds = next;
    },

    /** Check if broadcast is active for a specific tab */
    isBroadcastActiveForTab(tabId: string): boolean {
      return broadcastTabIds.has(tabId);
    },

    /** Get all session IDs in the active tab's layout tree */
    getActiveTabSessionIds(): string[] {
      if (!activeTab) return [];
      return collectSessionIds(activeTab.layout);
    },

    /** Get all session IDs in a specific tab's layout tree */
    getTabSessionIds(tabId: string): string[] {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return [];
      return collectSessionIds(tab.layout);
    },

    /** Find which tab a session belongs to, and check if broadcast is active for that tab */
    isBroadcastActiveForSession(sessionId: string): boolean {
      const tab = findTabBySession(sessionId);
      if (!tab) return false;
      return broadcastTabIds.has(tab.id);
    },

    /** Get all sibling session IDs for a given session (same tab, excluding the given session) */
    getSiblingSessionIds(sessionId: string): string[] {
      const tab = findTabBySession(sessionId);
      if (!tab) return [];
      return collectSessionIds(tab.layout).filter((id) => id !== sessionId);
    },

    // ── Session reconnection (page reload persistence) ──

    /**
     * Get all session IDs referenced across all tabs.
     * Used during reconciliation to match server sessions with tab layouts.
     */
    getAllSessionIds(): string[] {
      const ids: string[] = [];
      for (const tab of tabs) {
        ids.push(...collectSessionIds(tab.layout));
      }
      return ids;
    },

    /**
     * Store the set of server sessions that can be reconnected to.
     * Called by TerminalPanel after querying the server for surviving sessions.
     */
    setReconnectableSessions(sessionMap: Map<string, TerminalSessionMeta>) {
      reconnectableSessions = sessionMap;
    },

    /** Check if a session can be reconnected to (exists on the server) */
    isReconnectable(sessionId: string): boolean {
      return reconnectableSessions.has(sessionId);
    },

    /** Get the server metadata for a reconnectable session */
    getReconnectableSession(sessionId: string): TerminalSessionMeta | undefined {
      return reconnectableSessions.get(sessionId);
    },

    /** Remove a session from the reconnectable set after it has been reconnected */
    clearReconnectable(sessionId: string) {
      const next = new Map(reconnectableSessions);
      next.delete(sessionId);
      reconnectableSessions = next;
    },

    /**
     * Replace a session ID in all tab layouts.
     * Used when a fresh server session is created to replace a stale persisted ID.
     * Works correctly with split layouts (updates the correct leaf in the tree).
     */
    updateSessionId(oldId: string, newId: string) {
      for (const tab of tabs) {
        const ids = collectSessionIds(tab.layout);
        if (ids.includes(oldId)) {
          tab.layout = replaceSessionInLayout(tab.layout, oldId, newId);
          if (tab.focusedSessionId === oldId) {
            tab.focusedSessionId = newId;
          }
        }
      }
      tabs = [...tabs]; // trigger reactivity
      persistTabs();
    },

    // ── Pending commands (for task runner) ──

    /** Set a command to be sent to a session after it is created */
    setPendingCommand(sessionId: string, command: string) {
      const next = new Map(pendingCommands);
      next.set(sessionId, command);
      pendingCommands = next;
    },

    /** Get and clear the pending command for a session (called after session creation) */
    consumePendingCommand(sessionId: string): string | null {
      const cmd = pendingCommands.get(sessionId);
      if (cmd !== undefined) {
        const next = new Map(pendingCommands);
        next.delete(sessionId);
        pendingCommands = next;
        return cmd;
      }
      return null;
    },

    /**
     * Create a new tab for running a task (e.g. "npm run dev").
     * The command will be sent to the terminal after the session connects.
     * Returns the tab ID.
     */
    createTaskTab(label: string, command: string): string {
      const sessionId = uid();
      const tabId = uid();

      const tab: TerminalTab = {
        id: tabId,
        label,
        layout: makeLeaf(sessionId),
        focusedSessionId: sessionId,
      };

      // Store the command to be sent after the session is created
      const next = new Map(pendingCommands);
      next.set(sessionId, command + '\n');
      pendingCommands = next;

      tabs = [...tabs, tab];
      activeTabId = tabId;
      persistTabs();
      return tabId;
    },

    // ── Agent terminal tab ──

    /** Get the agent tab ID (null if not created) */
    get agentTabId() {
      return agentTabId;
    },

    /** Check if a tab is the agent tab */
    isAgentTab(tabId: string): boolean {
      return agentTabId === tabId;
    },

    /** Check if a session belongs to an agent tab (virtual, no PTY) */
    isAgentSession(sessionId: string): boolean {
      return agentSessionIds.has(sessionId);
    },

    /**
     * Get or create the dedicated Agent terminal tab.
     * If the agent tab already exists, return its tab ID.
     * Otherwise, create a new tab labeled "Agent" and return it.
     */
    getOrCreateAgentTab(): { tabId: string; sessionId: string } {
      // If agent tab still exists, reuse it
      if (agentTabId) {
        const existingTab = tabs.find((t) => t.id === agentTabId);
        if (existingTab) {
          return { tabId: agentTabId, sessionId: existingTab.focusedSessionId };
        }
        // Tab was removed but agentTabId wasn't cleared — reset
        agentTabId = null;
      }

      // Create a new agent tab
      const sessionId = uid();
      const tabId = uid();

      const tab: TerminalTab = {
        id: tabId,
        label: 'Agent',
        layout: makeLeaf(sessionId),
        focusedSessionId: sessionId,
      };

      // Track as agent session (no PTY)
      const nextAgentSessions = new Set(agentSessionIds);
      nextAgentSessions.add(sessionId);
      agentSessionIds = nextAgentSessions;

      agentTabId = tabId;
      tabs = [...tabs, tab];
      activeTabId = tabId;
      isOpen = true;
      persistTabs();
      this.announce('Agent terminal tab created');
      return { tabId, sessionId };
    },

    /**
     * Close the agent tab. Resets agentTabId so it will recreate on next tool execution.
     */
    closeAgentTab() {
      if (!agentTabId) return;
      const tab = tabs.find((t) => t.id === agentTabId);
      if (tab) {
        // Clean up agent session IDs
        const sessionIds = collectSessionIds(tab.layout);
        const nextAgentSessions = new Set(agentSessionIds);
        for (const sid of sessionIds) {
          nextAgentSessions.delete(sid);
        }
        agentSessionIds = nextAgentSessions;
      }
      // Use standard closeTab logic
      this.closeTab(agentTabId);
      agentTabId = null;
    },

    // ── State capture / restore (for workspace snapshots) ──

    captureState() {
      return {
        isOpen,
        panelHeight,
        maximized,
        tabs: tabs.map((t) => ({
          id: t.id,
          label: t.label,
          layout: t.layout,
          focusedSessionId: t.focusedSessionId,
          profileId: t.profileId,
        })),
        activeTabId,
        preferences: { ...preferences },
      };
    },

    restoreState(state: {
      isOpen: boolean;
      panelHeight: number;
      maximized?: boolean;
      tabs?: PersistedTerminalTab[];
      activeTabId?: string | null;
      preferences?: TerminalPreferences;
    }) {
      isOpen = state.isOpen;
      panelHeight = state.panelHeight;
      maximized = state.maximized ?? false;

      if (state.tabs && state.tabs.length > 0) {
        tabs = state.tabs.map((t) => ({
          id: t.id,
          label: t.label,
          layout: t.layout,
          focusedSessionId: t.focusedSessionId,
          profileId: t.profileId,
        }));
        activeTabId = state.activeTabId ?? state.tabs[0].id;
      } else {
        tabs = [];
        activeTabId = null;
      }

      if (state.preferences) {
        preferences = { ...DEFAULT_TERMINAL_PREFERENCES, ...state.preferences };
        persistPrefs();
      }

      // Clear live session state — sessions will be re-registered by terminal components
      sessions = new Map();
      searchOpenSessions = new Set();
      broadcastTabIds = new Set();

      persistTabs();
    },

    /** Initialize from localStorage on first load */
    init() {
      const savedPrefs = loadPreferences();
      preferences = savedPrefs;

      const savedTabs = loadPersistedTabs();
      if (savedTabs && savedTabs.tabs.length > 0) {
        tabs = savedTabs.tabs.map((t) => ({
          id: t.id,
          label: t.label,
          layout: t.layout,
          focusedSessionId: t.focusedSessionId,
          profileId: t.profileId,
        }));
        activeTabId = savedTabs.activeTabId ?? savedTabs.tabs[0].id;
      }
    },
  };
}

export const terminalStore = createTerminalStore();
