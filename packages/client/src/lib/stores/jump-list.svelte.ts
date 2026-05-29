/**
 * jump-list.svelte.ts (LYK-989) — cross-tab navigation history.
 *
 * Per-tab cursor history is what CodeMirror's undo stack already
 * gives. This store is the orthogonal piece: a global stack of
 * (filePath, line, col) positions that grows whenever the user makes
 * a non-local jump — goto-definition landing, search-result open,
 * or a manual cursor move that crosses more than N lines within the
 * same file.
 *
 * Back / Forward semantics match JetBrains and VS Code: pushing a
 * new entry truncates anything forward of the current index. Repeated
 * back walks toward the start; forward un-walks. The pointer never
 * goes below 0 or above stack.length - 1.
 *
 * Persistence: the stack is keyed by workspace id and persisted under
 * `e-jump-list-v1` so reloads survive. Cap is 100 entries per workspace,
 * which is generous enough to never matter for a session and small
 * enough not to bloat localStorage.
 *
 * The store doesn't actually open files — `applyEntry` in the caller
 * (AppShell.handleKeyDown / menuActions) routes through
 * editorStore.openFile so the existing goTo + scroll plumbing handles
 * the navigation.
 */

import { workspaceStore } from './workspace.svelte';

const STORAGE_KEY = 'e-jump-list-v1';
const MAX_PER_WORKSPACE = 100;
/** Min cursor delta within the same file to count as a non-local jump. */
export const JUMP_THRESHOLD_LINES = 8;

export interface JumpEntry {
  filePath: string;
  line: number;
  col: number;
  /** Date.now() at push — used for the optional history panel display. */
  ts: number;
}

interface PerWorkspaceState {
  stack: JumpEntry[];
  index: number; // -1 when stack empty
}

type Persisted = Record<string, PerWorkspaceState>;

function loadFromStorage(): Persisted {
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

function saveToStorage(state: Persisted) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota
  }
}

function entriesEqual(a: JumpEntry, b: JumpEntry): boolean {
  return a.filePath === b.filePath && a.line === b.line && a.col === b.col;
}

function createJumpListStore() {
  let perWorkspace = $state<Persisted>(loadFromStorage());

  function bucketKey(): string {
    return workspaceStore.activeWorkspaceId ?? '__none__';
  }

  function getOrInit(): PerWorkspaceState {
    const key = bucketKey();
    let entry = perWorkspace[key];
    if (!entry) {
      entry = { stack: [], index: -1 };
      perWorkspace = { ...perWorkspace, [key]: entry };
    }
    return entry;
  }

  function persist() {
    saveToStorage(perWorkspace);
  }

  return {
    /** Stack snapshot for the active workspace, oldest → newest. */
    get entries(): JumpEntry[] {
      return perWorkspace[bucketKey()]?.stack ?? [];
    },

    /** Pointer into `entries`; -1 when empty. */
    get currentIndex(): number {
      return perWorkspace[bucketKey()]?.index ?? -1;
    },

    /** True iff back() would return an entry. */
    get canBack(): boolean {
      const e = perWorkspace[bucketKey()];
      return !!e && e.index > 0;
    },

    /** True iff forward() would return an entry. */
    get canForward(): boolean {
      const e = perWorkspace[bucketKey()];
      return !!e && e.index >= 0 && e.index < e.stack.length - 1;
    },

    /**
     * Append a jump position. Drops anything forward of the current
     * pointer (standard back/forward semantics), dedupes against the
     * top entry to avoid duplicates from rapid double-clicks, and
     * caps the stack at MAX_PER_WORKSPACE.
     */
    push(entry: Omit<JumpEntry, 'ts'>) {
      if (!entry.filePath) return;
      const state = getOrInit();
      const newEntry: JumpEntry = { ...entry, ts: Date.now() };
      const top = state.stack[state.index];
      if (top && entriesEqual(top, newEntry)) {
        // Same position — refresh timestamp but don't grow the stack.
        top.ts = newEntry.ts;
        persist();
        return;
      }
      // Drop forward branch.
      const truncated =
        state.index >= 0 && state.index < state.stack.length - 1
          ? state.stack.slice(0, state.index + 1)
          : state.stack;
      const next = [...truncated, newEntry];
      const overflow = Math.max(0, next.length - MAX_PER_WORKSPACE);
      const trimmed = overflow > 0 ? next.slice(overflow) : next;
      const newState: PerWorkspaceState = {
        stack: trimmed,
        index: trimmed.length - 1,
      };
      perWorkspace = { ...perWorkspace, [bucketKey()]: newState };
      persist();
    },

    /** Step back one entry; returns the entry to navigate to, or null. */
    back(): JumpEntry | null {
      const state = perWorkspace[bucketKey()];
      if (!state || state.index <= 0) return null;
      const newIndex = state.index - 1;
      const newState: PerWorkspaceState = { ...state, index: newIndex };
      perWorkspace = { ...perWorkspace, [bucketKey()]: newState };
      persist();
      return state.stack[newIndex];
    },

    /** Step forward one entry; returns the entry, or null. */
    forward(): JumpEntry | null {
      const state = perWorkspace[bucketKey()];
      if (!state || state.index < 0 || state.index >= state.stack.length - 1) return null;
      const newIndex = state.index + 1;
      const newState: PerWorkspaceState = { ...state, index: newIndex };
      perWorkspace = { ...perWorkspace, [bucketKey()]: newState };
      persist();
      return state.stack[newIndex];
    },

    /** Jump directly to an entry by index — used by the optional panel. */
    goto(targetIndex: number): JumpEntry | null {
      const state = perWorkspace[bucketKey()];
      if (!state) return null;
      if (targetIndex < 0 || targetIndex >= state.stack.length) return null;
      const newState: PerWorkspaceState = { ...state, index: targetIndex };
      perWorkspace = { ...perWorkspace, [bucketKey()]: newState };
      persist();
      return state.stack[targetIndex];
    },

    /** Drop the workspace's history (e.g. after Clear All). */
    clear() {
      perWorkspace = { ...perWorkspace, [bucketKey()]: { stack: [], index: -1 } };
      persist();
    },
  };
}

export const jumpListStore = createJumpListStore();
