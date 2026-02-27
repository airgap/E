/**
 * TerminalConnectionManager — imperative service (not a store) that owns all
 * WebSocket connections and xterm.js Terminal instances.
 *
 * Terminal instances persist in memory across tab switches via
 * detachFromContainer / attachToContainer (moves the DOM node without
 * recreating the Terminal).
 *
 * Session persistence across browser reloads:
 *   - @xterm/addon-serialize snapshots buffer state on beforeunload
 *   - On reload, reconnectSession() reattaches to surviving PTY sessions
 *   - Serialized snapshots provide instant visual re-render
 *   - Server scrollback replay is skipped when a snapshot is available
 *
 * Addons loaded per terminal:
 *   - @xterm/addon-search     (full-text search)
 *   - @xterm/addon-web-links  (clickable URLs)
 *   - @xterm/addon-unicode11  (emoji & wide chars)
 *   - @xterm/addon-clipboard  (OSC 52 clipboard)
 *   - @xterm/addon-webgl      (WebGL renderer, canvas fallback)
 *   - @xterm/addon-fit        (auto-fit to container)
 *   - @xterm/addon-serialize  (buffer snapshot/restore)
 *   - @xterm/addon-image      (iTerm2 + Sixel inline images, opt-in)
 *
 * Binary-prefix protocol:
 *   0x00 — raw PTY data (default)
 *   0x01 — resize (ASCII "cols,rows")
 *   0x02 — JSON control message → parsed and emitted as typed events
 */

import { Terminal, type IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { getBaseUrl, getDirectWsBase, getAuthToken, getCsrfToken } from '$lib/api/client';
import {
  createUrlClickHandler,
  createUrlLinkOptions,
  createFilePathLinkProvider,
} from './terminal-links';
import type {
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalControlMessage,
  TerminalSessionMeta,
  ShellProfile,
  TerminalPreferences,
} from '@e/shared';
import { TERMINAL_PROTOCOL, DEFAULT_TERMINAL_PREFERENCES } from '@e/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Search options forwarded to the SearchAddon (re-exported for convenience) */
export type TerminalSearchOptions = ISearchOptions;

/** Possible event types emitted when a 0x02 control message arrives. */
export type TerminalControlEventType = TerminalControlMessage['type'];

/** A typed listener for control messages */
export type TerminalControlListener = (msg: TerminalControlMessage) => void;

/** SessionStorage key prefix for buffer snapshots */
const SNAPSHOT_KEY_PREFIX = 'e-terminal-snapshot-';

/** Internal bookkeeping for a single terminal connection */
interface TerminalConnection {
  sessionId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  serializeAddon: SerializeAddon;
  ws: WebSocket | null;
  /** The DOM element the terminal is currently mounted to, or null if detached */
  container: HTMLElement | null;
  /** ResizeObserver for auto-fit when the container resizes */
  resizeObserver: ResizeObserver | null;
  /** Buffer messages received before terminal is ready */
  messageBuffer: string[];
  /** Whether the terminal has rendered its first frame */
  ready: boolean;
  readyTimeout: ReturnType<typeof setTimeout> | null;
  /** Per-session control message listeners */
  controlListeners: Set<TerminalControlListener>;
  /** WebGL addon instance, if loaded */
  webglAddon: unknown | null;
  /** Image addon instance (for iTerm2 inline images + Sixel), if loaded */
  imageAddon: import('@xterm/addon-image').ImageAddon | null;
  /** Whether WebSocket has successfully connected at least once */
  hasConnected: boolean;
  /** Disposable for the file-path link provider */
  linkProviderDisposable: IDisposable | null;
  /** CWD used when the session was created (fallback for link resolution) */
  initialCwd: string;
  /** If true, skip writing server replay data (we restored from a local snapshot) */
  skipReplay: boolean;
  /** Accumulated write data waiting for next rAF flush */
  writeBatch: string;
  /** rAF handle for pending write batch flush */
  writeBatchRaf: number | null;
}

/** Fallback theme colours (used when CSS custom properties aren't available) */
const FALLBACK_THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#00b4ff',
  selectionBackground: 'rgba(0, 180, 255, 0.3)',
  black: '#0d1117',
  red: '#ff3344',
  green: '#00ff88',
  yellow: '#ffaa00',
  blue: '#00b4ff',
  magenta: '#f778ba',
  cyan: '#56d4dd',
  white: '#c9d1d9',
  brightBlack: '#6e7681',
  brightRed: '#ff6b7a',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#76e3ea',
  brightWhite: '#f0f6fc',
};

/**
 * Derive terminal theme from CSS custom properties.
 * Falls back to FALLBACK_THEME values when properties are not set.
 */
