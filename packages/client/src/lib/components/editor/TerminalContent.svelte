<script lang="ts">
  import { terminalStore } from '$lib/stores/terminal.svelte';
  import TerminalSplitPane from './TerminalSplitPane.svelte';
</script>

<div class="terminal-content">
  {#each terminalStore.tabs as tab (tab.id)}
    {@const isActive = tab.id === terminalStore.activeTabId}
    <div
      class="tab-pane"
      class:hidden={!isActive}
      role="tabpanel"
      id="terminal-tabpanel-{tab.id}"
      aria-labelledby="terminal-tab-{tab.id}"
      tabindex="0"
    >
      <TerminalSplitPane
        layout={tab.layout}
        focusedSessionId={tab.focusedSessionId}
        active={isActive}
      />
    </div>
  {/each}

  {#if terminalStore.tabs.length === 0}
    <div class="empty-state" role="status">
      <span class="empty-text">No terminal sessions</span>
    </div>
  {/if}
</div>

<style>
  .terminal-content {
    flex: 1;
    min-height: 0;
    display: flex;
    position: relative;
    overflow: hidden;
  }

  .tab-pane {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .tab-pane.hidden {
    display: none;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
  }

  .empty-text {
    opacity: 0.6;
  }
</style>
