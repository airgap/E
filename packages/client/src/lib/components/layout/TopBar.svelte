<script lang="ts">
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { deviceStore } from '$lib/stores/device.svelte';
  import WorkspaceTabBar from './WorkspaceTabBar.svelte';
  import WindowControls from './WindowControls.svelte';
  import RemoteSessionIndicator from '../common/RemoteSessionIndicator.svelte';

  // Window drag on Linux is handled natively in Rust via GTK button-press-event
  // (see setup_linux_drag in main.rs). On macOS/Windows, Tauri's built-in
  // data-tauri-drag-region handler works. No JS drag logic needed.
</script>

<header class="topbar" data-tauri-drag-region>
  <div class="topbar-left" data-tauri-drag-region>
    <WindowControls side="left" />
    {#if deviceStore.isMobileUI}
      <button
        class="icon-btn"
        onclick={() => uiStore.setMobileView('conversations')}
        title="Conversations"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="13" x2="13" y2="13" />
        </svg>
      </button>
    {:else}
      <button
        class="icon-btn"
        onclick={() => uiStore.toggleSidebar()}
        title="Toggle sidebar (Ctrl+/)"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>
    {/if}
    <WorkspaceTabBar />
  </div>

  <div class="topbar-center" data-tauri-drag-region>
    {#if conversationStore.active}
      <span class="conv-title truncate" data-tauri-drag-region
        >{conversationStore.active.title}</span
      >
    {/if}
  </div>

  <div class="topbar-right" data-tauri-drag-region>
    <RemoteSessionIndicator />

    {#if conversationStore.active?.planMode}
      <span class="mode-badge plan">PLAN MODE</span>
    {:else if conversationStore.active?.permissionMode === 'teach'}
      <span class="mode-badge teach">TEACH MODE</span>
    {/if}

    <button
      class="icon-btn"
      onclick={() => uiStore.setSidebarTab('help')}
      title="Help & Docs (?)"
      aria-label="Help and documentation"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
    </button>

    <button class="icon-btn" onclick={() => uiStore.openModal('settings')} title="Settings">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      </svg>
    </button>
    <WindowControls side="right" />
  </div>
</header>

<style>
  .topbar {
    height: var(--topbar-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: var(--bg-glass);
    border-bottom: var(--ht-separator);
    gap: 12px;
    flex-shrink: 0;
    z-index: 10;
    position: relative;
  }
  /* Topbar accent overlay — varies per hypertheme */
  .topbar::after {
    content: '';
    position: absolute;
    inset: 0;
    /* Tech default: scanlines */
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      var(--border-secondary) 2px,
      var(--border-secondary) 4px
    );
    pointer-events: none;
  }

  :global([data-hypertheme='arcane']) .topbar::after {
    background: linear-gradient(180deg, transparent 90%, var(--border-primary) 100%);
  }

  :global([data-hypertheme='ethereal']) .topbar::after {
    background: linear-gradient(180deg, transparent 92%, var(--border-secondary) 100%);
  }

  :global([data-hypertheme='study']) .topbar::after {
    background: linear-gradient(
      90deg,
      transparent 5%,
      rgba(228, 160, 60, 0.08) 50%,
      transparent 95%
    );
    border-bottom: none;
  }

  :global([data-hypertheme='astral']) .topbar::after,
  :global([data-hypertheme='astral-midnight']) .topbar::after {
    background:
      radial-gradient(0.5px 0.5px at 10% 50%, var(--border-primary), transparent),
      radial-gradient(0.5px 0.5px at 30% 30%, var(--border-secondary), transparent),
      radial-gradient(0.5px 0.5px at 50% 70%, var(--border-primary), transparent),
      radial-gradient(0.5px 0.5px at 70% 40%, var(--border-secondary), transparent),
      radial-gradient(0.5px 0.5px at 90% 60%, var(--border-primary), transparent);
  }

  .topbar-left,
  .topbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .topbar-center {
    flex: 1;
    text-align: center;
    min-width: 0;
  }

  .conv-title {
    color: var(--text-secondary);
    font-size: var(--fs-base);
    font-weight: 600;
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    display: block;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    border: 1px solid transparent;
    transition: all var(--transition);
  }
  .icon-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
    box-shadow: var(--shadow-glow-sm);
  }

  .mode-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 3px 10px;
    border-radius: var(--radius);
    color: var(--text-on-accent);
    letter-spacing: var(--ht-label-spacing);
    text-transform: var(--ht-label-transform);
    animation: hudBlink 3s infinite;
  }
  .mode-badge.plan {
    background: var(--accent-warning);
  }
  .mode-badge.teach {
    background: var(--accent-secondary, #10b981);
  }

  /* ── Mobile overrides ── */
  :global([data-mobile]) .topbar {
    padding: 0 10px;
    gap: 6px;
  }
  /* Hide items that don't fit / aren't useful on mobile */
  :global([data-mobile]) .mode-badge {
    display: none;
  }
  /* Topbar left: let workspace tabs shrink but don't clip dropdown */
  :global([data-mobile]) .topbar-left {
    flex: 1;
    min-width: 0;
    overflow: visible;
  }
  :global([data-mobile]) .topbar-right {
    flex-shrink: 0;
    gap: 4px;
  }
</style>
