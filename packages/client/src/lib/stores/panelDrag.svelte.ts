/**
 * Shared drag state for Affinity-style panel drag-and-drop.
 *
 * When a tab is dragged (from TabGroupBar or FloatingPanel title bar),
 * this store broadcasts the drag context so PanelColumns and other
 * components can render drop-zone indicators.
 */

import type { SidebarTab } from './ui.svelte';

export type DropTarget =
  | { type: 'tab-bar'; column: 'left' | 'right'; groupIndex: number; insertIndex: number }
  | { type: 'split'; column: 'left' | 'right'; insertGroupAtIndex: number }
  | { type: 'column'; column: 'left' | 'right' }
  | null;

interface PanelDragState {
  /** The tab being dragged */
  tabId: SidebarTab;
  /** Where the drag originated */
  source: { type: 'tab-bar'; column: 'left' | 'right'; groupIndex: number } | { type: 'floating' };
  /** Current mouse position */
  mouseX: number;
  mouseY: number;
}

function createPanelDragStore() {
  let dragState = $state<PanelDragState | null>(null);
  let activeDropTarget = $state<DropTarget>(null);

  return {
    get drag() {
      return dragState;
    },
    get dropTarget() {
      return activeDropTarget;
    },
    get isDragging() {
      return dragState !== null;
    },

    /** Start a cross-component drag */
    startDrag(tabId: SidebarTab, source: PanelDragState['source'], mouseX: number, mouseY: number) {
      dragState = { tabId, source, mouseX, mouseY };
      activeDropTarget = null;
    },

    /** Update mouse position during drag */
    updatePosition(mouseX: number, mouseY: number) {
      if (!dragState) return;
      dragState = { ...dragState, mouseX, mouseY };
    },

    /** Set the current drop target (called by drop zone components) */
    setDropTarget(target: DropTarget) {
      activeDropTarget = target;
    },

    /** End the drag, returning the active drop target */
    endDrag(): { tabId: SidebarTab; target: DropTarget } | null {
      if (!dragState) return null;
      const result = { tabId: dragState.tabId, target: activeDropTarget };
      dragState = null;
      activeDropTarget = null;
      return result;
    },

    /** Cancel the drag without applying */
    cancelDrag() {
      dragState = null;
      activeDropTarget = null;
    },
  };
}

export const panelDragStore = createPanelDragStore();
