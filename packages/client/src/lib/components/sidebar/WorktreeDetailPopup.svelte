<script lang="ts">
  import { worktreeStore } from '$lib/stores/worktree.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import type { WorktreeEntry, WorktreeDetailStatus } from '$lib/stores/worktree.svelte';
  import { onMount } from 'svelte';

  interface Props {
    storyId: string;
    storyTitle: string;
    onclose: () => void;
  }

  let { storyId, storyTitle, onclose }: Props = $props();

  let entry = $derived(worktreeStore.getForStory(storyId));
  let detail = $state<WorktreeDetailStatus | null>(null);
  let loadingDetail = $state(true);
  let merging = $state(false);
  let removing = $state(false);

  let isDirty = $derived(detail ? detail.dirtyFiles.length > 0 : false);
  let hasConflicts = $derived(entry?.record?.status === 'conflict');
  let checksFailing = $derived(hasConflicts);
  let mergeDisabled = $derived(isDirty || checksFailing);

  onMount(async () => {
    loadingDetail = true;
    detail = await worktreeStore.loadDetail(storyId);
    loadingDetail = false;
  });

  function statusColor(status: string | undefined): string {
    switch (status) {
      case 'active':
        return 'var(--accent-secondary, #22c55e)';
      case 'merging':
        return 'var(--accent-warning, #eab308)';
      case 'conflict':
        return 'var(--accent-error, #ef4444)';
      case 'merged':
        return 'var(--text-tertiary)';
      case 'abandoned':
      case 'cleanup_pending':
        return 'var(--text-tertiary)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  async function handleMerge() {
    if (mergeDisabled) return;
    merging = true;
    const result = await worktreeStore.merge(storyId, {
      retry: hasConflicts,
    });
    merging = false;
    if (result.ok) {
      uiStore.toast('Merge initiated', 'success');
    } else {
      uiStore.toast(result.error || 'Merge failed', 'error');
    }
  }

  async function handleRemove() {
    removing = true;
    const result = await worktreeStore.remove(storyId, true);
    removing = false;
    if (result.ok) {
      uiStore.toast('Worktree removed', 'success');
      onclose();
    } else {
      uiStore.toast(result.error || 'Remove failed', 'error');
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="popup-overlay" onclick={onclose}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="popup" onclick={(e) => e.stopPropagation()}>
    <div class="popup-header">
      <h3>Worktree Details</h3>
      <button class="close-btn" onclick={onclose}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <div class="popup-body">
      <div class="story-name">{storyTitle}</div>

      {#if entry}
        <!-- Branch info -->
        <div class="info-row">
          <span class="info-label">Branch</span>
          <span class="info-value mono">{entry.branch ?? 'unknown'}</span>
        </div>

        <div class="info-row">
          <span class="info-label">Status</span>
          <span class="status-badge" style="background: {statusColor(entry.record?.status)}">
            {entry.record?.status ?? 'unknown'}
          </span>
        </div>

        {#if loadingDetail}
          <div class="info-row">
            <span class="info-label">Loading details...</span>
            <span class="spinner-sm"></span>
          </div>
        {:else if detail}
          <!-- Dirty files -->
          <div class="info-row">
            <span class="info-label">Dirty Files</span>
            <span class="info-value" class:warn={detail.dirtyFiles.length > 0}>
              {detail.dirtyFiles.length === 0 ? 'Clean' : `${detail.dirtyFiles.length} uncommitted`}
            </span>
          </div>

          {#if detail.dirtyFiles.length > 0}
            <div class="dirty-files">
              {#each detail.dirtyFiles.slice(0, 10) as file}
                <div class="dirty-file mono">{file}</div>
              {/each}
              {#if detail.dirtyFiles.length > 10}
                <div class="dirty-file-more">...and {detail.dirtyFiles.length - 10} more</div>
              {/if}
            </div>
          {/if}

          <!-- Ahead/behind -->
          <div class="info-row">
            <span class="info-label">Ahead / Behind</span>
            <span class="info-value">
              <span class="ahead" class:positive={detail.aheadBy > 0}>↑{detail.aheadBy}</span>
              <span class="behind" class:negative={detail.behindBy > 0}>↓{detail.behindBy}</span>
            </span>
          </div>
        {/if}

        <!-- Actions -->
        <div class="actions">
          <button
            class="action-btn merge-btn"
            disabled={mergeDisabled || merging}
            onclick={handleMerge}
            title={mergeDisabled
              ? isDirty
                ? 'Cannot merge: uncommitted changes'
                : 'Cannot merge: checks failing'
              : 'Merge branch back to base'}
          >
            {#if merging}
              <span class="spinner-sm"></span> Merging...
            {:else}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="18" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <path d="M6 21V9a9 9 0 0 0 9 9" />
              </svg>
              Merge
            {/if}
          </button>

          <button class="action-btn remove-btn" disabled={removing} onclick={handleRemove}>
            {#if removing}
              <span class="spinner-sm"></span> Removing...
            {:else}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path
                  d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                />
              </svg>
              Remove
            {/if}
          </button>
        </div>

        {#if mergeDisabled}
          <div class="merge-warning">
            {#if isDirty}
              ⚠ Cannot merge while there are uncommitted changes.
            {:else if hasConflicts}
              ⚠ Cannot merge due to unresolved conflicts.
            {/if}
          </div>
        {/if}
      {:else}
        <div class="no-worktree">No worktree found for this story.</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .popup-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .popup {
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg, 8px);
    width: 380px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  }

  .popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-primary);
  }

  .popup-header h3 {
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .close-btn {
    padding: 4px;
    border-radius: 4px;
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
  }
  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .popup-body {
    padding: 12px 16px;
    overflow-y: auto;
  }

  .story-name {
    font-size: var(--fs-sm);
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .info-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--border-secondary, var(--border-primary));
  }

  .info-label {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }

  .info-value {
    font-size: var(--fs-xs);
    color: var(--text-primary);
  }
  .info-value.warn {
    color: var(--accent-warning, #eab308);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-xxs);
  }

  .status-badge {
    font-size: var(--fs-xxs);
    padding: 1px 8px;
    border-radius: 3px;
    color: white;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .dirty-files {
    padding: 6px 0 6px 8px;
    max-height: 100px;
    overflow-y: auto;
  }

  .dirty-file {
    font-size: var(--fs-xxs);
    color: var(--text-secondary);
    padding: 1px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dirty-file-more {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-style: italic;
    padding-top: 2px;
  }

  .ahead,
  .behind {
    font-size: var(--fs-xs);
    padding: 0 4px;
  }
  .positive {
    color: var(--accent-secondary, #22c55e);
  }
  .negative {
    color: var(--accent-error, #ef4444);
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: var(--fs-xs);
    font-weight: 600;
    border-radius: var(--radius-sm);
    cursor: pointer;
    border: 1px solid var(--border-primary);
    transition: all 0.15s ease;
  }

  .merge-btn {
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-color: var(--accent-primary);
  }
  .merge-btn:hover:not(:disabled) {
    opacity: 0.9;
  }
  .merge-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .remove-btn {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }
  .remove-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--accent-error);
    border-color: var(--accent-error);
  }
  .remove-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .merge-warning {
    margin-top: 8px;
    padding: 6px 8px;
    font-size: var(--fs-xxs);
    color: var(--accent-warning, #eab308);
    background: rgba(234, 179, 8, 0.08);
    border-radius: var(--radius-sm);
    border-left: 2px solid var(--accent-warning, #eab308);
  }

  .no-worktree {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
    text-align: center;
    padding: 24px 0;
  }

  .spinner-sm {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
