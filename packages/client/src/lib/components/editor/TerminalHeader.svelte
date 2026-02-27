<script lang="ts">
  import TerminalTabBar from './TerminalTabBar.svelte';
  import TerminalActions from './TerminalActions.svelte';
</script>

<div class="terminal-header" role="toolbar" aria-label="Terminal controls">
  <TerminalTabBar />
  <TerminalActions />
</div>

<style>
  .terminal-header {
    display: flex;
    align-items: stretch;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
    flex-shrink: 0;
    height: 32px;
    overflow: hidden;
  }
</style>
