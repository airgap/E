<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import type { MobileView } from '$lib/stores/ui.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { SIDEBAR_TABS, getTabDef } from '$lib/config/sidebarTabs';

  /** Special (non-sidebar) views with their own icons */
  const SPECIAL_ICONS: Record<string, { label: string; icon: string }> = {
    chat: {
      label: 'Chat',
      icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    },
    terminal: { label: 'Terminal', icon: 'M4 17l6-6-6-6M12 19h8' },
  };

  const MORE_ITEM = {
    id: 'more' as const,
    label: 'More',
    icon: 'M4 6h4v4H4zM10 6h4v4h-4zM16 6h4v4h-4zM4 14h4v4H4zM10 14h4v4h-4zM16 14h4v4h-4z',
  };

  interface NavItem {
    id: MobileView | 'more';
    label: string;
    icon: string;
  }

  /** Resolve a tab id to its icon and label */
  function resolveTab(id: string): NavItem | null {
    // Special views
    if (SPECIAL_ICONS[id]) {
      return { id: id as MobileView, ...SPECIAL_ICONS[id] };
    }
    // Sidebar tab — look up from config
    const tab = SIDEBAR_TABS.find((t) => t.id === id);
    if (tab) {
      return { id: tab.id as MobileView, label: tab.label, icon: tab.icon };
    }
    return null;
  }

  /** Build nav items from settings — up to 10 user tabs + "More" always appended */
  const navItems = $derived.by(() => {
    const configured = settingsStore.mobileNavTabs.slice(0, 10);
    const items: NavItem[] = [];
    for (const id of configured) {
      const resolved = resolveTab(id);
      if (resolved) items.push(resolved);
    }
    items.push(MORE_ITEM);
    return items;
  });

  function isActive(item: NavItem): boolean {
    if (item.id === 'more') return uiStore.mobileMoreOpen;
    return uiStore.mobileActiveView === item.id;
  }

  function handleTap(item: NavItem) {
    if (item.id === 'more') {
      uiStore.setMobileMoreOpen(!uiStore.mobileMoreOpen);
    } else {
      uiStore.setMobileView(item.id as MobileView);
    }
  }
</script>

<nav class="mobile-nav-bar">
  {#each navItems as item (item.id)}
    <button class="mobile-nav-item" class:active={isActive(item)} onclick={() => handleTap(item)}>
      <svg
        class="mobile-nav-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d={item.icon} />
      </svg>
      <span class="mobile-nav-label">{item.label}</span>
    </button>
  {/each}
</nav>

<style>
  .mobile-nav-bar {
    display: flex;
    align-items: center;
    justify-content: space-around;
    height: var(--mobile-nav-height, 56px);
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-primary);
    padding-bottom: env(safe-area-inset-bottom);
    flex-shrink: 0;
    z-index: 10;
    position: relative;
  }

  .mobile-nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    flex: 1;
    padding: 6px 0;
    color: var(--text-tertiary);
    background: none;
    border: none;
    font-size: var(--fs-xxs);
    font-weight: 600;
    letter-spacing: 0.3px;
    transition: color var(--transition);
    position: relative;
    -webkit-tap-highlight-color: transparent;
    min-height: 44px;
    min-width: 0;
  }

  .mobile-nav-item.active {
    color: var(--accent-primary);
  }

  .mobile-nav-item.active::after {
    content: '';
    position: absolute;
    top: 0;
    left: 25%;
    right: 25%;
    height: 2px;
    background: var(--accent-primary);
    box-shadow: var(--shadow-glow-sm);
    border-radius: 0 0 1px 1px;
  }

  .mobile-nav-icon {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }

  .mobile-nav-label {
    line-height: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    padding: 0 2px;
  }
</style>
