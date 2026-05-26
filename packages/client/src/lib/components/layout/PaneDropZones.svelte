<script lang="ts">
  /**
   * PaneDropZones — split-on-drop overlay for a primary pane.
   *
   * Visible only while a tab drag is in flight (tabDragStore). Covers the pane
   * CONTENT area (below the tab bar) with two halves: left and right. Drop on a
   * half to split the pane in that direction — primaryPaneStore.splitTabOut
   * pulls the dragged tab from its source pane into a new pane inserted there.
   * A single-tab pane dropped onto its own adjacent edge is a no-op (handled in
   * the store).
   */
  import { tabDragStore } from '$lib/stores/tabDrag.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';

  let { paneIndex }: { paneIndex: number } = $props();

  // 'left' | 'right' | null — which half is being hovered (for highlight).
  let hover = $state<'left' | 'right' | null>(null);

  function onDragOver(e: DragEvent, side: 'left' | 'right') {
    if (!tabDragStore.drag) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    hover = side;
  }
  function onDragLeave(side: 'left' | 'right') {
    if (hover === side) hover = null;
  }
  function onDrop(e: DragEvent, side: 'left' | 'right') {
    e.preventDefault();
    const d = tabDragStore.drag;
    hover = null;
    if (!d) return;
    // Left-split inserts BEFORE this pane; right-split inserts AFTER.
    const insertAt = side === 'left' ? paneIndex : paneIndex + 1;
    primaryPaneStore.splitTabOut(d.sourcePaneId, d.tabId, insertAt);
    tabDragStore.end();
  }
</script>

{#if tabDragStore.isDragging}
  <div class="pane-drop-overlay">
    <div
      class="zone left"
      class:hover={hover === 'left'}
      ondragover={(e) => onDragOver(e, 'left')}
      ondragleave={() => onDragLeave('left')}
      ondrop={(e) => onDrop(e, 'left')}
      role="presentation"
    ></div>
    <div
      class="zone right"
      class:hover={hover === 'right'}
      ondragover={(e) => onDragOver(e, 'right')}
      ondragleave={() => onDragLeave('right')}
      ondrop={(e) => onDrop(e, 'right')}
      role="presentation"
    ></div>
  </div>
{/if}

<style>
  .pane-drop-overlay {
    position: absolute;
    /* Sit below the 34px PrimaryTabBar so tab-to-tab reorder still works. */
    top: 34px;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    z-index: 50;
    pointer-events: none;
  }
  .zone {
    flex: 1;
    pointer-events: auto;
    transition: background 80ms ease;
  }
  .zone.hover {
    background: color-mix(in srgb, var(--accent-primary, #58a6ff) 22%, transparent);
    box-shadow: inset 0 0 0 2px var(--accent-primary, #58a6ff);
  }
</style>
