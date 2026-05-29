import { uuid } from '$lib/utils/uuid';

export type SidebarTab =
  | 'conversations'
  | 'files'
  | 'search'
  | 'work'
  | 'memory'
  | 'agents'
  | 'symbols'
  | 'mcp'
  | 'todos'
  | 'costs'
  | 'ambient'
  | 'digest'
  | 'custom-tools'
  | 'initiatives'
  | 'help'
  | 'git'
  | 'artifacts'
  | 'notes'
  | 'manager'
  | 'commentary'
  | 'command-history'
  | 'canvas'
  | 'learning'
  | 'scripts'
  | 'crossdraw'
  | 'problems'
  | 'debug'
  | 'git-graph'
  | 'docs'
  | 'test-explorer'
  /**
   * Plugin-contributed sidebar tabs. The id format is
   * `plugin:<plugin-id>:<pane-id>` — the parser in PluginPanel splits on
   * `:` to find the right plugin + sidePane contribution. Surfacing as a
   * template literal lets TypeScript narrow incoming tab ids at the type
   * level instead of falling back to `string`.
   */
  | `plugin:${string}`;

/** Mobile navigation view — either a special view or any sidebar tab rendered fullscreen */
export type MobileView = 'chat' | 'terminal' | SidebarTab;
type ModalId =
  | 'settings'
  | 'command-palette'
  | 'keybindings'
  | 'quick-open'
  | 'workspace-setup'
  | 'snapshots'
  | 'loop-config'
  | 'story-create'
  | 'story-generate'
  | 'story-refine'
  | 'criteria-validation'
  | 'story-estimate'
  | 'sprint-plan'
  | 'prd-completeness'
  | 'template-library'
  | 'priority-recommendation'
  | 'effort-value-matrix'
  | 'external-provider-config'
  | 'compaction-history'
  | 'prd-refine-all'
  | 'claude-code-viewer'
  | 'plugin-pane-viewer'
  | 'launch-config-editor'
  | 'walkthroughs'
  | null;
type FocusedPane = 'chat' | 'editor';

/** Callback for sidebar layout integration (avoids circular import) */
let _onSidebarTabChange: ((tab: SidebarTab) => void) | null = null;
export function onSidebarTabChange(cb: (tab: SidebarTab) => void) {
  _onSidebarTabChange = cb;
}

/** Callback for focusing the chat input from anywhere (avoids circular import) */
let _onFocusChatInput: (() => void) | null = null;
export function onFocusChatInput(cb: () => void) {
  _onFocusChatInput = cb;
}

