/**
 * tabDrag.svelte.ts — global drag state for primary-pane tab drags.
 *
 * Set by PrimaryTabBar's dragstart so the pane-slot drag handlers in
 * PrimaryPane can recognise a tab-drag in flight (vs an unrelated DOM drag) and
 * decide whether to engage the split-on-drop behaviour. In-memory only.
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
      console.debug('[tab-drag] start', { sourcePaneId, tabId });
    },
    end() {
      drag = null;
      console.debug('[tab-drag] end');
    },
  };
}

export const tabDragStore = createTabDragStore();
