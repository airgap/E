/**
 * tabDrag.svelte.ts — global drag state for primary-pane tab drags.
 *
 * Set by PrimaryTabBar's dragstart so other components (PaneDropZones) can
 * render split-on-drop overlays and know which tab/source-pane is in flight.
 * In-memory only; not persisted.
 */

interface TabDragState {
  sourcePaneId: string;
  tabId: string;
}

function createTabDragStore() {
  let drag = $state<TabDragState | null>(null);
  return {
    get drag() {
      return drag;
    },
    get isDragging() {
      return drag !== null;
    },
    start(sourcePaneId: string, tabId: string) {
      drag = { sourcePaneId, tabId };
    },
    end() {
      drag = null;
    },
  };
}

export const tabDragStore = createTabDragStore();
