<script lang="ts" module>
  // Shared z-index counter across all FloatingPanel instances.
  let zCounter = 0;
  export function nextZIndex(): number {
    return ++zCounter;
  }
</script>

<script lang="ts">
  import type { SidebarTab } from '$lib/stores/ui.svelte';
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import { panelDragStore } from '$lib/stores/panelDrag.svelte';
  import { getTabDef } from '$lib/config/sidebarTabs';
  import SidebarTabContent from './SidebarTabContent.svelte';

  interface Props {
    tabId: SidebarTab;
    x: number;
    y: number;
    width: number;
    height: number;
  }

  let { tabId, x, y, width, height }: Props = $props();

  const MIN_WIDTH = 200;
  const MIN_HEIGHT = 200;
  const BASE_Z_INDEX = 800;
  const SNAP_THRESHOLD = 40;

  const tabDef = $derived(getTabDef(tabId));

  // --- Click-to-focus z-index management ---
  let zIndex = $state(BASE_Z_INDEX);

  function bringToFront() {
    zIndex = BASE_Z_INDEX + nextZIndex();
  }

  // --- Drag state ---
  let dragging = $state(false);
  let crossDragging = $state(false);
  let snapEdge = $state<'left' | 'right' | null>(null);
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartPanelX = 0;
  let dragStartPanelY = 0;

  function handleDragStart(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    bringToFront();

    dragging = true;
    crossDragging = false;
    snapEdge = null;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartPanelX = x;
    dragStartPanelY = y;

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }

  function handleDragMove(e: MouseEvent) {
    if (!dragging) return;

    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;

    let newX = dragStartPanelX + deltaX;
    let newY = dragStartPanelY + deltaY;

    newX = Math.max(0, Math.min(window.innerWidth - width, newX));
    newY = Math.max(0, Math.min(window.innerHeight - height, newY));

    x = newX;
    y = newY;

    // Start shared drag so drop zones appear in columns
    if (!crossDragging) {
      crossDragging = true;
      panelDragStore.startDrag(tabId, { type: 'floating' }, e.clientX, e.clientY);
    } else {
      panelDragStore.updatePosition(e.clientX, e.clientY);
    }

    // Detect snap-to-edge hints
    if (newX <= SNAP_THRESHOLD) {
      snapEdge = 'left';
    } else if (newX + width >= window.innerWidth - SNAP_THRESHOLD) {
      snapEdge = 'right';
    } else {
      snapEdge = null;
    }
  }

  function handleDragEnd() {
    dragging = false;
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);

    if (crossDragging) {
      const result = panelDragStore.endDrag();
      crossDragging = false;

      if (result && result.target) {
        const { target } = result;
        if (target.type === 'tab-bar') {
          sidebarLayoutStore.moveTabToGroup(
            tabId,
            target.column,
            target.groupIndex,
            target.insertIndex,
          );
        } else if (target.type === 'split') {
          sidebarLayoutStore.createSplit(tabId, target.column, target.insertGroupAtIndex);
        } else if (target.type === 'column') {
          sidebarLayoutStore.addTabToColumn(tabId, target.column);
        }
        return;
      }

      // Fall back to snap-to-edge if no specific drop target
      if (snapEdge) {
        const edge = snapEdge;
        snapEdge = null;
        sidebarLayoutStore.dockFloatingTab(tabId, edge);
        return;
      }
    }

    // Just moved the floating panel — update position
    snapEdge = null;
    sidebarLayoutStore.updatePanelPosition(tabId, x, y);
  }

  // --- Resize state ---
  type ResizeDirection = 'e' | 's' | 'se';
  let resizing = $state(false);
  let resizeDir: ResizeDirection = 'se';
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;

  function handleResizeStart(dir: ResizeDirection, e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    bringToFront();

    resizing = true;
    resizeDir = dir;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartWidth = width;
    resizeStartHeight = height;

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  }

  function handleResizeMove(e: MouseEvent) {
    if (!resizing) return;
    const deltaX = e.clientX - resizeStartX;
    const deltaY = e.clientY - resizeStartY;

    if (resizeDir === 'e' || resizeDir === 'se') {
      width = Math.max(MIN_WIDTH, resizeStartWidth + deltaX);
    }
    if (resizeDir === 's' || resizeDir === 'se') {
      height = Math.max(MIN_HEIGHT, resizeStartHeight + deltaY);
    }
  }

  function handleResizeEnd() {
    resizing = false;
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
    sidebarLayoutStore.updatePanelSize(tabId, width, height);
  }

  // --- Panel actions ---
  function handlePanelMouseDown() {
    bringToFront();
  }

  function handleDockToColumn(column: 'left' | 'right') {
    sidebarLayoutStore.dockFloatingTab(tabId, column);
  }

  function handleClose() {
    sidebarLayoutStore.closeFloatingPanel(tabId);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="floating-panel"
  class:dragging
  class:resizing
  class:snap-left={snapEdge === 'left'}
  class:snap-right={snapEdge === 'right'}
  style="left: {x}px; top: {y}px; width: {width}px; height: {height}px; z-index: {zIndex};"
  onmousedown={handlePanelMouseDown}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="title-bar" onmousedown={handleDragStart}>
    <svg
      class="title-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={tabDef.icon} />
    </svg>
    <span class="title-label">{tabDef.label}</span>
    <button
      class="title-action"
      title="Move to left column"
      onclick={() => handleDockToColumn('left')}
      onmousedown={(e) => e.stopPropagation()}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M3 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3M11 3h10v18H11z" />
      </svg>
    </button>
    <button
      class="title-action"
      title="Move to right column"
      onclick={() => handleDockToColumn('right')}
      onmousedown={(e) => e.stopPropagation()}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M3 3h12v18H3z" />
      </svg>
    </button>
    <button
      class="title-action"
      title="Close panel"
      onclick={handleClose}
      onmousedown={(e) => e.stopPropagation()}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  </div>

  <div class="panel-content">
    <SidebarTabContent {tabId} />
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize-handle resize-e" onmousedown={(e) => handleResizeStart('e', e)}></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize-handle resize-s" onmousedown={(e) => handleResizeStart('s', e)}></div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize-handle resize-se" onmousedown={(e) => handleResizeStart('se', e)}></div>
</div>

<style>
  .floating-panel {
    position: fixed;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    box-shadow: var(--shadow-lg);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .floating-panel.dragging,
  .floating-panel.resizing {
    user-select: none;
  }

  .floating-panel.snap-left {
    border-left: 2px solid var(--accent-primary);
    box-shadow: var(--shadow-lg), var(--shadow-glow-sm);
  }

  .floating-panel.snap-right {
    border-right: 2px solid var(--accent-primary);
    box-shadow: var(--shadow-lg), var(--shadow-glow-sm);
  }

  .floating-panel.dragging .title-bar {
    cursor: grabbing;
  }

  .title-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--bg-elevated);
    cursor: grab;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-primary);
    min-height: 28px;
    user-select: none;
  }

  .title-icon {
    flex-shrink: 0;
    color: var(--accent-primary);
  }

  .title-label {
    flex: 1;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .title-action {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    min-width: 24px;
    min-height: 24px;
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: color var(--transition);
  }

  .title-action:hover {
    color: var(--accent-primary);
  }

  .panel-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
  }

  .resize-handle {
    position: absolute;
  }

  .resize-e {
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: ew-resize;
  }

  .resize-s {
    bottom: -3px;
    left: 0;
    width: 100%;
    height: 6px;
    cursor: ns-resize;
  }

  .resize-se {
    bottom: -3px;
    right: -3px;
    width: 12px;
    height: 12px;
    cursor: nwse-resize;
  }
</style>