/**
 * Resolve the terminal font family for xterm's canvas renderer.
 *
 * xterm.js measures character cells using canvas measureText(), which cannot
 * resolve CSS var() references. If the pref contains var(), we read the
 * computed value from the DOM. As a final fallback we read --font-family
 * (the app's mono font) directly from the root element.
 */
function resolveTerminalFont(pref: string): string {
  if (typeof document === 'undefined') return pref;

  let result = pref;

  // If the preference is a CSS var() reference, resolve it from computed style
  if (pref.startsWith('var(')) {
    const style = getComputedStyle(document.documentElement);
    const match = pref.match(/var\(\s*(--[^,)]+)/);
    if (match) {
      const resolved = style.getPropertyValue(match[1]).trim();
      if (resolved) {
        result = resolved;
      } else {
        // The referenced variable doesn't exist — read --font-family (app mono font)
        const appFont = style.getPropertyValue('--font-family').trim();
        result = appFont || 'monospace';
      }
    }
  }

  return result;
}

export function getThemeFromCSS(): typeof FALLBACK_THEME {
  if (typeof document === 'undefined') return { ...FALLBACK_THEME };

  const style = getComputedStyle(document.documentElement);
  const get = (prop: string, fallback: string): string => {
    const val = style.getPropertyValue(prop).trim();
    return val || fallback;
  };

  return {
    background: get('--bg-primary', FALLBACK_THEME.background),
    foreground: get('--text-primary', FALLBACK_THEME.foreground),
    cursor: get('--accent-primary', FALLBACK_THEME.cursor),
    selectionBackground: get('--bg-selection', FALLBACK_THEME.selectionBackground),
    black: get('--bg-primary', FALLBACK_THEME.black),
    red: get('--accent-error', FALLBACK_THEME.red),
    green: get('--accent-secondary', FALLBACK_THEME.green),
    yellow: get('--accent-warning', FALLBACK_THEME.yellow),
    blue: get('--accent-primary', FALLBACK_THEME.blue),
    magenta: get('--text-link', FALLBACK_THEME.magenta),
    cyan: get('--accent-info', FALLBACK_THEME.cyan),
    white: get('--text-primary', FALLBACK_THEME.white),
    brightBlack: get('--text-tertiary', FALLBACK_THEME.brightBlack),
    brightRed: FALLBACK_THEME.brightRed,
    brightGreen: FALLBACK_THEME.brightGreen,
    brightYellow: FALLBACK_THEME.brightYellow,
    brightBlue: FALLBACK_THEME.brightBlue,
    brightMagenta: FALLBACK_THEME.brightMagenta,
    brightCyan: FALLBACK_THEME.brightCyan,
    brightWhite: FALLBACK_THEME.brightWhite,
  };
}

// ---------------------------------------------------------------------------
// REST helpers (thin wrappers around fetch)
// ---------------------------------------------------------------------------

