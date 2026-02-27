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
  import CommentaryTicker from './CommentaryTicker.svelte';
  import StatusBar from './StatusBar.svelte';
  import MainContent from './MainContent.svelte';
  import TerminalPanel from '../editor/TerminalPanel.svelte';
  import PanelColumn from '../sidebar/PanelColumn.svelte';
  import FloatingPanelContainer from '../sidebar/FloatingPanelContainer.svelte';
  import DragOverlay from '../sidebar/DragOverlay.svelte';
  import SettingsModal from '../settings/SettingsModal.svelte';
  import SnapshotModal from '../settings/SnapshotModal.svelte';
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
  import ToastContainer from '../common/ToastContainer.svelte';
  import QuickOpen from '../editor/QuickOpen.svelte';
  import ProjectSetup from '../common/ProjectSetup.svelte';
  import AmbientBackground from './AmbientBackground.svelte';
  import MobileShell from './MobileShell.svelte';
  import InteractiveTutorial from '../common/InteractiveTutorial.svelte';
  import StartupTip from '../common/StartupTip.svelte';
  import { waitForServer, api } from '$lib/api/client';
  import { reconnectActiveStream } from '$lib/api/sse';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { deviceStore } from '$lib/stores/device.svelte';
  import { tutorialStore } from '$lib/stores/tutorial.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { startupTipsStore } from '$lib/stores/startupTips.svelte';
  import { onMount } from 'svelte';

  let { children: appChildren } = $props<{ children: any }>();

  onMount(() => {
    deviceStore.init();

    waitForServer().then(async () => {
      // Await workspace init to ensure activeConversationId is loaded
      // before attempting stream reconnection
      await workspaceStore.init();
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
    // Ctrl+K or Ctrl+Shift+P: Command palette
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
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
      settingsStore.update({ fontSize: 14, uiFontSize: null });
      uiStore.toast('Font size reset to default', 'success');
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

<div
  class="app-shell"
  class:resizing
  class:golem-active={loopStore.isRunning}
  class:golem-paused-active={loopStore.isPaused}
>
  <AmbientBackground />

  {#if isMobileUI}
    <!-- ── Mobile: fullscreen single-view with bottom tab bar ── -->
    <MobileShell>
      {#snippet children()}
        {@render appChildren()}
      {/snippet}
    </MobileShell>
  {:else}
    <!-- ── Desktop: multi-column layout with sidebar panels ── -->
    <TopBar />
    <CommentaryTicker />

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
        <div class="main-content-upper">
          <MainContent>
            {#snippet children()}
              {@render appChildren()}
            {/snippet}
          </MainContent>
        </div>
        {#if terminalStore.isOpen}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="terminal-resize-handle" onmousedown={onTerminalResizeStart}></div>
          <TerminalPanel />
        {/if}
      </main>

      {#if sidebarLayoutStore.rightColumn}
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

    <StatusBar />

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
  /* ── Golem active border glow ── */
  .app-shell.golem-active {
    box-shadow: inset 0 0 1px 1px color-mix(in srgb, var(--accent-primary) 40%, transparent);
    animation: golemBorderGlow 3s ease-in-out infinite;
  }
  .app-shell.golem-paused-active {
    box-shadow: inset 0 0 1px 1px color-mix(in srgb, var(--accent-warning) 30%, transparent);
  }

  /* Golem running throbber at the very top of the app */
  .app-shell.golem-active::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    z-index: 100;
    pointer-events: none;
    background: linear-gradient(90deg, transparent, var(--accent-primary), transparent);
    background-size: 200% 100%;
    animation: golemTopBarSlide 2s ease-in-out infinite;
  }
  .app-shell.golem-paused-active::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    z-index: 100;
    pointer-events: none;
    background: var(--accent-warning);
    opacity: 0.5;
  }

  @keyframes golemBorderGlow {
    0%,
    100% {
      box-shadow: inset 0 0 1px 1px color-mix(in srgb, var(--accent-primary) 30%, transparent);
    }
    50% {
      box-shadow: inset 0 0 2px 1px color-mix(in srgb, var(--accent-primary) 50%, transparent);
    }
  }
  @keyframes golemTopBarSlide {
    0% {
      background-position: -200% 0%;
    }
    100% {
      background-position: 200% 0%;
    }
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
