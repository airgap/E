<script lang="ts">
  /**
   * MainToolbar — traditional menu bar (File / Edit / View / Go / Tools /
   * Help) with click-to-open dropdowns. Sits between the TopBar and the
   * workspace body. Hidden in Zen Mode and on mobile (gated by the caller
   * in AppShell / via media query below).
   *
   * Interaction model:
   * - Click a top-level label to open its menu; click again (or outside,
   *   or Escape) to close.
   * - With one menu open, hovering another top-level label switches focus
   *   to that menu — the classic desktop-app pattern.
   * - Item activation closes the menu and runs the handler.
   * - Submenus open to the right on hover.
   */
  import { uiStore } from '$lib/stores/ui.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { dapStore } from '$lib/stores/dap.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { startupTipsStore } from '$lib/stores/startupTips.svelte';
  import type { SidebarTab } from '$lib/stores/ui.svelte';

  // Electron host detection — preload exposes `__TAURI__` (legacy name kept
  // from the original Tauri build). Window-management items only appear
  // when this bridge is present; in browser dev they'd be no-ops.
  const isElectron = typeof window !== 'undefined' && '__TAURI__' in window;
  function electronWin(): any {
    return (window as any).__TAURI__?.window?.getCurrentWindow?.() ?? null;
  }

  // ── Modifier-key display (Mac shows ⌘, others Ctrl). Cosmetic only —
  // the actual handlers accept both metaKey and ctrlKey in AppShell. ──
  const mod = (() => {
    if (typeof navigator === 'undefined') return 'Ctrl';
    return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  })();
  const alt = (() => {
    if (typeof navigator === 'undefined') return 'Alt';
    return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥' : 'Alt';
  })();
  const shift = (() => {
    if (typeof navigator === 'undefined') return 'Shift';
    return /Mac|iPhone|iPad/.test(navigator.platform) ? '⇧' : 'Shift';
  })();

  // ── Actions ──
  function newConversation() {
    conversationStore.setActive(null);
    conversationStore.createDraft();
    uiStore.focusChatInput();
  }
  function quickOpen(seed = '') {
    if (seed) uiStore.setQuickOpenSeed(seed);
    uiStore.openModal('quick-open');
  }
  function toggleSplit() {
    editorStore.setLayoutMode(
      editorStore.layoutMode === 'split-horizontal' ? 'chat-only' : 'split-horizontal',
    );
  }
  function goto(tab: SidebarTab) {
    uiStore.setSidebarTab(tab);
  }
  function closeActiveTab() {
    const id = editorStore.activeTabId;
    if (id) editorStore.closeTab(id);
  }
  function stopGeneration() {
    streamStore.cancel();
  }
  function setTheme(id: string) {
    settingsStore.setTheme(id);
  }
  function openAppearanceSettings() {
    uiStore.openSettings('appearance');
  }
  function switchWorkspace(wsId: string) {
    workspaceStore.switchWorkspace(wsId);
  }
  function winMinimize() {
    electronWin()?.minimize?.();
  }
  function winToggleMaximize() {
    electronWin()?.toggleMaximize?.();
  }
  function winClose() {
    electronWin()?.close?.();
  }

  // ── Menu model ──
  type Item =
    | {
        kind: 'item';
        label: string;
        shortcut?: string;
        checked?: boolean;
        disabled?: boolean;
        run: () => void;
      }
    | { kind: 'sep' }
    | { kind: 'sub'; label: string; items: Item[] };

  type Menu = { id: string; label: string; items: Item[] };

  // Quick-pick themes for the View > Theme submenu — full picker stays in
  // Settings ▸ Appearance ("More Themes…" item at the bottom).
  const QUICK_THEMES: Array<{ id: string; label: string }> = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'monokai', label: 'Monokai' },
    { id: 'dracula', label: 'Dracula' },
    { id: 'nord', label: 'Nord' },
    { id: 'solarized-dark', label: 'Solarized Dark' },
    { id: 'tokyo-night', label: 'Tokyo Night' },
    { id: 'github-dark', label: 'GitHub Dark' },
    { id: 'arcane', label: 'Arcane' },
    { id: 'ethereal', label: 'Ethereal' },
    { id: 'study', label: "Wizard's Study" },
    { id: 'astral', label: 'Astral · Twilight' },
    { id: 'goth', label: 'Redrum' },
    { id: 'hyperfuture', label: 'Hyperfuture' },
    { id: 'magic-forest', label: 'Magic Forest' },
  ];

  const menus: Menu[] = $derived([
    {
      id: 'file',
      label: 'File',
      items: [
        { kind: 'item', label: 'New Conversation', shortcut: `${mod}+N`, run: newConversation },
        { kind: 'sep' },
        { kind: 'item', label: 'Open File…', shortcut: `${mod}+P`, run: () => quickOpen() },
        {
          kind: 'item',
          label: 'Go to Symbol in Workspace…',
          shortcut: `${mod}+T`,
          run: () => quickOpen('#'),
        },
        {
          kind: 'item',
          label: 'Go to Symbol in File…',
          shortcut: `${mod}+${shift}+O`,
          run: () => quickOpen('@'),
        },
        { kind: 'sep' },
        {
          kind: 'item',
          label: 'Close Editor Tab',
          shortcut: `${mod}+W`,
          disabled: !editorStore.activeTabId,
          run: closeActiveTab,
        },
        {
          kind: 'item',
          label: 'Reopen Closed Editor',
          shortcut: `${mod}+${shift}+T`,
          disabled: !editorStore.hasClosedTabs,
          run: () => void editorStore.reopenLastClosedTab(),
        },
        { kind: 'sep' },
        { kind: 'item', label: 'Snapshots…', run: () => uiStore.openModal('snapshots') },
        {
          kind: 'item',
          label: 'Workspace Setup…',
          run: () => uiStore.openModal('workspace-setup'),
        },
        // Switch Workspace only shows when more than one is open — single-
        // workspace users would just see a one-item submenu otherwise.
        ...(workspaceStore.workspaces.length > 1
          ? ([
              {
                kind: 'sub' as const,
                label: 'Switch Workspace',
                items: workspaceStore.workspaces.map(
                  (w): Item => ({
                    kind: 'item',
                    label: w.workspaceName,
                    checked: w.workspaceId === workspaceStore.activeWorkspaceId,
                    run: () => switchWorkspace(w.workspaceId),
                  }),
                ),
              },
            ] as Item[])
          : []),
        { kind: 'sep' },
        {
          kind: 'item',
          label: 'Settings',
          shortcut: `${mod}+,`,
          run: () => uiStore.openSettings(),
        },
        ...(isElectron
          ? ([
              { kind: 'sep' as const },
              { kind: 'item' as const, label: 'Exit', run: winClose },
            ] as Item[])
          : []),
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        {
          kind: 'item',
          label: 'Search Across Files',
          shortcut: `${mod}+${shift}+F`,
          run: () => goto('search'),
        },
        {
          kind: 'item',
          label: 'Find Symbol in Workspace',
          shortcut: `${mod}+T`,
          run: () => quickOpen('#'),
        },
        {
          kind: 'item',
          label: 'Find Symbol in File',
          shortcut: `${mod}+${shift}+O`,
          run: () => quickOpen('@'),
        },
        { kind: 'sep' },
        {
          kind: 'item',
          label: 'Stop Generation',
          disabled: !streamStore.isStreaming,
          run: stopGeneration,
        },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        {
          kind: 'item',
          label: 'Toggle Sidebar',
          shortcut: `${mod}+/`,
          checked: uiStore.sidebarOpen,
          run: () => uiStore.toggleSidebar(),
        },
        {
          kind: 'item',
          label: 'Toggle Terminal',
          checked: terminalStore.isOpen,
          run: () => terminalStore.toggle(),
        },
        {
          kind: 'item',
          label: 'Toggle Split Pane',
          shortcut: `${mod}+\\`,
          checked: editorStore.layoutMode === 'split-horizontal',
          run: toggleSplit,
        },
        {
          kind: 'item',
          label: 'Show Breadcrumbs',
          checked: settingsStore.breadcrumbsEnabled,
          run: () =>
            settingsStore.update({ breadcrumbsEnabled: !settingsStore.breadcrumbsEnabled }),
        },
        { kind: 'sep' },
        {
          kind: 'item',
          label: 'Zen Mode',
          shortcut: `${mod}+${alt}+Z`,
          checked: uiStore.zenMode,
          run: () => uiStore.toggleZenMode(),
        },
        { kind: 'sep' },
        {
          kind: 'sub',
          label: 'Theme',
          items: [
            ...QUICK_THEMES.map(
              (t): Item => ({
                kind: 'item',
                label: t.label,
                checked: settingsStore.theme === t.id,
                run: () => setTheme(t.id),
              }),
            ),
            { kind: 'sep' },
            { kind: 'item', label: 'More Themes…', run: openAppearanceSettings },
          ],
        },
      ],
    },
    {
      id: 'run',
      label: 'Run',
      items: [
        {
          kind: 'item',
          label: 'Start Debugging…',
          disabled: dapStore.isActive,
          run: () => goto('debug'),
        },
        {
          kind: 'item',
          label: 'Continue',
          shortcut: 'F5',
          disabled: !dapStore.isActive || dapStore.state !== 'stopped',
          run: () => void dapStore.continueExec(),
        },
        {
          kind: 'item',
          label: 'Pause',
          shortcut: 'F6',
          disabled: !dapStore.isActive || dapStore.state !== 'running',
          run: () => void dapStore.pause(),
        },
        {
          kind: 'item',
          label: 'Stop',
          shortcut: `${shift}+F5`,
          disabled: !dapStore.isActive,
          run: () => void dapStore.stop(),
        },
        { kind: 'sep' },
        {
          kind: 'item',
          label: 'Step Over',
          shortcut: 'F10',
          disabled: dapStore.state !== 'stopped',
          run: () => void dapStore.stepOver(),
        },
        {
          kind: 'item',
          label: 'Step Into',
          shortcut: 'F11',
          disabled: dapStore.state !== 'stopped',
          run: () => void dapStore.stepIn(),
        },
        {
          kind: 'item',
          label: 'Step Out',
          shortcut: `${shift}+F11`,
          disabled: dapStore.state !== 'stopped',
          run: () => void dapStore.stepOut(),
        },
        { kind: 'sep' },
        { kind: 'item', label: 'Problems', run: () => goto('problems') },
        { kind: 'item', label: 'Debug Panel', run: () => goto('debug') },
      ],
    },
    {
      id: 'go',
      label: 'Go',
      items: [
        { kind: 'item', label: 'Conversations', run: () => goto('conversations') },
        { kind: 'item', label: 'Files', run: () => goto('files') },
        { kind: 'item', label: 'Search', run: () => goto('search') },
        { kind: 'item', label: 'Work', run: () => goto('work') },
        { kind: 'item', label: 'Memory', run: () => goto('memory') },
        { kind: 'item', label: 'Agents', run: () => goto('agents') },
        { kind: 'sep' },
        {
          kind: 'sub',
          label: 'More',
          items: [
            { kind: 'item', label: 'Symbols', run: () => goto('symbols') },
            { kind: 'item', label: 'Todos', run: () => goto('todos') },
            { kind: 'item', label: 'Git', run: () => goto('git') },
            { kind: 'item', label: 'Git Graph', run: () => goto('git-graph') },
            { kind: 'item', label: 'Problems', run: () => goto('problems') },
            { kind: 'item', label: 'Debug', run: () => goto('debug') },
            { kind: 'item', label: 'Notes', run: () => goto('notes') },
            { kind: 'item', label: 'Artifacts', run: () => goto('artifacts') },
            { kind: 'item', label: 'Initiatives', run: () => goto('initiatives') },
            { kind: 'item', label: 'Learning', run: () => goto('learning') },
            { kind: 'item', label: 'Costs', run: () => goto('costs') },
            { kind: 'item', label: 'Ambient', run: () => goto('ambient') },
            { kind: 'item', label: 'Digest', run: () => goto('digest') },
            { kind: 'item', label: 'Command History', run: () => goto('command-history') },
          ],
        },
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      items: [
        {
          kind: 'item',
          label: 'Command Palette…',
          shortcut: `${mod}+K`,
          run: () => uiStore.openModal('command-palette'),
        },
        {
          kind: 'item',
          label: 'Keyboard Shortcuts…',
          run: () => uiStore.openModal('keybindings'),
        },
        { kind: 'sep' },
        { kind: 'item', label: 'MCP Servers', run: () => goto('mcp') },
        { kind: 'item', label: 'Custom Tools', run: () => goto('custom-tools') },
        { kind: 'item', label: 'Scripts', run: () => goto('scripts') },
        { kind: 'item', label: 'Manager', run: () => goto('manager') },
      ],
    },
    ...(isElectron
      ? ([
          {
            id: 'window',
            label: 'Window',
            items: [
              { kind: 'item' as const, label: 'Minimize', run: winMinimize },
              { kind: 'item' as const, label: 'Maximize / Restore', run: winToggleMaximize },
              { kind: 'sep' as const },
              { kind: 'item' as const, label: 'Close Window', run: winClose },
            ],
          },
        ] as Menu[])
      : []),
    {
      id: 'help',
      label: 'Help',
      items: [
        { kind: 'item', label: 'Help Panel', run: () => goto('help') },
        { kind: 'item', label: 'Documentation', run: () => goto('docs') },
        { kind: 'sep' },
        { kind: 'item', label: 'Welcome Tips', run: () => startupTipsStore.show() },
        {
          kind: 'item',
          label: 'Keyboard Shortcuts…',
          run: () => uiStore.openModal('keybindings'),
        },
      ],
    },
  ]);

  // ── Open-menu state ──
  let openMenuId = $state<string | null>(null);
  let openSubLabel = $state<string | null>(null);
  let barEl: HTMLDivElement | undefined = $state();

  function openMenu(id: string) {
    openMenuId = id;
    openSubLabel = null;
  }
  function closeAll() {
    openMenuId = null;
    openSubLabel = null;
  }
  function toggleMenu(id: string) {
    if (openMenuId === id) closeAll();
    else openMenu(id);
  }
  function handleTopHover(id: string) {
    // Only switch on hover if a menu is already open — matches OS behavior.
    if (openMenuId && openMenuId !== id) openMenu(id);
  }
  function runItem(item: Item) {
    if (item.kind !== 'item') return;
    if (item.disabled) return;
    closeAll();
    item.run();
  }

  // ── Outside-click + Escape ──
  function onDocPointerDown(e: PointerEvent) {
    if (!openMenuId) return;
    if (barEl && e.target instanceof Node && barEl.contains(e.target)) return;
    closeAll();
  }
  function onDocKeyDown(e: KeyboardEvent) {
    if (openMenuId && e.key === 'Escape') {
      e.preventDefault();
      closeAll();
    }
  }
  $effect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('keydown', onDocKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      document.removeEventListener('keydown', onDocKeyDown, true);
    };
  });
