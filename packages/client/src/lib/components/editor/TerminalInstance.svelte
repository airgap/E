<script lang="ts">
  import { onMount } from 'svelte';
  import { terminalConnectionManager } from '$lib/services/terminal-connection';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { testResultsStore } from '$lib/stores/test-results.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { workspaceListStore } from '$lib/stores/projects.svelte';
  import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
  import type { ContextMenuItem } from '$lib/components/ui/ContextMenu.svelte';
  import { shellEscapePath } from '$lib/utils/shell-escape';
  import { editorStore } from '$lib/stores/editor.svelte';
  import '@xterm/xterm/css/xterm.css';

  let { sessionId, active = true } = $props<{ sessionId: string; active?: boolean }>();

  let containerEl: HTMLDivElement;
  let mounted = $state(false);

  // ── Context menu state ──
  let showCtx = $state(false);
  let ctxX = $state(0);
  let ctxY = $state(0);

  // ── Drag-and-drop state ──
  let dragOver = $state(false);

  /** Accessible label describing this terminal session */
  const terminalAriaLabel = $derived.by(() => {
    const meta = terminalStore.sessions.get(sessionId);
    if (meta) {
      const shell = meta.shell ? meta.shell.split('/').pop() : 'terminal';
      const cwd = meta.cwd || '';
      return `Terminal session: ${shell}${cwd ? ` — ${cwd}` : ''}`;
    }
    return `Terminal session: ${sessionId}`;
  });

  /** Resolve the working directory for new sessions */
  function getCwd(): string {
    return (
      workspaceListStore.activeWorkspace?.path ||
      conversationStore.active?.workspacePath ||
      settingsStore.workspacePath ||
      '.'
    );
  }

  // ── Clipboard actions ──

  /** Copy the current terminal selection to clipboard */
  async function copySelection(): Promise<void> {
    const text = terminalConnectionManager.getSelection(sessionId);
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard API may fail in some contexts
      }
    }
  }

  /** Paste from clipboard into the terminal */
  async function pasteClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        terminalConnectionManager.write(sessionId, text);
      }
    } catch {
      // Clipboard API may fail in some contexts
    }
  }

  /** Register keyboard handler for search + clipboard shortcuts on the terminal */
  function registerKeyHandler() {
    terminalConnectionManager.attachCustomKeyHandler(sessionId, (ev: KeyboardEvent) => {
      // Ctrl+Shift+C: copy terminal selection to clipboard
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key === 'C') {
        ev.preventDefault();
        ev.stopPropagation();
        copySelection();
        return false;
      }

      // Ctrl+Shift+V: paste from clipboard into terminal
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key === 'V') {
        ev.preventDefault();
        ev.stopPropagation();
        pasteClipboard();
        return false;
      }

      // Ctrl+Shift+F: open terminal search for this instance
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key === 'F') {
        ev.preventDefault();
        ev.stopPropagation();
        terminalStore.openSearchForSession(sessionId);
        return false;
      }

      // Escape: close search if open for this instance
      if (ev.key === 'Escape' && terminalStore.isSearchOpen(sessionId)) {
        ev.preventDefault();
        ev.stopPropagation();
        terminalStore.closeSearchForSession(sessionId);
        terminalConnectionManager.clearSearch(sessionId);
        return false;
      }

      // Shift+F10 or Context Menu key: open context menu via keyboard
      if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) {
        ev.preventDefault();
        ev.stopPropagation();
        openContextMenuFromKeyboard();
        return false;
      }

      return true;
    });
  }

  /** Open context menu at a reasonable position when triggered by keyboard */
  function openContextMenuFromKeyboard() {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    // Position near center of the terminal pane
    ctxX = rect.left + rect.width / 2;
    ctxY = rect.top + rect.height / 3;
    showCtx = true;
  }

  /** Register copy-on-select handler */
  function registerCopyOnSelect(): (() => void) | undefined {
    return terminalConnectionManager.onSelectionChange(sessionId, () => {
      if (!terminalStore.preferences.copyOnSelect) return;
      const text = terminalConnectionManager.getSelection(sessionId);
      if (text) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
    });
  }

  // ── Session logging ──

  /** Toggle session output logging on/off via server API */
  async function toggleLogging(): Promise<void> {
    const isCurrentlyLogging = terminalStore.isLogging(sessionId);
    const enabled = !isCurrentlyLogging;

    try {
      const result = await terminalConnectionManager.toggleLogging(sessionId, enabled);
      if (enabled && result.logFilePath) {
        terminalStore.setLogging(sessionId, result.logFilePath);
      } else if (!enabled) {
        terminalStore.clearLogging(sessionId);
      }
    } catch (err) {
      console.error('[TerminalInstance] Failed to toggle logging:', err);
    }
  }

  /** Open the session log file in the IDE editor */
  async function openLogFile(): Promise<void> {
    const logPath = terminalStore.getLogFilePath(sessionId);
    if (logPath) {
      editorStore.openFile(logPath, false);
      return;
    }
    // Fallback: ask the server for the log file path
    const serverPath = await terminalConnectionManager.getLogFilePath(sessionId);
    if (serverPath) {
      editorStore.openFile(serverPath, false);
    }
  }

  // ── Context menu ──

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    ctxX = e.clientX;
    ctxY = e.clientY;
    showCtx = true;
  }

  const isMac = typeof navigator !== 'undefined' && navigator.platform?.includes('Mac');

  let ctxItems = $derived<ContextMenuItem[]>([
    {
      label: 'Copy',
      shortcut: isMac ? '⌘⇧C' : 'Ctrl+Shift+C',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
      disabled: !terminalConnectionManager.hasSelection(sessionId),
      action: () => copySelection(),
    },
    {
      label: 'Paste',
      shortcut: isMac ? '⌘⇧V' : 'Ctrl+Shift+V',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>`,
      action: () => pasteClipboard(),
    },
    {
      label: 'Select All',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/></svg>`,
      action: () => terminalConnectionManager.selectAll(sessionId),
    },
    { kind: 'separator' },
    {
      label: 'Clear Terminal',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="10"/></svg>`,
      action: () => terminalConnectionManager.clearTerminal(sessionId),
    },
    { kind: 'separator' },
    {
      label: terminalStore.isLogging(sessionId) ? 'Stop Logging' : 'Start Logging',
      icon: terminalStore.isLogging(sessionId)
        ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>`
        : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`,
      action: () => toggleLogging(),
    },
    ...(terminalStore.getLogFilePath(sessionId)
      ? [
          {
            label: 'Open Log File',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
            action: () => openLogFile(),
          } as ContextMenuItem,
        ]
      : []),
    { kind: 'separator' as const },
    {
      label: 'Split Horizontally',
      shortcut: isMac ? '⌘⇧H' : 'Ctrl+Shift+H',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>`,
      action: () => terminalStore.splitActive('horizontal'),
    },
    {
      label: 'Split Vertically',
      shortcut: isMac ? '⌘⇧V' : 'Ctrl+Shift+\\',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>`,
      action: () => terminalStore.splitActive('vertical'),
    },
    { kind: 'separator' },
    {
      label: 'Close Terminal',
      icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      danger: true,
      action: () => {
        terminalConnectionManager.destroySession(sessionId);
        terminalStore.closeSplit(sessionId);
      },
    },
  ]);

  // ── Drag-and-drop handlers ──

  function handleDragOver(e: DragEvent) {
    // Only accept file-path drops from the FileTree
    if (e.dataTransfer?.types.includes('text/terminal-path')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      dragOver = true;
    }
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    dragOver = false;
    if (!e.dataTransfer) return;

    const filePath = e.dataTransfer.getData('text/terminal-path');
    if (filePath) {
      e.preventDefault();
      e.stopPropagation();
      // Shell-escape and write to terminal
      const escaped = shellEscapePath(filePath);
      terminalConnectionManager.write(sessionId, escaped);
      terminalConnectionManager.focus(sessionId);
    }
  }

  /** Look up the profile for this session from the tab's profileId */
  function getSessionProfile():
    | { shellPath?: string; args?: string[]; env?: Record<string, string>; cwd?: string }
    | undefined {
    // Find the tab that contains this session
    const tab = terminalStore.tabs.find((t) => {
      function hasSession(layout: import('@e/shared').TerminalLayout): boolean {
        if (layout.type === 'leaf') return layout.sessionId === sessionId;
        return hasSession(layout.first) || hasSession(layout.second);
      }
      return hasSession(t.layout);
    });
    if (!tab?.profileId) return undefined;
    return terminalStore.getProfile(tab.profileId);
  }

  /**
   * Create a brand new server session (the original flow).
   * Used when no surviving server session matches this session ID.
   */
  async function createFreshSession(): Promise<void> {
    const profile = getSessionProfile();
    const cwd = profile?.cwd || getCwd();
    const createdId = await terminalConnectionManager.createSession({
      shellPath: profile?.shellPath,
      args: profile?.args,
      env: profile?.env,
      cwd,
      cols: 80,
      rows: 24,
    });

    terminalStore.registerSession({
      id: createdId,
      shell: profile?.shellPath || 'sh',
      pid: 0,
      cwd,
      exitCode: null,
      attached: true,
      logging: false,
      logFilePath: null,
    });

    // If the server assigned a different ID than the store's placeholder,
    // update the tab layout tree to point to the real session ID.
    if (createdId !== sessionId) {
      terminalStore.updateSessionId(sessionId, createdId);
      sessionId = createdId;
    }
  }

  /** Whether this session is a virtual agent session (read-only, no PTY) */
  const isAgentSession = $derived(terminalStore.isAgentSession(sessionId));

  /**
   * Ensure this terminal instance has an active connection.
   *
   * On page reload the tab layout is restored from localStorage with the
   * original server session IDs.  If those sessions are still alive on
   * the server (reconciliation happened in TerminalPanel), we reconnect
   * instead of creating a fresh PTY.
   */
  async function ensureSession() {
    if (!terminalConnectionManager.has(sessionId)) {
      // ── Agent virtual session: no PTY needed ──
      if (terminalStore.isAgentSession(sessionId)) {
        terminalConnectionManager.createVirtualSession(sessionId);
        // Register minimal session metadata for agent sessions
        terminalStore.registerSession({
          id: sessionId,
          shell: 'agent',
          pid: 0,
          cwd: '.',
          exitCode: null,
          attached: true,
          logging: false,
          logFilePath: null,
        });
      } else {
        // Check if this session can be reconnected to (server still has it)
        const serverSession = terminalStore.getReconnectableSession(sessionId);

        if (serverSession) {
          // ── Reconnect to existing server session ──
          try {
            // Load buffer snapshot from sessionStorage for instant visual re-render
            const snapshot = terminalConnectionManager.loadSnapshot(sessionId) ?? undefined;

            terminalConnectionManager.reconnectSession(sessionId, {
              cwd: serverSession.cwd,
              snapshot,
            });

            // Register session metadata from server data
            terminalStore.registerSession({
              id: sessionId,
              shell: serverSession.shell,
              pid: serverSession.pid,
              cwd: serverSession.cwd,
              exitCode: serverSession.exitCode,
              attached: true,
              logging: serverSession.logging ?? false,
              logFilePath: serverSession.logFilePath ?? null,
            });

            // Restore logging state if the server session was logging
            if (serverSession.logging && serverSession.logFilePath) {
              terminalStore.setLogging(sessionId, serverSession.logFilePath);
            }

            // Clear the reconnectable flag so we don't try again
            terminalStore.clearReconnectable(sessionId);
          } catch (err) {
            console.error('[TerminalInstance] Failed to reconnect, creating new session:', err);
            terminalStore.clearReconnectable(sessionId);
            try {
              await createFreshSession();
            } catch (freshErr) {
              console.error('[TerminalInstance] Failed to create session:', freshErr);
              return;
            }
          }
        } else {
          // ── Create new session (no surviving server session) ──
          try {
            await createFreshSession();
          } catch (err) {
            console.error('[TerminalInstance] Failed to create session:', err);
            return;
          }
        }
      }
    }

    // Attach to container if mounted and active
    if (mounted && containerEl && active) {
      try {
        terminalConnectionManager.attachToContainer(sessionId, containerEl);
        // Don't focus agent sessions (they're read-only)
        if (!terminalStore.isAgentSession(sessionId)) {
          terminalConnectionManager.focus(sessionId);
        }
      } catch (err) {
        console.error('[TerminalInstance] Failed to attach:', err);
      }
    }

    // Register custom key handler for clipboard + search shortcuts
    registerKeyHandler();

    // Register control message listener for shell integration events
    // (skip for agent sessions — they don't use shell integration)
    if (!terminalStore.isAgentSession(sessionId)) {
      cleanupControlListener?.();
      cleanupControlListener = registerControlListener(sessionId);
    }

    // Check for pending command (task runner) and send it after a short delay
    // to allow the shell prompt to initialize
    const pendingCmd = terminalStore.consumePendingCommand(sessionId);
    if (pendingCmd) {
      setTimeout(() => {
        terminalConnectionManager.write(sessionId, pendingCmd);
      }, 300);
    }
  }

  // Re-derive and apply theme when settings change
  $effect(() => {
    // Access reactive theme/hypertheme values to trigger on change
    const _theme = settingsStore.theme;
    const _ht = settingsStore.hypertheme;

    // Reapply theme on next tick so CSS vars have updated
    if (typeof document !== 'undefined') {
      requestAnimationFrame(() => {
        terminalConnectionManager.reapplyTheme();
      });
    }
  });

  // When active state changes, attach/detach
  $effect(() => {
    if (!mounted || !containerEl) return;

    if (active && terminalConnectionManager.has(sessionId)) {
      terminalConnectionManager.attachToContainer(sessionId, containerEl);
      terminalConnectionManager.focus(sessionId);
    } else if (!active && terminalConnectionManager.has(sessionId)) {
      terminalConnectionManager.detachFromContainer(sessionId);
    }
  });

  let cleanupCopyOnSelect: (() => void) | undefined;
  let cleanupControlListener: (() => void) | undefined;

  /** Register control message listener for shell integration events */
  function registerControlListener(sid: string): () => void {
    // Enable block rendering when we receive any shell integration message
    let blockRenderingActivated = false;

    return terminalConnectionManager.onControlMessage(sid, (msg) => {
      switch (msg.type) {
        case 'cwd_changed':
          terminalStore.setCwd(sid, msg.cwd);
          // Enable block rendering on first shell integration message
          if (!blockRenderingActivated) {
            blockRenderingActivated = true;
            terminalStore.enableBlockRendering(sid);
          }
          break;
        case 'command_text':
          // Store pending command text (arrives before command_start)
          terminalStore.setPendingCommandText(msg.id, msg.text);
          break;
        case 'command_start':
          terminalStore.clearCommandStatus(sid);
          break;
        case 'command_end':
          terminalStore.setCommandStatus(sid, msg.id, msg.exitCode);
          break;
        case 'session_exit':
          terminalStore.setExitCode(sid, msg.exitCode);
          break;
        case 'logging_started':
          terminalStore.setLogging(sid, msg.logFilePath);
          break;
        case 'logging_stopped':
          terminalStore.clearLogging(sid);
          break;
        case 'rich_content':
          terminalStore.addRichContent(msg.blockId, msg.contentType, msg.data);
          if (msg.contentType === 'test_results') {
            try {
              const testRun = JSON.parse(msg.data);
              testResultsStore.addTestRun(testRun);
            } catch {
              // ignore parse errors
            }
          }
          break;
      }
    });
  }

  onMount(() => {
    mounted = true;
    ensureSession();
    cleanupCopyOnSelect = registerCopyOnSelect();

    return () => {
      mounted = false;
      cleanupCopyOnSelect?.();
      cleanupControlListener?.();
      // Detach from DOM but keep session alive (AC #9)
      if (terminalConnectionManager.has(sessionId)) {
        terminalConnectionManager.detachFromContainer(sessionId);
      }
    };
  });
</script>

<!-- Context menu -->
{#if showCtx}
  <ContextMenu
    items={ctxItems}
    x={ctxX}
    y={ctxY}
    onClose={() => {
      showCtx = false;
    }}
  />
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="terminal-instance-wrapper" class:hidden={!active}>
  <div
    class="terminal-instance"
    class:drag-over={dragOver}
    bind:this={containerEl}
    oncontextmenu={handleContextMenu}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    role="group"
    aria-label={terminalAriaLabel}
  ></div>
</div>

<style>
  .terminal-instance-wrapper {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .terminal-instance-wrapper.hidden {
    display: none;
  }
  .terminal-instance {
    flex: 1;
    min-height: 0;
    padding: 4px;
    transition: outline var(--transition);
  }
  .terminal-instance :global(.xterm) {
    height: 100%;
  }
  .terminal-instance.drag-over {
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }
  /* Tooltip shown when hovering clickable links in terminal output */
  .terminal-instance :global(.terminal-link-tooltip) {
    font-family: var(--font-ui, system-ui, sans-serif);
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
