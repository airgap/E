/**
 * Shared registry of menu actions (in-window MainToolbar + native menu).
 *
 * Both surfaces (`MainToolbar.svelte` and the Electron native menu in
 * `electron/main.ts`) dispatch the same actions. The MainToolbar imports
 * handlers from this module; the native menu sends an IPC message with
 * the action id and AppShell routes the dispatch back here.
 *
 * Action ids are stable, dot-namespaced strings — `file.newConversation`,
 * `view.toggleSidebar`, etc. New entries get a doc comment listing the
 * surface(s) that present them so removing an action is a grep away.
 *
 * Action handlers are plain functions — no reactive state is captured at
 * module load; instead each call reads the relevant store at invocation
 * time, so the behaviour stays in lockstep with whatever's currently
 * mounted (e.g. the active editor tab when Close Editor Tab fires).
 *
 * Dynamic submenus (themes, recent workspaces, switch workspace) live in
 * the in-window toolbar only — the native menu exposes a single
 * picker-launching entry per category. The action-id surface is still
 * the same; only the click target differs.
 */

import { uiStore, type SidebarTab } from '$lib/stores/ui.svelte';
import { conversationStore } from '$lib/stores/conversation.svelte';
import { terminalStore } from '$lib/stores/terminal.svelte';
import { editorStore } from '$lib/stores/editor.svelte';
import { jumpListStore } from '$lib/stores/jump-list.svelte';
import { settingsStore } from '$lib/stores/settings.svelte';
import { dapStore } from '$lib/stores/dap.svelte';
import { streamStore } from '$lib/stores/stream.svelte';
import { startupTipsStore } from '$lib/stores/startupTips.svelte';
import { api } from '$lib/api/client';

function quickOpen(seed = '') {
  if (seed) uiStore.setQuickOpenSeed(seed);
  uiStore.openModal('quick-open');
}
function goto(tab: SidebarTab) {
  uiStore.setSidebarTab(tab);
}

function electronWin(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).__TAURI__?.window?.getCurrentWindow?.() ?? null;
}