async function apiRequest<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetch(`${getBaseUrl()}${path}`, { ...opts, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// TerminalConnectionManager
// ---------------------------------------------------------------------------

export class TerminalConnectionManager {
  /** All active connections keyed by sessionId */
  private connections = new Map<string, TerminalConnection>();

  /** Global listeners for control messages from any session */
  private globalControlListeners = new Set<
    (sessionId: string, msg: TerminalControlMessage) => void
  >();

  /** User preferences (can be updated at runtime) */
  private prefs: TerminalPreferences = { ...DEFAULT_TERMINAL_PREFERENCES };

  /**
   * Guard flag to prevent recursive broadcast writes.
   * When the broadcast handler fans out input to sibling sessions,
   * write() should not re-enter the broadcast path.
   */
  private broadcasting = false;

  /**
   * Optional broadcast handler: called whenever a terminal receives keyboard
   * input via onData. The handler receives the source sessionId and the raw
   * input string. The UI layer uses this to fan out input to sibling sessions
   * when broadcast mode is active for the source session's tab.
   */
  private broadcastHandler: ((sourceSessionId: string, data: string) => void) | null = null;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Create a new terminal session via REST, then open a WebSocket and create
   * the Terminal instance.  Returns the sessionId.
   */
  async createSession(
    profile?: Partial<ShellProfile & { cwd?: string; cols?: number; rows?: number }>,
  ): Promise<string> {
    // 1. Call REST to create session on the server
    const body: TerminalCreateRequest = {
      shell: profile?.shellPath,
      args: profile?.args,
      cwd: profile?.cwd,
      env: profile?.env,
      cols: profile?.cols ?? 80,
      rows: profile?.rows ?? 24,
      enableShellIntegration: this.prefs.enableShellIntegration,
    };

    const { data } = await apiRequest<{ ok: boolean; data: TerminalCreateResponse }>(
      '/terminal/sessions',
      { method: 'POST', body: JSON.stringify(body) },
    );

    const sessionId = data.sessionId;

    // 2. Build the connection (Terminal + addons + wiring)
    const conn = this.buildConnection(sessionId, body.cwd ?? '.');

    // 3. Open WebSocket
    this.openWebSocket(conn);

    return sessionId;
  }

  /**
   * Reconnect to an existing server session (surviving across browser reload).
   * Does NOT create a new session via REST — just creates a Terminal instance
   * and opens a WebSocket to the existing server session.
   *
   * If a serialized buffer snapshot is available, it is written to the terminal
   * immediately for instant visual re-render. Server replay data is skipped
   * when a snapshot is present to avoid duplication.
   */
  async reconnectSession(
    sessionId: string,
    opts?: { cwd?: string; snapshot?: string },
  ): Promise<string> {
    // Don't reconnect if we already have this session
    if (this.connections.has(sessionId)) {
      return sessionId;
    }

    const initialCwd = opts?.cwd ?? '.';

    // Build the connection (Terminal + addons + wiring)
    const conn = this.buildConnection(sessionId, initialCwd);

    // If we have a serialized snapshot, write it immediately for fast visual.
    // This data is buffered and rendered when the terminal opens in the DOM.
    if (opts?.snapshot) {
      conn.skipReplay = true;
      conn.terminal.write(opts.snapshot);
    }

    // Open WebSocket — server will replay scrollback (skipped if we have snapshot)
    this.openWebSocket(conn);

    return sessionId;
  }

  /**
   * Create a virtual terminal session — a local-only xterm.js instance with
   * no PTY / WebSocket backing.  Used for the Agent terminal tab, which
   * displays AI tool execution output in a read-only terminal.
   *
   * The terminal has `disableStdin: true` so keyboard input is ignored.
   * Call `writeToTerminal()` to push output into this session.
   *
   * Returns the sessionId (same as the one passed in).
   */
  createVirtualSession(sessionId: string): string {
    if (this.connections.has(sessionId)) {
      return sessionId;
    }

    // Create a Terminal instance with read-only mode
    const terminal = new Terminal({
      cursorBlink: false,
      cursorStyle: 'block',
      fontSize: this.prefs.fontSize,
      fontFamily: resolveTerminalFont(this.prefs.fontFamily),
      fontWeight: this.prefs.fontWeight as any,
      lineHeight: this.prefs.lineHeight,
      scrollback: this.prefs.scrollback,
      disableStdin: true,
      allowProposedApi: true,
      theme: getThemeFromCSS(),
    });

    // Create addons (search + fit + serialize + links + unicode)
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const serializeAddon = new SerializeAddon();
    const unicode11Addon = new Unicode11Addon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = '11';

    const conn: TerminalConnection = {
      sessionId,
      terminal,
      fitAddon,
      searchAddon,
      serializeAddon,
      ws: null,
      container: null,
      resizeObserver: null,
      messageBuffer: [],
      ready: false,
      readyTimeout: null,
      controlListeners: new Set(),
      webglAddon: null,
      imageAddon: null,
      hasConnected: false,
      linkProviderDisposable: null,
      initialCwd: '.',
      skipReplay: false,
      writeBatch: '',
      writeBatchRaf: null,
    };

    this.connections.set(sessionId, conn);

    return sessionId;
  }

  /**
   * Write data directly to a terminal (typically a virtual session).
   * This bypasses the WebSocket and writes directly to the xterm.js instance.
   */
  writeToTerminal(sessionId: string, data: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    if (conn.ready) {
      conn.terminal.write(data);
    } else {
      conn.messageBuffer.push(data);
    }
  }

  /**
   * Mount the terminal into a DOM element.
   *
   * If the terminal was previously attached elsewhere it is moved, not
   * recreated.  If already attached to the same element this is a no-op.
   */
  async attachToContainer(sessionId: string, el: HTMLElement): Promise<void> {
    const conn = this.connections.get(sessionId);
    if (!conn) throw new Error(`No connection for session ${sessionId}`);

    // Already attached to this element — nothing to do
    if (conn.container === el) {
      conn.fitAddon.fit();
      return;
    }

    // Detach from previous container if any
    if (conn.container) {
      this.detachFromContainerInternal(conn);
    }

    conn.container = el;

    // xterm.js open() can only be called once, but we can move the DOM node.
    // If the terminal element already has a parent (was previously opened),
    // we simply reparent it.
    const xtermEl = (conn.terminal as any)._core?._renderService?._renderer?.dimensions
      ? conn.terminal.element
      : null;

    if (xtermEl?.parentElement) {
      // Terminal was previously opened — move the existing DOM subtree
      el.appendChild(xtermEl);
    } else {
      // Wait for fonts to be ready before opening, so xterm's canvas
      // measureText() uses the actual font glyphs (not a fallback).
      await document.fonts.ready;

      // First time opening — let xterm create its DOM
      conn.terminal.open(el);

      // Try loading WebGL addon (with canvas fallback)
      this.loadWebGLAddon(conn);

      // Load image addon if inline images are enabled
      if (this.prefs.enableImages) {
        this.loadImageAddon(conn);
      }
    }

    // Fit and observe size changes
    requestAnimationFrame(() => {
      conn.fitAddon.fit();
    });

    conn.resizeObserver = new ResizeObserver(() => {
      conn.fitAddon.fit();
    });
    conn.resizeObserver.observe(el);

    // Mark ready and flush buffer
    if (!conn.ready) {
      if (conn.readyTimeout) clearTimeout(conn.readyTimeout);
      conn.readyTimeout = setTimeout(() => {
        conn.ready = true;
        if (conn.messageBuffer.length > 0) {
          for (const msg of conn.messageBuffer) {
            conn.terminal.write(msg);
          }
          conn.messageBuffer.length = 0;
        }
      }, 100);
    }
  }

  /**
   * Unmount the terminal from its current DOM element, keeping the Terminal
   * instance alive in memory for later reattachment.
   */
  detachFromContainer(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    this.detachFromContainerInternal(conn);
  }

  /**
   * Destroy a session — closes the WebSocket, disposes the Terminal, and
   * removes all bookkeeping.
   */
  destroySession(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;

    // Clean up DOM
    this.detachFromContainerInternal(conn);

    // Flush pending write batch
    if (conn.writeBatchRaf !== null) {
      cancelAnimationFrame(conn.writeBatchRaf);
      conn.writeBatchRaf = null;
      conn.writeBatch = '';
    }

    // Clean up ready timeout
    if (conn.readyTimeout) clearTimeout(conn.readyTimeout);

    // Dispose link provider
    if (conn.linkProviderDisposable) {
      conn.linkProviderDisposable.dispose();
      conn.linkProviderDisposable = null;
    }

    // Close WebSocket
    if (conn.ws) {
      conn.ws.onclose = null;
      conn.ws.onerror = null;
      conn.ws.onmessage = null;
      conn.ws.onopen = null;
      conn.ws.close();
      conn.ws = null;
    }

    // Clean up image addon explicitly before terminal disposal
    this.unloadImageAddon(conn);

    // Dispose Terminal (and all addons)
    conn.terminal.dispose();

    // Clear listeners
    conn.controlListeners.clear();

    // Clean up snapshot from sessionStorage
    this.clearSnapshot(sessionId);

    this.connections.delete(sessionId);
  }

  /**
   * Destroy all sessions and clean up.
   */
  destroyAll(): void {
    for (const sessionId of Array.from(this.connections.keys())) {
      this.destroySession(sessionId);
    }
  }

  // -----------------------------------------------------------------------
  // Session queries
  // -----------------------------------------------------------------------

  /** Returns all tracked session IDs */
  get sessionIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /** Returns the number of active connections */
  get size(): number {
    return this.connections.size;
  }

  /** Check whether a session exists */
  has(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  /** Get the Terminal instance for a session (useful for theming, etc.) */
  getTerminal(sessionId: string): Terminal | undefined {
    return this.connections.get(sessionId)?.terminal;
  }

  /** Fetch session list from server */
  async listRemoteSessions(): Promise<TerminalSessionMeta[]> {
    const { data } = await apiRequest<{ ok: boolean; data: TerminalSessionMeta[] }>(
      '/terminal/sessions',
    );
    return data;
  }

  // -----------------------------------------------------------------------
  // Buffer serialization (for session persistence across reloads)
  // -----------------------------------------------------------------------

  /**
   * Serialize the terminal buffer for a specific session.
   * Returns the serialized data string or null if serialization fails.
   */
  serializeBuffer(sessionId: string): string | null {
    const conn = this.connections.get(sessionId);
    if (!conn) return null;
    try {
      return conn.serializeAddon.serialize();
    } catch {
      return null;
    }
  }

  /**
   * Serialize all terminal buffers and save to sessionStorage.
   * Call this on beforeunload to snapshot state for reload recovery.
   */
  saveAllSnapshots(): void {
    if (typeof sessionStorage === 'undefined') return;

    // Clear old snapshots first
    this.clearAllSnapshots();

    for (const [id, conn] of this.connections) {
      try {
        const data = conn.serializeAddon.serialize();
        if (data) {
          sessionStorage.setItem(`${SNAPSHOT_KEY_PREFIX}${id}`, data);
        }
      } catch {
        // Serialization may fail for disposed terminals
      }
    }
  }

  /**
   * Load a buffer snapshot from sessionStorage for a specific session.
   * Returns the serialized data or null if no snapshot exists.
   */
  loadSnapshot(sessionId: string): string | null {
    if (typeof sessionStorage === 'undefined') return null;
    try {
      return sessionStorage.getItem(`${SNAPSHOT_KEY_PREFIX}${sessionId}`);
    } catch {
      return null;
    }
  }

  /** Clear a specific snapshot from sessionStorage */
  clearSnapshot(sessionId: string): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      sessionStorage.removeItem(`${SNAPSHOT_KEY_PREFIX}${sessionId}`);
    } catch {
      // ignore
    }
  }

  /** Clear all terminal snapshots from sessionStorage */
  clearAllSnapshots(): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(SNAPSHOT_KEY_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        sessionStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }

  /**
   * Remove snapshots from sessionStorage that don't correspond to any
   * reconnectable session. Called after reconciliation to clean up
   * orphaned snapshots from sessions that no longer exist on the server.
   */
  cleanupStaleSnapshots(reconnectableIds: Set<string>): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(SNAPSHOT_KEY_PREFIX)) {
          const sessionId = key.slice(SNAPSHOT_KEY_PREFIX.length);
          if (!reconnectableIds.has(sessionId)) {
            keysToRemove.push(key);
          }
        }
      }
      for (const key of keysToRemove) {
        sessionStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }

  /**
   * Install beforeunload handler to snapshot terminal buffers on page unload.
   * Returns a cleanup function to remove the handler.
   */
  installBeforeUnloadHandler(): () => void {
    if (typeof window === 'undefined') return () => {};

    const handler = () => {
      this.saveAllSnapshots();
    };

    window.addEventListener('beforeunload', handler);

    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  /**
   * Search for text in a terminal's scrollback.
   * Returns `true` if a match was found.
   */
  search(sessionId: string, query: string, opts?: TerminalSearchOptions): boolean {
    const conn = this.connections.get(sessionId);
    if (!conn) return false;
    return conn.searchAddon.findNext(query, opts);
  }

  /** Find the previous match */
  searchPrevious(sessionId: string, query: string, opts?: TerminalSearchOptions): boolean {
    const conn = this.connections.get(sessionId);
    if (!conn) return false;
    return conn.searchAddon.findPrevious(query, opts);
  }

  /** Clear search decorations */
  clearSearch(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    conn.searchAddon.clearDecorations();
  }

  /**
   * Register a listener for search result changes (fires when match count/index updates).
   * Returns an unsubscribe function.
   */
  onSearchResults(
    sessionId: string,
    callback: (results: { resultIndex: number; resultCount: number }) => void,
  ): () => void {
    const conn = this.connections.get(sessionId);
    if (!conn) return () => {};
    try {
      const disposable = conn.searchAddon.onDidChangeResults(callback);
      return () => disposable.dispose();
    } catch {
      return () => {};
    }
  }

  /**
   * Attach a custom key event handler to a terminal instance.
   * The handler runs before xterm processes the key. Return `false` to prevent
   * xterm from handling the key.
   */
  attachCustomKeyHandler(sessionId: string, handler: (ev: KeyboardEvent) => boolean): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    conn.terminal.attachCustomKeyEventHandler(handler);
  }

  // -----------------------------------------------------------------------
  // Control message events
  // -----------------------------------------------------------------------

  /**
   * Register a listener for control messages on a specific session.
   * Returns an unsubscribe function.
   */
  onControlMessage(sessionId: string, listener: TerminalControlListener): () => void {
    const conn = this.connections.get(sessionId);
    if (!conn) return () => {};
    conn.controlListeners.add(listener);
    return () => conn.controlListeners.delete(listener);
  }

  /**
   * Register a listener for control messages from *any* session.
   * Returns an unsubscribe function.
   */
  onAnyControlMessage(
    listener: (sessionId: string, msg: TerminalControlMessage) => void,
  ): () => void {
    this.globalControlListeners.add(listener);
    return () => this.globalControlListeners.delete(listener);
  }

  // -----------------------------------------------------------------------
  // Preferences
  // -----------------------------------------------------------------------

  /** Update terminal preferences (font, cursor, etc.) for all terminals */
  updatePreferences(prefs: Partial<TerminalPreferences>): void {
    const prevEnableImages = this.prefs.enableImages;
    Object.assign(this.prefs, prefs);
    for (const conn of this.connections.values()) {
      this.applyPreferences(conn);
      // Handle image addon enable/disable toggling at runtime
      if (this.prefs.enableImages && !prevEnableImages) {
        // Images just enabled — load the addon for all terminals that have a container
        if (conn.container && !conn.imageAddon) {
          this.loadImageAddon(conn);
        }
      } else if (!this.prefs.enableImages && prevEnableImages) {
        // Images just disabled — unload the addon
        this.unloadImageAddon(conn);
      } else if (this.prefs.enableImages && conn.imageAddon) {
        // Update storage limit if images are enabled
        conn.imageAddon.storageLimit = this.prefs.imageStorageLimit ?? 64;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Broadcast
  // -----------------------------------------------------------------------

  /**
   * Set or clear the broadcast handler. When set, the handler is called
   * whenever any terminal receives keyboard input (via onData), allowing
   * the UI layer to replicate that input to sibling sessions in the same
   * tab group. Resize events are never broadcast.
   */
  setBroadcastHandler(handler: ((sourceSessionId: string, data: string) => void) | null): void {
    this.broadcastHandler = handler;
  }

  // -----------------------------------------------------------------------
  // Manual input / resize
  // -----------------------------------------------------------------------

  /** Write raw data to a session's WebSocket (e.g. paste) */
  write(sessionId: string, data: string): void {
    const conn = this.connections.get(sessionId);
    if (conn?.ws?.readyState === WebSocket.OPEN) {
      conn.ws.send(data);
    }
  }

  /** Manually trigger a fit (e.g. after programmatic layout change) */
  fit(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (conn?.container) {
      conn.fitAddon.fit();
    }
  }

  /** Focus the terminal */
  focus(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    conn?.terminal.focus();
  }

  /** Get the current text selection from a terminal */
  getSelection(sessionId: string): string {
    const conn = this.connections.get(sessionId);
    if (!conn) return '';
    return conn.terminal.getSelection();
  }

  /** Check if the terminal has an active text selection */
  hasSelection(sessionId: string): boolean {
    const conn = this.connections.get(sessionId);
    if (!conn) return false;
    return conn.terminal.hasSelection();
  }

  /** Clear the current text selection */
  clearSelection(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    conn.terminal.clearSelection();
  }

  /** Select all text in the terminal scrollback buffer */
  selectAll(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    conn.terminal.selectAll();
  }

  /**
   * Extract text content from the terminal buffer for a range of rows.
   * Used by CommandBlockOverlay to copy actual command output.
   * Returns the text content of the buffer between startRow and endRow (inclusive).
   */
  getBufferText(sessionId: string, startRow: number, endRow: number): string {
    const conn = this.connections.get(sessionId);
    if (!conn) return '';

    const buf = conn.terminal.buffer.active;
    const lines: string[] = [];
    const actualEnd = endRow >= 0 ? endRow : buf.baseY + conn.terminal.rows;

    for (let row = startRow; row <= actualEnd; row++) {
      const line = buf.getLine(row);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }

    return lines.join('\n');
  }

  /** Clear the terminal viewport (reset + clear scrollback) and flush image cache */
  clearTerminal(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    conn.terminal.clear();
    // Reset the image addon to flush cached images (AC #6)
    if (conn.imageAddon) {
      conn.imageAddon.reset();
    }
  }

  // -----------------------------------------------------------------------
  // Session Logging
  // -----------------------------------------------------------------------

  /**
   * Toggle session logging on or off via REST API.
   * Returns the updated logging state and log file path (if started).
   */
  async toggleLogging(
    sessionId: string,
    enabled: boolean,
  ): Promise<{ logging: boolean; logFilePath?: string }> {
    const { data } = await apiRequest<{
      ok: boolean;
      data: { logging: boolean; logFilePath?: string };
    }>(`/terminal/sessions/${encodeURIComponent(sessionId)}/logging`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
    return data;
  }

  /**
   * Get the log file path for a session via REST API.
   * Returns the log file path or null if no log file exists.
   */
  async getLogFilePath(sessionId: string): Promise<string | null> {
    try {
      const { data } = await apiRequest<{
        ok: boolean;
        data: { logFilePath: string };
      }>(`/terminal/sessions/${encodeURIComponent(sessionId)}/log`);
      return data.logFilePath;
    } catch {
      return null;
    }
  }

  /** Register a selection change handler for copy-on-select */
  onSelectionChange(sessionId: string, callback: () => void): () => void {
    const conn = this.connections.get(sessionId);
    if (!conn) return () => {};
    const disposable = conn.terminal.onSelectionChange(callback);
    return () => disposable.dispose();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Create a Terminal instance with the current preferences and CSS-derived theme */
  private createTerminalInstance(): Terminal {
    return new Terminal({
      cursorBlink: this.prefs.cursorBlink,
      cursorStyle: this.prefs.cursorStyle,
      fontSize: this.prefs.fontSize,
      fontFamily: resolveTerminalFont(this.prefs.fontFamily),
      fontWeight: this.prefs.fontWeight as any,
      lineHeight: this.prefs.lineHeight,
      scrollback: this.prefs.scrollback,
      allowProposedApi: true,
      theme: getThemeFromCSS(),
    });
  }

  /**
   * Build a complete TerminalConnection record with all addons wired up.
   * Shared by createSession() and reconnectSession() to avoid duplication.
   */
  private buildConnection(sessionId: string, initialCwd: string): TerminalConnection {
    // Create Terminal instance
    const terminal = this.createTerminalInstance();

    // Create addons
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const serializeAddon = new SerializeAddon();
    const webLinksAddon = new WebLinksAddon(
      createUrlClickHandler(),
      createUrlLinkOptions(terminal),
    );
    const unicode11Addon = new Unicode11Addon();
    const clipboardAddon = new ClipboardAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.loadAddon(clipboardAddon);

    // Activate unicode11 version
    terminal.unicode.activeVersion = '11';

    // Register file-path link provider for Ctrl+Click navigation
    const linkProviderDisposable = terminal.registerLinkProvider(
      createFilePathLinkProvider(terminal, sessionId, initialCwd),
    );

    // Build connection record
    const conn: TerminalConnection = {
      sessionId,
      terminal,
      fitAddon,
      searchAddon,
      serializeAddon,
      ws: null,
      container: null,
      resizeObserver: null,
      messageBuffer: [],
      ready: false,
      readyTimeout: null,
      controlListeners: new Set(),
      webglAddon: null,
      imageAddon: null,
      hasConnected: false,
      linkProviderDisposable,
      initialCwd,
      skipReplay: false,
      writeBatch: '',
      writeBatchRaf: null,
    };

    this.connections.set(sessionId, conn);

    // Wire terminal input → WebSocket (+ broadcast fan-out)
    terminal.onData((input) => {
      if (conn.ws?.readyState === WebSocket.OPEN) {
        conn.ws.send(input);
      }
      // Notify broadcast handler so it can replicate input to sibling sessions.
      // The broadcasting guard prevents re-entry when write() is called for siblings.
      if (this.broadcastHandler && !this.broadcasting) {
        this.broadcasting = true;
        try {
          this.broadcastHandler(sessionId, input);
        } finally {
          this.broadcasting = false;
        }
      }
    });

    terminal.onResize(({ cols, rows }) => {
      if (conn.ws?.readyState === WebSocket.OPEN) {
        conn.ws.send(`${String.fromCharCode(TERMINAL_PROTOCOL.RESIZE)}${cols},${rows}`);
      }
    });

    return conn;
  }

  /** Re-derive theme from CSS custom properties and apply to all terminals */
  reapplyTheme(): void {
    const theme = getThemeFromCSS();
    for (const conn of this.connections.values()) {
      conn.terminal.options.theme = theme;
    }
  }

  /** Apply current preferences to an existing terminal */
  private applyPreferences(conn: TerminalConnection): void {
    const t = conn.terminal;
    t.options.cursorBlink = this.prefs.cursorBlink;
    t.options.cursorStyle = this.prefs.cursorStyle;
    t.options.fontSize = this.prefs.fontSize;
    t.options.fontFamily = resolveTerminalFont(this.prefs.fontFamily);
    t.options.fontWeight = this.prefs.fontWeight as any;
    t.options.lineHeight = this.prefs.lineHeight;
    t.options.scrollback = this.prefs.scrollback;
  }

  /** Try to load the WebGL addon; fall back to canvas renderer on failure */
  private async loadWebGLAddon(conn: TerminalConnection): Promise<void> {
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      const addon = new WebglAddon();
      conn.terminal.loadAddon(addon);
      conn.webglAddon = addon;
    } catch {
      // WebGL not supported — canvas renderer is the built-in default
    }
  }

  /**
   * Load the image addon for inline image rendering (iTerm2 + Sixel).
   * Uses dynamic import to avoid blocking initial load.
   * Configures pixel limits based on imageMaxWidth/imageMaxHeight preferences
   * and storage limits from imageStorageLimit.
   */
  private async loadImageAddon(conn: TerminalConnection): Promise<void> {
    // Don't load if already loaded
    if (conn.imageAddon) return;
    try {
      const { ImageAddon } = await import('@xterm/addon-image');
      // Compute pixel limit from max dimensions
      const maxW = this.prefs.imageMaxWidth ?? 1000;
      const maxH = this.prefs.imageMaxHeight ?? 1000;
      const pixelLimit = maxW * maxH;
      const addon = new ImageAddon({
        enableSizeReports: true,
        pixelLimit,
        storageLimit: this.prefs.imageStorageLimit ?? 64,
        showPlaceholder: true,
        sixelSupport: true,
        sixelScrolling: true,
        sixelPaletteLimit: 256,
        sixelSizeLimit: 25_000_000,
        iipSupport: true,
        iipSizeLimit: 20_000_000,
      });
      conn.terminal.loadAddon(addon);
      conn.imageAddon = addon;
    } catch {
      // Image addon failed to load — not critical, just skip
    }
  }

  /** Unload the image addon from a connection (when images are disabled) */
  private unloadImageAddon(conn: TerminalConnection): void {
    if (conn.imageAddon) {
      try {
        conn.imageAddon.dispose();
      } catch {
        // ignore disposal errors
      }
      conn.imageAddon = null;
    }
  }

  /** Open a WebSocket for a connection */
  private openWebSocket(conn: TerminalConnection): void {
    // Use direct WS base to bypass Vite proxy in dev — lower latency
    const wsUrl = `${getDirectWsBase()}/terminal/ws?sessionId=${encodeURIComponent(conn.sessionId)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    conn.ws = ws;

    ws.onopen = () => {
      conn.hasConnected = true;
      // Send initial size if terminal is already opened
      if (conn.container) {
        conn.fitAddon.fit();
        const { cols, rows } = conn.terminal;
        ws.send(`${String.fromCharCode(TERMINAL_PROTOCOL.RESIZE)}${cols},${rows}`);
      }
    };

    ws.onmessage = (evt) => {
      // Handle both binary (ArrayBuffer) and text frames
      let raw: string;
      if (evt.data instanceof ArrayBuffer) {
        raw = new TextDecoder().decode(evt.data);
      } else {
        raw = evt.data as string;
      }

      // --- Binary-prefix protocol: 0x02 = control message ---
      if (raw.length > 0 && raw.charCodeAt(0) === TERMINAL_PROTOCOL.CONTROL) {
        const json = raw.slice(1);
        try {
          const msg = JSON.parse(json) as TerminalControlMessage;

          // When replay ends, stop skipping data — new live output should flow
          if (msg.type === 'replay_end') {
            conn.skipReplay = false;
          }

          this.emitControlMessage(conn, msg);
        } catch {
          // Malformed control message — ignore
        }
        return;
      }

      // --- Skip server replay data when we restored from a local snapshot ---
      if (conn.skipReplay) {
        return;
      }

      // --- Normal PTY data: batch writes into one terminal.write() per frame ---
      if (conn.ready) {
        conn.writeBatch += raw;
        if (conn.writeBatchRaf === null) {
          conn.writeBatchRaf = requestAnimationFrame(() => {
            const batch = conn.writeBatch;
            conn.writeBatch = '';
            conn.writeBatchRaf = null;
            if (batch) conn.terminal.write(batch);
          });
        }
      } else {
        conn.messageBuffer.push(raw);
      }
    };

    ws.onclose = () => {
      // Flush any pending write batch before going idle
      this.flushWriteBatch(conn);
    };

    ws.onerror = () => {
      // Error will also trigger onclose
    };
  }

  /** Flush pending rAF write batch immediately (e.g. on close) */
  private flushWriteBatch(conn: TerminalConnection): void {
    if (conn.writeBatchRaf !== null) {
      cancelAnimationFrame(conn.writeBatchRaf);
      conn.writeBatchRaf = null;
    }
    if (conn.writeBatch) {
      const batch = conn.writeBatch;
      conn.writeBatch = '';
      conn.terminal.write(batch);
    }
  }

  /** Emit a control message to per-session and global listeners */
  private emitControlMessage(conn: TerminalConnection, msg: TerminalControlMessage): void {
    for (const listener of conn.controlListeners) {
      try {
        listener(msg);
      } catch {
        // Listener threw — swallow to avoid breaking the loop
      }
    }
    for (const listener of this.globalControlListeners) {
      try {
        listener(conn.sessionId, msg);
      } catch {
        // Swallow
      }
    }
  }

  /** Internal helper to detach a terminal from its container */
  private detachFromContainerInternal(conn: TerminalConnection): void {
    if (conn.resizeObserver) {
      conn.resizeObserver.disconnect();
      conn.resizeObserver = null;
    }

    // Move the xterm DOM element out of the container but keep it alive.
    // We reparent it to an off-screen holder so it isn't garbage-collected.
    const xtermEl = conn.terminal.element;
    if (xtermEl?.parentElement) {
      xtermEl.parentElement.removeChild(xtermEl);
    }

    conn.container = null;
  }
}

/**
 * Singleton instance.
 *
 * Import this from components / stores that need terminal connections:
 *
 *   import { terminalConnectionManager } from '$lib/services/terminal-connection';
 */
export const terminalConnectionManager = new TerminalConnectionManager();
