<script lang="ts">
  import {
    primaryPaneStore,
    type PrimaryPane,
    type PrimaryTab,
  } from '$lib/stores/primaryPane.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
  import type { ContextMenuItem } from '$lib/components/ui/ContextMenu.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';

  let { pane }: { pane: PrimaryPane } = $props();

  // ── Tab context menu ──
  let ctxTab = $state<PrimaryTab | null>(null);
  let ctxX = $state(0);
  let ctxY = $state(0);

  function openTabCtx(e: MouseEvent, tab: PrimaryTab) {
    e.preventDefault();
    e.stopPropagation();
    ctxTab = tab;
    ctxX = e.clientX;
    ctxY = e.clientY;
  }

  /**
   * If the active conversation no longer has a tab in the primary pane,
   * clear it so the conversation→tab sync doesn't auto-recreate the tab.
   */
  function cleanupConversation() {
    // Only relevant for the primary pane (index 0) which has conversation sync
    if (pane.id !== primaryPaneStore.panes[0]?.id) return;
    const activeConvId = conversationStore.activeId;
    if (activeConvId && !pane.tabs.some((t) => t.conversationId === activeConvId)) {
      conversationStore.setActive(null);
    }
  }

  function closeTab(tabId: string) {
    primaryPaneStore.closeTab(pane.id, tabId);
    cleanupConversation();
  }

  function closeOthers(tabId: string) {
    pane.tabs
      .filter((t) => t.id !== tabId)
      .forEach((t) => primaryPaneStore.closeTab(pane.id, t.id));
    cleanupConversation();
  }

  function closeToRight(tabId: string) {
    const idx = pane.tabs.findIndex((t) => t.id === tabId);
    pane.tabs.slice(idx + 1).forEach((t) => primaryPaneStore.closeTab(pane.id, t.id));
    cleanupConversation();
  }

  function closeAll() {
    // Close from end to avoid shifting index issues
    [...pane.tabs].reverse().forEach((t) => primaryPaneStore.closeTab(pane.id, t.id));
    cleanupConversation();
  }

  function copyPath(tab: PrimaryTab) {
    const path = tab.filePath ?? tab.title;
    navigator.clipboard.writeText(path);
  }

  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

  let ctxItems = $derived<ContextMenuItem[]>(
    ctxTab
      ? [
          {
            label: 'Close',
            shortcut: isMac ? '⌘W' : 'Ctrl+W',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
            action: () => {
              closeTab(ctxTab!.id);
              ctxTab = null;
            },
          },
          {
            label: 'Close Others',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/><circle cx="12" cy="12" r="10"/></svg>`,
            disabled: pane.tabs.length <= 1,
            action: () => {
              closeOthers(ctxTab!.id);
              ctxTab = null;
            },
          },
          {
            label: 'Close to the Right',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`,
            disabled: pane.tabs.findIndex((t) => t.id === ctxTab!.id) >= pane.tabs.length - 1,
            action: () => {
              closeToRight(ctxTab!.id);
              ctxTab = null;
            },
          },
          {
            label: 'Close All',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`,
            action: () => {
              closeAll();
              ctxTab = null;
            },
          },
          ...(ctxTab.filePath
            ? [
                { kind: 'separator' } as ContextMenuItem,
                {
                  label: 'Copy Path',
                  shortcut: isMac ? '⌘⌥C' : 'Ctrl+Alt+C',
                  icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
                  action: () => {
                    copyPath(ctxTab!);
                    ctxTab = null;
                  },
                } as ContextMenuItem,
                {
                  label: 'Copy Relative Path',
                  icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
                  action: () => {
                    const p = ctxTab!.filePath ?? '';
                    // Strip leading workspace root by removing first segment after /home/…/<project>/
                    const rel = p.replace(/^.*?\/[^/]+\//, '');
                    navigator.clipboard.writeText(rel);
                    ctxTab = null;
                  },
                } as ContextMenuItem,
              ]
            : []),
          ...(pane.tabs.length > 1
            ? [
                { kind: 'separator' } as ContextMenuItem,
                {
                  label: 'Move to New Pane',
                  icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/></svg>`,
                  action: () => {
                    primaryPaneStore.splitOpen(ctxTab!.conversationId, ctxTab!.title);
                    closeTab(ctxTab!.id);
                    ctxTab = null;
                  },
                } as ContextMenuItem,
              ]
            : []),
        ]
      : [],
  );

  // ── Tooltip content per tab ──
  function tabTooltip(tab: PrimaryTab): string {
    const parts: string[] = [];
    if (tab.kind === 'looper') return 'Loop Dashboard';
    if (tab.kind === 'canvas') return `Canvas: ${tab.title}`;
    if (tab.filePath) parts.push(tab.filePath);
    else if (tab.kind === 'chat') parts.push('Conversation');
    if (tab.language) parts.push(tab.language);
    if (tab.kind === 'diff') parts.push(tab.staged ? 'staged diff' : 'unstaged diff');
    return parts.join(' · ');
  }

  function handleSplitClose() {
    primaryPaneStore.closePane(pane.id);
  }

  let isOnlyPane = $derived(primaryPaneStore.panes.length === 1);
  let canSplit = $derived(primaryPaneStore.panes.length < 10);