</script>

<div class="menubar" role="menubar" aria-label="Application" bind:this={barEl}>
  {#each menus as menu (menu.id)}
    <div class="slot">
      <button
        type="button"
        class="top"
        class:open={openMenuId === menu.id}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={openMenuId === menu.id}
        onclick={() => toggleMenu(menu.id)}
        onpointerenter={() => handleTopHover(menu.id)}
      >
        {menu.label}
      </button>

      {#if openMenuId === menu.id}
        <div class="dropdown" role="menu" aria-label={menu.label}>
          {#each menu.items as item, i (i)}
            {#if item.kind === 'sep'}
              <div class="sep" role="separator"></div>
            {:else if item.kind === 'sub'}
              <div
                class="row sub-row"
                role="menuitem"
                tabindex="-1"
                aria-haspopup="menu"
                aria-expanded={openSubLabel === item.label}
                onpointerenter={() => (openSubLabel = item.label)}
              >
                <span class="check"></span>
                <span class="label">{item.label}</span>
                <span class="chev">▸</span>

                {#if openSubLabel === item.label}
                  <div class="submenu" role="menu" aria-label={item.label}>
                    {#each item.items as sub, j (j)}
                      {#if sub.kind === 'sep'}
                        <div class="sep" role="separator"></div>
                      {:else if sub.kind === 'item'}
                        <button
                          type="button"
                          class="row"
                          class:disabled={sub.disabled}
                          role="menuitem"
                          disabled={sub.disabled}
                          onclick={() => runItem(sub)}
                        >
                          <span class="check">{sub.checked ? '✓' : ''}</span>
                          <span class="label">{sub.label}</span>
                          <span class="shortcut">{sub.shortcut ?? ''}</span>
                        </button>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            {:else}
              <button
                type="button"
                class="row"
                class:disabled={item.disabled}
                role="menuitem"
                disabled={item.disabled}
                onclick={() => runItem(item)}
                onpointerenter={() => (openSubLabel = null)}
              >
                <span class="check">{item.checked ? '✓' : ''}</span>
                <span class="label">{item.label}</span>
                <span class="shortcut">{item.shortcut ?? ''}</span>
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .menubar {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 0;
    padding: 0 8px;
    background: var(--bg-secondary, rgba(255, 255, 255, 0.02));
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    min-height: 28px;
    flex-shrink: 0;
    user-select: none;
    font-size: 12px;
  }

  /* Immersive hyperthemes — translucent treatment matching PanelColumn /
     PrimaryTabBar / TabGroupBar so the menubar sits visually with the
     themed chrome instead of floating opaquely above it. */
  :global([data-hypertheme='arcane']) .menubar,
  :global([data-hypertheme='ethereal']) .menubar,
  :global([data-hypertheme='astral']) .menubar,
  :global([data-hypertheme='astral-midnight']) .menubar {
    background: color-mix(in srgb, var(--bg-secondary, #1b1b1f) 60%, transparent);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  :global([data-hypertheme='study']) .menubar {
    background: transparent;
  }

  .top {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--fg-secondary, #c8c8c8);
    padding: 0 10px;
    height: 100%;
    cursor: pointer;
    font: inherit;
    line-height: 1;
    border-radius: 0;
  }
  .top:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
    color: var(--fg-primary, #f0f0f0);
  }
  .top:focus-visible {
    outline: 2px solid var(--accent-fg, #4ec1f5);
    outline-offset: -2px;
  }
  .top.open {
    background: var(--bg-selected, rgba(78, 193, 245, 0.18));
    color: var(--accent-fg, #4ec1f5);
  }

  .slot {
    position: relative;
    display: flex;
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 240px;
    padding: 4px 0;
    background: var(--bg-elevated, #232327);
    border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.12));
    border-radius: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 1000;
  }

  .row {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 12px;
    background: transparent;
    border: none;
    color: var(--fg-primary, #e6e6e6);
    cursor: pointer;
    font: inherit;
    text-align: left;
    position: relative;
  }
  .row:hover:not(.disabled),
  .sub-row[aria-expanded='true'] {
    background: var(--bg-selected, rgba(78, 193, 245, 0.18));
    color: var(--fg-primary, #fff);
  }
  .row.disabled {
    color: var(--fg-tertiary, #777);
    cursor: default;
  }
  .row.disabled .shortcut,
  .row.disabled .check {
    color: var(--fg-tertiary, #555);
  }
  .row:focus-visible {
    outline: none;
    background: var(--bg-selected, rgba(78, 193, 245, 0.18));
  }
  .check {
    color: var(--accent-fg, #4ec1f5);
    text-align: center;
    font-size: 11px;
  }
  .label {
    white-space: nowrap;
  }
  .shortcut,
  .chev {
    color: var(--fg-tertiary, #888);
    font-size: 11px;
    white-space: nowrap;
  }
  .sep {
    height: 1px;
    margin: 4px 8px;
    background: var(--border-subtle, rgba(255, 255, 255, 0.08));
  }

  .submenu {
    position: absolute;
    top: -5px;
    left: 100%;
    min-width: 220px;
    padding: 4px 0;
    background: var(--bg-elevated, #232327);
    border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.12));
    border-radius: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  /* Hide on mobile — the mobile shell has its own nav row + no real
     screen space for a menu bar. */
  @media (max-width: 768px) {
    .menubar {
      display: none;
    }
  }
</style>
