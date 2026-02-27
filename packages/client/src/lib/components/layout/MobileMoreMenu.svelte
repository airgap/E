<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import type { MobileView } from '$lib/stores/ui.svelte';
  import { SIDEBAR_TABS } from '$lib/config/sidebarTabs';
  import { fly } from 'svelte/transition';

  const SPECIAL_VIEWS: Array<{ id: MobileView; label: string; icon: string }> = [
    {
      id: 'chat',
      label: 'Chat',
      icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: 'M4 17l6-6-6-6M12 19h8',
    },
  ];

  function handleSelect(view: MobileView) {
    uiStore.setMobileView(view);
  }

  function handleClose() {
    uiStore.setMobileMoreOpen(false);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="mobile-more-overlay"
  transition:fly={{ y: 300, duration: 200 }}
  onclick={(e) => {
    if (e.target === e.currentTarget) handleClose();
  }}
>
  <header class="mobile-more-header">
    <h2>Panels</h2>
    <button class="mobile-more-close" onclick={handleClose}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  </header>

  <div class="mobile-more-grid">
    {#each SPECIAL_VIEWS as view (view.id)}
      <button
        class="mobile-more-item"
        class:active={uiStore.mobileActiveView === view.id}
        onclick={() => handleSelect(view.id)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d={view.icon} />
        </svg>
        <span>{view.label}</span>
      </button>
    {/each}

    {#each SIDEBAR_TABS as tab (tab.id)}
      <button
        class="mobile-more-item"
        class:active={uiStore.mobileActiveView === tab.id}
        onclick={() => handleSelect(tab.id)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d={tab.icon} />
        </svg>
        <span>{tab.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .mobile-more-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--bg-primary);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }

  .mobile-more-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
    flex-shrink: 0;
  }

  .mobile-more-header h2 {
    font-size: var(--fs-xl);
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }

  .mobile-more-close {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
  }

  .mobile-more-close svg {
    width: 20px;
    height: 20px;
  }

  .mobile-more-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    padding: 8px 12px;
  }

  .mobile-more-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 16px 4px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    font-weight: 500;
    transition:
      color var(--transition),
      background var(--transition),
      border-color var(--transition);
    -webkit-tap-highlight-color: transparent;
    min-height: 44px;
    min-width: 44px;
  }

  .mobile-more-item:active {
    background: var(--bg-hover);
  }

  .mobile-more-item.active {
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
    border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
  }

  .mobile-more-item svg {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
  }

  .mobile-more-item span {
    line-height: 1.2;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
</style>
