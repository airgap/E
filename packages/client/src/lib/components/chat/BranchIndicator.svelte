<script lang="ts">
  import { api } from '$lib/api/client';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { streamStore } from '$lib/stores/stream.svelte';
  import { primaryPaneStore } from '$lib/stores/primaryPane.svelte';
  import { messageSyncStore } from '$lib/stores/message-sync.svelte';

  let { conversationId, messageId } = $props<{
    conversationId: string;
    messageId: string;
  }>();

  let branches = $state<Array<{ id: string; title: string; created_at: number }>>([]);
  let expanded = $state(false);
  let loading = $state(false);

  // Load branches for this message
  $effect(() => {
    if (conversationId && messageId) {
      loadBranches();
    }
  });

  async function loadBranches() {
    try {
      const res = await api.conversations.branchesAt(conversationId, messageId);
      if (res.ok && res.data) {
        branches = res.data;
      }
    } catch {
      // Silently fail — not critical
    }
  }

  async function switchBranch(branchId: string) {
    loading = true;
    try {
      const res = await api.conversations.get(branchId);
      if (res.ok && res.data) {
        conversationStore.setActive(res.data);
        messageSyncStore.subscribe(branchId);
        primaryPaneStore.openConversation(res.data.id, res.data.title ?? 'Conversation');
        if (!streamStore.isStreaming) {
          streamStore.reset();
        }
      }
    } finally {
      loading = false;
    }
  }
</script>

{#if branches.length > 0}
  <div class="branch-indicator">
    <button
      class="branch-toggle"
      onclick={() => (expanded = !expanded)}
      title="{branches.length} branch(es) from this point"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M6 12a6 6 0 0 0 12-6" />
      </svg>
      <span class="branch-count">{branches.length}</span>
      <svg
        class="branch-chevron"
        class:expanded
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    {#if expanded}
      <div class="branch-list">
        {#each branches as branch}
          <button class="branch-item" onclick={() => switchBranch(branch.id)} disabled={loading}>
            <span class="branch-title">{branch.title}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .branch-indicator {
    margin: 2px 0 4px 48px;
  }
  .branch-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    font-size: var(--fs-xs);
    color: var(--accent-secondary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition);
    font-weight: 600;
  }
  .branch-toggle:hover {
    background: var(--bg-hover);
    border-color: var(--accent-secondary);
  }
  .branch-count {
    font-variant-numeric: tabular-nums;
  }
  .branch-chevron {
    transition: transform 0.15s ease;
  }
  .branch-chevron.expanded {
    transform: rotate(180deg);
  }
  .branch-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
    padding: 4px 0;
    border-left: 2px solid var(--border-secondary);
    margin-left: 6px;
  }
  .branch-item {
    display: block;
    text-align: left;
    padding: 5px 12px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    transition: all var(--transition);
    cursor: pointer;
    border: none;
    background: none;
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .branch-item:hover {
    background: var(--bg-hover);
    color: var(--accent-primary);
  }
  .branch-item:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .branch-title {
    font-weight: 500;
  }
</style>
