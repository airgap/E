<script lang="ts">
  import type { Snippet } from 'svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import type { SidebarTab } from '$lib/stores/ui.svelte';
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import TopBar from './TopBar.svelte';
  import MainContent from './MainContent.svelte';
  import TerminalPanel from '../editor/TerminalPanel.svelte';
  import SidebarTabContent from '../sidebar/SidebarTabContent.svelte';
  import MobileNavBar from './MobileNavBar.svelte';
  import MobileMoreMenu from './MobileMoreMenu.svelte';

  let { children: appChildren }: { children: Snippet } = $props();

  const mobileView = $derived(uiStore.mobileActiveView);

  // Track whether terminal has ever been opened so we can keep its DOM alive
  let terminalEverOpened = $state(false);
  $effect(() => {
    if (mobileView === 'terminal') {
      terminalEverOpened = true;
      if (!terminalStore.isOpen) {
        terminalStore.open();
      }
    }
  });

  const isSidebarPanel = $derived(mobileView !== 'chat' && mobileView !== 'terminal');
</script>

<TopBar />

<div class="mobile-views">
  <!-- Chat view — kept alive to preserve scroll position -->
  <div class="mobile-view" class:active={mobileView === 'chat'}>
    <MainContent>
      {#snippet children()}
        {@render appChildren()}
      {/snippet}
    </MainContent>
  </div>

  <!-- Terminal view — kept alive to preserve xterm buffers -->
  <div class="mobile-view" class:active={mobileView === 'terminal'}>
    {#if terminalEverOpened}
      <TerminalPanel />
    {/if}
  </div>

  <!-- Sidebar panels — mount/unmount on switch (stateless enough) -->
  {#if isSidebarPanel}
    <div class="mobile-view active mobile-panel-wrapper">
      <SidebarTabContent tabId={mobileView as SidebarTab} />
    </div>
  {/if}
</div>

<MobileNavBar />

{#if uiStore.mobileMoreOpen}
  <MobileMoreMenu />
{/if}

<style>
  .mobile-views {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .mobile-view {
    display: none;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .mobile-view.active {
    display: flex;
  }

  .mobile-panel-wrapper {
    background: var(--bg-secondary);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
</style>
