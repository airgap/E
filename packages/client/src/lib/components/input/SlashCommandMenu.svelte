<script lang="ts">
  import { getAllCommands } from '$lib/commands/slash-commands';

  let {
    query = '',
    onSelect,
    onClose,
  } = $props<{
    query: string;
    onSelect: (command: string) => void;
    onClose: () => void;
  }>();

  let filtered = $derived(
    getAllCommands().filter(
      (c) =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.description.toLowerCase().includes(query.toLowerCase()),
    ),
  );

  let selectedIndex = $state(0);

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      onSelect(filtered[selectedIndex].name);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="slash-menu" onclick={(e) => e.stopPropagation()}>
  {#if filtered.length === 0}
    <div class="no-results">No commands found</div>
  {:else}
    {#each filtered as cmd, i}
      <button
        class="slash-item"
        class:selected={i === selectedIndex}
        onclick={() => onSelect(cmd.name)}
        onmouseenter={() => (selectedIndex = i)}
      >
        <span class="cmd-name">/{cmd.name}</span>
        <span class="cmd-desc">{cmd.description}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .slash-menu {
    position: absolute;
    bottom: 100%;
    left: 24px;
    right: 24px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    max-height: 300px;
    overflow-y: auto;
    padding: 4px;
    z-index: 100;
  }

  .slash-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    text-align: left;
    transition: background var(--transition);
  }
  .slash-item:hover,
  .slash-item.selected {
    background: var(--bg-hover);
  }

  .cmd-name {
    font-weight: 600;
    color: var(--accent-primary);
    font-size: var(--fs-base);
    white-space: nowrap;
  }

  .cmd-desc {
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .no-results {
    padding: 12px;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
    text-align: center;
  }
</style>
