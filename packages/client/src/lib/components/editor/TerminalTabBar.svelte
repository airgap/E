<script lang="ts">
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import type { TerminalTab } from '@e/shared';

  /** Get the display label for a tab — use CWD directory name if available */
  function getTabDisplayLabel(tab: TerminalTab): string {
    const meta = terminalStore.sessions.get(tab.focusedSessionId);
    if (meta?.cwd) {
      // Extract directory name from path (last component)
      const parts = meta.cwd.replace(/\/+$/, '').split('/');
      const dirName = parts[parts.length - 1];
      if (dirName) return dirName;
    }
    return tab.label;
  }

  let dropdownOpen = $state(false);
  let editingTabId = $state<string | null>(null);
  let editValue = $state('');

  // Split profiles into auto-detected and custom
  const autoProfiles = $derived(terminalStore.profiles.filter((p) => p.isAutoDetected));
  const customProfiles = $derived(terminalStore.profiles.filter((p) => !p.isAutoDetected));
  const defaultProfileId = $derived(settingsStore.termDefaultProfileId);

  function activateTab(tabId: string) {
    terminalStore.activateTab(tabId);
  }

  function closeTab(e: MouseEvent, tabId: string) {
    e.stopPropagation();
    terminalStore.closeTab(tabId);
    // After closing, focus moves to the newly active tab
    requestAnimationFrame(() => {
      const newActiveId = terminalStore.activeTabId;
      if (newActiveId) {
        const el = document.getElementById(`terminal-tab-${newActiveId}`);
        el?.focus();
      }
    });
  }

  function startRename(e: MouseEvent, tab: TerminalTab) {
    e.preventDefault();
    e.stopPropagation();
    editingTabId = tab.id;
    editValue = tab.label;
  }

  function commitRename() {
    if (editingTabId && editValue.trim()) {
      terminalStore.renameTab(editingTabId, editValue.trim());
    }
    editingTabId = null;
    editValue = '';
  }

  function cancelRename() {
    editingTabId = null;
    editValue = '';
  }

  function onRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  function addTab(profileId?: string) {
    terminalStore.createTab(profileId);
    dropdownOpen = false;
    // Focus the newly created tab after DOM updates
    requestAnimationFrame(() => {
      const newActiveId = terminalStore.activeTabId;
      if (newActiveId) {
        const el = document.getElementById(`terminal-tab-${newActiveId}`);
        el?.focus();
      }
    });
  }

  function addDefaultTab() {
    // Use the default profile if one is set
    if (defaultProfileId) {
      addTab(defaultProfileId);
    } else {
      addTab();
    }
  }

  function toggleDropdown(e: MouseEvent) {
    e.stopPropagation();
    dropdownOpen = !dropdownOpen;
    if (dropdownOpen) {
      // Focus first menu item when dropdown opens
      requestAnimationFrame(() => {
        const firstItem = document.querySelector(
          '.shell-dropdown [role="menuitem"]',
        ) as HTMLElement;
        firstItem?.focus();
      });
    }
  }

  function closeDropdown() {
    dropdownOpen = false;
  }

  /**
   * Handle keyboard navigation within the shell profile dropdown.
   * Implements WAI-ARIA menu pattern: ArrowDown/ArrowUp to move,
   * Home/End for first/last, Escape to close.
   */
  function onDropdownKeydown(e: KeyboardEvent) {
    const items = Array.from(
      document.querySelectorAll('.shell-dropdown [role="menuitem"]'),
    ) as HTMLElement[];
    if (items.length === 0) return;

    const currentIndex = items.findIndex((el) => el === document.activeElement);

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items[next].focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        items[prev].focus();
        break;
      }
      case 'Home': {
        e.preventDefault();
        items[0].focus();
        break;
      }
      case 'End': {
        e.preventDefault();
        items[items.length - 1].focus();
        break;
      }
      case 'Escape': {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
        // Return focus to the add button
        const addBtn = document.querySelector('.add-tab-btn') as HTMLElement;
        addBtn?.focus();
        break;
      }
    }
  }

  /**
   * Focus management: when active tab changes (create, close, switch),
   * move DOM focus to the newly active tab element for keyboard users.
   */
  $effect(() => {
    const id = terminalStore.activeTabId;
    if (!id) return;
    // Schedule focus after DOM update
    requestAnimationFrame(() => {
      const el = document.getElementById(`terminal-tab-${id}`);
      // Only move focus if a tab element currently has focus (keyboard navigation)
      // or if no element is focused (tab was just closed)
      if (
        el &&
        (!document.activeElement ||
          document.activeElement === document.body ||
          document.activeElement?.getAttribute('role') === 'tab')
      ) {
        el.focus();
      }
    });
  });
</script>

<svelte:window onclick={closeDropdown} />