function createUIStore() {
  let sidebarOpen = $state(true);
  let sidebarTab = $state<SidebarTab>('conversations');
  let sidebarWidth = $state(280);
  let activeModal = $state<ModalId>(null);
  let toasts = $state<
    Array<{
      id: string;
      message: string;
      type: 'info' | 'success' | 'error' | 'warning';
      timeout?: number;
    }>
  >([]);
  let commandPaletteQuery = $state('');
  /** Optional seed query when opening the quick-open modal (e.g. '#' for workspace symbols). */
  let quickOpenSeed = $state('');
  let contextMenuPos = $state<{ x: number; y: number } | null>(null);
  let focusedPane = $state<FocusedPane>('chat');

  // ── Mobile navigation state ──
  let mobileActiveView = $state<MobileView>('chat');
  let mobileMoreOpen = $state(false);

  // ── Zen Mode ──
  // When on: hide TopBar / CommentaryTicker / both sidebars / terminal /
  // StatusBar. Entering stashes the sidebar-open state so exit can restore
  // it (otherwise users who pre-closed a sidebar would have it re-opened).
  let zenMode = $state(false);
  let zenStash: { sidebarOpen: boolean } | null = null;

  return {
    get sidebarOpen() {
      return sidebarOpen;
    },
    get sidebarTab() {
      return sidebarTab;
    },
    get sidebarWidth() {
      return sidebarWidth;
    },
    get activeModal() {
      return activeModal;
    },
    get toasts() {
      return toasts;
    },
    get commandPaletteQuery() {
      return commandPaletteQuery;
    },
    get quickOpenSeed() {
      return quickOpenSeed;
    },
    setQuickOpenSeed(seed: string) {
      quickOpenSeed = seed;
    },
    consumeQuickOpenSeed(): string {
      const v = quickOpenSeed;
      quickOpenSeed = '';
      return v;
    },
    get focusedPane() {
      return focusedPane;
    },
    get mobileActiveView() {
      return mobileActiveView;
    },
    get mobileMoreOpen() {
      return mobileMoreOpen;
    },

    get zenMode() {
      return zenMode;
    },

    /**
     * Toggle Zen Mode. On entry: stash current sidebar-open state and hide
     * everything except the active editor/main content. On exit: restore
     * the stashed sidebar state. The setSidebarTab handler resets zenMode
     * if the user opens a tab so they can't get visually stuck.
     */
    toggleZenMode() {
      if (zenMode) {
        zenMode = false;
        if (zenStash) {
          sidebarOpen = zenStash.sidebarOpen;
          zenStash = null;
        }
      } else {
        zenStash = { sidebarOpen };
        zenMode = true;
        // Closing the sidebar explicitly makes the layout collapse cleanly
        // when zen-mode CSS isn't loaded yet; defence in depth.
        sidebarOpen = false;
      }
    },
    setZenMode(v: boolean) {
      if (v === zenMode) return;
      this.toggleZenMode();
    },

    toggleSidebar() {
      sidebarOpen = !sidebarOpen;
    },
    setSidebarOpen(v: boolean) {
      sidebarOpen = v;
    },
    setSidebarTab(tab: SidebarTab) {
      sidebarTab = tab;
      sidebarOpen = true;
      // Opening a sidebar tab implicitly exits Zen Mode — the user clearly
      // wants the chrome back. Without this they'd hit the tab and see
      // nothing happen (zenMode would still suppress the sidebar render).
      if (zenMode) {
        zenMode = false;
        zenStash = null;
      }
      // Notify the layout store to focus the tab wherever it lives.
      // Uses a callback to avoid circular import (sidebarLayout imports SidebarTab type from here).
      _onSidebarTabChange?.(tab);
      // On mobile, also navigate to the tab fullscreen
      if (typeof window !== 'undefined' && document.documentElement.hasAttribute('data-mobile')) {
        mobileActiveView = tab;
        mobileMoreOpen = false;
      }
    },
    setSidebarWidth(w: number) {
      sidebarWidth = Math.max(200, Math.min(500, w));
    },

    openModal(id: ModalId) {
      activeModal = id;
    },
    closeModal() {
      activeModal = null;
    },
    openSettings(tab?: string) {
      if (tab && typeof localStorage !== 'undefined') {
        localStorage.setItem('e-settings-tab', tab);
      }
      activeModal = 'settings';
    },
    toast(
      message: string,
      type: 'info' | 'success' | 'error' | 'warning' = 'info',
      timeout = 4000,
    ) {
      const id = uuid();
      toasts = [...toasts, { id, message, type, timeout }];
      if (timeout > 0) {
        setTimeout(() => {
          toasts = toasts.filter((t) => t.id !== id);
        }, timeout);
      }
      return id;
    },

    dismissToast(id: string) {
      toasts = toasts.filter((t) => t.id !== id);
    },

    setCommandPaletteQuery(q: string) {
      commandPaletteQuery = q;
    },

    setFocusedPane(pane: FocusedPane) {
      focusedPane = pane;
    },

    focusChatInput() {
      _onFocusChatInput?.();
    },

    // ── Mobile navigation ──

    setMobileView(view: MobileView) {
      mobileActiveView = view;
      mobileMoreOpen = false;
      // Keep sidebarTab in sync if navigating to a sidebar panel
      if (view !== 'chat' && view !== 'terminal') {
        sidebarTab = view;
        _onSidebarTabChange?.(view);
      }
    },

    setMobileMoreOpen(open: boolean) {
      mobileMoreOpen = open;
    },

    restoreState(state: { sidebarTab: SidebarTab; sidebarOpen: boolean }) {
      sidebarTab = state.sidebarTab;
      sidebarOpen = state.sidebarOpen;
    },
  };
}

export const uiStore = createUIStore();
