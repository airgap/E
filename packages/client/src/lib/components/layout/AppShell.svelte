<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { profilesStore } from '$lib/stores/profiles.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { panelDragStore } from '$lib/stores/panelDrag.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import TopBar from './TopBar.svelte';
  import MainToolbar from './MainToolbar.svelte';
  import CommentaryTicker from './CommentaryTicker.svelte';
  import StatusBar from './StatusBar.svelte';
  import MainContent from './MainContent.svelte';
  import TerminalPanel from '../editor/TerminalPanel.svelte';
  import PanelColumn from '../sidebar/PanelColumn.svelte';
  import FloatingPanelContainer from '../sidebar/FloatingPanelContainer.svelte';
  import DragOverlay from '../sidebar/DragOverlay.svelte';
  import SettingsModal from '../settings/SettingsModal.svelte';
  import SnapshotModal from '../settings/SnapshotModal.svelte';
  import LaunchConfigEditor from '../settings/LaunchConfigEditor.svelte';
  import WalkthroughsModal from '../common/WalkthroughsModal.svelte';
  import BranchPickerModal from '../git/BranchPickerModal.svelte';
  import PluginPromptModal from '../common/PluginPromptModal.svelte';
  import LoopConfigModal from '../settings/LoopConfigModal.svelte';
  import StoryCreateModal from '../settings/StoryCreateModal.svelte';
  import StoryGenerateModal from '../settings/StoryGenerateModal.svelte';
  import StoryRefineModal from '../settings/StoryRefineModal.svelte';
  import PrdRefineAllModal from '../settings/PrdRefineAllModal.svelte';
  import CriteriaValidationModal from '../settings/CriteriaValidationModal.svelte';
  import StoryEstimateModal from '../settings/StoryEstimateModal.svelte';
  import SprintPlanModal from '../settings/SprintPlanModal.svelte';
  import PrdCompletenessModal from '../settings/PrdCompletenessModal.svelte';
  import TemplateLibraryModal from '../settings/TemplateLibraryModal.svelte';
  import PriorityRecommendationModal from '../settings/PriorityRecommendationModal.svelte';
  import EffortValueMatrixModal from '../settings/EffortValueMatrixModal.svelte';
  import ExternalProviderConfigModal from '../settings/ExternalProviderConfigModal.svelte';
  import CommandPalette from '../common/CommandPalette.svelte';
  import CompactionHistoryModal from '../common/CompactionHistoryModal.svelte';
  import ClaudeCodeViewerModal from '../sidebar/ClaudeCodeViewerModal.svelte';
  import PluginPaneViewerModal from '../sidebar/PluginPaneViewerModal.svelte';
  import ToastContainer from '../common/ToastContainer.svelte';
  import QuickOpen from '../editor/QuickOpen.svelte';
  import ProjectSetup from '../common/ProjectSetup.svelte';
  import AmbientBackground from './AmbientBackground.svelte';
  import MobileShell from './MobileShell.svelte';
  import SpatialViewport from './SpatialViewport.svelte';
  import { spatialViewportStore } from '$lib/stores/spatialViewport.svelte';
  import InteractiveTutorial from '../common/InteractiveTutorial.svelte';
  import StartupTip from '../common/StartupTip.svelte';
  import { waitForServer, restoreRemoteConnection, api } from '$lib/api/client';
  import { reconnectActiveStream } from '$lib/api/sse';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { deviceStore } from '$lib/stores/device.svelte';
  import { tutorialStore } from '$lib/stores/tutorial.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { startupTipsStore } from '$lib/stores/startupTips.svelte';
  import { signalAppReady } from '$lib/stores/ready';
  import { fileWatcherStore } from '$lib/stores/fileWatcher.svelte';
  import { diagnosticsStore } from '$lib/stores/diagnostics.svelte';
  import { dapStore } from '$lib/stores/dap.svelte';
  import { launchConfigsStore } from '$lib/stores/launch-configs.svelte';
  import { pluginContributionsStore } from '$lib/stores/pluginContributions.svelte';
  import { dispatchPluginCommand } from '$lib/stores/pluginBridge';
  import { bootstrapPluginBridge } from '$lib/stores/pluginBridgeBootstrap.svelte';
  import { bootstrapPluginThemes } from '$lib/stores/pluginThemes.svelte';
  import { bootstrapPluginSnippets } from '$lib/stores/pluginSnippets.svelte';
  import { bootstrapPluginLanguageConfigs } from '$lib/stores/pluginLanguageConfigs.svelte';
  import { bootstrapPluginIconThemes } from '$lib/stores/pluginIconThemes.svelte';
  import { bootstrapPluginGrammars } from '$lib/stores/pluginGrammars.svelte';
  import { parseKeystroke, keystrokeMatches, pickKeybindingForOS } from '$lib/stores/keybindings';
  import { evaluateWhen } from '$lib/stores/whenExpression';
  import { runMenuAction } from '$lib/menu/menuActions';
  import { onMount, onDestroy, tick } from 'svelte';

  let { children: appChildren } = $props<{ children: any }>();

  onMount(() => {
    deviceStore.init();
    restoreRemoteConnection();
    // Wire plugin RPC handlers + host→iframe broadcasts (LYK-1056).
    // Bootstrap is idempotent — safe to call regardless of hot-reload.
    bootstrapPluginBridge();
    // Sync plugin-contributed themes from enabled plugins (LYK-1038).
    bootstrapPluginThemes();
    // Sync plugin-contributed snippets from enabled plugins (LYK-1037).
    bootstrapPluginSnippets();
    // Sync plugin-contributed language configurations (LYK-1034).
    bootstrapPluginLanguageConfigs();
    // Sync plugin-contributed file icon themes (LYK-1039).
    bootstrapPluginIconThemes();
    // Sync plugin-contributed grammar runtimes (LYK-1035 / LYK-1036).
    bootstrapPluginGrammars();

    // ── Mac native-menu plumbing ──
    // Set <html data-mac> so MainToolbar (and any other "hide on mac"
    // surface) can opt out via CSS. Subscribe to 'e:menu-action' from
    // the preload bridge so native-menu clicks dispatch through the
    // same registry the in-window MainToolbar uses.
    const isMac = /mac|iphone|ipad/i.test(
      (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '',
    );
    if (isMac) document.documentElement.setAttribute('data-mac', '');
    const onMenuAction = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string }>).detail;
      if (detail?.id) runMenuAction(detail.id);
    };
    window.addEventListener('e:menu-action', onMenuAction);
    onDestroy(() => window.removeEventListener('e:menu-action', onMenuAction));

    waitForServer().then(async () => {
      // Await workspace init to ensure activeConversationId is loaded
      // before attempting stream reconnection
      await workspaceStore.init();
      // Start the filesystem watcher so externally-modified files reload
      // in the editor without the user doing anything. The server already
      // knows the current workspace from settings; we just open the socket.
      fileWatcherStore.start();
      // Subscribe the global diagnostics store so the Problems panel
      // aggregates across every LSP, not just the active file.
      diagnosticsStore.subscribe();
      sidebarLayoutStore.init();
      primaryPaneStore.init();
      profilesStore.load();

      // Always load active loop state on startup so that golem indicators
      // (TopBar badge, StatusBar, AppShell glow, GolemsPanel) work regardless
      // of which sidebar tab is restored from the session.
      loopStore.loadActiveLoop();

      // On mobile, start with sidebar closed
      if (deviceStore.isMobileUI) {
        // sidebarLayoutStore.init() may open it — close after init
        setTimeout(() => {
          if (deviceStore.isMobileUI && uiStore.sidebarOpen) {
            uiStore.toggleSidebar();
          }
        }, 0);
      }

      // Check for in-flight streaming sessions and reconnect if found.
      // This handles page reloads during active responses from any provider.
      try {
        const reconnectedId = await reconnectActiveStream();

        // If reconnection didn't load a conversation, ensure the saved one
        // is restored. This handles the case where reconnection finds no
        // active sessions but ConversationList hasn't loaded yet.
        if (!reconnectedId && !conversationStore.active) {
          const savedId = workspaceStore.activeWorkspace?.snapshot.activeConversationId;
          if (savedId) {
            try {
              const convRes = await api.conversations.get(savedId);
              if (convRes.ok && convRes.data) {
                conversationStore.setActive(convRes.data);
              }
            } catch {
              // Conversation may no longer exist
            }
          }
        }
      } catch {
        // Non-critical — user can manually reload
      }

      // Signal that the app is fully initialized — splash can dismiss.
      // Wait for Svelte to flush DOM updates, then one paint frame.
      await tick();
      requestAnimationFrame(() => signalAppReady());

      // Auto-launch tutorial for first-time users
      if (tutorialStore.isFirstTime) {
        tutorialStore.start();
      } else if (settingsStore.showStartupTips) {
        // Show a rotating tip for returning users (skip when tutorial is active)
        setTimeout(() => {
          if (!tutorialStore.active) {
            startupTipsStore.show();
          }
        }, 1500);
      }
    });
  });

  // Retarget the server-side watcher whenever the active workspace changes.
  // Guarded against the sentinel '.' value used before any workspace is loaded.
  $effect(() => {
    const wsPath = settingsStore.workspacePath;
    if (wsPath && wsPath !== '.') {
      fileWatcherStore.watch(wsPath).catch(() => {});
    }
  });

  onDestroy(() => {
    fileWatcherStore.stop();
  });

  // Surface a one-shot hint when Zen Mode turns on so users know how to
  // get out. Reading `uiStore.zenMode` makes this effect re-run on toggle;
  // the prevZen guard suppresses the initial mount tick.
  let prevZen = false;
  $effect(() => {
    const zen = uiStore.zenMode;
    if (zen && !prevZen) {
      uiStore.toast('Zen Mode · press Esc or Ctrl+Alt+Z to exit', 'info', 3000);
    }
    prevZen = zen;
  });

  let resizing = $state(false);
  let resizeSide = $state<'left' | 'right'>('left');
  let startX = 0;
  let startWidth = 0;

  function onColumnResizeStart(side: 'left' | 'right', e: MouseEvent) {
    resizing = true;
    resizeSide = side;
    startX = e.clientX;
    const col = side === 'left' ? sidebarLayoutStore.leftColumn : sidebarLayoutStore.rightColumn;
    startWidth = col?.width ?? 280;
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }

  function onResizeMove(e: MouseEvent) {
    if (!resizing) return;
    const delta = resizeSide === 'left' ? e.clientX - startX : startX - e.clientX;
    sidebarLayoutStore.setColumnWidth(resizeSide, startWidth + delta);
  }

  function onResizeEnd() {
    resizing = false;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  }

  // Touch equivalents for column resize
  function onColumnTouchResizeStart(side: 'left' | 'right', e: TouchEvent) {
    e.preventDefault();
    resizing = true;
    resizeSide = side;
    startX = e.touches[0]?.clientX ?? 0;
    const col = side === 'left' ? sidebarLayoutStore.leftColumn : sidebarLayoutStore.rightColumn;
    startWidth = col?.width ?? 280;
  }

  function onColumnTouchResizeMove(e: TouchEvent) {
    if (!resizing || !e.touches[0]) return;
    const x = e.touches[0].clientX;
    const delta = resizeSide === 'left' ? x - startX : startX - x;
    sidebarLayoutStore.setColumnWidth(resizeSide, startWidth + delta);
  }

  function onColumnTouchResizeEnd() {
    resizing = false;
  }

  // --- Terminal resize ---
  let resizingTerminal = $state(false);
  let termStartY = 0;
  let termStartHeight = 0;

  function onTerminalResizeStart(e: MouseEvent) {
    resizingTerminal = true;
    termStartY = e.clientY;
    termStartHeight = terminalStore.panelHeight;
    document.addEventListener('mousemove', onTerminalResizeMove);
    document.addEventListener('mouseup', onTerminalResizeEnd);
  }

  function onTerminalResizeMove(e: MouseEvent) {
    if (!resizingTerminal) return;
    const delta = termStartY - e.clientY;
    terminalStore.setPanelHeight(termStartHeight + delta);
  }

  function onTerminalResizeEnd() {
    resizingTerminal = false;
    document.removeEventListener('mousemove', onTerminalResizeMove);
    document.removeEventListener('mouseup', onTerminalResizeEnd);
  }

  // Derived from device store — true when touch-primary and no hardware keyboard
  const isMobileUI = $derived(deviceStore.isMobileUI);

  function onMainContentClick() {
    if (isMobileUI && uiStore.sidebarOpen) {
      uiStore.toggleSidebar();
    }
  }

  // --- Edge drop zones for creating columns ---
  const isDragging = $derived(panelDragStore.isDragging);

  function isEdgeDropTarget(side: 'left' | 'right'): boolean {
    const dt = panelDragStore.dropTarget;
    return dt !== null && dt.type === 'column' && dt.column === side;
  }

  function handleEdgeEnter(side: 'left' | 'right') {
    if (!panelDragStore.isDragging) return;
    panelDragStore.setDropTarget({ type: 'column', column: side });
  }

  function handleEdgeLeave(side: 'left' | 'right') {
    if (!panelDragStore.isDragging) return;
    const dt = panelDragStore.dropTarget;
    if (dt && dt.type === 'column' && dt.column === side) {
      panelDragStore.setDropTarget(null);
    }
  }

  function onKeydown(e: KeyboardEvent) {
    // Plugin-contributed keybindings get first crack (LYK-1031) — they're
    // declared in plugin manifests and run only when the matching plugin
    // is enabled. Built-in shortcuts still win conflicts when they trigger
    // (we don't return early below) but a matching plugin binding fires
    // its command regardless. `when` clauses are now evaluated through
    // the LYK-1032 interpreter — bindings only fire when their when
    // expression is currently true.
    for (const kb of pluginContributionsStore.keybindings) {
      const stroke = parseKeystroke(pickKeybindingForOS(kb));
      if (!stroke) continue;
      if (!keystrokeMatches(stroke, e)) continue;
      if (!evaluateWhen(kb.when)) continue;
      e.preventDefault();
      dispatchPluginCommand({ pluginId: kb.pluginId, command: kb.command });
      // Don't return — multiple plugins can bind the same chord and all
      // should fire (LSP-style "best-effort"). The host's own bindings
      // also continue to run below; conflicts are intentional, not
      // silently suppressed.
    }
    // Zen Mode toggle (Ctrl/Cmd+Alt+Z). Avoids Ctrl+K's chord ambiguity
    // with the command palette. ESC exits cleanly via the second branch
    // below.
    if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      uiStore.toggleZenMode();
      return;
    }
    // Escape exits Zen Mode preemptively — don't fall through to any
    // other modal/cancel handler so the chrome comes back immediately.
    if (e.key === 'Escape' && uiStore.zenMode) {
      e.preventDefault();
      uiStore.toggleZenMode();
      return;
    }
    // Ctrl+K or Ctrl+Shift+P: Command palette
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === 'k' || (e.shiftKey && (e.key === 'p' || e.key === 'P')))
    ) {
      e.preventDefault();
      uiStore.openModal('command-palette');
    }
    // Ctrl+Shift+F: Search across files
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      uiStore.setSidebarTab('search');
    }
    // Ctrl+P: Quick open file
    if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.shiftKey) {
      e.preventDefault();
      uiStore.openModal('quick-open');
    }
    // Ctrl+T: Quick open — workspace symbol search (# prefix)
    if ((e.ctrlKey || e.metaKey) && e.key === 't' && !e.shiftKey) {
      e.preventDefault();
      uiStore.setQuickOpenSeed('#');
      uiStore.openModal('quick-open');
    }
    // Ctrl+Shift+O: Quick open — current-file symbol search (@ prefix)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault();
      uiStore.setQuickOpenSeed('@');
      uiStore.openModal('quick-open');
    }
    // F5 family — debug controls. Only bound when a session exists, otherwise
    // F5 falls through to browser refresh which is almost never what the user wants
    // in this context but we still preserve it to avoid surprise.
    if (e.key === 'F5' && !e.shiftKey && !e.ctrlKey) {
      if (dapStore.isActive) {
        e.preventDefault();
        if (dapStore.state === 'stopped') void dapStore.continueExec();
      } else if (launchConfigsStore.activeConfig) {
        // No session running — F5 starts the active launch.json config
        // (LYK-1020). Without an active config we let F5 fall through to
        // browser refresh rather than swallowing it silently.
        e.preventDefault();
        void launchConfigsStore.startActive();
      }
    } else if (e.key === 'F5' && e.shiftKey) {
      if (dapStore.isActive) {
        e.preventDefault();
        void dapStore.stop();
      }
    } else if (e.key === 'F10' && dapStore.state === 'stopped') {
      e.preventDefault();
      void dapStore.stepOver();
    } else if (e.key === 'F11' && !e.shiftKey && dapStore.state === 'stopped') {
      e.preventDefault();
      void dapStore.stepIn();
    } else if (e.key === 'F11' && e.shiftKey && dapStore.state === 'stopped') {
      e.preventDefault();
      void dapStore.stepOut();
    } else if (e.key === 'F6' && dapStore.state === 'running') {
      e.preventDefault();
      void dapStore.pause();
    }
    // Ctrl+/: Toggle sidebar
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      uiStore.toggleSidebar();
    }
    // Ctrl+\: Toggle split pane
    if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
      e.preventDefault();
      if (editorStore.layoutMode === 'split-horizontal') {
        editorStore.setLayoutMode('chat-only');
      } else {
        editorStore.setLayoutMode('split-horizontal');
      }
    }
    // Ctrl+Shift+T / Cmd+Shift+T: Reopen most recently closed editor tab
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 't' || e.key === 'T')) {
      if (editorStore.hasClosedTabs) {
        e.preventDefault();
        void editorStore.reopenLastClosedTab();
      }
    }
    // Ctrl+W / Cmd+W: Close active tab (prevent browser from closing the window)
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      // Try to close the active tab based on what's currently focused/visible
      let tabClosed = false;

      // Priority 1: Primary pane (chat/conversation) tabs
      const activePane = primaryPaneStore.panes.find((p) => p.id === primaryPaneStore.activePaneId);
      if (activePane && activePane.activeTabId) {
        e.preventDefault();
        primaryPaneStore.closeTab(activePane.id, activePane.activeTabId);
        tabClosed = true;
      }

      // Priority 2: Editor tabs when editor pane is focused
      if (!tabClosed && editorStore.activeTabId && uiStore.focusedPane === 'editor') {
        e.preventDefault();
        editorStore.closeTab(editorStore.activeTabId);
        tabClosed = true;
      }

      // Priority 3: Terminal tabs when terminal is open
      if (!tabClosed && terminalStore.isOpen && terminalStore.activeTabId) {
        e.preventDefault();
        terminalStore.closeTab(terminalStore.activeTabId);
        tabClosed = true;
      }

      // Priority 4: Workspace tabs (but only if there's more than one)
      if (!tabClosed && workspaceStore.activeWorkspaceId && workspaceStore.workspaces.length > 1) {
        e.preventDefault();
        // Check for unsaved changes or active streams
        if (workspaceStore.hasDirtyTabs(workspaceStore.activeWorkspaceId)) {
          if (confirm('This workspace has unsaved changes. Close anyway?')) {
            workspaceStore.closeWorkspace(workspaceStore.activeWorkspaceId);
            tabClosed = true;
          }
        } else if (workspaceStore.hasActiveStream(workspaceStore.activeWorkspaceId)) {
          if (confirm('A stream is running in this workspace. Close and cancel it?')) {
            workspaceStore.closeWorkspace(workspaceStore.activeWorkspaceId);
            tabClosed = true;
          }
        } else {
          workspaceStore.closeWorkspace(workspaceStore.activeWorkspaceId);
          tabClosed = true;
        }
      }

      // If nothing was closed but we have tabs, still prevent browser close
      if (
        !tabClosed &&
        (editorStore.hasOpenTabs ||
          terminalStore.tabs.length > 0 ||
          primaryPaneStore.panes.some((p) => p.tabs.length > 0))
      ) {
        e.preventDefault();
      }
    }
    // Ctrl+Tab / Ctrl+Shift+Tab: Cycle tabs
    if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
      if (editorStore.hasOpenTabs) {
        e.preventDefault();
        editorStore.cycleTab(e.shiftKey ? -1 : 1);
      }
    }
    // Ctrl+1..9: Switch to nth tab (without Shift — Shift combos reserved for terminal)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      if (idx < editorStore.tabs.length) {
        e.preventDefault();
        editorStore.activateTabByIndex(idx);
      }
    }
    // Ctrl+`: Toggle terminal (without Shift)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '`') {
      e.preventDefault();
      if (isMobileUI) {
        uiStore.setMobileView(uiStore.mobileActiveView === 'terminal' ? 'chat' : 'terminal');
      } else {
        terminalStore.toggle();
      }
    }
    // Ctrl+Shift+`: New terminal tab
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === '~' || e.key === '`')) {
      e.preventDefault();
      terminalStore.open();
      terminalStore.createTab();
    }
    // Ctrl+Shift+5: Split active terminal horizontally
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === '%' || e.key === '5')) {
      e.preventDefault();
      terminalStore.open();
      terminalStore.splitActive('horizontal');
    }
    // Alt+Arrow: Navigate between terminal split panes
    if (
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.shiftKey &&
      terminalStore.isOpen &&
      terminalStore.hasSplits
    ) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        terminalStore.navigateSplit('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        terminalStore.navigateSplit('down');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        terminalStore.navigateSplit('left');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        terminalStore.navigateSplit('right');
      }
    }
    // Alt+Left / Alt+Right: cross-tab jump-list back/forward (LYK-989).
    // VS Code parity on Win/Linux; mac Option+Left/Right falls through
    // CodeMirror's word-jump only when focus is in the editor — here we
    // capture at the document level so it works anywhere.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      runMenuAction('go.back');
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'ArrowRight') {
      e.preventDefault();
      runMenuAction('go.forward');
      return;
    }
    // Ctrl+Alt+Left: Previous workspace
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      const ws = workspaceStore.workspaces;
      if (ws.length > 1 && workspaceStore.activeWorkspaceId) {
        const idx = ws.findIndex((w) => w.workspaceId === workspaceStore.activeWorkspaceId);
        const prev = (idx - 1 + ws.length) % ws.length;
        workspaceStore.switchWorkspace(ws[prev].workspaceId);
      }
    }
    // Ctrl+Alt+Right: Next workspace
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      const ws = workspaceStore.workspaces;
      if (ws.length > 1 && workspaceStore.activeWorkspaceId) {
        const idx = ws.findIndex((w) => w.workspaceId === workspaceStore.activeWorkspaceId);
        const next = (idx + 1) % ws.length;
        workspaceStore.switchWorkspace(ws[next].workspaceId);
      }
    }
    // Ctrl+Alt+W: Close active workspace
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'w') {
      e.preventDefault();
      if (workspaceStore.activeWorkspaceId) {
        workspaceStore.closeWorkspace(workspaceStore.activeWorkspaceId);
      }
    }
    // Ctrl+Shift+,: Cycle through agent profiles
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === ',') {
      e.preventDefault();
      profilesStore.cycleProfile();
      const profile = profilesStore.activeProfile;
      if (profile) {
        uiStore.toast(`Profile: ${profile.name}`, 'success');
      }
    }
    // Ctrl+= / Ctrl+Plus: Increase font size
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      const newCode = Math.min(28, settingsStore.fontSize + 1);
      if (settingsStore.uiFontSize !== null) {
        settingsStore.update({
          fontSize: newCode,
          uiFontSize: Math.min(28, settingsStore.uiFontSize + 1),
        });
      } else {
        settingsStore.update({ fontSize: newCode });
      }
    }
    // Ctrl+- / Ctrl+Minus: Decrease font size
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault();
      const newCode = Math.max(10, settingsStore.fontSize - 1);
      if (settingsStore.uiFontSize !== null) {
        settingsStore.update({
          fontSize: newCode,
          uiFontSize: Math.max(10, settingsStore.uiFontSize - 1),
        });
      } else {
        settingsStore.update({ fontSize: newCode });
      }
    }
    // Ctrl+0: Reset font size to defaults
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      settingsStore.update({ fontSize: 15, uiFontSize: null });
      uiStore.toast('Font size reset to default', 'success');
    }
    // Ctrl+Shift+Left/Right: Cycle spatial focus
    if (
      (e.ctrlKey || e.metaKey) &&
      e.shiftKey &&
      settingsStore.spatialViewport &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    ) {
      e.preventDefault();
      spatialViewportStore.cycleFocus(e.key === 'ArrowLeft' ? -1 : 1);
    }
    // Ctrl+Shift+Down: Focus terminal in spatial mode
    if (
      (e.ctrlKey || e.metaKey) &&
      e.shiftKey &&
      e.key === 'ArrowDown' &&
      settingsStore.spatialViewport
    ) {
      e.preventDefault();
      spatialViewportStore.focusTerminal();
    }
    // Escape: Close modal
    if (e.key === 'Escape' && uiStore.activeModal) {
      e.preventDefault();
      uiStore.closeModal();
    }
    // ?: Open help panel (when not typing in an input)
    if (
      e.key === '?' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      uiStore.setSidebarTab('help');
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app-shell" class:resizing class:zen-mode={uiStore.zenMode}>
  <AmbientBackground />

  {#if isMobileUI}
    <!-- ── Mobile: fullscreen single-view with bottom tab bar ── -->
    <MobileShell>
      {#snippet children()}
        {@render appChildren()}
      {/snippet}
    </MobileShell>
  {:else if settingsStore.spatialViewport}
    <!-- ── Spatial: 3D panel layout with depth + parallax ── -->
    {#if !uiStore.zenMode}
      <TopBar />
      <CommentaryTicker />
      <MainToolbar />
    {/if}

    <SpatialViewport>
      {#snippet sidebarLeft()}
        {#if uiStore.sidebarOpen && sidebarLayoutStore.leftColumn && !uiStore.zenMode}
          <PanelColumn column={sidebarLayoutStore.leftColumn} side="left" />
        {/if}
      {/snippet}
      {#snippet mainContent()}
        <MainContent>
          {#snippet children()}
            {@render appChildren()}
          {/snippet}
        </MainContent>
      {/snippet}
      {#snippet terminal()}
        {#if terminalStore.isOpen && !uiStore.zenMode}
          <TerminalPanel />
        {/if}
      {/snippet}
      {#snippet sidebarRight()}
        {#if sidebarLayoutStore.rightColumn && !uiStore.zenMode}
          <PanelColumn column={sidebarLayoutStore.rightColumn} side="right" />
        {/if}
      {/snippet}
    </SpatialViewport>

    {#if !uiStore.zenMode}
      <StatusBar />
    {/if}
    <FloatingPanelContainer />
  {:else}
    <!-- ── Desktop: multi-column layout with sidebar panels ── -->
    {#if !uiStore.zenMode}
      <TopBar />
      <CommentaryTicker />
      <MainToolbar />
    {/if}

    <div class="app-body">
      <!-- Left edge drop zone (when no left column exists) -->
      {#if isDragging && !(uiStore.sidebarOpen && sidebarLayoutStore.leftColumn)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="edge-drop-zone edge-left"
          class:active={isEdgeDropTarget('left')}
          onmouseenter={() => handleEdgeEnter('left')}
          onmouseleave={() => handleEdgeLeave('left')}
        >
          <div class="edge-drop-indicator"></div>
        </div>
      {/if}

      {#if uiStore.sidebarOpen && sidebarLayoutStore.leftColumn}
        <PanelColumn column={sidebarLayoutStore.leftColumn} side="left" />
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="resize-handle"
          onmousedown={(e) => onColumnResizeStart('left', e)}
          ontouchstart={(e) => onColumnTouchResizeStart('left', e)}
          ontouchmove={onColumnTouchResizeMove}
          ontouchend={onColumnTouchResizeEnd}
        ></div>
      {/if}

      <main class="main-content" class:resizing-terminal={resizingTerminal}>
        {#if !(terminalStore.isOpen && terminalStore.maximized)}
          <div class="main-content-upper">
            <MainContent>
              {#snippet children()}
                {@render appChildren()}
              {/snippet}
            </MainContent>
          </div>
        {/if}
        {#if terminalStore.isOpen && !uiStore.zenMode}
          {#if !terminalStore.maximized}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="terminal-resize-handle" onmousedown={onTerminalResizeStart}></div>
          {/if}
          <TerminalPanel />
        {/if}
      </main>

      {#if !uiStore.zenMode && sidebarLayoutStore.rightColumn}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="resize-handle"
          onmousedown={(e) => onColumnResizeStart('right', e)}
          ontouchstart={(e) => onColumnTouchResizeStart('right', e)}
          ontouchmove={onColumnTouchResizeMove}
          ontouchend={onColumnTouchResizeEnd}
        ></div>
        <PanelColumn column={sidebarLayoutStore.rightColumn} side="right" />
      {/if}

      <!-- Right edge drop zone (when no right column exists) -->
      {#if isDragging && !sidebarLayoutStore.rightColumn}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="edge-drop-zone edge-right"
          class:active={isEdgeDropTarget('right')}
          onmouseenter={() => handleEdgeEnter('right')}
          onmouseleave={() => handleEdgeLeave('right')}
        >
          <div class="edge-drop-indicator"></div>
        </div>
      {/if}
    </div>

    {#if !uiStore.zenMode}
      <StatusBar />
    {/if}

    <FloatingPanelContainer />
    <DragOverlay />
  {/if}

  <!-- Modals — work on both mobile and desktop -->
  {#if uiStore.activeModal === 'settings'}
    <SettingsModal />
  {/if}

  {#if uiStore.activeModal === 'snapshots'}
    <SnapshotModal />
  {/if}

  {#if uiStore.activeModal === 'launch-config-editor'}
    <LaunchConfigEditor />
  {/if}

  {#if uiStore.activeModal === 'walkthroughs'}
    <WalkthroughsModal />
  {/if}

  {#if uiStore.activeModal === 'branch-picker'}
    <BranchPickerModal />
  {/if}

  <!-- LYK-1056: plugin quick-pick / input-box prompts (self-gated on
       pluginPromptStore.active, so always mounted). -->
  <PluginPromptModal />

  {#if uiStore.activeModal === 'loop-config'}
    <LoopConfigModal />
  {/if}

  {#if uiStore.activeModal === 'story-create'}
    <StoryCreateModal />
  {/if}

  {#if uiStore.activeModal === 'story-generate'}
    <StoryGenerateModal />
  {/if}

  {#if uiStore.activeModal === 'story-refine'}
    <StoryRefineModal />
  {/if}

  {#if uiStore.activeModal === 'criteria-validation'}
    <CriteriaValidationModal />
  {/if}

  {#if uiStore.activeModal === 'story-estimate'}
    <StoryEstimateModal />
  {/if}

  {#if uiStore.activeModal === 'sprint-plan'}
    <SprintPlanModal />
  {/if}

  {#if uiStore.activeModal === 'prd-completeness'}
    <PrdCompletenessModal />
  {/if}

  {#if uiStore.activeModal === 'template-library'}
    <TemplateLibraryModal />
  {/if}

  {#if uiStore.activeModal === 'priority-recommendation'}
    <PriorityRecommendationModal />
  {/if}

  {#if uiStore.activeModal === 'effort-value-matrix'}
    <EffortValueMatrixModal />
  {/if}

  {#if uiStore.activeModal === 'external-provider-config'}
    <ExternalProviderConfigModal />
  {/if}

  {#if uiStore.activeModal === 'command-palette'}
    <CommandPalette />
  {/if}

  {#if uiStore.activeModal === 'prd-refine-all'}
    <PrdRefineAllModal />
  {/if}

  {#if uiStore.activeModal === 'compaction-history'}
    <CompactionHistoryModal conversationId={conversationStore.activeId} />
  {/if}

  {#if uiStore.activeModal === 'claude-code-viewer'}
    <ClaudeCodeViewerModal />
  {/if}

  {#if uiStore.activeModal === 'plugin-pane-viewer'}
    <PluginPaneViewerModal />
  {/if}

  <QuickOpen />
  <ProjectSetup />

  <InteractiveTutorial />
  <StartupTip />

  <ToastContainer />
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    position: relative;
    /* Safe area insets for notch / Dynamic Island / home bar */
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
  }
  /* Ambient overlay — themes provide their own backgrounds */
  .app-shell::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    display: none;
  }

  .app-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
    z-index: 1;
  }

  .resize-handle {
    width: 6px;
    cursor: col-resize;
    background: transparent;
    flex-shrink: 0;
    transition: background var(--transition);
    position: relative;
    touch-action: none;
  }
  .resize-handle:hover,
  .resizing .resize-handle {
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }
  @media (pointer: coarse) {
    .resize-handle {
      width: 44px;
      margin: 0 -19px;
      z-index: 10;
    }
  }

  /* Mobile sidebar overlay backdrop */
  .mobile-sidebar-backdrop {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: rgba(0, 0, 0, 0.5);
  }

  /* --- Edge drop zones for creating columns --- */
  .edge-drop-zone {
    width: 24px;
    flex-shrink: 0;
    position: relative;
    z-index: 5;
    transition:
      width 100ms ease,
      background 100ms ease;
  }

  .edge-drop-zone:hover,
  .edge-drop-zone.active {
    width: 48px;
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }

  .edge-drop-indicator {
    position: absolute;
    top: 8px;
    bottom: 8px;
    width: 2px;
    background: transparent;
    border-radius: 1px;
    transition:
      background 100ms ease,
      box-shadow 100ms ease;
  }

  .edge-left .edge-drop-indicator {
    left: 4px;
  }

  .edge-right .edge-drop-indicator {
    right: 4px;
  }

  .edge-drop-zone:hover .edge-drop-indicator,
  .edge-drop-zone.active .edge-drop-indicator {
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  .main-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-primary);
    position: relative;
    z-index: 1;
  }

  .main-content-upper {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .terminal-resize-handle {
    height: 6px;
    cursor: row-resize;
    background: transparent;
    flex-shrink: 0;
    transition: background var(--transition);
  }
  .terminal-resize-handle:hover,
  .resizing-terminal .terminal-resize-handle {
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  /* ── Mobile layout (data-mobile set by deviceStore when touch + no HW keyboard) ── */
  :global([data-mobile]) .app-body {
    position: relative;
  }
  /* Sidebar columns slide in as overlays */
  :global([data-mobile] .panel-column.column-left),
  :global([data-mobile] .panel-column.column-right) {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 100;
    width: var(--sidebar-width) !important;
    max-width: 100vw;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);
  }
  :global([data-mobile] .panel-column.column-left) {
    left: 0;
  }
  :global([data-mobile] .panel-column.column-right) {
    right: 0;
  }
  /* Hide column resize handles on mobile (tap backdrop to close) */
  :global([data-mobile]) .resize-handle {
    display: none;
  }
  /* Edge drop zones not needed on mobile */
  :global([data-mobile]) .edge-drop-zone {
    display: none;
  }
  /* Let canvas effects bleed through in magic hyperthemes */
  :global([data-hypertheme='arcane']) .main-content,
  :global([data-hypertheme='ethereal']) .main-content,
  :global([data-hypertheme='astral']) .main-content,
  :global([data-hypertheme='astral-midnight']) .main-content {
    background: var(--bg-glass, rgba(14, 10, 8, 0.85));
  }
  :global([data-hypertheme='study']) .main-content {
    background: transparent;
  }
</style>
