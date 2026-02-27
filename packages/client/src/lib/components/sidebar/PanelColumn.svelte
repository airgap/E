<script lang="ts">
  import type { PanelColumn } from '$lib/stores/sidebarLayout.svelte';
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import { panelDragStore } from '$lib/stores/panelDrag.svelte';
  import TabGroupView from './TabGroupView.svelte';

  interface Props {
    column: PanelColumn;
    side: 'left' | 'right';
  }

  let { column, side }: Props = $props();

  // --- Group divider resize ---
  let resizingDivider = $state<number | null>(null);
  let groupHeights = $state<number[]>([]);
  let containerEl: HTMLDivElement | undefined = $state();

  function handleDividerStart(dividerIndex: number, e: MouseEvent) {
    if (e.button !== 0 || !containerEl) return;
    // Don't start resize during panel drag
    if (panelDragStore.isDragging) return;
    e.preventDefault();
    resizingDivider = dividerIndex;

    // Cache current group heights
    const groupEls = containerEl.querySelectorAll<HTMLElement>('.group-container');
    groupHeights = Array.from(groupEls).map((el) => el.getBoundingClientRect().height);

    document.addEventListener('mousemove', handleDividerMove);
    document.addEventListener('mouseup', handleDividerEnd);
  }

  function handleDividerMove(e: MouseEvent) {
    if (resizingDivider == null || !containerEl) return;
    const di = resizingDivider;
    const groupEls = containerEl.querySelectorAll<HTMLElement>('.group-container');
    if (di >= groupEls.length - 1) return;

    const topEl = groupEls[di];
    const bottomEl = groupEls[di + 1];
    const topRect = topEl.getBoundingClientRect();
    const bottomRect = bottomEl.getBoundingClientRect();

    const totalHeight = topRect.height + bottomRect.height;
    const mouseRelative = e.clientY - topRect.top;
    const topHeight = Math.max(80, Math.min(totalHeight - 80, mouseRelative));

    topEl.style.flex = `0 0 ${topHeight}px`;
    bottomEl.style.flex = `0 0 ${totalHeight - topHeight}px`;
  }

  function handleDividerEnd() {
    resizingDivider = null;
    document.removeEventListener('mousemove', handleDividerMove);
    document.removeEventListener('mouseup', handleDividerEnd);

    // Reset inline flex styles to let CSS handle it
    if (containerEl) {
      const groupEls = containerEl.querySelectorAll<HTMLElement>('.group-container');
      groupEls.forEach((el) => {
        el.style.flex = '';
      });
    }
  }

  // --- Drop zone detection ---

  /** Is the given split drop zone the active target? */
  function isSplitTarget(insertIndex: number): boolean {
    const dt = panelDragStore.dropTarget;
    return (
      dt !== null &&
      dt.type === 'split' &&
      dt.column === side &&
      dt.insertGroupAtIndex === insertIndex
    );
  }

  /** Is a tab-bar drop zone the active target for a given group? */
  function isTabBarTarget(groupIndex: number): boolean {
    const dt = panelDragStore.dropTarget;
    return (
      dt !== null && dt.type === 'tab-bar' && dt.column === side && dt.groupIndex === groupIndex
    );
  }

  function handleSplitZoneEnter(insertGroupAtIndex: number) {
    if (!panelDragStore.isDragging) return;
    panelDragStore.setDropTarget({
      type: 'split',
      column: side,
      insertGroupAtIndex,
    });
  }

  function handleSplitZoneLeave() {
    if (!panelDragStore.isDragging) return;
    const dt = panelDragStore.dropTarget;
    if (dt && dt.type === 'split' && dt.column === side) {
      panelDragStore.setDropTarget(null);
    }
  }

  function handleTabBarZoneEnter(groupIndex: number, insertIndex: number) {
    if (!panelDragStore.isDragging) return;
    panelDragStore.setDropTarget({
      type: 'tab-bar',
      column: side,
      groupIndex,
      insertIndex,
    });
  }

  function handleTabBarZoneLeave(groupIndex: number) {
    if (!panelDragStore.isDragging) return;
    const dt = panelDragStore.dropTarget;
    if (dt && dt.type === 'tab-bar' && dt.column === side && dt.groupIndex === groupIndex) {
      panelDragStore.setDropTarget(null);
    }
  }

  const isDragging = $derived(panelDragStore.isDragging);
