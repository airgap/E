<script lang="ts">
  import type { Snippet } from 'svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { editorStore, type EditorTab } from '$lib/stores/editor.svelte';
  import { api } from '$lib/api/client';
  import { reconnectToConversation } from '$lib/api/sse';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { onMount } from 'svelte';
  import PrimaryTabBar from './PrimaryTabBar.svelte';
  import UnifiedDiffView from '../editor/UnifiedDiffView.svelte';
  import CodeEditor from '../editor/CodeEditor.svelte';
  import LooperView from '../loop/LooperView.svelte';
  import ChangePreviewPanel from '../editor/ChangePreviewPanel.svelte';
  import TimelinePanel from '../timeline/TimelinePanel.svelte';
  import CanvasTabView from '../canvas/CanvasTabView.svelte';

  let { children }: { children: Snippet } = $props();

  let pane = $derived(primaryPaneStore.panes[0]);

  // Active tab for pane[0] — used to switch rendering mode
  let primaryActiveTab = $derived(
    pane ? (pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0] ?? null) : null,
  );

  // ── Tab → conversation sync ──
  let lastAppliedTabId = $state<string | null>(null);
  onMount(() => {
    lastAppliedTabId = primaryPaneStore.activeTab()?.id ?? null;
  });

  $effect(() => {
    const tab = primaryPaneStore.activeTab();
    if (!tab || tab.id === lastAppliedTabId) return;
    lastAppliedTabId = tab.id;

    // Non-chat tabs don't affect conversation state
    if (
      tab.kind === 'diff' ||
      tab.kind === 'file' ||
      tab.kind === 'looper' ||
      tab.kind === 'change-preview' ||
      tab.kind === 'timeline' ||
      tab.kind === 'canvas'
    )
      return;

    if (tab.conversationId === null) {
      conversationStore.setActive(null);
      conversationStore.clearDraft();
      conversationStore.createDraft();
      if (!streamStore.isStreaming) streamStore.reset();
      uiStore.focusChatInput();
    } else if (tab.conversationId !== conversationStore.activeId) {
      const tabConvId = tab.conversationId;
      conversationStore.setLoading(true);
      api.conversations
        .get(tabConvId)
        .then((res) => {
          conversationStore.setActive(res.data);
          // Only reset if not streaming, or if streaming to a different conversation
          if (!streamStore.isStreaming || streamStore.conversationId !== tabConvId) {
            streamStore.reset();
            // Check if the server has an active streaming session for this
            // conversation (e.g. from a golem loop). If so, connect to it.
            reconnectToConversation(tabConvId).catch(() => {});
          }
        })
        .catch((err) => {
          console.error('Failed to load conversation for tab:', err);
        })
        .finally(() => {
          conversationStore.setLoading(false);
        });
    }
  });

  // ── Conversation → tab sync ──
  $effect(() => {
    const active = conversationStore.active;
    if (!active) {
      // Only look at chat tabs (not diff/file tabs) for blank tab matching.
      // If a blank tab already exists, switch to it. Otherwise do nothing —
      // we no longer auto-create "New chat" tabs.
      const blankTab = pane?.tabs.find((t) => t.kind === 'chat' && t.conversationId === null);
      if (blankTab && pane && pane.activeTabId !== blankTab.id) {
        primaryPaneStore.setActiveTab(pane.id, blankTab.id);
        lastAppliedTabId = blankTab.id;
      }
      return;
    }

    const tabExists = pane?.tabs.some((t) => t.conversationId === active.id);
    if (!tabExists) {
      primaryPaneStore.openConversation(active.id, active.title ?? 'Conversation', pane?.id);
    } else {
      // Don't override when the user has actively selected a non-chat tab
      const currentTab = pane?.tabs.find((t) => t.id === pane.activeTabId);
      if (currentTab && currentTab.kind !== 'chat') return;

      const tab = pane?.tabs.find((t) => t.conversationId === active.id);
      if (tab && pane && pane.activeTabId !== tab.id) {
        primaryPaneStore.setActiveTab(pane.id, tab.id);
        lastAppliedTabId = tab.id;
      }
    }
  });

  // Keep tab titles in sync
  $effect(() => {
    const active = conversationStore.active;
    if (active?.id && active.title) {
      primaryPaneStore.updateTabTitle(active.id, active.title);
    }
  });

  // ── Divider drag ──
  let draggingDivider = $state<number | null>(null);
  let dragStartX = $state(0);
  let containerEl = $state<HTMLDivElement | null>(null);

  function onDividerMouseDown(e: MouseEvent, dividerIdx: number) {
    e.preventDefault();
    draggingDivider = dividerIdx;
    dragStartX = e.clientX;
    document.addEventListener('mousemove', onDividerMouseMove);
    document.addEventListener('mouseup', onDividerMouseUp);
  }

  function onDividerMouseMove(e: MouseEvent) {
    if (draggingDivider === null || !containerEl) return;
    const containerWidth = containerEl.getBoundingClientRect().width;
    if (containerWidth === 0) return;
    const deltaPercent = ((e.clientX - dragStartX) / containerWidth) * 100;
    dragStartX = e.clientX;
    primaryPaneStore.resizeDivider(draggingDivider, deltaPercent);
    // Also keep editorStore in sync for 2-pane case
    if (primaryPaneStore.panes.length === 2) {
      editorStore.setSplitRatio(primaryPaneStore.splitRatio);
    }
  }

  function onDividerMouseUp() {
    draggingDivider = null;
    document.removeEventListener('mousemove', onDividerMouseMove);
    document.removeEventListener('mouseup', onDividerMouseUp);
  }

  // Touch equivalents for divider
  function onDividerTouchStart(e: TouchEvent, dividerIdx: number) {
    e.preventDefault();
    draggingDivider = dividerIdx;
    dragStartX = e.touches[0]?.clientX ?? 0;
  }

  function onDividerTouchMove(e: TouchEvent) {
    if (draggingDivider === null || !containerEl || !e.touches[0]) return;
    const containerWidth = containerEl.getBoundingClientRect().width;
    if (containerWidth === 0) return;
    const deltaPercent = ((e.touches[0].clientX - dragStartX) / containerWidth) * 100;
    dragStartX = e.touches[0].clientX;
    primaryPaneStore.resizeDivider(draggingDivider, deltaPercent);
    if (primaryPaneStore.panes.length === 2) {
      editorStore.setSplitRatio(primaryPaneStore.splitRatio);
    }
  }

  function onDividerTouchEnd() {
    draggingDivider = null;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="primary-pane" class:resizing={draggingDivider !== null} bind:this={containerEl}>
  {#each primaryPaneStore.panes as p, i (p.id)}
    <!-- Divider before every pane except the first -->
    {#if i > 0}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="pane-divider"
        class:active={draggingDivider === i - 1}
        onmousedown={(e) => onDividerMouseDown(e, i - 1)}
        ontouchstart={(e) => onDividerTouchStart(e, i - 1)}
        ontouchmove={onDividerTouchMove}
        ontouchend={onDividerTouchEnd}
      ></div>
    {/if}

    <div
      class="pane-slot"
      style:flex-basis="{primaryPaneStore.sizes[i]}%"
      style:flex-grow="0"
      style:flex-shrink="0"
    >
      <PrimaryTabBar pane={p} />

      {#if i === 0}
        <!-- Primary pane: renders chat, diff, or file based on active tab kind -->
        {@const activeTab = primaryActiveTab}
        {#if activeTab?.kind === 'change-preview'}
          <div class="pane-content">
            <ChangePreviewPanel planId={activeTab.changePreviewPlanId ?? ''} />
          </div>
        {:else if activeTab?.kind === 'timeline'}
          <div class="pane-content">
            <TimelinePanel conversationId={activeTab.timelineConversationId ?? ''} />
          </div>
        {:else if activeTab?.kind === 'looper'}
          <div class="pane-content">
            <LooperView loopId={activeTab.loopId ?? ''} />
          </div>
        {:else if activeTab?.kind === 'canvas'}
          <div class="pane-content">
            <CanvasTabView canvasId={activeTab.canvasId ?? ''} />
          </div>
        {:else if activeTab?.kind === 'diff'}
          <div class="pane-content">
            <UnifiedDiffView
              diffContent={activeTab.diffContent ?? ''}
              fileName={activeTab.filePath ?? ''}
            />
          </div>
        {:else if activeTab?.kind === 'file'}
          <div class="pane-content">
            {#key activeTab.id}
              <CodeEditor
                tab={{
                  id: activeTab.id,
                  filePath: activeTab.filePath ?? '',
                  fileName: activeTab.title,
                  language: activeTab.language ?? 'text',
                  content: activeTab.fileContent ?? '',
                  originalContent: activeTab.fileContent ?? '',
                  cursorLine: 1,
                  cursorCol: 1,
                  scrollTop: 0,
                  scrollLeft: 0,
                } satisfies EditorTab}
              />
            {/key}
          </div>
        {:else}
          <div class="pane-content">
            {@render children()}
          </div>
        {/if}
      {:else}
        <!-- Secondary panes: editor or placeholder -->
        <div class="pane-content">
          <div class="split-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18M3 9h6M3 15h6" />
            </svg>
            <p>Open a file from the sidebar to view it here</p>
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .primary-pane {
    display: flex;
    flex-direction: row;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .primary-pane.resizing {
    user-select: none;
    cursor: col-resize;
  }

  /* ── Individual pane column ── */
  .pane-slot {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ── Content area below the tab bar ── */
  .pane-content {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Divider handle ── */
  .pane-divider {
    flex-shrink: 0;
    width: 6px;
    background: transparent;
    cursor: col-resize;
    position: relative;
    z-index: 5;
    transition: background var(--transition);
    touch-action: none;
  }
  @media (pointer: coarse) {
    .pane-divider {
      width: 44px;
      margin: 0 -19px;
    }
  }

  .pane-divider:hover,
  .pane-divider.active {
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  /* Left border on every secondary pane (sits just after the divider) */
  .pane-slot:not(:first-child) {
    border-left: 1px solid var(--border-primary);
  }

  /* ── Placeholder ── */
  .split-placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-tertiary);
    padding: 40px;
    text-align: center;
  }

  .split-placeholder svg {
    width: 36px;
    height: 36px;
    opacity: 0.25;
  }

  .split-placeholder p {
    font-size: var(--fs-base);
    margin: 0;
    opacity: 0.7;
  }
</style>