</script>

<!-- Tab context menu -->
{#if ctxTab}
  <ContextMenu
    items={ctxItems}
    x={ctxX}
    y={ctxY}
    onClose={() => {
      ctxTab = null;
    }}
  />
{/if}

<div class="primary-tab-bar" class:focused={primaryPaneStore.activePaneId === pane.id}>
  <div class="tabs-scroll">
    {#each pane.tabs as tab (tab.id)}
      <Tooltip content={tabTooltip(tab)} placement="bottom" delay={700}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="primary-tab"
          class:active={tab.id === pane.activeTabId}
          role="tab"
          tabindex="0"
          aria-selected={tab.id === pane.activeTabId}
          onclick={() => primaryPaneStore.setActiveTab(pane.id, tab.id)}
          onkeydown={(e) => e.key === 'Enter' && primaryPaneStore.setActiveTab(pane.id, tab.id)}
          oncontextmenu={(e) => openTabCtx(e, tab)}
          onauxclick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              closeTab(tab.id);
            }
          }}
        >
          {#if tab.kind === 'looper'}
            <svg
              class="tab-icon looper-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M17 1l4 4-4 4" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <path d="M7 23l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          {:else if tab.kind === 'diff'}
            <svg
              class="tab-icon diff-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="18" r="3" />
              <path d="M6 9v3a6 6 0 0 0 6 6h2M18 15V9" />
            </svg>
          {:else if tab.kind === 'canvas'}
            <svg
              class="tab-icon canvas-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
          {:else if tab.kind === 'file'}
            <svg
              class="tab-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          {:else}
            <svg
              class="tab-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          {/if}

          <span class="tab-title">{tab.title}</span>

          {#if pane.tabs.length >= 1}
            <Tooltip
              content="Close tab"
              shortcut={isMac ? '⌘W' : 'Ctrl+W'}
              placement="bottom"
              delay={900}
            >
              <button
                class="tab-close"
                onclick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label="Close tab"
                tabindex="-1"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </Tooltip>
          {/if}
        </div>
      </Tooltip>
    {/each}

    <Tooltip
      content="New conversation"
      shortcut={isMac ? '⌘T' : 'Ctrl+T'}
      placement="bottom"
      delay={700}
    >
      <button
        class="new-tab-btn"
        aria-label="New conversation"
        onclick={() => primaryPaneStore.openConversation(null, 'New chat', pane.id)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </Tooltip>
  </div>

  <div class="tab-bar-actions">
    <Tooltip
      content={editorStore.followAlong
        ? 'Following edits (click to stop)'
        : 'Follow along with edits'}
      placement="bottom"
      delay={400}
    >
      <button
        class="action-btn follow-btn"
        class:active={editorStore.followAlong}
        class:streaming={editorStore.followAlong && streamStore.isStreaming}
        aria-label="Toggle follow along"
        onclick={() => editorStore.toggleFollowAlong()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </Tooltip>
    {#if !isOnlyPane}
      <Tooltip content="Close pane" placement="bottom" delay={700}>
        <button class="action-btn" aria-label="Close pane" onclick={handleSplitClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </Tooltip>
    {/if}
    {#if canSplit}
      <Tooltip content="Split pane" placement="bottom" delay={700}>
        <button
          class="action-btn"
          aria-label="Split pane"
          onclick={() => primaryPaneStore.splitOpen(null)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M12 3v18" />
          </svg>
        </button>
      </Tooltip>
    {/if}
  </div>
</div>

<style>
  .primary-tab-bar {
    display: flex;
    align-items: stretch;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
    height: 34px;
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .primary-tab-bar.focused {
    border-bottom-color: var(--accent-primary);
  }

  .tabs-scroll {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    flex: 1;
    align-items: stretch;
  }
  .tabs-scroll::-webkit-scrollbar {
    display: none;
  }

  /* Tooltip wrapper must stretch to fill tab bar height */
  .tabs-scroll :global(.tooltip-trigger) {
    display: flex;
    align-items: stretch;
  }

  /* ── Tab ── */
  .primary-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px 0 8px;
    font-size: var(--fs-base);
    color: var(--text-secondary);
    border-right: 1px solid var(--border-secondary);
    background: transparent;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background var(--transition),
      color var(--transition);
    position: relative;
    flex-shrink: 0;
    user-select: none;
  }

  .primary-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .primary-tab.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    border-bottom: 2px solid var(--accent-primary);
    margin-bottom: -1px;
  }

  /* Active tab left/right separators fade */
  .primary-tab.active::before,
  .primary-tab.active::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--border-primary);
  }
  .primary-tab.active::before {
    left: -1px;
  }
  .primary-tab.active::after {
    right: -1px;
  }

  .tab-icon {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    opacity: 0.55;
    transition: opacity var(--transition);
  }

  .primary-tab:hover .tab-icon,
  .primary-tab.active .tab-icon {
    opacity: 1;
  }

  .diff-icon {
    color: var(--accent-warning, #e5c07b);
  }

  .looper-icon {
    color: var(--accent-primary);
  }

  .canvas-icon {
    color: var(--accent-secondary, var(--accent-primary));
  }

  .tab-title {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--fs-base);
  }

  /* ── Close button ── */
  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 3px;
    color: var(--text-tertiary);
    opacity: 0;
    transition:
      opacity var(--transition),
      background var(--transition),
      color var(--transition);
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
  }

  .tab-close svg {
    width: 9px;
    height: 9px;
  }

  .primary-tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: color-mix(in srgb, var(--accent-error) 18%, var(--bg-active));
    color: var(--accent-error);
    opacity: 1;
  }

  /* ── New tab button ── */
  .new-tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    flex-shrink: 0;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition);
    border-right: 1px solid var(--border-secondary);
  }

  .new-tab-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .new-tab-btn svg {
    width: 14px;
    height: 14px;
  }

  /* ── Actions ── */
  .tab-bar-actions {
    display: flex;
    align-items: center;
    padding: 0 4px;
    gap: 2px;
    flex-shrink: 0;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition);
    padding: 0;
  }

  .action-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .action-btn svg {
    width: 14px;
    height: 14px;
  }

  .follow-btn.active {
    color: var(--accent-primary);
  }

  .follow-btn.active:hover {
    background: color-mix(in srgb, var(--accent-primary) 12%, var(--bg-hover));
  }

  @keyframes follow-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .follow-btn.streaming {
    animation: follow-pulse 2s ease-in-out infinite;
  }
</style>
