<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';

  let { conversationId }: { conversationId: string | null } = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let history = $state<any[]>([]);

  async function loadHistory() {
    loading = true;
    error = null;
    try {
      if (conversationId) {
        const res = await api.conversations.compactionHistory(conversationId);
        history = res.data;
      } else {
        const res = await api.conversations.recentCompactions(50);
        history = res.data;
      }
    } catch (e: any) {
      error = e.message || 'Failed to load compaction history';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadHistory();
  });

  function formatDate(timestamp: number): string {
    const d = new Date(timestamp);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function close() {
    uiStore.closeModal();
  }
</script>

<div class="modal-overlay" onclick={close}>
  <div class="modal-content" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Compaction History</h2>
      <button class="close-btn" onclick={close}>×</button>
    </div>

    <div class="modal-body">
      {#if loading}
        <div class="loading">Loading history...</div>
      {:else if error}
        <div class="error">
          <p>{error}</p>
          <button onclick={loadHistory}>Retry</button>
        </div>
      {:else if history.length === 0}
        <div class="empty">No compaction events yet</div>
      {:else}
        <div class="history-list">
          {#each history as event}
            <div class="history-item">
              <div class="item-header">
                <div class="item-title">
                  {#if !conversationId}
                    <span class="conversation-title">{event.conversationTitle}</span>
                  {/if}
                  <span class="trigger-badge" class:auto={event.trigger === 'auto'}>
                    {event.trigger === 'auto' ? 'Auto' : 'Manual'}
                  </span>
                  <span class="llm-badge" class:used={event.usedLLM}>
                    {event.usedLLM ? 'LLM' : 'Rule-based'}
                  </span>
                </div>
                <div class="item-date">{formatDate(event.compactedAt)}</div>
              </div>

              <div class="item-stats">
                <div class="stat">
                  <span class="stat-label">Original:</span>
                  <span class="stat-value">{event.originalCount} msgs</span>
                </div>
                <div class="stat">
                  <span class="stat-label">Compacted:</span>
                  <span class="stat-value">{event.compactedCount} msgs</span>
                </div>
                <div class="stat">
                  <span class="stat-label">Dropped:</span>
                  <span class="stat-value dropped">{event.droppedCount} msgs</span>
                </div>
                <div class="stat">
                  <span class="stat-label">Kept:</span>
                  <span class="stat-value">{event.retentionCount} recent</span>
                </div>
                {#if event.thresholdPct}
                  <div class="stat">
                    <span class="stat-label">Threshold:</span>
                    <span class="stat-value">{event.thresholdPct}%</span>
                  </div>
                {/if}
              </div>

              <details class="item-summary">
                <summary>View Summary</summary>
                <div class="summary-text">{event.summaryText}</div>
              </details>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 20px;
  }

  .modal-content {
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    max-width: 800px;
    width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-primary);
  }

  .modal-header h2 {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 700;
    color: var(--text-primary);
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 28px;
    line-height: 1;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color var(--transition);
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .loading,
  .empty,
  .error {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-tertiary);
  }

  .error {
    color: var(--accent-error);
  }

  .error button {
    margin-top: 12px;
    padding: 6px 16px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    cursor: pointer;
    font-family: var(--font-family);
    transition: all var(--transition);
  }

  .error button:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .history-item {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .item-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .item-title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .conversation-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .trigger-badge,
  .llm-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-tertiary);
  }

  .trigger-badge.auto {
    background: var(--accent-primary);
    color: var(--bg-primary);
    border-color: var(--accent-primary);
  }

  .llm-badge.used {
    background: var(--accent-success);
    color: var(--bg-primary);
    border-color: var(--accent-success);
  }

  .item-date {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    white-space: nowrap;
  }

  .item-stats {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .stat {
    display: flex;
    gap: 4px;
    font-size: var(--fs-xs);
  }

  .stat-label {
    color: var(--text-tertiary);
  }

  .stat-value {
    color: var(--text-primary);
    font-weight: 600;
    font-family: var(--font-family);
  }

  .stat-value.dropped {
    color: var(--accent-warning);
  }

  .item-summary {
    margin-top: 4px;
  }

  .item-summary summary {
    font-size: var(--fs-xs);
    color: var(--accent-primary);
    cursor: pointer;
    user-select: none;
    list-style: none;
    padding: 4px 0;
  }

  .item-summary summary:hover {
    text-decoration: underline;
  }

  .item-summary summary::-webkit-details-marker {
    display: none;
  }

  .summary-text {
    margin-top: 8px;
    padding: 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.5;
    white-space: pre-wrap;
    max-height: 200px;
    overflow-y: auto;
  }
</style>
