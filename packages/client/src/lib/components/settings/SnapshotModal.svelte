<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';

  interface Snapshot {
    id: string;
    workspacePath: string;
    conversationId: string | null;
    headSha: string;
    stashSha: string | null;
    reason: string;
    hasChanges: boolean;
    messageId: string | null;
    createdAt: number;
  }

  let snapshots = $state<Snapshot[]>([]);
  let loading = $state(true);
  let restoring = $state<string | null>(null);
  let error = $state<string | null>(null);

  onMount(async () => {
    await loadSnapshots();
  });

  async function loadSnapshots() {
    loading = true;
    error = null;
    try {
      const res = await api.git.snapshots(settingsStore.workspacePath);
      snapshots = res.data;
    } catch {
      error = 'Failed to load snapshots';
    }
    loading = false;
  }

  async function restore(id: string) {
    if (restoring) return;
    restoring = id;
    error = null;
    try {
      await api.git.restoreSnapshot(id);
      uiStore.toast('Snapshot restored successfully', 'success');
      await loadSnapshots();
    } catch {
      error = 'Failed to restore snapshot';
      uiStore.toast('Failed to restore snapshot', 'error');
    }
    restoring = null;
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return (
      d.toLocaleDateString() +
      ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  }

  function close() {
    uiStore.closeModal();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Git Snapshots</h2>
      <button class="close-btn" onclick={close}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="modal-body">
      <p class="snapshot-desc">
        Snapshots are taken automatically before each agent run. Restore to revert file changes.
      </p>

      {#if error}
        <div class="error-msg">{error}</div>
      {/if}

      {#if loading}
        <div class="loading">Loading snapshots...</div>
      {:else if snapshots.length === 0}
        <div class="empty">
          No snapshots yet. Snapshots are created automatically before agent runs.
        </div>
      {:else}
        <div class="snapshot-list">
          {#each snapshots as snap (snap.id)}
            <div class="snapshot-row" class:restoring={restoring === snap.id}>
              <div class="snapshot-info">
                <div class="snapshot-meta">
                  <span class="snapshot-reason">{snap.reason}</span>
                  <span class="snapshot-time">{formatTime(snap.createdAt)}</span>
                </div>
                <div class="snapshot-details">
                  <code class="snapshot-sha">{snap.headSha.slice(0, 8)}</code>
                  {#if snap.hasChanges}
                    <span class="snapshot-badge changes">uncommitted changes</span>
                  {:else}
                    <span class="snapshot-badge clean">clean</span>
                  {/if}
                  {#if snap.messageId}
                    <span
                      class="snapshot-badge message-linked"
                      title="Linked to message {snap.messageId}">msg linked</span
                    >
                  {/if}
                </div>
              </div>
              <button
                class="restore-btn"
                onclick={() => restore(snap.id)}
                disabled={restoring !== null}
                title="Restore to this snapshot"
              >
                {restoring === snap.id ? 'Restoring...' : 'Restore'}
              </button>
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
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg);
    width: 520px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-primary);
  }
  .modal-header h2 {
    font-size: var(--fs-lg);
    font-weight: 700;
  }
  .close-btn {
    color: var(--text-tertiary);
    padding: 4px;
    border-radius: var(--radius-sm);
  }
  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .modal-body {
    padding: 16px 20px;
    overflow-y: auto;
  }
  .snapshot-desc {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    margin-bottom: 14px;
  }
  .error-msg {
    padding: 8px 12px;
    background: rgba(255, 50, 50, 0.1);
    border: 1px solid var(--accent-error);
    color: var(--accent-error);
    font-size: var(--fs-sm);
    margin-bottom: 12px;
    border-radius: var(--radius-sm);
  }
  .loading,
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }
  .snapshot-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .snapshot-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    transition: opacity 0.15s ease;
  }
  .snapshot-row.restoring {
    opacity: 0.5;
  }
  .snapshot-info {
    flex: 1;
    min-width: 0;
  }
  .snapshot-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
  }
  .snapshot-reason {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
  }
  .snapshot-time {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .snapshot-details {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .snapshot-sha {
    font-size: var(--fs-xs);
    color: var(--accent-primary);
    font-family: var(--font-family);
  }
  .snapshot-badge {
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }
  .snapshot-badge.changes {
    color: var(--accent-warning);
    border: 1px solid var(--accent-warning);
  }
  .snapshot-badge.clean {
    color: var(--text-tertiary);
    border: 1px solid var(--border-secondary);
  }
  .snapshot-badge.message-linked {
    color: var(--accent-primary);
    border: 1px solid var(--accent-primary);
  }
  .restore-btn {
    padding: 5px 14px;
    font-size: var(--fs-sm);
    font-weight: 600;
    background: var(--bg-primary);
    border: 1px solid var(--accent-warning);
    color: var(--accent-warning);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .restore-btn:hover:not(:disabled) {
    background: var(--accent-warning);
    color: var(--bg-primary);
  }
  .restore-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
