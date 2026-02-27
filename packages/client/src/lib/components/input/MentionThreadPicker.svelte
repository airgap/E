<script lang="ts">
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import type { ConversationSummary } from '@e/shared';
  import { onMount } from 'svelte';

  let { onSelect, onClose } = $props<{
    onSelect: (conv: ConversationSummary) => void;
    onClose: () => void;
  }>();

  let searchQuery = $state('');
  let selectedIndex = $state(0);
  let searchInput = $state<HTMLInputElement>();

  onMount(() => {
    searchInput?.focus();
  });

  let threads = $derived(conversationStore.list.filter((c) => c.id !== conversationStore.activeId));

  let filtered = $derived(
    searchQuery.trim()
      ? threads.filter((c) => {
          const q = searchQuery.toLowerCase();
          return (
            c.title.toLowerCase().includes(q) ||
            (c.compactSummary && c.compactSummary.toLowerCase().includes(q))
          );
        })
      : threads,
  );

  function formatDate(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  }

  function getSummarySnippet(conv: ConversationSummary): string | null {
    if (!conv.compactSummary) return null;
    // Return first 80 chars of summary as a preview
    const text = conv.compactSummary.trim();
    return text.length > 80 ? text.slice(0, 80) + '…' : text;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      onSelect(filtered[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="thread-picker" onclick={(e) => e.stopPropagation()}>
  <div class="picker-header">
    <span class="picker-title"
      ><svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg
      > Select Thread</span
    >
    <button class="picker-close" onclick={onClose}>×</button>
  </div>
  <div class="search-wrap">
    <input
      bind:this={searchInput}
      bind:value={searchQuery}
      oninput={() => (selectedIndex = 0)}
      placeholder="Search conversations…"
      class="search-input"
    />
  </div>
  <div class="picker-list">
    {#if filtered.length === 0}
      <div class="picker-empty">
        {threads.length === 0 ? 'No prior conversations found' : 'No matching conversations'}
      </div>
    {:else}
      {#each filtered as conv, i}
        {@const snippet = getSummarySnippet(conv)}
        <button
          class="picker-item"
          class:selected={i === selectedIndex}
          onclick={() => onSelect(conv)}
          onmouseenter={() => (selectedIndex = i)}
        >
          <span class="thread-icon"
            ><svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg
            ></span
          >
          <span class="thread-body">
            <span class="thread-title">{conv.title || 'Untitled'}</span>
            {#if snippet}
              <span class="thread-snippet">{snippet}</span>
            {/if}
          </span>
          <span class="thread-meta">
            {conv.messageCount} msgs · {formatDate(conv.updatedAt)}
          </span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .thread-picker {
    position: absolute;
    bottom: 100%;
    left: 24px;
    right: 24px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    z-index: 100;
    display: flex;
    flex-direction: column;
    max-height: 340px;
  }

  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 4px;
    border-bottom: 1px solid var(--border-primary);
  }

  .picker-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--accent-primary);
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .picker-close {
    color: var(--text-tertiary);
    font-size: var(--fs-xl);
    line-height: 1;
    padding: 0 4px;
  }
  .picker-close:hover {
    color: var(--text-primary);
  }

  .search-wrap {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-primary);
  }

  .search-input {
    width: 100%;
    font-size: var(--fs-sm);
    padding: 5px 10px;
    background: var(--bg-input);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    outline: none;
  }
  .search-input:focus {
    border-color: var(--accent-primary);
  }

  .picker-list {
    overflow-y: auto;
    flex: 1;
    padding: 4px;
  }

  .picker-empty {
    padding: 12px;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
    text-align: center;
  }

  .picker-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 6px 12px;
    border-radius: var(--radius-sm);
    text-align: left;
    font-size: var(--fs-sm);
    transition: background var(--transition);
    color: var(--text-secondary);
  }
  .picker-item:hover,
  .picker-item.selected {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .thread-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
    margin-top: 1px;
  }

  .thread-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .thread-title {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thread-snippet {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-style: italic;
  }

  .thread-meta {
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
    flex-shrink: 0;
    white-space: nowrap;
    margin-top: 1px;
  }
</style>
