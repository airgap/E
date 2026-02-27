<script lang="ts">
  import type { SidebarTab } from '$lib/stores/ui.svelte';
  import type { TabGroup } from '$lib/stores/sidebarLayout.svelte';
  import { SIDEBAR_TABS } from '$lib/config/sidebarTabs';
  import { sidebarLayoutStore } from '$lib/stores/sidebarLayout.svelte';
  import { panelDragStore } from '$lib/stores/panelDrag.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { golemsStore } from '$lib/stores/golems.svelte';
  import { gitStore } from '$lib/stores/git.svelte';

  interface Props {
    group: TabGroup;
    column: 'left' | 'right';
    groupIndex: number;
  }

  let { group, column, groupIndex }: Props = $props();

  let showMenu = $state(false);
  let contextMenu = $state<{ tabId: SidebarTab; x: number; y: number } | null>(null);

  // --- Drag-to-reorder state ---
  const DRAG_THRESHOLD = 5;
  const TEAROFF_THRESHOLD = 40;

  interface DragState {
    tabId: SidebarTab;
    startIndex: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    isDragging: boolean;
    /** True when this tab has entered cross-component drag mode */
    crossDrag: boolean;
    tabWidths: number[];
    tabOffsets: number[];
    order: SidebarTab[];
  }

  let drag = $state<DragState | null>(null);
  let tabBtnEls: HTMLButtonElement[] = $state([]);

  // Coordinate helper — normalise touch to {x, y}
  function touchXY(e: TouchEvent) {
    const t = e.touches[0] ?? e.changedTouches[0];
    return { x: t.clientX, y: t.clientY };
  }

  function startTabDrag(tabId: SidebarTab, index: number, x: number, y: number) {
    const widths: number[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < tabBtnEls.length; i++) {
      const el = tabBtnEls[i];
      if (el) {
        const rect = el.getBoundingClientRect();
        widths.push(rect.width);
        offsets.push(rect.left);
      }
    }
    drag = {
      tabId,
      startIndex: index,
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      isDragging: false,
      crossDrag: false,
      tabWidths: widths,
      tabOffsets: offsets,
      order: [...group.tabs],
    };
  }

  function handleDragStart(tabId: SidebarTab, index: number, e: MouseEvent) {
    if (e.button !== 0) return;
    startTabDrag(tabId, index, e.clientX, e.clientY);
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }

  function handleDragStartTouch(tabId: SidebarTab, index: number, e: TouchEvent) {
    e.preventDefault();
    cancelLongPress();
    startLongPress(tabId, e);
    const { x, y } = touchXY(e);
    startTabDrag(tabId, index, x, y);
    document.addEventListener('touchmove', handleDragMoveTouch, { passive: false });
    document.addEventListener('touchend', handleDragEndTouch);
  }

  function applyTabDragMove(x: number, y: number, e: { preventDefault(): void }) {
    if (!drag || drag.crossDrag) return;
    const deltaX = x - drag.startX;
    const deltaY = y - drag.startY;

    if (!drag.isDragging) {
      if (Math.abs(deltaX) < DRAG_THRESHOLD && Math.abs(deltaY) < DRAG_THRESHOLD) return;
      drag.isDragging = true;
      cancelLongPress(); // moved enough — not a long-press
      e.preventDefault();
    }

    drag.currentX = x;
    drag.currentY = y;

    // Tear-off: vertical drag enters cross-component drag mode
    if (Math.abs(deltaY) > TEAROFF_THRESHOLD) {
      drag.crossDrag = true;
      const tabId = drag.tabId;
      panelDragStore.startDrag(tabId, { type: 'tab-bar', column, groupIndex }, x, y);
      return; // cross-drag listeners attached by caller
    }

    // Horizontal reorder
    const draggedWidth = drag.tabWidths[drag.startIndex];
    const draggedCenter = drag.tabOffsets[drag.startIndex] + draggedWidth / 2 + deltaX;

    let newOrder = [...drag.order];
    let swapped = true;
    while (swapped) {
      swapped = false;
      const idx = newOrder.indexOf(drag.tabId);
      if (idx < newOrder.length - 1) {
        const rightOrigIndex = group.tabs.indexOf(newOrder[idx + 1]);
        if (rightOrigIndex >= 0 && rightOrigIndex < drag.tabOffsets.length) {
          const rightMid = drag.tabOffsets[rightOrigIndex] + drag.tabWidths[rightOrigIndex] / 2;
          if (draggedCenter > rightMid) {
            [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
            swapped = true;
            continue;
          }
        }
      }
      if (idx > 0) {
        const leftOrigIndex = group.tabs.indexOf(newOrder[idx - 1]);
        if (leftOrigIndex >= 0 && leftOrigIndex < drag.tabOffsets.length) {
          const leftMid = drag.tabOffsets[leftOrigIndex] + drag.tabWidths[leftOrigIndex] / 2;
          if (draggedCenter < leftMid) {
            [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
            swapped = true;
            continue;
          }
        }
      }
    }
    drag.order = newOrder;
  }

  function handleDragMove(e: MouseEvent) {
    if (drag?.crossDrag) {
      // Hand off to cross-drag
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.addEventListener('mousemove', handleCrossDragMove);
      document.addEventListener('mouseup', handleCrossDragEnd);
      return;
    }
    applyTabDragMove(e.clientX, e.clientY, e);
    if (drag?.crossDrag) {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.addEventListener('mousemove', handleCrossDragMove);
      document.addEventListener('mouseup', handleCrossDragEnd);
    }
  }

  function handleDragMoveTouch(e: TouchEvent) {
    e.preventDefault();
    if (drag?.crossDrag) {
      document.removeEventListener('touchmove', handleDragMoveTouch);
      document.removeEventListener('touchend', handleDragEndTouch);
      document.addEventListener('touchmove', handleCrossDragMoveTouch, { passive: false });
      document.addEventListener('touchend', handleCrossDragEndTouch);
      return;
    }
    const { x, y } = touchXY(e);
    applyTabDragMove(x, y, e);
    if (drag?.crossDrag) {
      document.removeEventListener('touchmove', handleDragMoveTouch);
      document.removeEventListener('touchend', handleDragEndTouch);
      document.addEventListener('touchmove', handleCrossDragMoveTouch, { passive: false });
      document.addEventListener('touchend', handleCrossDragEndTouch);
    }
  }

  function finishTabDrag() {
    if (!drag) return;
    if (drag.isDragging && !drag.crossDrag) {
      sidebarLayoutStore.reorderTabsInGroup(column, groupIndex, drag.order);
    } else if (!drag.isDragging) {
      handleTabClick(drag.tabId);
    }
    drag = null;
  }

  function handleDragEnd() {
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    finishTabDrag();
  }

  function handleDragEndTouch(e: TouchEvent) {
    document.removeEventListener('touchmove', handleDragMoveTouch);
    document.removeEventListener('touchend', handleDragEndTouch);
    cancelLongPress();
    finishTabDrag();
  }

  // --- Cross-component drag (after tear-off) ---

  function handleCrossDragMove(e: MouseEvent) {
    panelDragStore.updatePosition(e.clientX, e.clientY);
  }

  function handleCrossDragMoveTouch(e: TouchEvent) {
    e.preventDefault();
    const { x, y } = touchXY(e);
    panelDragStore.updatePosition(x, y);
  }

  function finishCrossDrag(x: number, y: number) {
    const result = panelDragStore.endDrag();
    if (!result) {
      drag = null;
      return;
    }
    const { tabId, target } = result;
    if (!target) {
      sidebarLayoutStore.popOutTab(tabId, {
        x: Math.max(0, x - 160),
        y: Math.max(0, y - 14),
      });
    } else if (target.type === 'tab-bar') {
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
    drag = null;
  }

  function handleCrossDragEnd(e: MouseEvent) {
    document.removeEventListener('mousemove', handleCrossDragMove);
    document.removeEventListener('mouseup', handleCrossDragEnd);
    finishCrossDrag(e.clientX, e.clientY);
  }

  function handleCrossDragEndTouch(e: TouchEvent) {
    document.removeEventListener('touchmove', handleCrossDragMoveTouch);
    document.removeEventListener('touchend', handleCrossDragEndTouch);
    const { x, y } = touchXY(e);
    finishCrossDrag(x, y);
  }

  // --- Drop target: this tab bar itself accepts drops ---

  function handleBarMouseEnter() {
    if (!panelDragStore.isDragging) return;
    // Set this tab bar as the drop target
    panelDragStore.setDropTarget({
      type: 'tab-bar',
      column,
      groupIndex,
      insertIndex: group.tabs.length, // default: append at end
    });
  }

  function handleBarMouseLeave() {
    if (!panelDragStore.isDragging) return;
    const dt = panelDragStore.dropTarget;
    if (dt && dt.type === 'tab-bar' && dt.column === column && dt.groupIndex === groupIndex) {
      panelDragStore.setDropTarget(null);
    }
  }

  function handleTabSlotEnter(insertIndex: number) {
    if (!panelDragStore.isDragging) return;
    // Refine the insertion point within this tab bar
    panelDragStore.setDropTarget({
      type: 'tab-bar',
      column,
      groupIndex,
      insertIndex,
    });
  }

  // --- Visual helpers ---

  function getDragTransform(tabId: SidebarTab): string {
    if (!drag || !drag.isDragging || drag.crossDrag) return '';
    if (tabId === drag.tabId) {
      const dx = drag.currentX - drag.startX;
      const dy = drag.currentY - drag.startY;
      return `translate(${dx}px, ${dy}px)`;
    }
    const originalIndex = group.tabs.indexOf(tabId);
    const newIndex = drag.order.indexOf(tabId);
    if (originalIndex === newIndex) return '';
    const draggedWidth = drag.tabWidths[drag.startIndex];
    const direction = newIndex > originalIndex ? 1 : -1;
    const gap = 1;
    const shift = direction * (draggedWidth + gap);
    return `translateX(${shift}px)`;
  }

  function getDragStyle(tabId: SidebarTab): string {
    const transform = getDragTransform(tabId);
    if (!transform) return '';
    if (drag && tabId === drag.tabId) {
      return `transform: ${transform}; opacity: 0.7; z-index: 10;`;
    }
    return `transform: ${transform}; transition: transform 150ms ease;`;
  }

  /** Whether the dragged tab came from this bar and is now in cross-drag */
  const tabHidden = $derived.by(() => {
    if (!drag?.crossDrag) return null;
    return drag.tabId;
  });

  /** Is an external drag hovering over this bar? */
  const isDropTarget = $derived.by(() => {
    const dt = panelDragStore.dropTarget;
    return (
      panelDragStore.isDragging &&
      dt !== null &&
      dt.type === 'tab-bar' &&
      dt.column === column &&
      dt.groupIndex === groupIndex
    );
  });

  /** Where in this bar would the tab be inserted? */
  const dropInsertIndex = $derived.by(() => {
    const dt = panelDragStore.dropTarget;
    if (!isDropTarget || !dt || dt.type !== 'tab-bar') return -1;
    return dt.insertIndex;
  });

  // --- Actions ---

  function handleTabClick(tabId: SidebarTab) {
    sidebarLayoutStore.setActiveTabInGroup(column, groupIndex, tabId);
  }

  function closeMenu() {
    showMenu = false;
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  // --- Context menu ---
  // We block ALL native contextmenu events on the nav (prevents the browser
  // menu and the touch-synthesized popup). Instead:
  //   • Mouse right-click  → detected via pointerdown with pointerType='mouse' and button=2
  //   • Touch long-press   → detected via our own timer in handleDragStartTouch

  const LONG_PRESS_MS = 500;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  function startLongPress(tabId: SidebarTab, e: TouchEvent) {
    const { x, y } = touchXY(e);
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (!drag?.isDragging) {
        contextMenu = { tabId, x, y };
      }
    }, LONG_PRESS_MS);
  }

  function cancelLongPress() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  // Right-click via pointer API (works on mouse and pen, never fires for touch)
  function handleTabPointerDown(tabId: SidebarTab, e: PointerEvent) {
    if (e.pointerType !== 'mouse' || e.button !== 2) return;
    // Show context menu on pointerup to match OS convention
    const onUp = (up: PointerEvent) => {
      document.removeEventListener('pointerup', onUp);
      if (up.button === 2) {
        contextMenu = { tabId, x: up.clientX, y: up.clientY };
      }
    };
    document.addEventListener('pointerup', onUp);
  }

  function handlePopOut(tabId: SidebarTab) {
    sidebarLayoutStore.popOutTab(tabId);
    closeMenu();
    closeContextMenu();
  }

  function handleMoveToColumn(tabId: SidebarTab, targetColumn: 'left' | 'right') {
    sidebarLayoutStore.addTabToColumn(tabId, targetColumn);
    closeMenu();
    closeContextMenu();
  }

  function handleRemoveFromGroup(tabId: SidebarTab) {
    sidebarLayoutStore.removeTab(tabId);
    closeContextMenu();
  }

  function handleAddTab(tabId: SidebarTab) {
    sidebarLayoutStore.moveTabToGroup(tabId, column, groupIndex);
    closeMenu();
  }

  const otherColumn = $derived(column === 'left' ? 'right' : 'left');

  // --- Menu drag-to-reorder / drag-into-tab-bar ---

  /** All sidebar tabs in display order for the menu */
  let menuOrder = $state<SidebarTab[]>(SIDEBAR_TABS.map((t) => t.id));

  /** Sync menuOrder when menu opens */
  function openMenu() {
    menuOrder = SIDEBAR_TABS.map((t) => t.id);
    showMenu = true;
  }

  function toggleMenu() {
    if (showMenu) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  const MENU_DRAG_THRESHOLD = 4;
  /** Pixels of horizontal movement before we convert to a tab-bar cross-drag */
  const MENU_CROSS_THRESHOLD = 40;

  interface MenuDragState {
    tabId: SidebarTab;
    startIndex: number;
    startY: number;
    startX: number;
    currentY: number;
    isDragging: boolean;
    crossDrag: boolean;
    order: SidebarTab[];
    itemOffsets: number[];
    itemHeights: number[];
  }

  let menuDrag = $state<MenuDragState | null>(null);
  let menuItemEls: HTMLElement[] = $state([]);

  function startMenuDrag(tabId: SidebarTab, index: number, x: number, y: number) {
    const heights: number[] = [];
    const offsets: number[] = [];
    for (const el of menuItemEls) {
      if (el) {
        const rect = el.getBoundingClientRect();
        heights.push(rect.height);
        offsets.push(rect.top);
      }
    }
    menuDrag = {
      tabId,
      startIndex: index,
      startY: y,
      startX: x,
      currentY: y,
      isDragging: false,
      crossDrag: false,
      order: [...menuOrder],
      itemOffsets: offsets,
      itemHeights: heights,
    };
  }

  function handleMenuItemMousedown(tabId: SidebarTab, index: number, e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startMenuDrag(tabId, index, e.clientX, e.clientY);
    document.addEventListener('mousemove', handleMenuDragMove);
    document.addEventListener('mouseup', handleMenuDragEnd);
  }

  function handleMenuItemTouchstart(tabId: SidebarTab, index: number, e: TouchEvent) {
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = touchXY(e);
    startMenuDrag(tabId, index, x, y);
    document.addEventListener('touchmove', handleMenuDragMoveTouch, { passive: false });
    document.addEventListener('touchend', handleMenuDragEndTouch);
  }

  function applyMenuDragMove(x: number, y: number) {
    if (!menuDrag || menuDrag.crossDrag) return false;

    const deltaY = y - menuDrag.startY;
    const deltaX = x - menuDrag.startX;

    if (!menuDrag.isDragging) {
      if (Math.abs(deltaY) < MENU_DRAG_THRESHOLD && Math.abs(deltaX) < MENU_DRAG_THRESHOLD)
        return false;
      menuDrag.isDragging = true;
    }

    menuDrag.currentY = y;

    // Enough horizontal movement → cross-component drag into tab bar
    if (Math.abs(deltaX) > MENU_CROSS_THRESHOLD) {
      menuDrag.crossDrag = true;
      const tabId = menuDrag.tabId;
      closeMenu();
      panelDragStore.startDrag(tabId, { type: 'tab-bar', column, groupIndex }, x, y);
      return true; // signal: switch to cross-drag listeners
    }

    // Vertical reorder within the menu list
    let newOrder = [...menuDrag.order];
    let swapped = true;
    while (swapped) {
      swapped = false;
      const idx = newOrder.indexOf(menuDrag.tabId);
      if (idx < newOrder.length - 1) {
        const nextOrigIdx = menuOrder.indexOf(newOrder[idx + 1]);
        if (nextOrigIdx >= 0 && nextOrigIdx < menuDrag.itemOffsets.length) {
          const nextMid = menuDrag.itemOffsets[nextOrigIdx] + menuDrag.itemHeights[nextOrigIdx] / 2;
          if (y > nextMid) {
            [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
            swapped = true;
            continue;
          }
        }
      }
      if (idx > 0) {
        const prevOrigIdx = menuOrder.indexOf(newOrder[idx - 1]);
        if (prevOrigIdx >= 0 && prevOrigIdx < menuDrag.itemOffsets.length) {
          const prevMid = menuDrag.itemOffsets[prevOrigIdx] + menuDrag.itemHeights[prevOrigIdx] / 2;
          if (y < prevMid) {
            [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
            swapped = true;
            continue;
          }
        }
      }
    }
    menuDrag.order = newOrder;
    return false;
  }

  function handleMenuDragMove(e: MouseEvent) {
    const crossDragStarted = applyMenuDragMove(e.clientX, e.clientY);
    if (crossDragStarted) {
      document.removeEventListener('mousemove', handleMenuDragMove);
      document.removeEventListener('mouseup', handleMenuDragEnd);
      document.addEventListener('mousemove', handleCrossDragMove);
      document.addEventListener('mouseup', handleCrossDragEnd);
    }
  }

  function handleMenuDragMoveTouch(e: TouchEvent) {
    e.preventDefault();
    const { x, y } = touchXY(e);
    const crossDragStarted = applyMenuDragMove(x, y);
    if (crossDragStarted) {
      document.removeEventListener('touchmove', handleMenuDragMoveTouch);
      document.removeEventListener('touchend', handleMenuDragEndTouch);
      document.addEventListener('touchmove', handleCrossDragMoveTouch, { passive: false });
      document.addEventListener('touchend', handleCrossDragEndTouch);
    }
  }

  function finishMenuDrag() {
    if (!menuDrag) return;
    if (menuDrag.isDragging && !menuDrag.crossDrag) {
      menuOrder = menuDrag.order;
    } else if (!menuDrag.isDragging) {
      handleAddTab(menuDrag.tabId);
    }
    menuDrag = null;
  }

  function handleMenuDragEnd(e: MouseEvent) {
    document.removeEventListener('mousemove', handleMenuDragMove);
    document.removeEventListener('mouseup', handleMenuDragEnd);
    finishMenuDrag();
  }

  function handleMenuDragEndTouch(e: TouchEvent) {
    document.removeEventListener('touchmove', handleMenuDragMoveTouch);
    document.removeEventListener('touchend', handleMenuDragEndTouch);
    finishMenuDrag();
  }

  function getMenuItemDragStyle(tabId: SidebarTab, index: number): string {
    if (!menuDrag || !menuDrag.isDragging || menuDrag.crossDrag) return '';
    if (tabId === menuDrag.tabId) {
      const dy = menuDrag.currentY - menuDrag.startY;
      return `transform: translateY(${dy}px); opacity: 0.75; z-index: 10; position: relative;`;
    }
    const origIdx = menuOrder.indexOf(tabId);
    const newIdx = menuDrag.order.indexOf(tabId);
    if (origIdx === newIdx) return '';
    const direction = newIdx > origIdx ? 1 : -1;
    const draggedHeight = menuDrag.itemHeights[menuDrag.startIndex] ?? 28;
    return `transform: translateY(${direction * draggedHeight}px); transition: transform 150ms ease;`;
  }

  /** Whether a tab is in this group */
  function isInThisGroup(tabId: SidebarTab): boolean {
    return group.tabs.includes(tabId);
  }

  /** Whether a tab is placed anywhere (in a group or floating) */
  function isPlaced(tabId: SidebarTab): boolean {
    return !sidebarLayoutStore.unplacedTabs.some((t) => t.id === tabId);
  }

  /** Get badge count for a tab */
  function getTabBadge(tabId: SidebarTab): number | null {
    if (tabId === 'git' && gitStore.isDirty) {
      return gitStore.dirtyCount;
    }
    return null;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<nav
  class="tab-group-bar"
  class:dragging={drag?.isDragging && !drag.crossDrag}
  class:drop-target={isDropTarget}
  onmouseenter={handleBarMouseEnter}
  onmouseleave={handleBarMouseLeave}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#each group.tabs as tab, i (tab)}
    {@const tabDef = SIDEBAR_TABS.find((t) => t.id === tab)}
    {#if tabDef}
      <!-- Drop insertion indicator before this tab -->
      {#if isDropTarget && dropInsertIndex === i}
        <div class="drop-insert-marker"></div>
      {/if}
      <button
        bind:this={tabBtnEls[i]}
        class="tab-btn"
        class:active={group.activeTab === tab}
        class:drag-source={drag?.isDragging && !drag.crossDrag && drag.tabId === tab}
        class:hidden-tab={tabHidden === tab}
        class:golem-active-tab={(tab === 'work' && loopStore.isRunning) ||
          (tab === 'golems' && golemsStore.golems.some((g) => g.status === 'running'))}
        class:golem-paused-tab={(tab === 'work' && loopStore.isPaused) ||
          (tab === 'golems' &&
            !golemsStore.golems.some((g) => g.status === 'running') &&
            golemsStore.golems.some((g) => g.status === 'paused'))}
        onmousedown={(e) => handleDragStart(tab, i, e)}
        ontouchstart={(e) => handleDragStartTouch(tab, i, e)}
        onpointerdown={(e) => handleTabPointerDown(tab, e)}
        onmouseenter={() => handleTabSlotEnter(i)}
        style={getDragStyle(tab)}
        title={tabDef.label}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d={tabDef.icon} />
        </svg>
        {#if tab === 'work' && loopStore.isActive}
          <span
            class="golem-activity-dot"
            class:running={loopStore.isRunning}
            class:paused={loopStore.isPaused}
          ></span>
        {/if}
        {#if tab === 'golems' && golemsStore.hasActiveGolems}
          <span
            class="golem-activity-dot"
            class:running={golemsStore.golems.some((g) => g.status === 'running')}
            class:paused={!golemsStore.golems.some((g) => g.status === 'running') &&
              golemsStore.golems.some((g) => g.status === 'paused')}
          ></span>
        {/if}
        {#if getTabBadge(tab) !== null}
          <span class="tab-badge">{getTabBadge(tab)}</span>
        {/if}
      </button>
    {/if}
  {/each}

  <!-- Drop insertion indicator after last tab -->
  {#if isDropTarget && dropInsertIndex >= group.tabs.length}
    <div class="drop-insert-marker"></div>
  {/if}

  <div class="hamburger-wrap">
    <button
      class="tab-btn hamburger-btn"
      class:active={showMenu}
      onclick={toggleMenu}
      title="Manage tabs"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>

    {#if showMenu}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="menu-backdrop" onclick={closeMenu} ontouchend={closeMenu}></div>
      <div class="dropdown-menu" role="menu">
        <div class="menu-header">Panels</div>
        {#each menuDrag?.order ?? menuOrder as tabId, i (tabId)}
          {@const tab = SIDEBAR_TABS.find((t) => t.id === tabId)}
          {#if tab}
            {@const inThisGroup = isInThisGroup(tabId)}
            {@const placed = isPlaced(tabId)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="menu-item"
              class:menu-item-active={inThisGroup}
              class:menu-item-placed={placed && !inThisGroup}
              class:menu-item-dragging={menuDrag?.isDragging && menuDrag.tabId === tabId}
              role="menuitem"
              tabindex="0"
              bind:this={menuItemEls[i]}
              onmousedown={(e) => handleMenuItemMousedown(tabId, i, e)}
              ontouchstart={(e) => handleMenuItemTouchstart(tabId, i, e)}
              style={getMenuItemDragStyle(tabId, i)}
              title={placed && !inThisGroup
                ? `${tab.label} (in another panel — drag to move here)`
                : tab.label}
            >
              <svg
                class="menu-item-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d={tab.icon} />
              </svg>
              <span class="menu-item-label">{tab.label}</span>
              {#if tab.wip}
                <span class="menu-item-badge menu-item-badge-wip">WIP</span>
              {:else if placed && !inThisGroup}
                <span class="menu-item-badge">placed</span>
              {/if}
              <svg
                class="menu-drag-handle"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" />
              </svg>
            </div>
          {/if}
        {/each}
        <div class="menu-hint">Drag rows to reorder · Drag sideways to place in bar</div>
      </div>
    {/if}
  </div>
</nav>

{#if contextMenu}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="context-backdrop" onclick={closeContextMenu} ontouchend={closeContextMenu}></div>
  <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;">
    <button class="menu-item" onclick={() => handleMoveToColumn(contextMenu!.tabId, otherColumn)}>
      <svg
        class="menu-item-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        {#if otherColumn === 'right'}
          <path d="M5 12h14M12 5l7 7-7 7" />
        {:else}
          <path d="M19 12H5M12 19l-7-7 7-7" />
        {/if}
      </svg>
      Move to {otherColumn}
    </button>
    <button class="menu-item" onclick={() => handlePopOut(contextMenu!.tabId)}>
      <svg
        class="menu-item-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
      </svg>
      Pop out
    </button>
    {#if group.tabs.length > 1}
      <button class="menu-item" onclick={() => handleRemoveFromGroup(contextMenu!.tabId)}>
        <svg
          class="menu-item-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
        Remove
      </button>
    {/if}
  </div>
{/if}

<style>
  .tab-group-bar {
    display: flex;
    border-bottom: 1px solid var(--border-primary);
    padding: 4px 6px;
    gap: 2px;
    flex-shrink: 0;
    background: var(--bg-elevated);
    transition: background 150ms ease;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  /* SVGs are treated as images by Android Chrome — long-press triggers its
     image context menu before any JS can fire. Disable pointer events on all
     SVGs so touches land on the parent button instead. */
  .tab-group-bar svg,
  .dropdown-menu svg,
  .context-menu svg {
    pointer-events: none;
  }

  .tab-group-bar.drop-target {
    background: color-mix(in srgb, var(--accent-primary) 12%, var(--bg-elevated));
  }

  .tab-btn {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5px 6px;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    transition: all var(--transition);
    position: relative;
    border: 1px solid transparent;
    min-width: 32px;
    min-height: 32px;
    background: none;
    cursor: pointer;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .tab-btn:hover {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .tab-btn.active {
    color: var(--accent-primary);
    background: var(--bg-active);
    border-color: var(--border-primary);
    border-bottom-color: transparent;
  }
  .tab-btn.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 20%;
    right: 20%;
    height: 1px;
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
  }

  .tab-btn.hidden-tab {
    opacity: 0.3;
    pointer-events: none;
  }

  /* ── Golem activity indicator on Work sidebar tab ── */
  .tab-btn.golem-active-tab {
    color: var(--accent-primary);
    animation: golemTabBtnPulse 2s ease-in-out infinite;
  }
  .tab-btn.golem-paused-tab {
    color: var(--accent-warning);
  }

  .golem-activity-dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .golem-activity-dot.running {
    background: var(--accent-primary);
    box-shadow: 0 0 6px var(--accent-primary);
    animation: golemDotBlink 1.5s ease-in-out infinite;
  }
  .golem-activity-dot.paused {
    background: var(--accent-warning);
    box-shadow: 0 0 4px var(--accent-warning);
  }

  @keyframes golemTabBtnPulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }
  @keyframes golemDotBlink {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 4px var(--accent-primary);
    }
    50% {
      opacity: 0.5;
      box-shadow: 0 0 10px var(--accent-primary);
    }
  }

  /* Tab badge (e.g., uncommitted change count on git tab) */
  .tab-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    color: var(--bg-primary);
    background: var(--accent-warning);
    border-radius: 7px;
    border: 1px solid var(--bg-elevated);
  }
  .tab-btn.active .tab-badge {
    border-color: var(--bg-active);
  }

  .tab-group-bar.dragging {
    user-select: none;
    cursor: grabbing;
  }
  .tab-btn.drag-source {
    opacity: 0.7;
    z-index: 10;
  }

  /* Drop insertion marker — thin accent line between tabs */
  .drop-insert-marker {
    width: 2px;
    align-self: stretch;
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
    border-radius: 1px;
    flex-shrink: 0;
    margin: 2px 0;
  }

  .hamburger-wrap {
    position: relative;
    margin-left: auto;
  }
  .hamburger-btn {
    flex: 0 0 auto;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .dropdown-menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 100;
    min-width: 160px;
    margin-top: 4px;
    padding: 4px 0;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow);
  }

  .menu-header {
    padding: 4px 12px 2px;
    font-size: var(--fs-xxs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    user-select: none;
  }

  .menu-hint {
    padding: 4px 12px 6px;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-style: italic;
    border-top: 1px solid var(--border-primary);
    margin-top: 2px;
    user-select: none;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px 6px 12px;
    min-height: 28px;
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-secondary);
    background: none;
    border: none;
    text-align: left;
    cursor: grab;
    white-space: nowrap;
    user-select: none;
    touch-action: none;
    -webkit-touch-callout: none;
  }
  .menu-item:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .menu-item-active {
    color: var(--accent-primary);
  }
  .menu-item-active:hover {
    color: var(--accent-primary);
  }
  .menu-item-placed {
    opacity: 0.65;
  }
  .menu-item-dragging {
    cursor: grabbing;
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .menu-item-icon {
    flex-shrink: 0;
  }
  .menu-item-label {
    flex: 1;
  }

  .menu-item-badge {
    flex-shrink: 0;
    font-size: var(--fs-xxs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 1px 4px;
    border-radius: 3px;
    color: var(--text-tertiary);
    background: var(--bg-hover);
    border: 1px solid var(--border-primary);
  }
  .menu-item-badge-wip {
    color: var(--warning, #c89b3f);
    background: color-mix(in srgb, var(--warning, #c89b3f) 12%, transparent);
    border-color: color-mix(in srgb, var(--warning, #c89b3f) 30%, transparent);
  }

  .menu-drag-handle {
    flex-shrink: 0;
    color: var(--text-tertiary);
    opacity: 0.5;
  }
  .menu-item:hover .menu-drag-handle {
    opacity: 1;
  }

  .menu-empty {
    padding: 8px 12px;
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    font-style: italic;
  }

  .context-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .context-menu {
    position: fixed;
    z-index: 100;
    min-width: 140px;
    padding: 4px 0;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow);
  }
</style>
