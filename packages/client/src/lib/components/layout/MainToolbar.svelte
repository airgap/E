<script lang="ts">
  /**
   * MainToolbar — horizontal action bar between the TopBar (titlebar) and
   * the workspace body. Holds the file/view actions you reach for most
   * often, plus an always-visible command-palette trigger so the keybinding
   * is permanently discoverable. Hidden in Zen Mode like the rest of the
   * chrome (gated by the caller in AppShell).
   *
   * Layout: three groups with separators between, command palette pinned
   * right. Each button is icon + tooltip; the tooltip carries the
   * keyboard shortcut so users can graduate to muscle memory.
   */
  import { uiStore } from '$lib/stores/ui.svelte';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';

  function newConversation() {
    conversationStore.setActive(null);
    conversationStore.createDraft();
    uiStore.focusChatInput();
  }

  function quickOpen() {
    uiStore.openModal('quick-open');
  }

  function commandPalette() {
    uiStore.openModal('command-palette');
  }

  function searchFiles() {
    uiStore.setSidebarTab('search');
  }

  function toggleSplit() {
    if (editorStore.layoutMode === 'split-horizontal') {
      editorStore.setLayoutMode('chat-only');
    } else {
      editorStore.setLayoutMode('split-horizontal');
    }
  }

  // Display modifier — Mac shows ⌘, others show Ctrl. Pure cosmetic; the
  // actual keybinding handler in AppShell accepts both metaKey + ctrlKey.
  const mod = (() => {
    if (typeof navigator === 'undefined') return 'Ctrl';
    return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  })();
</script>

<div class="main-toolbar" role="toolbar" aria-label="Main">
  <!-- Group 1: File / chat actions -->
  <div class="group">
    <button class="tb-btn" onclick={newConversation} title="New conversation">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <line x1="12" y1="8" x2="12" y2="14" />
        <line x1="9" y1="11" x2="15" y2="11" />
      </svg>
    </button>
    <button class="tb-btn" onclick={quickOpen} title="Open file ({mod}+P)">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    </button>
    <button class="tb-btn" onclick={searchFiles} title="Search across files ({mod}+Shift+F)">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    </button>
  </div>

  <span class="sep" aria-hidden="true"></span>

  <!-- Group 2: View toggles -->
  <div class="group">
    <button
      class="tb-btn"
      class:active={uiStore.sidebarOpen}
      onclick={() => uiStore.toggleSidebar()}
      title="Toggle sidebar ({mod}+/)"
      aria-pressed={uiStore.sidebarOpen}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
      </svg>
    </button>
    <button
      class="tb-btn"
      class:active={terminalStore.isOpen}
      onclick={() => terminalStore.toggle()}
      title="Toggle terminal"
      aria-pressed={terminalStore.isOpen}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    </button>
    <button
      class="tb-btn"
      class:active={editorStore.layoutMode === 'split-horizontal'}
      onclick={toggleSplit}
      title="Toggle split pane ({mod}+\)"
      aria-pressed={editorStore.layoutMode === 'split-horizontal'}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="12" y1="3" x2="12" y2="21" />
      </svg>
    </button>
    <button
      class="tb-btn"
      class:active={uiStore.zenMode}
      onclick={() => uiStore.toggleZenMode()}
      title="Toggle Zen Mode ({mod}+Alt+Z)"
      aria-pressed={uiStore.zenMode}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <!-- Crescent moon — universal "focus / quiet" icon -->
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  </div>

  <span class="spacer" aria-hidden="true"></span>

  <!-- Group 3: Command palette pill (right-aligned) -->
  <button class="palette-pill" onclick={commandPalette} title="Command palette">
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
    <span class="palette-label">Command…</span>
    <kbd>{mod}K</kbd>
  </button>
</div>

<style>
  .main-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    background: var(--bg-secondary, rgba(255, 255, 255, 0.02));
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    min-height: 32px;
    flex-shrink: 0;
    user-select: none;
  }

  /* Immersive hyperthemes — same translucent treatment as PanelColumn /
     PrimaryTabBar / TabGroupBar so the toolbar sits visually with the
     themed chrome instead of floating opaquely above it. */
  :global([data-hypertheme='arcane']) .main-toolbar,
  :global([data-hypertheme='ethereal']) .main-toolbar,
  :global([data-hypertheme='astral']) .main-toolbar,
  :global([data-hypertheme='astral-midnight']) .main-toolbar {
    background: color-mix(in srgb, var(--bg-secondary, #1b1b1f) 60%, transparent);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  :global([data-hypertheme='study']) .main-toolbar {
    background: transparent;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .sep {
    width: 1px;
    height: 16px;
    background: var(--border-subtle, rgba(255, 255, 255, 0.1));
    margin: 0 6px;
  }

  .spacer {
    flex: 1;
  }

  .tb-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--fg-secondary, #aaa);
    border-radius: 4px;
    cursor: pointer;
    transition:
      background-color 100ms ease,
      color 100ms ease;
  }
  .tb-btn:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
    color: var(--fg-primary, #d4d4d4);
  }
  .tb-btn:focus-visible {
    outline: 2px solid var(--accent-fg, #4ec1f5);
    outline-offset: 1px;
  }
  .tb-btn.active {
    background: var(--bg-selected, rgba(78, 193, 245, 0.15));
    color: var(--accent-fg, #4ec1f5);
  }

  .palette-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 12px;
    color: var(--fg-secondary, #aaa);
    font-size: 11px;
    cursor: pointer;
    transition:
      background-color 100ms ease,
      border-color 100ms ease;
    min-width: 180px;
  }
  .palette-pill:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.08));
    border-color: var(--border-strong, rgba(255, 255, 255, 0.15));
    color: var(--fg-primary, #d4d4d4);
  }
  .palette-label {
    flex: 1;
    text-align: left;
  }
  .palette-pill kbd {
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
    font-size: 10px;
    background: var(--bg-primary, rgba(0, 0, 0, 0.2));
    padding: 1px 6px;
    border-radius: 3px;
    color: var(--fg-tertiary, #888);
  }

  /* Hide on mobile — the mobile shell has its own nav row + no real
     screen space for a secondary toolbar. */
  @media (max-width: 768px) {
    .main-toolbar {
      display: none;
    }
  }
</style>
