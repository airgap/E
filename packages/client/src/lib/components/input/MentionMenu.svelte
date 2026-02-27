<script lang="ts">
  export interface MentionType {
    id: 'file' | 'symbol' | 'diagnostics' | 'rule' | 'thread';
    label: string;
    description: string;
    iconPath: string;
  }

  const MENTION_TYPES: MentionType[] = [
    {
      id: 'file',
      label: '@file',
      description: 'Inject file content as context',
      iconPath: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
    },
    {
      id: 'symbol',
      label: '@symbol',
      description: 'Inject symbol definition from code',
      iconPath: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    },
    {
      id: 'diagnostics',
      label: '@diagnostics',
      description: 'Inject all LSP errors & warnings',
      iconPath: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M12 8v4 M12 16h.01',
    },
    {
      id: 'rule',
      label: '@rule',
      description: 'Inject an on-demand rule from Rules Library',
      iconPath:
        'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M15 2H9a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z',
    },
    {
      id: 'thread',
      label: '@thread',
      description: 'Inject a prior conversation summary',
      iconPath: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    },
  ];

  let {
    query = '',
    onSelect,
    onClose,
  } = $props<{
    query: string;
    onSelect: (type: MentionType['id']) => void;
    onClose: () => void;
  }>();

  let filtered = $derived(
    MENTION_TYPES.filter(
      (m) =>
        m.id.toLowerCase().includes(query.toLowerCase()) ||
        m.description.toLowerCase().includes(query.toLowerCase()),
    ),
  );

  let selectedIndex = $state(0);

  $effect(() => {
    // Reset index when filter changes
    void query;
    selectedIndex = 0;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      onSelect(filtered[selectedIndex].id);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mention-menu" onclick={(e) => e.stopPropagation()}>
  {#if filtered.length === 0}
    <div class="no-results">No mention types found</div>
  {:else}
    {#each filtered as type, i}
      <button
        class="mention-item"
        class:selected={i === selectedIndex}
        onclick={() => onSelect(type.id)}
        onmouseenter={() => (selectedIndex = i)}
      >
        <span class="mention-icon"
          ><svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d={type.iconPath} /></svg
          ></span
        >
        <span class="mention-label">{type.label}</span>
        <span class="mention-desc">{type.description}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .mention-menu {
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

  .mention-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    text-align: left;
    transition: background var(--transition);
  }
  .mention-item:hover,
  .mention-item.selected {
    background: var(--bg-hover);
  }

  .mention-icon {
    flex-shrink: 0;
    width: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
  }

  .mention-label {
    font-weight: 600;
    color: var(--accent-primary);
    font-size: var(--fs-base);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .mention-desc {
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
