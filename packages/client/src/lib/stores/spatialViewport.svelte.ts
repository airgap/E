/**
 * Spatial viewport store — manages focus state and pointer tracking
 * for the 3D panel layout mode.
 */

export type PanelRole = 'sidebar-left' | 'main-content' | 'terminal' | 'sidebar-right';

const PANEL_ORDER: PanelRole[] = ['sidebar-left', 'main-content', 'terminal', 'sidebar-right'];

function createSpatialViewportStore() {
  let focusedPanel = $state<PanelRole>('main-content');
  let pointerX = $state(0); // normalized -1..1
  let pointerY = $state(0); // normalized -1..1
  let transitioning = $state(false);

  // Throttle pointer updates to ~30fps
  let lastPointerUpdate = 0;
  const POINTER_THROTTLE_MS = 33; // ~30fps

  function handlePointerMove(e: PointerEvent) {
    const now = performance.now();
    if (now - lastPointerUpdate < POINTER_THROTTLE_MS) return;
    lastPointerUpdate = now;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    pointerX = (e.clientX / vw) * 2 - 1; // -1 (left) to 1 (right)
    pointerY = (e.clientY / vh) * 2 - 1; // -1 (top) to 1 (bottom)
  }

  function focusPanel(panel: PanelRole) {
    if (panel === focusedPanel) return;
    transitioning = true;
    focusedPanel = panel;
    setTimeout(() => {
      transitioning = false;
    }, 420); // slightly longer than 400ms transition
  }

  function cycleFocus(direction: 1 | -1) {
    const idx = PANEL_ORDER.indexOf(focusedPanel);
    const next = (idx + direction + PANEL_ORDER.length) % PANEL_ORDER.length;
    focusPanel(PANEL_ORDER[next]);
  }

  function focusTerminal() {
    focusPanel('terminal');
  }

  return {
    get focusedPanel() {
      return focusedPanel;
    },
    get pointerX() {
      return pointerX;
    },
    get pointerY() {
      return pointerY;
    },
    get transitioning() {
      return transitioning;
    },
    handlePointerMove,
    focusPanel,
    cycleFocus,
    focusTerminal,
  };
}

export const spatialViewportStore = createSpatialViewportStore();
