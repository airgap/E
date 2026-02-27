<script lang="ts">
  import { editorStore, type EditorTab } from '$lib/stores/editor.svelte';
  import ContextMenu from '$lib/components/ui/ContextMenu.svelte';
  import type { ContextMenuItem } from '$lib/components/ui/ContextMenu.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';

  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

  // ── Context menu ──
  let ctxTab = $state<EditorTab | null>(null);
  let ctxX = $state(0);
  let ctxY = $state(0);

  function openTabCtx(e: MouseEvent, tab: EditorTab) {
    e.preventDefault();
    e.stopPropagation();
    ctxTab = tab;
    ctxX = e.clientX;
    ctxY = e.clientY;
  }

  function closeTab(e: MouseEvent | null, tab: EditorTab) {
    if (e) e.stopPropagation();
    if (editorStore.isDirty(tab.id)) {
      if (!confirm(`${tab.fileName} has unsaved changes. Close anyway?`)) return;
    }
    editorStore.closeTab(tab.id);
  }

  function closeOthers(tab: EditorTab) {
    editorStore.tabs
      .filter((t) => t.id !== tab.id)
      .forEach((t) => {
        editorStore.closeTab(t.id);
      });
  }

  function closeSaved() {
    editorStore.tabs
      .filter((t) => !editorStore.isDirty(t.id))
      .forEach((t) => {
        editorStore.closeTab(t.id);
      });
  }

  function closeToRight(tab: EditorTab) {
    const idx = editorStore.tabs.findIndex((t) => t.id === tab.id);
    editorStore.tabs.slice(idx + 1).forEach((t) => editorStore.closeTab(t.id));
  }

  function closeAll() {
    [...editorStore.tabs].reverse().forEach((t) => editorStore.closeTab(t.id));
  }

  function copyPath(tab: EditorTab) {
    navigator.clipboard.writeText(tab.filePath);
  }

  function copyFileName(tab: EditorTab) {
    navigator.clipboard.writeText(tab.fileName);
  }

  // ── Tooltip content ──
  function tabTooltipContent(tab: EditorTab): string {
    const dirty = editorStore.isDirty(tab.id);
    const preview = tab.id === editorStore.previewTabId;
    const lineCount = tab.content.split('\n').length;
    const parts = [tab.filePath];
    parts.push(`${tab.language} · ${lineCount.toLocaleString()} lines`);
    if (dirty) parts.push('unsaved changes');
    if (preview) parts.push('preview');
    return parts.join(' · ');
  }

  let ctxItems = $derived<ContextMenuItem[]>(
    ctxTab
      ? [
          {
            label: ctxTab.pinned ? 'Unpin Tab' : 'Pin Tab',
            icon: ctxTab.pinned
              ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`
              : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5"/><path d="M9 11V6a3 3 0 0 1 6 0v5"/><path d="M5 11h14l-1 6H6z"/></svg>`,
            action: () => {
              if (ctxTab!.pinned) {
                editorStore.unpinTab(ctxTab!.id);
              } else {
                editorStore.pinTab(ctxTab!.id);
              }
              ctxTab = null;
            },
          },
          { kind: 'separator' },
          {
            label: 'Close',
            shortcut: isMac ? '⌘W' : 'Ctrl+W',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
            disabled: ctxTab.pinned,
            action: () => {
              closeTab(null, ctxTab!);
              ctxTab = null;
            },
          },
          {
            label: 'Close Others',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/><circle cx="12" cy="12" r="10"/></svg>`,
            disabled: editorStore.tabs.length <= 1,
            action: () => {
              closeOthers(ctxTab!);
              ctxTab = null;
            },
          },
          {
            label: 'Close to the Right',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`,
            disabled:
              editorStore.tabs.findIndex((t) => t.id === ctxTab!.id) >= editorStore.tabs.length - 1,
            action: () => {
              closeToRight(ctxTab!);
              ctxTab = null;
            },
          },
          {
            label: 'Close Saved',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
            disabled: editorStore.tabs.every((t) => editorStore.isDirty(t.id)),
            action: () => {
              closeSaved();
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
          { kind: 'separator' },
          {
            label: 'Copy Path',
            shortcut: isMac ? '⌘⌥C' : 'Ctrl+Alt+C',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
            action: () => {
              copyPath(ctxTab!);
              ctxTab = null;
            },
          },
          {
            label: 'Copy File Name',
            icon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
            action: () => {
              copyFileName(ctxTab!);
              ctxTab = null;
            },
          },
        ]
      : [],
  );
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

<div class="tab-bar">
  <div class="tabs-scroll">
    {#each editorStore.tabs as tab (tab.id)}
      {@const dirty = editorStore.isDirty(tab.id)}
      {@const isPreview = tab.id === editorStore.previewTabId}
      {@const isActive = tab.id === editorStore.activeTabId}

      <Tooltip content={tabTooltipContent(tab)} placement="bottom" delay={700}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="editor-tab"
          class:active={isActive}
          class:preview={isPreview}
          class:dirty
          onclick={() => editorStore.setActiveTab(tab.id)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              editorStore.setActiveTab(tab.id);
            }
          }}
          ondblclick={() => {
            if (isPreview) editorStore.openFile(tab.filePath, false);
          }}
          oncontextmenu={(e) => openTabCtx(e, tab)}
          onauxclick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              closeTab(null, tab);
            }
          }}
          role="tab"
          tabindex="0"
          aria-selected={isActive}
        >
          <!-- Pin icon or language dot -->
          {#if tab.pinned}
            <svg
              class="pin-icon"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              aria-hidden="true"
            >
              <path d="M12 17v5" />
              <path d="M9 11V6a3 3 0 0 1 6 0v5" />
              <path d="M5 11h14l-1 6H6z" />
            </svg>
          {:else}
            <span class="lang-dot" aria-hidden="true"></span>
          {/if}

          <span class="tab-name" class:italic={isPreview}>
            {tab.fileName}
          </span>

          <!-- Dirty / close button (swap on hover like VS Code) — hidden for pinned tabs -->
          {#if tab.pinned}
            <!-- No close button for pinned tabs -->
          {:else if dirty}
            <Tooltip content="Unsaved changes — click to close" placement="bottom" delay={900}>
              <button
                class="tab-close dirty-close"
                onclick={(e) => closeTab(e, tab)}
                aria-label="Close {tab.fileName} (unsaved)"
              >
                <!-- Filled circle = unsaved, morphs to × on hover -->
                <span class="dirty-indicator">
                  <svg class="icon-dot" viewBox="0 0 10 10" fill="currentColor">
                    <circle cx="5" cy="5" r="4" />
                  </svg>
                  <svg
                    class="icon-x"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </span>
              </button>
            </Tooltip>
          {:else}
            <Tooltip
              content="Close"
              shortcut={isMac ? '⌘W' : 'Ctrl+W'}
              placement="bottom"
              delay={900}
            >
              <button
                class="tab-close"
                onclick={(e) => closeTab(e, tab)}
                aria-label="Close {tab.fileName}"
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
  </div>

  <div class="tab-bar-actions"></div>
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
    height: 34px;
    overflow: hidden;
  }

  .tabs-scroll {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    flex: 1;
  }
  .tabs-scroll::-webkit-scrollbar {
    display: none;
  }

  /* Tooltip wrapper must fill height */
  .tabs-scroll :global(.tooltip-trigger) {
    display: flex;
    align-items: stretch;
  }

  /* ── Tab ── */
  .editor-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px 0 8px;
    font-size: var(--fs-base);
    color: var(--text-secondary);
    border-right: 1px solid var(--border-secondary);
    background: transparent;
    white-space: nowrap;
    transition:
      background var(--transition),
      color var(--transition);
    position: relative;
    min-width: 0;
    flex-shrink: 0;
    cursor: pointer;
    user-select: none;
  }
  .editor-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .editor-tab.active {
    background: var(--bg-code);
    color: var(--text-primary);
    border-bottom: 2px solid var(--accent-primary);
    margin-bottom: -1px;
  }
  .editor-tab.active::before,
  .editor-tab.active::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--border-primary);
  }
  .editor-tab.active::before {
    left: -1px;
  }
  .editor-tab.active::after {
    right: -1px;
  }

  /* Pin icon */
  .pin-icon {
    flex-shrink: 0;
    color: var(--accent-primary, #00b4ff);
    opacity: 0.7;
  }
  .editor-tab.active .pin-icon {
    opacity: 1;
  }

  /* Language dot */
  .lang-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent-primary);
    flex-shrink: 0;
    opacity: 0.4;
    transition: opacity var(--transition);
  }
  .editor-tab:hover .lang-dot,
  .editor-tab.active .lang-dot {
    opacity: 0.9;
  }
  .editor-tab.dirty .lang-dot {
    background: var(--accent-warning, #e5c07b);
    opacity: 0.75;
  }

  .tab-name {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tab-name.italic {
    font-style: italic;
  }

  /* ── Close / dirty button ── */
  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
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
    width: 10px;
    height: 10px;
  }

  .editor-tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: color-mix(in srgb, var(--accent-error) 18%, var(--bg-active));
    color: var(--accent-error);
  }

  /* Dirty-close: VS Code style dot → × swap */
  .dirty-close {
    opacity: 1; /* always visible when dirty */
    color: var(--accent-warning, #e5c07b);
  }

  .dirty-indicator {
    position: relative;
    width: 10px;
    height: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-dot {
    width: 8px;
    height: 8px;
    position: absolute;
    transition:
      opacity var(--transition),
      transform var(--transition);
  }

  .icon-x {
    width: 10px;
    height: 10px;
    position: absolute;
    opacity: 0;
    transition:
      opacity var(--transition),
      transform var(--transition);
    transform: scale(0.7);
  }

  .dirty-close:hover .icon-dot {
    opacity: 0;
    transform: scale(0.5);
  }
  .dirty-close:hover .icon-x {
    opacity: 1;
    transform: scale(1);
    color: var(--accent-error);
  }
  .dirty-close:hover {
    background: color-mix(in srgb, var(--accent-error) 18%, var(--bg-active));
    color: var(--accent-error);
  }

  /* ── Tab bar actions ── */
  .tab-bar-actions {
    display: flex;
    align-items: center;
    padding: 0 4px;
    gap: 2px;
    flex-shrink: 0;
    border-left: 1px solid var(--border-secondary);
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
</style>
