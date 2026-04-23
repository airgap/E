/**
 * Breakpoint store — client-side source of truth for user-set breakpoints.
 *
 * Breakpoints are stored per absolute file path. They persist across sessions
 * via localStorage so a reload doesn't wipe a debugging flow in progress.
 * When a debug session is running, the DAP store reads from here to push
 * `setBreakpoints` requests; edits while running also push immediately.
 */

const STORAGE_KEY = 'e-breakpoints';

export interface Breakpoint {
  /** 1-indexed line number, matching DAP semantics. */
  line: number;
  /** Optional expression — true breakpoint when set to non-empty. */
  condition?: string;
  /** Whether this breakpoint is currently enabled (disabled = present but skipped). */
  enabled: boolean;
  /** The adapter's verified state for this breakpoint, if we've heard back. */
  verified?: boolean;
}

type BreakpointChangeListener = (path: string, breakpoints: Breakpoint[]) => void;

function load(): Map<string, Breakpoint[]> {
  if (typeof localStorage === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, Breakpoint[]>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function persist(map: Map<string, Breakpoint[]>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const obj: Record<string, Breakpoint[]> = {};
    for (const [k, v] of map.entries()) {
      if (v.length > 0) obj[k] = v;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Quota or privacy mode — breakpoints become session-only, that's fine.
  }
}

function createBreakpointsStore() {
  let byPath = $state<Map<string, Breakpoint[]>>(load());
  const listeners = new Set<BreakpointChangeListener>();

  function notify(path: string) {
    const bps = byPath.get(path) ?? [];
    for (const l of listeners) l(path, bps);
  }

  function setForPath(path: string, bps: Breakpoint[]) {
    const next = new Map(byPath);
    if (bps.length === 0) next.delete(path);
    else next.set(path, bps);
    byPath = next;
    persist(next);
    notify(path);
  }

  return {
    /** Entire map, keyed by absolute path. */
    get byPath() {
      return byPath;
    },

    /** Breakpoints for one file (empty array if none). */
    forFile(path: string): Breakpoint[] {
      return byPath.get(path) ?? [];
    },

    /** Toggle a breakpoint at a specific line — add if absent, remove if present. */
    toggle(path: string, line: number): void {
      const current = byPath.get(path) ?? [];
      const idx = current.findIndex((b) => b.line === line);
      if (idx >= 0) {
        setForPath(
          path,
          current.filter((_, i) => i !== idx),
        );
      } else {
        setForPath(
          path,
          [...current, { line, enabled: true }].sort((a, b) => a.line - b.line),
        );
      }
    },

    /** Toggle `enabled` without removing the breakpoint. */
    setEnabled(path: string, line: number, enabled: boolean): void {
      const current = byPath.get(path) ?? [];
      const next = current.map((b) => (b.line === line ? { ...b, enabled } : b));
      setForPath(path, next);
    },

    /** Mark verification from the adapter (shown as filled vs hollow in the gutter). */
    setVerified(path: string, line: number, verified: boolean): void {
      const current = byPath.get(path) ?? [];
      const next = current.map((b) => (b.line === line ? { ...b, verified } : b));
      setForPath(path, next);
    },

    /** Clear all breakpoints — used by the "Remove All Breakpoints" command. */
    clearAll(): void {
      byPath = new Map();
      persist(byPath);
      for (const l of listeners) l('', []);
    },

    /** Subscribe to change events. Returns an unsubscribe function. */
    subscribe(listener: BreakpointChangeListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const breakpointsStore = createBreakpointsStore();