export const menuActions: Record<string, () => void> = {
  // ── File ────────────────────────────────────────────────────────────
  'file.newConversation': () => {
    conversationStore.setActive(null);
    conversationStore.createDraft();
    uiStore.focusChatInput();
  },
  'file.openFile': () => quickOpen(),
  'file.gotoSymbolWorkspace': () => quickOpen('#'),
  'file.gotoSymbolFile': () => quickOpen('@'),
  'file.closeTab': () => {
    const id = editorStore.activeTabId;
    if (id) editorStore.closeTab(id);
  },
  'file.reopenClosedTab': () => {
    if (editorStore.hasClosedTabs) void editorStore.reopenLastClosedTab();
  },
  'file.snapshots': () => uiStore.openModal('snapshots'),
  'file.workspaceSetup': () => uiStore.openModal('workspace-setup'),
  // Native menu uses these as picker entries; in-window menu also offers
  // an inline list submenu that targets per-item handlers directly.
  'file.switchWorkspacePicker': () => uiStore.openModal('workspace-setup'),
  'file.openRecentPicker': () => uiStore.openModal('workspace-setup'),
  'file.settings': () => uiStore.openSettings(),
  'file.exit': () => electronWin()?.close?.(),

  // ── Edit ────────────────────────────────────────────────────────────
  'edit.searchAcrossFiles': () => goto('search'),
  'edit.findSymbolWorkspace': () => quickOpen('#'),
  'edit.findSymbolFile': () => quickOpen('@'),
  'edit.stopGeneration': () => streamStore.cancel(),
  /**
   * LYK-1053 rename. Prompts for the new name, calls the plugin rename
   * service for the cursor position, then applies the returned workspace
   * edit by writing each affected file. No-op when no plugin contributed
   * a rename for the active file's language.
   */
  'edit.rename': async () => {
    const tab = editorStore.activeTab;
    if (!tab) return;
    const newName = typeof window !== 'undefined' ? window.prompt('Rename to:') : null;
    if (!newName) return;
    const line = tab.cursorLine - 1;
    const character = Math.max(0, tab.cursorCol - 1);
    try {
      const res = await api.plugins.rename(tab.filePath, tab.content, line, character, newName);
      const edits = res.data?.result?.edits;
      if (!edits || Object.keys(edits).length === 0) {
        uiStore.toast('No plugin rename available for this file.', 'info');
        return;
      }
      // Apply per-file. For each file, sort edits in reverse order
      // (bottom-up by line then character) so earlier offsets stay valid
      // as we splice later ones in.
      for (const [filePath, fileEdits] of Object.entries(edits)) {
        let content: string;
        if (filePath === tab.filePath) {
          content = tab.content;
        } else {
          try {
            const r = await api.files.read(filePath);
            content = r.data.content;
          } catch {
            continue;
          }
        }
        const lines = content.split('\n');
        const sorted = [...fileEdits].sort((a, b) =>
          b.startLine === a.startLine
            ? b.startCharacter - a.startCharacter
            : b.startLine - a.startLine,
        );
        for (const e of sorted) {
          let from = 0;
          for (let i = 0; i < e.startLine && i < lines.length; i++) from += lines[i].length + 1;
          from += e.startCharacter;
          let to = 0;
          for (let i = 0; i < e.endLine && i < lines.length; i++) to += lines[i].length + 1;
          to += e.endCharacter;
          content = content.slice(0, from) + e.newText + content.slice(to);
          // Re-split for the next edit so the loop indexes stay sane.
          // (Rare-enough operation that the cost is fine.)
          const _ = lines.splice(0, lines.length, ...content.split('\n'));
          void _;
        }
        if (filePath === tab.filePath) {
          editorStore.updateContent(tab.id, content);
        } else {
          await api.files.write(filePath, content);
        }
      }
      uiStore.toast(`Renamed in ${Object.keys(edits).length} file(s).`, 'success');
    } catch (err) {
      uiStore.toast(`Rename failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  },

  // ── View ────────────────────────────────────────────────────────────
  'view.toggleSidebar': () => uiStore.toggleSidebar(),
  'view.toggleTerminal': () => terminalStore.toggle(),
  'view.toggleSplit': () => {
    editorStore.setLayoutMode(
      editorStore.layoutMode === 'split-horizontal' ? 'chat-only' : 'split-horizontal',
    );
  },
  'view.zenMode': () => uiStore.toggleZenMode(),
  'view.themePicker': () => uiStore.openSettings('appearance'),
  'view.toggleBreadcrumbs': () =>
    settingsStore.update({ breadcrumbsEnabled: !settingsStore.breadcrumbsEnabled }),

  // ── Run / Debug ─────────────────────────────────────────────────────
  // Each guards on dapStore state so a fire-from-menu while inactive is
  // a no-op rather than throwing.
  'run.startDebugging': () => goto('debug'),
  'run.continue': () => {
    if (dapStore.isActive && dapStore.state === 'stopped') void dapStore.continueExec();
  },
  'run.pause': () => {
    if (dapStore.isActive && dapStore.state === 'running') void dapStore.pause();
  },
  'run.stop': () => {
    if (dapStore.isActive) void dapStore.stop();
  },
  'run.stepOver': () => {
    if (dapStore.state === 'stopped') void dapStore.stepOver();
  },
  'run.stepInto': () => {
    if (dapStore.state === 'stopped') void dapStore.stepIn();
  },
  'run.stepOut': () => {
    if (dapStore.state === 'stopped') void dapStore.stepOut();
  },
  'run.problems': () => goto('problems'),
  'run.debugPanel': () => goto('debug'),

  // ── Go (sidebar tabs) ────────────────────────────────────────────────
  /**
   * Cross-tab back/forward (LYK-989). Pops the previous (filePath, line, col)
   * from the jump-list stack and routes through editorStore.openFile so the
   * existing goTo + scroll plumbing handles the navigation.
   */
  'go.back': () => {
    const entry = jumpListStore.back();
    if (entry) {
      void editorStore.openFileSilentJump(entry.filePath, { line: entry.line, col: entry.col });
    }
  },
  'go.forward': () => {
    const entry = jumpListStore.forward();
    if (entry) {
      void editorStore.openFileSilentJump(entry.filePath, { line: entry.line, col: entry.col });
    }
  },
  'go.conversations': () => goto('conversations'),
  'go.files': () => goto('files'),
  'go.search': () => goto('search'),
  'go.work': () => goto('work'),
  'go.memory': () => goto('memory'),
  'go.agents': () => goto('agents'),
  'go.symbols': () => goto('symbols'),
  'go.todos': () => goto('todos'),
  'go.tests': () => goto('test-explorer'),
  'go.git': () => goto('git'),
  'go.gitGraph': () => goto('git-graph'),
  'go.problems': () => goto('problems'),
  'go.debug': () => goto('debug'),
  'go.notes': () => goto('notes'),
  'go.artifacts': () => goto('artifacts'),
  'go.initiatives': () => goto('initiatives'),
  'go.learning': () => goto('learning'),
  'go.costs': () => goto('costs'),
  'go.ambient': () => goto('ambient'),
  'go.digest': () => goto('digest'),
  'go.commandHistory': () => goto('command-history'),

  // ── Tools ────────────────────────────────────────────────────────────
  'tools.commandPalette': () => uiStore.openModal('command-palette'),
  'tools.keybindings': () => uiStore.openModal('keybindings'),
  'tools.mcp': () => goto('mcp'),
  'tools.customTools': () => goto('custom-tools'),
  'tools.scripts': () => goto('scripts'),
  'tools.manager': () => goto('manager'),

  // ── Window (Electron) ────────────────────────────────────────────────
  'window.minimize': () => electronWin()?.minimize?.(),
  'window.toggleMaximize': () => electronWin()?.toggleMaximize?.(),
  'window.close': () => electronWin()?.close?.(),

  // ── Help ────────────────────────────────────────────────────────────
  'help.helpPanel': () => goto('help'),
  'help.docs': () => goto('docs'),
  'help.welcomeTips': () => startupTipsStore.show(),
  /** LYK-1040 plugin walkthroughs picker. */
  'help.walkthroughs': () => uiStore.openModal('walkthroughs'),
  'help.keybindings': () => uiStore.openModal('keybindings'),
};

/** Run an action by id. No-op when the id is unknown. */
export function runMenuAction(id: string): void {
  const fn = menuActions[id];
  if (!fn) {
    console.warn(`[menuActions] unknown action: ${id}`);
    return;
  }
  fn();
}
