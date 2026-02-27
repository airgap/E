<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import type { PriorityRecommendation, StoryPriority } from '@e/shared';

  // The story being analyzed
  let story = $derived(
    loopStore.selectedPrd?.stories?.find((s) => s.id === loopStore.recommendingPriorityStoryId) ||
      null,
  );

  // Manual override state
  let showManualOverride = $state(false);
  let manualPriority = $state<StoryPriority>('medium');

  function close() {
    loopStore.clearPriorityRecommendation();
    showManualOverride = false;
    manualPriority = 'medium';
    uiStore.closeModal();
  }

  async function startRecommendation() {
    const prdId = loopStore.selectedPrdId;
    const storyId = loopStore.recommendingPriorityStoryId;
    if (!prdId || !storyId) return;

    const result = await loopStore.recommendPriority(prdId, storyId);
    if (!result.ok) {
      uiStore.toast(result.error || 'Priority recommendation failed', 'error');
    }
  }

  async function acceptSuggestion() {
    const prdId = loopStore.selectedPrdId;
    const storyId = loopStore.recommendingPriorityStoryId;
    if (!prdId || !storyId || !currentRecommendation) return;

    const result = await loopStore.acceptPriority(
      prdId,
      storyId,
      currentRecommendation.suggestedPriority,
      true,
    );
    if (result.ok) {
      uiStore.toast(`Priority updated to ${currentRecommendation.suggestedPriority}`, 'success');
      close();
    } else {
      uiStore.toast(result.error || 'Failed to update priority', 'error');
    }
  }

  async function saveOverride() {
    const prdId = loopStore.selectedPrdId;
    const storyId = loopStore.recommendingPriorityStoryId;
    if (!prdId || !storyId) return;

    const result = await loopStore.acceptPriority(prdId, storyId, manualPriority, false);
    if (result.ok) {
      uiStore.toast(`Priority overridden to ${manualPriority}`, 'success');
      close();
    } else {
      uiStore.toast(result.error || 'Failed to override priority', 'error');
    }
  }

  function openOverride() {
    showManualOverride = true;
    manualPriority = (currentRecommendation?.suggestedPriority ||
      story?.priority ||
      'medium') as StoryPriority;
  }

  function priorityColor(priority: string): string {
    switch (priority) {
      case 'critical':
        return 'var(--accent-error)';
      case 'high':
        return '#e07a2f';
      case 'medium':
        return 'var(--accent-warning, #e6a817)';
      case 'low':
        return 'var(--accent-secondary)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  function priorityIcon(priority: string): string {
    switch (priority) {
      case 'critical':
        return '●';
      case 'high':
        return '●';
      case 'medium':
        return '●';
      case 'low':
        return '●';
      default:
        return '○';
    }
  }

  function categoryIcon(category: string): string {
    switch (category) {
      case 'dependency':
        return '⊟';
      case 'risk':
        return '△';
      case 'scope':
        return '∟';
      case 'user_impact':
        return '⊕';
      default:
        return '•';
    }
  }

  function categoryLabel(category: string): string {
    switch (category) {
      case 'dependency':
        return 'Dependency';
      case 'risk':
        return 'Risk';
      case 'scope':
        return 'Scope';
      case 'user_impact':
        return 'User Impact';
      default:
        return category;
    }
  }

  function impactIcon(impact: string): string {
    switch (impact) {
      case 'increases':
        return '↑';
      case 'decreases':
        return '↓';
      default:
        return '→';
    }
  }

  function impactColor(impact: string): string {
    switch (impact) {
      case 'increases':
        return 'var(--accent-error)';
      case 'decreases':
        return 'var(--accent-secondary)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  const priorityOptions: StoryPriority[] = ['critical', 'high', 'medium', 'low'];

  // Current recommendation (either from modal result or persisted on the story)
  let currentRecommendation = $derived(
    loopStore.priorityRecommendationResult || story?.priorityRecommendation || null,
  );

  let priorityChanged = $derived(
    currentRecommendation
      ? currentRecommendation.suggestedPriority !== currentRecommendation.currentPriority
      : false,
  );

  // Auto-start recommendation when modal opens
  $effect(() => {
    if (
      loopStore.recommendingPriorityStoryId &&
      !loopStore.recommendingPriority &&
      !loopStore.priorityRecommendationResult &&
      !story?.priorityRecommendation
    ) {
      startRecommendation();
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Priority Recommendation</h2>
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
      {#if !story}
        <div class="empty-state">Story not found.</div>
      {:else if loopStore.recommendingPriority}
        <!-- Loading state -->
        <div class="loading-state">
          <div class="spinner-large"></div>
          <p>Analyzing story priority...</p>
          <p class="loading-sub">Evaluating dependencies, risks, scope, and user impact</p>
        </div>
      {:else if currentRecommendation}
        <!-- Story Info -->
        <div class="story-info">
          <span class="story-title-text">{story.title}</span>
          {#if story.description}
            <p class="story-desc">{story.description}</p>
          {/if}
        </div>

        <!-- Priority Comparison -->
        <div class="priority-comparison">
          <div class="priority-card current">
            <span class="card-label">Current Priority</span>
            <span
              class="card-value"
              style:color={priorityColor(currentRecommendation.currentPriority)}
            >
              {priorityIcon(currentRecommendation.currentPriority)}
              {currentRecommendation.currentPriority.toUpperCase()}
            </span>
          </div>
          <div class="priority-arrow">
            {#if priorityChanged}
              <span class="arrow-icon">→</span>
            {:else}
              <span class="check-icon">✓</span>
            {/if}
          </div>
          <div class="priority-card suggested" class:changed={priorityChanged}>
            <span class="card-label">Suggested Priority</span>
            <span
              class="card-value"
              style:color={priorityColor(currentRecommendation.suggestedPriority)}
            >
              {priorityIcon(currentRecommendation.suggestedPriority)}
              {currentRecommendation.suggestedPriority.toUpperCase()}
            </span>
            <span class="confidence-score">{currentRecommendation.confidence}% confidence</span>
          </div>
        </div>

        {#if !priorityChanged}
          <div class="no-change-badge">Priority looks correct — no change recommended</div>
        {/if}

        {#if currentRecommendation.isManualOverride}
          <div class="manual-badge">✎ Manually Overridden</div>
        {/if}

        <!-- Explanation -->
        <div class="explanation-section">
          <h4 class="section-label">Explanation</h4>
          <p class="explanation-text">{currentRecommendation.explanation}</p>
        </div>

        <!-- Factors -->
        {#if currentRecommendation.factors.length > 0}
          <div class="factors-section">
            <h4 class="section-label">Key Factors ({currentRecommendation.factors.length})</h4>
            <div class="factors-list">
              {#each currentRecommendation.factors as factor}
                <div class="factor-item">
                  <span class="factor-category" title={categoryLabel(factor.category)}>
                    {categoryIcon(factor.category)}
                  </span>
                  <span class="factor-impact" style:color={impactColor(factor.impact)}>
                    {impactIcon(factor.impact)}
                  </span>
                  <span class="factor-text">{factor.factor}</span>
                  <span class="factor-weight">{factor.weight}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Manual Override Form -->
        {#if showManualOverride}
          <div class="override-section">
            <h4 class="section-label">Override Priority</h4>
            <div class="override-form">
              <div class="priority-options">
                {#each priorityOptions as opt}
                  <button
                    class="priority-option"
                    class:selected={manualPriority === opt}
                    style:border-color={manualPriority === opt
                      ? priorityColor(opt)
                      : 'var(--border-primary)'}
                    onclick={() => (manualPriority = opt)}
                  >
                    <span class="opt-icon">{priorityIcon(opt)}</span>
                    <span class="opt-label">{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                  </button>
                {/each}
              </div>
              <div class="override-actions">
                <button class="btn-save" onclick={saveOverride}>Save Override</button>
                <button class="btn-cancel-override" onclick={() => (showManualOverride = false)}
                  >Cancel</button
                >
              </div>
            </div>
          </div>
        {/if}

        <!-- Error -->
        {#if loopStore.priorityRecommendationError}
          <div class="error-banner">
            {loopStore.priorityRecommendationError}
          </div>
        {/if}
      {:else if loopStore.priorityRecommendationError}
        <div class="error-banner">
          {loopStore.priorityRecommendationError}
        </div>
      {:else}
        <!-- Story has no recommendation yet and we're not loading -->
        <div class="story-info">
          <span class="story-title-text">{story.title}</span>
          {#if story.description}
            <p class="story-desc">{story.description}</p>
          {/if}
        </div>
        <div class="no-recommendation">
          <p>
            No priority recommendation yet. Click "Analyze" to get an AI-powered priority
            suggestion.
          </p>
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn-close" onclick={close}>
        {currentRecommendation ? 'Done' : 'Close'}
      </button>
      {#if story && !loopStore.recommendingPriority}
        <button class="btn-analyze" onclick={startRecommendation}>
          {currentRecommendation ? 'Re-analyze' : 'Analyze'}
        </button>
        {#if currentRecommendation && priorityChanged && !showManualOverride}
          <button class="btn-accept" onclick={acceptSuggestion}>
            Accept ({currentRecommendation.suggestedPriority})
          </button>
        {/if}
        {#if currentRecommendation && !showManualOverride}
          <button class="btn-override" onclick={openOverride}> Override </button>
        {/if}
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
    width: 620px;
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
  .modal-header h2 {
    font-size: var(--fs-lg);
    font-weight: 600;
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
  .empty-state {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }
  .no-recommendation {
    text-align: center;
    padding: 20px;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }

  /* Story info */
  .story-info {
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border-primary);
  }
  .story-title-text {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .story-desc {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    margin-top: 6px;
    line-height: 1.4;
  }

  /* Priority comparison */
  .priority-comparison {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .priority-card {
    flex: 1;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 12px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .priority-card.changed {
    border-color: var(--accent-primary);
    background: rgba(59, 130, 246, 0.04);
  }
  .card-label {
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
  }
  .card-value {
    font-size: var(--fs-lg);
    font-weight: 700;
  }
  .confidence-score {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .priority-arrow {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
  }
  .arrow-icon {
    font-size: var(--fs-xl);
    color: var(--accent-primary);
    font-weight: 700;
  }
  .check-icon {
    font-size: var(--fs-lg);
    color: var(--accent-secondary);
    font-weight: 700;
  }
  .no-change-badge {
    text-align: center;
    font-size: var(--fs-xs);
    color: var(--accent-secondary);
    padding: 6px 10px;
    background: rgba(34, 197, 94, 0.08);
    border: 1px solid rgba(34, 197, 94, 0.2);
    border-radius: var(--radius-sm);
    margin-bottom: 16px;
  }
  .manual-badge {
    margin-bottom: 16px;
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-align: center;
    padding: 2px 8px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    display: inline-block;
  }

  /* Explanation */
  .explanation-section {
    margin-bottom: 16px;
  }
  .section-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }
  .explanation-text {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    line-height: 1.5;
    margin: 0;
    padding: 8px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }

  /* Factors */
  .factors-section {
    margin-bottom: 16px;
  }
  .factors-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .factor-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .factor-category {
    font-size: var(--fs-base);
    flex-shrink: 0;
    width: 20px;
    text-align: center;
  }
  .factor-impact {
    font-size: var(--fs-md);
    font-weight: 700;
    flex-shrink: 0;
    width: 16px;
    text-align: center;
  }
  .factor-text {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    flex: 1;
    line-height: 1.4;
  }
  .factor-weight {
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    padding: 1px 5px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  /* Override */
  .override-section {
    margin-top: 16px;
    padding: 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .override-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .priority-options {
    display: flex;
    gap: 8px;
  }
  .priority-option {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 8px;
    border-radius: var(--radius-sm);
    border: 2px solid var(--border-primary);
    background: var(--bg-primary);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .priority-option:hover {
    background: var(--bg-hover);
  }
  .priority-option.selected {
    background: rgba(59, 130, 246, 0.06);
  }
  .opt-icon {
    font-size: var(--fs-lg);
  }
  .opt-label {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .override-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 4px;
  }
  .btn-save {
    font-size: var(--fs-xs);
    padding: 5px 14px;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    font-weight: 600;
    cursor: pointer;
  }
  .btn-save:hover {
    opacity: 0.9;
  }
  .btn-cancel-override {
    font-size: var(--fs-xs);
    padding: 5px 14px;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
  }
  .btn-cancel-override:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  /* Error */
  .error-banner {
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--accent-error);
    border-radius: var(--radius-sm);
    color: var(--accent-error);
    font-size: var(--fs-sm);
    margin-top: 12px;
  }

  /* Footer */
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border-primary);
  }
  .btn-close {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
  }
  .btn-close:hover {
    background: var(--bg-hover);
  }
  .btn-analyze {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
    font-weight: 600;
  }
  .btn-analyze:hover {
    opacity: 0.9;
  }
  .btn-accept {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--accent-secondary);
    color: var(--text-on-accent, white);
    cursor: pointer;
    font-weight: 600;
  }
  .btn-accept:hover {
    opacity: 0.9;
  }
  .btn-override {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
  }
  .btn-override:hover {
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
