<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import type { StoryRecommendation, SuggestedNewStory } from '@e/shared';

  let appliedIds = $state<Set<string>>(new Set());
  let dismissedIds = $state<Set<string>>(new Set());
  let addedNewStories = $state<Set<number>>(new Set());

  const prdId = $derived(loopStore.selectedPrdId);
  const prdName = $derived(loopStore.selectedPrd?.name || 'PRD');

  function close() {
    loopStore.clearRefineAll();
    appliedIds = new Set();
    dismissedIds = new Set();
    addedNewStories = new Set();
    uiStore.closeModal();
  }

  async function startRefineAll() {
    if (!prdId) return;
    const result = await loopStore.refineAllStories(prdId);
    if (!result.ok) {
      uiStore.toast(result.error || 'Refinement failed', 'error');
    }
  }

  async function applyRecommendation(rec: StoryRecommendation) {
    if (!prdId) return;
    const result = await loopStore.applyRecommendation(prdId, rec);
    if (result.ok) {
      appliedIds = new Set([...appliedIds, rec.storyId]);
      uiStore.toast(`Applied: ${rec.action} "${rec.storyTitle}"`, 'success');
    } else {
      uiStore.toast('Failed to apply recommendation', 'error');
    }
  }

  function dismissRecommendation(storyId: string) {
    dismissedIds = new Set([...dismissedIds, storyId]);
  }

  async function addNewStory(story: SuggestedNewStory, index: number) {
    if (!prdId) return;
    const result = await loopStore.addSuggestedStory(prdId, story);
    if (result.ok) {
      addedNewStories = new Set([...addedNewStories, index]);
      uiStore.toast(`Added: "${story.title}"`, 'success');
    } else {
      uiStore.toast('Failed to add story', 'error');
    }
  }

  async function applyAll() {
    if (!prdId || !loopStore.refineAllResults) return;
    const recs = loopStore.refineAllResults.storyRecommendations.filter(
      (r) => r.action !== 'keep' && !appliedIds.has(r.storyId) && !dismissedIds.has(r.storyId),
    );
    for (const rec of recs) {
      await applyRecommendation(rec);
    }
  }

  function actionColor(action: string): string {
    switch (action) {
      case 'keep':
        return 'var(--accent-secondary)';
      case 'update':
        return 'var(--accent-primary)';
      case 'split':
        return 'var(--accent-warning, #e6a817)';
      case 'merge':
        return 'var(--accent-warning, #e6a817)';
      case 'remove':
        return 'var(--accent-error)';
      case 'already_done':
        return 'var(--accent-secondary)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  function actionLabel(action: string): string {
    switch (action) {
      case 'keep':
        return 'Keep';
      case 'update':
        return 'Update';
      case 'split':
        return 'Split';
      case 'merge':
        return 'Merge';
      case 'remove':
        return 'Remove';
      case 'already_done':
        return 'Done';
      default:
        return action;
    }
  }

  // Auto-start when modal opens
  $effect(() => {
    if (
      prdId &&
      !loopStore.refiningAll &&
      !loopStore.refineAllResults &&
      !loopStore.refineAllError
    ) {
      startRefineAll();
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <div class="header-text">
        <h2>Refine All Stories</h2>
        <span class="prd-name">{prdName}</span>
      </div>
      <button class="close-btn" onclick={close} title="Close">
        <svg
          width="16"
          height="16"
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

    <div class="modal-body">
      {#if loopStore.refiningAll}
        <div class="loading-state">
          <div class="spinner-large"></div>
          <p>Analyzing all stories against codebase...</p>
          <p class="loading-sub">This may take a moment for large PRDs</p>
        </div>
      {:else if loopStore.refineAllError}
        <div class="error-banner">{loopStore.refineAllError}</div>
        <button class="btn-retry" onclick={startRefineAll}>Retry</button>
      {:else if loopStore.refineAllResults}
        <!-- Summary -->
        <div class="summary-section">
          <p class="summary-text">{loopStore.refineAllResults.summary}</p>
          <div class="summary-stats">
            {#each ['keep', 'update', 'split', 'merge', 'remove', 'already_done'] as action}
              {@const count = loopStore.refineAllResults.storyRecommendations.filter(
                (r) => r.action === action,
              ).length}
              {#if count > 0}
                <span class="stat-badge" style:background={actionColor(action)}>
                  {actionLabel(action)}: {count}
                </span>
              {/if}
            {/each}
          </div>
        </div>

        <!-- Story Recommendations -->
        <div class="recommendations-section">
          <h3 class="section-label">
            Story Recommendations ({loopStore.refineAllResults.storyRecommendations.length})
          </h3>
          <div class="recommendations-list">
            {#each loopStore.refineAllResults.storyRecommendations as rec (rec.storyId)}
              {@const isApplied = appliedIds.has(rec.storyId)}
              {@const isDismissed = dismissedIds.has(rec.storyId)}
              <div class="rec-card" class:applied={isApplied} class:dismissed={isDismissed}>
                <div class="rec-header">
                  <span class="rec-title">{rec.storyTitle}</span>
                  <span class="action-badge" style:background={actionColor(rec.action)}>
                    {actionLabel(rec.action)}
                  </span>
                </div>
                <p class="rec-reason">{rec.reason}</p>

                {#if rec.action === 'update' && rec.suggestedChanges}
                  <div class="changes-preview">
                    {#if rec.suggestedChanges.title}
                      <div class="change-row">
                        <span class="change-label">Title:</span>
                        <span class="change-value">{rec.suggestedChanges.title}</span>
                      </div>
                    {/if}
                    {#if rec.suggestedChanges.description}
                      <div class="change-row">
                        <span class="change-label">Description:</span>
                        <span class="change-value">{rec.suggestedChanges.description}</span>
                      </div>
                    {/if}
                    {#if rec.suggestedChanges.acceptanceCriteria?.length}
                      <div class="change-row">
                        <span class="change-label">Criteria:</span>
                        <ul class="criteria-preview">
                          {#each rec.suggestedChanges.acceptanceCriteria as criterion}
                            <li>{criterion}</li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                    {#if rec.suggestedChanges.priority}
                      <div class="change-row">
                        <span class="change-label">Priority:</span>
                        <span class="change-value">{rec.suggestedChanges.priority}</span>
                      </div>
                    {/if}
                  </div>
                {/if}

                {#if rec.action === 'merge' && rec.mergeWith?.length}
                  <div class="merge-info">
                    Merge with: {rec.mergeWith.join(', ')}
                  </div>
                {/if}

                {#if !isApplied && !isDismissed && rec.action !== 'keep'}
                  <div class="rec-actions">
                    <button class="btn-apply" onclick={() => applyRecommendation(rec)}>
                      Apply
                    </button>
                    <button class="btn-dismiss" onclick={() => dismissRecommendation(rec.storyId)}>
                      Dismiss
                    </button>
                  </div>
                {:else if isApplied}
                  <div class="rec-status applied-status">Applied</div>
                {:else if isDismissed}
                  <div class="rec-status dismissed-status">Dismissed</div>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- Suggested New Stories -->
        {#if loopStore.refineAllResults.suggestedNewStories.length > 0}
          <div class="new-stories-section">
            <h3 class="section-label">
              Suggested New Stories ({loopStore.refineAllResults.suggestedNewStories.length})
            </h3>
            <div class="new-stories-list">
              {#each loopStore.refineAllResults.suggestedNewStories as story, idx (idx)}
                {@const isAdded = addedNewStories.has(idx)}
                <div class="new-story-card" class:added={isAdded}>
                  <div class="new-story-header">
                    <span class="new-story-title">{story.title}</span>
                    <span class="priority-badge">{story.priority}</span>
                  </div>
                  <p class="new-story-reason">{story.reason}</p>
                  {#if story.description}
                    <p class="new-story-desc">{story.description}</p>
                  {/if}
                  {#if story.acceptanceCriteria.length > 0}
                    <ul class="criteria-preview">
                      {#each story.acceptanceCriteria as criterion}
                        <li>{criterion}</li>
                      {/each}
                    </ul>
                  {/if}
                  {#if !isAdded}
                    <button class="btn-add" onclick={() => addNewStory(story, idx)}>
                      Add to PRD
                    </button>
                  {:else}
                    <div class="rec-status applied-status">Added</div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {:else}
        <div class="empty-state">Select a PRD to refine all stories.</div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn-cancel" onclick={close}>
        {loopStore.refineAllResults ? 'Done' : 'Cancel'}
      </button>
      {#if loopStore.refineAllResults && !loopStore.refiningAll}
        {@const actionableCount = loopStore.refineAllResults.storyRecommendations.filter(
          (r) => r.action !== 'keep' && !appliedIds.has(r.storyId) && !dismissedIds.has(r.storyId),
        ).length}
        {#if actionableCount > 0}
          <button class="btn-apply-all" onclick={applyAll}>
            Apply All ({actionableCount})
          </button>
        {/if}
        <button class="btn-retry-outline" onclick={startRefineAll}>Re-analyze</button>
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
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-lg, 8px);
    width: 700px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-primary);
  }
  .header-text {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .modal-header h2 {
    font-size: var(--fs-lg);
    font-weight: 600;
    margin: 0;
  }
  .prd-name {
    font-size: var(--fs-sm);
    color: var(--text-tertiary);
  }
  .close-btn {
    padding: 4px;
    border-radius: 4px;
    color: var(--text-tertiary);
  }
  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .modal-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
  }

  /* Loading */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px 20px;
    gap: 12px;
  }
  .loading-state p {
    font-size: var(--fs-base);
    color: var(--text-secondary);
    margin: 0;
  }
  .loading-sub {
    font-style: italic;
    color: var(--text-tertiary) !important;
    font-size: var(--fs-sm) !important;
  }
  .spinner-large {
    width: 24px;
    height: 24px;
    border: 3px solid transparent;
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  /* Error */
  .error-banner {
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--accent-error);
    border-radius: var(--radius-sm);
    color: var(--accent-error);
    font-size: var(--fs-sm);
    margin-bottom: 12px;
  }
  .btn-retry {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
  }

  /* Summary */
  .summary-section {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 12px;
    margin-bottom: 16px;
  }
  .summary-text {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0 0 8px;
  }
  .summary-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .stat-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 2px 8px;
    border-radius: 3px;
    color: var(--text-on-accent);
  }

  /* Recommendations */
  .section-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 10px;
  }
  .recommendations-list,
  .new-stories-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .rec-card,
  .new-story-card {
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    background: var(--bg-secondary);
    transition: opacity 0.2s ease;
  }
  .rec-card.applied,
  .new-story-card.added {
    opacity: 0.5;
  }
  .rec-card.dismissed {
    opacity: 0.35;
  }
  .rec-header,
  .new-story-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }
  .rec-title,
  .new-story-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .action-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--text-on-accent);
    white-space: nowrap;
  }
  .priority-badge {
    font-size: var(--fs-xxs);
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    font-weight: 600;
    text-transform: uppercase;
  }
  .rec-reason,
  .new-story-reason {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    line-height: 1.4;
    margin: 0 0 6px;
  }
  .new-story-desc {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.4;
    margin: 0 0 6px;
  }

  /* Changes preview */
  .changes-preview {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 8px;
    margin-bottom: 6px;
  }
  .change-row {
    font-size: var(--fs-xs);
    margin-bottom: 4px;
  }
  .change-row:last-child {
    margin-bottom: 0;
  }
  .change-label {
    font-weight: 600;
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
  }
  .change-value {
    color: var(--text-secondary);
  }
  .criteria-preview {
    padding-left: 16px;
    margin: 2px 0 0;
  }
  .criteria-preview li {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .merge-info {
    font-size: var(--fs-xs);
    color: var(--accent-warning, #e6a817);
    margin-bottom: 6px;
  }

  /* Actions */
  .rec-actions {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .btn-apply,
  .btn-add {
    padding: 4px 12px;
    font-size: var(--fs-xs);
    font-weight: 600;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
  }
  .btn-apply:hover,
  .btn-add:hover {
    opacity: 0.9;
  }
  .btn-dismiss {
    padding: 4px 12px;
    font-size: var(--fs-xs);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
  }
  .btn-dismiss:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }
  .rec-status {
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-top: 6px;
  }
  .applied-status {
    color: var(--accent-secondary);
  }
  .dismissed-status {
    color: var(--text-tertiary);
  }

  /* New stories section */
  .new-stories-section {
    margin-top: 16px;
  }
  .btn-add {
    margin-top: 6px;
  }

  /* Empty state */
  .empty-state {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }

  /* Footer */
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border-primary);
  }
  .btn-cancel {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
  }
  .btn-cancel:hover {
    background: var(--bg-hover);
  }
  .btn-apply-all {
    padding: 6px 20px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
  }
  .btn-apply-all:hover {
    opacity: 0.9;
  }
  .btn-retry-outline {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
  }
  .btn-retry-outline:hover {
    background: var(--bg-hover);
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