<div class="terminal-tab-bar">
  <div class="tabs-scroll" role="tablist" aria-label="Terminal tabs">
    {#each terminalStore.tabs as tab, tabIndex (tab.id)}
      {@const isActive = tab.id === terminalStore.activeTabId}
      {@const isEditing = tab.id === editingTabId}
      {@const isBroadcasting = terminalStore.isBroadcastActiveForTab(tab.id)}
      {@const isLogging = terminalStore.isLogging(tab.focusedSessionId)}
      {@const isAgent = terminalStore.isAgentTab(tab.id)}

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="term-tab"
        class:active={isActive}
        class:broadcasting={isBroadcasting}
        class:agent-tab={isAgent}
        onclick={() => activateTab(tab.id)}
        ondblclick={(e) => startRename(e, tab)}
        role="tab"
        id="terminal-tab-{tab.id}"
        tabindex={isActive ? 0 : -1}
        aria-selected={isActive}
        aria-controls="terminal-tabpanel-{tab.id}"
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activateTab(tab.id);
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIdx = (tabIndex + 1) % terminalStore.tabs.length;
            const nextTab = document.getElementById(
              `terminal-tab-${terminalStore.tabs[nextIdx].id}`,
            );
            nextTab?.focus();
            activateTab(terminalStore.tabs[nextIdx].id);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            const prevIdx = (tabIndex - 1 + terminalStore.tabs.length) % terminalStore.tabs.length;
            const prevTab = document.getElementById(
              `terminal-tab-${terminalStore.tabs[prevIdx].id}`,
            );
            prevTab?.focus();
            activateTab(terminalStore.tabs[prevIdx].id);
          } else if (e.key === 'Home') {
            e.preventDefault();
            const firstTab = document.getElementById(`terminal-tab-${terminalStore.tabs[0].id}`);
            firstTab?.focus();
            activateTab(terminalStore.tabs[0].id);
          } else if (e.key === 'End') {
            e.preventDefault();
            const lastTab = document.getElementById(
              `terminal-tab-${terminalStore.tabs[terminalStore.tabs.length - 1].id}`,
            );
            lastTab?.focus();
            activateTab(terminalStore.tabs[terminalStore.tabs.length - 1].id);
          } else if (e.key === 'Delete') {
            e.preventDefault();
            terminalStore.closeTab(tab.id);
          }
        }}
      >
        {#if isAgent}
          <svg
            class="agent-icon"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-label="Agent terminal"
          >
            <rect x="3" y="4" width="18" height="12" rx="2" /><line
              x1="8"
              y1="20"
              x2="16"
              y2="20"
            /><line x1="12" y1="16" x2="12" y2="20" /><circle
              cx="9"
              cy="10"
              r="1.5"
              fill="currentColor"
            /><circle cx="15" cy="10" r="1.5" fill="currentColor" />
          </svg>
        {:else if isBroadcasting}
          <svg
            class="broadcast-badge"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            aria-label="Broadcast input active"
          >
            <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
          </svg>
        {:else}
          <svg
            class="shell-icon"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        {/if}

        {#if isEditing}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="tab-rename-input"
            type="text"
            bind:value={editValue}
            onblur={commitRename}
            onkeydown={onRenameKeydown}
            onclick={(e) => e.stopPropagation()}
            autofocus
          />
        {:else}
          <span
            class="tab-label"
            title={terminalStore.sessions.get(tab.focusedSessionId)?.cwd || tab.label}
            >{getTabDisplayLabel(tab)}</span
          >
        {/if}

        {#if isLogging}
          <span
            class="logging-indicator"
            title="Session logging active"
            aria-label="Session logging active"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
              <circle cx="4" cy="4" r="4" fill="currentColor" />
            </svg>
          </span>
        {/if}

        <button
          class="tab-close-btn"
          onclick={(e) => closeTab(e, tab.id)}
          aria-label="Close {tab.label}"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/each}
  </div>

  <div class="add-tab-wrapper">
    <button
      class="add-tab-btn"
      onclick={toggleDropdown}
      aria-label="New terminal"
      title="New terminal"
      aria-haspopup="menu"
      aria-expanded={dropdownOpen}
      onkeydown={(e) => {
        if (e.key === 'Escape' && dropdownOpen) {
          e.preventDefault();
          e.stopPropagation();
          closeDropdown();
        } else if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !dropdownOpen) {
          e.preventDefault();
          dropdownOpen = true;
          requestAnimationFrame(() => {
            const firstItem = document.querySelector(
              '.shell-dropdown [role="menuitem"]',
            ) as HTMLElement;
            firstItem?.focus();
          });
        }
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>

    {#if dropdownOpen}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="shell-dropdown"
        role="menu"
        aria-label="Shell profiles"
        onclick={(e) => e.stopPropagation()}
        onkeydown={onDropdownKeydown}
      >
        <!-- Default / plain shell -->
        <button class="shell-option" role="menuitem" onclick={() => addDefaultTab()}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span class="option-label">Default Shell</span>
          {#if !defaultProfileId}
            <span class="default-badge">default</span>
          {/if}
        </button>

        <!-- Auto-detected shells -->
        {#if autoProfiles.length > 0}
          <div class="dropdown-separator"></div>
          <div class="dropdown-section-label">Detected Shells</div>
          {#each autoProfiles as profile (profile.id)}
            <button class="shell-option" role="menuitem" onclick={() => addTab(profile.id)}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span class="option-label">{profile.name}</span>
              {#if defaultProfileId === profile.id}
                <span class="default-badge">default</span>
              {/if}
            </button>
          {/each}
        {/if}

        <!-- Custom profiles -->
        {#if customProfiles.length > 0}
          <div class="dropdown-separator"></div>
          <div class="dropdown-section-label">Custom Profiles</div>
          {#each customProfiles as profile (profile.id)}
            <button class="shell-option" role="menuitem" onclick={() => addTab(profile.id)}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                {#if profile.icon === 'code'}
                  <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                {:else if profile.icon === 'server'}
                  <rect x="2" y="2" width="20" height="8" rx="2" /><rect
                    x="2"
                    y="14"
                    width="20"
                    height="8"
                    rx="2"
                  /><circle cx="6" cy="6" r="1" fill="currentColor" /><circle
                    cx="6"
                    cy="18"
                    r="1"
                    fill="currentColor"
                  />
                {:else}
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                {/if}
              </svg>
              <span class="option-label">{profile.name}</span>
              {#if defaultProfileId === profile.id}
                <span class="default-badge">default</span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .terminal-tab-bar {
    display: flex;
    align-items: stretch;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .tabs-scroll {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    flex: 1;
    min-width: 0;
  }
  .tabs-scroll::-webkit-scrollbar {
    display: none;
  }

  /* ── Tab ── */
  .term-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 6px 0 8px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    border-right: 1px solid var(--border-secondary);
    background: transparent;
    white-space: nowrap;
    transition:
      background var(--transition),
      color var(--transition);
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
    min-width: 0;
    height: 100%;
  }
  .term-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .term-tab.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    border-bottom: 2px solid var(--accent-primary);
    margin-bottom: -1px;
  }
  .term-tab:focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: -2px;
  }
  .term-tab:focus:not(:focus-visible) {
    outline: none;
  }

  .shell-icon {
    flex-shrink: 0;
    opacity: 0.5;
  }
  .term-tab.active .shell-icon {
    opacity: 0.9;
    color: var(--accent-primary);
  }

  /* ── Agent tab ── */
  .agent-icon {
    flex-shrink: 0;
    color: var(--accent-info, #56d4dd);
    opacity: 0.9;
  }
  .term-tab.agent-tab {
    border-left: 2px solid var(--accent-info, #56d4dd);
  }
  .term-tab.agent-tab.active {
    border-bottom-color: var(--accent-info, #56d4dd);
  }
  .term-tab.agent-tab .tab-label {
    color: var(--accent-info, #56d4dd);
  }
  .term-tab.agent-tab.active .agent-icon {
    color: var(--accent-info, #56d4dd);
  }

  /* ── Broadcast indicator ── */
  .broadcast-badge {
    flex-shrink: 0;
    color: var(--accent-warning, #ffaa00);
    opacity: 0.9;
  }
  .term-tab.broadcasting {
    border-left: 2px solid var(--accent-warning, #ffaa00);
  }
  .term-tab.broadcasting.active {
    border-bottom-color: var(--accent-warning, #ffaa00);
  }

  .tab-label {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Logging indicator ── */
  .logging-indicator {
    flex-shrink: 0;
    color: var(--accent-error, #ff3344);
    display: flex;
    align-items: center;
    animation: logging-pulse 2s ease-in-out infinite;
  }

  @keyframes logging-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  .tab-rename-input {
    width: 80px;
    background: var(--bg-input);
    border: 1px solid var(--border-focus);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--fs-xs);
    padding: 1px 4px;
    outline: none;
    font-family: inherit;
  }

  /* ── Close button ── */
  .tab-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    color: var(--text-tertiary);
    opacity: 0;
    transition:
      opacity var(--transition),
      background var(--transition),
      color var(--transition);
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
  }
  .tab-close-btn svg {
    width: 10px;
    height: 10px;
  }
  .term-tab:hover .tab-close-btn {
    opacity: 1;
  }
  .tab-close-btn:hover {
    background: color-mix(in srgb, var(--accent-error) 18%, var(--bg-active));
    color: var(--accent-error);
  }
  .tab-close-btn:focus-visible {
    opacity: 1;
    outline: 2px solid var(--border-focus);
    outline-offset: -1px;
  }

  /* ── Add tab button ── */
  .add-tab-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .add-tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition:
      color var(--transition),
      background var(--transition);
    padding: 0;
  }
  .add-tab-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .add-tab-btn:focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: -2px;
  }

  /* ── Shell profile dropdown ── */
  .shell-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 100;
    min-width: 200px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.4));
    padding: 4px;
    margin-top: 2px;
  }

  .shell-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
    text-align: left;
    transition:
      background var(--transition),
      color var(--transition);
    white-space: nowrap;
  }
  .shell-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .option-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .default-badge {
    font-size: var(--fs-sans-xs);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent-primary) 20%, transparent);
    color: var(--accent-primary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }

  .dropdown-separator {
    height: 1px;
    background: var(--border-secondary);
    margin: 4px 6px;
  }

  .dropdown-section-label {
    font-size: var(--fs-sans-xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 4px 10px 2px;
    user-select: none;
  }
</style>