</script>

<div
  class="panel-column"
  class:column-left={side === 'left'}
  class:column-right={side === 'right'}
  class:resizing={resizingDivider != null}
  class:drop-active={isDragging}
  style="width: {column.width}px;"
  bind:this={containerEl}
>
  {#each column.groups as group, i (group.id)}
    <!-- Split drop zone ABOVE this group -->
    {#if isDragging}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="split-drop-zone"
        class:active={isSplitTarget(i)}
        onmouseenter={() => handleSplitZoneEnter(i)}
        onmouseleave={handleSplitZoneLeave}
      >
        <div class="split-drop-indicator"></div>
      </div>
    {/if}

    {#if i > 0 && !isDragging}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="group-divider" onmousedown={(e) => handleDividerStart(i - 1, e)}></div>
    {/if}

    <div class="group-container" class:tab-bar-target={isTabBarTarget(i)}>
      <TabGroupView {group} column={side} groupIndex={i} />
    </div>
  {/each}

  <!-- Split drop zone BELOW last group (for appending new group at end) -->
  {#if isDragging}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="split-drop-zone split-drop-zone-bottom"
      class:active={isSplitTarget(column.groups.length)}
      onmouseenter={() => handleSplitZoneEnter(column.groups.length)}
      onmouseleave={handleSplitZoneLeave}
    >
      <div class="split-drop-indicator"></div>
    </div>
  {/if}
</div>

<style>
  .panel-column {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    overflow: hidden;
    background: var(--bg-secondary);
    height: 100%;
    position: relative;
  }

  .panel-column.column-left {
    border-right: 1px solid var(--border-primary);
  }

  .panel-column.column-right {
    border-left: 1px solid var(--border-primary);
  }

  /* Let canvas effects bleed through in magic hyperthemes */
  :global([data-hypertheme='arcane']) .panel-column,
  :global([data-hypertheme='ethereal']) .panel-column,
  :global([data-hypertheme='astral']) .panel-column,
  :global([data-hypertheme='astral-midnight']) .panel-column {
    background: var(--bg-glass, rgba(14, 10, 8, 0.85));
  }
  :global([data-hypertheme='study']) .panel-column {
    background: transparent;
  }

  .panel-column.resizing {
    user-select: none;
    cursor: row-resize;
  }

  .group-container {
    flex: 1;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: box-shadow 150ms ease;
  }

  .group-container.tab-bar-target {
    box-shadow: inset 0 0 0 2px var(--accent-primary);
    border-radius: var(--radius-sm);
  }

  .group-divider {
    height: 6px;
    flex-shrink: 0;
    background: var(--border-primary);
    cursor: row-resize;
    transition: background var(--transition);
  }
  .group-divider:hover {
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  /* --- Drop zones --- */

  .split-drop-zone {
    flex-shrink: 0;
    height: 8px;
    position: relative;
    z-index: 5;
    transition: height 100ms ease;
  }

  .split-drop-zone:hover,
  .split-drop-zone.active {
    height: 20px;
  }

  .split-drop-indicator {
    position: absolute;
    left: 8px;
    right: 8px;
    top: 50%;
    height: 2px;
    background: transparent;
    border-radius: 1px;
    transform: translateY(-50%);
    transition:
      background 100ms ease,
      box-shadow 100ms ease;
  }

  .split-drop-zone:hover .split-drop-indicator,
  .split-drop-zone.active .split-drop-indicator {
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  /* When column is a drag target, highlight border */
  .panel-column.drop-active {
    outline: 1px dashed var(--accent-primary);
    outline-offset: -1px;
  }
</style>
