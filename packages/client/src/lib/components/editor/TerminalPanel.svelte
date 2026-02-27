<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { terminalConnectionManager } from '$lib/services/terminal-connection';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { getBaseUrl, getAuthToken } from '$lib/api/client';
  import type { ShellProfile, TerminalSessionMeta } from '@e/shared';
  import TerminalHeader from './TerminalHeader.svelte';
  import TerminalContent from './TerminalContent.svelte';
  import '@xterm/xterm/css/xterm.css';

  // Provide screen reader announcement function to child components (e.g. TerminalSearchBar)
  setContext('terminal-announce', (msg: string) => terminalStore.announce(msg));

  /** Whether reconciliation with the server is complete (gates TerminalContent rendering) */
  let reconciled = $state(false);

  /** Fetch available shell profiles from the server and merge with custom profiles */
  async function loadShellProfiles() {
    let autoDetected: ShellProfile[] = [];
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${getBaseUrl()}/terminal/shells`, { headers });
      if (res.ok) {
        const { data } = await res.json();
        if (Array.isArray(data)) {
          autoDetected = data.map((s: { path: string; name: string; version: string }) => ({
            id: `auto-${s.name.toLowerCase()}`,
            name: `${s.name}${s.version ? ` (${s.version})` : ''}`,
            shellPath: s.path,
            args: [],
            env: {},
            icon: 'terminal',
            isAutoDetected: true,
          }));
        }
      }
    } catch {
      // Shell profiles are optional — terminal will use defaults
    }

    // Save for reactive merging and merge with custom profiles
    autoDetectedProfiles = autoDetected;
    mergeProfiles(autoDetected);
  }

  /** Merge auto-detected and custom profiles into the terminal store */
  function mergeProfiles(autoDetected: ShellProfile[]) {
    const custom = settingsStore.terminalProfiles.map((p) => ({
      ...p,
      isAutoDetected: false,
    }));
    terminalStore.setProfiles([...autoDetected, ...custom]);
  }

  /**
   * Query the server for surviving terminal sessions and build a
   * reconnectable-sessions map.  TerminalInstance components check this
   * map to decide whether to reconnect or create fresh sessions.
   */
  async function reconcileServerSessions(): Promise<void> {
    try {
      const serverSessions = await terminalConnectionManager.listRemoteSessions();
      const sessionMap = new Map<string, TerminalSessionMeta>();
      for (const s of serverSessions) {
        sessionMap.set(s.id, s);
      }

      // Collect all session IDs referenced in current (persisted) tabs
      const tabSessionIds = terminalStore.getAllSessionIds();

      // Build reconnectable map: sessions that exist on both server and in tabs
      const reconnectable = new Map<string, TerminalSessionMeta>();
      for (const sid of tabSessionIds) {
        const serverSession = sessionMap.get(sid);
        if (serverSession) {
          reconnectable.set(sid, serverSession);
        }
      }

      terminalStore.setReconnectableSessions(reconnectable);

      // Clean up stale buffer snapshots from sessionStorage
      terminalConnectionManager.cleanupStaleSnapshots(new Set(reconnectable.keys()));
    } catch (err) {
      // If server is unreachable, proceed without reconnection —
      // all sessions will be created fresh.
      console.warn('[TerminalPanel] Failed to reconcile server sessions:', err);
    }
  }

  onMount(() => {
    let destroyed = false;

    // Initialize store from localStorage (restores tabs, preferences)
    terminalStore.init();

    // Load shell profiles (async, non-blocking)
    loadShellProfiles();

    // Reconcile with server sessions for persistence across page reload.
    // This must complete BEFORE TerminalInstance components mount so they
    // can check whether to reconnect or create fresh sessions.
    (async () => {
      await reconcileServerSessions();

      if (destroyed) return;

      // If no tabs exist after reconciliation, create one
      if (terminalStore.tabs.length === 0) {
        const defaultProfileId = settingsStore.termDefaultProfileId;
        terminalStore.createTab(defaultProfileId || undefined);
      }

      reconciled = true;
    })();

    // Set up broadcast handler: when broadcast mode is active for a tab,
    // replicate keyboard input to all sibling sessions in the same tab.
    terminalConnectionManager.setBroadcastHandler((sourceSessionId, data) => {
      // Check if broadcast is enabled for the tab containing this session
      if (!terminalStore.isBroadcastActiveForSession(sourceSessionId)) return;

      // Get all sibling sessions (same tab, excluding the source)
      const siblings = terminalStore.getSiblingSessionIds(sourceSessionId);
      for (const siblingId of siblings) {
        terminalConnectionManager.write(siblingId, data);
      }
    });

    // Install beforeunload handler to snapshot terminal buffers on page unload.
    // This enables instant visual re-render on reload via @xterm/addon-serialize.
    const cleanupBeforeUnload = terminalConnectionManager.installBeforeUnloadHandler();

    // Listen for OS/IDE high contrast mode changes and reapply terminal theme.
    // This ensures xterm.js picks up the updated CSS custom properties from
    // @media (prefers-contrast: more) or @media (forced-colors: active).
    let cleanupContrastListener: (() => void) | undefined;
    if (typeof window !== 'undefined' && window.matchMedia) {
      const contrastQuery = window.matchMedia('(prefers-contrast: more)');
      const forcedColorsQuery = window.matchMedia('(forced-colors: active)');
      const onContrastChange = () => {
        // CSS vars have already been updated by the browser; reapply to xterm
        requestAnimationFrame(() => {
          terminalConnectionManager.reapplyTheme();
        });
      };
      contrastQuery.addEventListener('change', onContrastChange);
      forcedColorsQuery.addEventListener('change', onContrastChange);
      cleanupContrastListener = () => {
        contrastQuery.removeEventListener('change', onContrastChange);
        forcedColorsQuery.removeEventListener('change', onContrastChange);
      };
    }

    // Closing the panel does NOT kill sessions (AC #9).
    // On unmount, we just detach terminals from DOM.
    return () => {
      destroyed = true;
      // Clean up beforeunload handler
      cleanupBeforeUnload();
      // Clean up contrast change listeners
      cleanupContrastListener?.();
      // Clear the broadcast handler on unmount
      terminalConnectionManager.setBroadcastHandler(null);
      // Sessions stay alive in ConnectionManager memory.
      // When panel reopens, TerminalInstance will reattach.
    };
  });

  // Sync terminal preferences from settingsStore → terminalStore → connectionManager
  $effect(() => {
    // Read all terminal settings from settingsStore (these are reactive)
    const prefs = {
      fontFamily: settingsStore.termFontFamily,
      fontSize: settingsStore.termFontSize,
      fontWeight: settingsStore.termFontWeight,
      lineHeight: settingsStore.termLineHeight,
      cursorStyle: settingsStore.termCursorStyle,
      cursorBlink: settingsStore.termCursorBlink,
      scrollback: settingsStore.termScrollback,
      bellStyle: settingsStore.termBellStyle,
      copyOnSelect: settingsStore.termCopyOnSelect,
      rightClickPaste: settingsStore.termRightClickPaste,
      defaultShell: settingsStore.termDefaultShell,
      enableShellIntegration: settingsStore.termEnableShellIntegration,
      enableImages: settingsStore.termEnableImages,
      imageMaxWidth: settingsStore.termImageMaxWidth,
      imageMaxHeight: settingsStore.termImageMaxHeight,
      imageStorageLimit: settingsStore.termImageStorageLimit,
    };
    // Push to terminalStore (full replace, no merge needed) and connection manager
    terminalStore.setPreferences(prefs);
    terminalConnectionManager.updatePreferences(prefs);
  });

  // Track auto-detected profiles so we can merge them reactively
  let autoDetectedProfiles: ShellProfile[] = [];

  // Reactively re-merge profiles when custom profiles change in settingsStore
  $effect(() => {
    const _custom = settingsStore.terminalProfiles;
    // Re-merge whenever custom profiles change
    mergeProfiles(autoDetectedProfiles);
  });

  // Panel height — default 250px, resizable 100-600px (AC #10)
  const panelHeight = $derived(terminalStore.maximized ? undefined : terminalStore.panelHeight);
</script>

<div
  class="terminal-panel"
  class:maximized={terminalStore.maximized}
  style:height={panelHeight ? `${panelHeight}px` : undefined}
  role="region"
  aria-label="Terminal panel"
>
  <!-- Screen reader announcements (visually hidden, announced on change) -->
  <div class="sr-only" aria-live="polite" aria-atomic="true" role="status">
    {terminalStore.announcement}
  </div>

  <TerminalHeader />
  {#if reconciled}
    <TerminalContent />
  {/if}
</div>

<style>
  .terminal-panel {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border-primary);
    background: var(--bg-primary);
    min-height: 100px;
    max-height: 600px;
  }

  .terminal-panel.maximized {
    flex: 1;
    max-height: none;
    min-height: 0;
  }

  /* Visually hidden but accessible to screen readers */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
