<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import type { StoryEstimate } from '@e/shared';

  // The story being estimated
  let story = $derived(
    loopStore.selectedPrd?.stories?.find((s) => s.id === loopStore.estimatingStoryId) || null,
  );

  // Manual override state
  let showManualOverride = $state(false);
  let manualSize = $state<string>('medium');
  let manualPoints = $state<number>(5);
  let manualReasoning = $state('');

  function close() {
    loopStore.clearEstimation();
    showManualOverride = false;
    manualSize = 'medium';
    manualPoints = 5;
    manualReasoning = '';
    uiStore.closeModal();
  }

  async function startEstimation() {
    const prdId = loopStore.selectedPrdId;
    const storyId = loopStore.estimatingStoryId;
    if (!prdId || !storyId) return;

    const result = await loopStore.estimateStory(prdId, storyId);
    if (!result.ok) {
      uiStore.toast(result.error || 'Estimation failed', 'error');
    }
  }

  async function saveManual() {
    const prdId = loopStore.selectedPrdId;
    const storyId = loopStore.estimatingStoryId;
    if (!prdId || !storyId) return;

    const result = await loopStore.saveManualEstimate(
      prdId,
      storyId,
      manualSize,
      manualPoints,
      manualReasoning || undefined,
    );
    if (result.ok) {
      uiStore.toast('Manual estimate saved', 'success');
      showManualOverride = false;
    } else {
      uiStore.toast(result.error || 'Failed to save estimate', 'error');
    }
  }

  function openManualOverride() {
    showManualOverride = true;
    // Pre-fill with current estimate if available
    const est = loopStore.estimationResult || story?.estimate;
    if (est) {
      manualSize = est.size;
      manualPoints = est.storyPoints;
      manualReasoning = est.reasoning || '';
    }
  }

  function sizeColor(size: string): string {
    switch (size) {
      case 'small':
        return 'var(--accent-secondary)';
      case 'medium':
        return 'var(--accent-warning, #e6a817)';
      case 'large':
        return 'var(--accent-error)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  function confidenceColor(confidence: string): string {
    switch (confidence) {
      case 'high':
        return 'var(--accent-secondary)';
      case 'medium':
        return 'var(--accent-warning, #e6a817)';
      case 'low':
        return 'var(--accent-error)';
      default:
        return 'var(--text-tertiary)';
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

  function weightLabel(weight: string): string {
    switch (weight) {
      case 'major':
        return 'Major';
      case 'moderate':
        return 'Moderate';
      case 'minor':
        return 'Minor';
      default:
        return weight;
    }
  }

  // Point options for the manual select
  const pointOptions = [1, 2, 3, 5, 8, 13];
  const sizeOptions = ['small', 'medium', 'large'];

  // Current estimate (either from modal estimation result or persisted on the story)
  let currentEstimate = $derived(loopStore.estimationResult || story?.estimate || null);

  // Auto-start estimation when modal opens
  $effect(() => {
    if (
      loopStore.estimatingStoryId &&
      !loopStore.estimating &&
      !loopStore.estimationResult &&
      !story?.estimate
    ) {
      startEstimation();
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Story Estimation</h2>
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
      {:else if loopStore.estimating}
        <!-- Loading state -->
        <div class="loading-state">
          <div class="spinner-large"></div>
          <p>Analyzing story complexity...</p>
          <p class="loading-sub">Evaluating scope, criteria, and dependencies</p>
        </div>
      {:else if currentEstimate}
        <!-- Story Info -->
        <div class="story-info">
          <span class="story-title-text">{story.title}</span>
          {#if story.description}
            <p class="story-desc">{story.description}</p>
          {/if}
        </div>

        <!-- Estimate Overview -->
        <div class="estimate-overview">
          <div class="estimate-row">
            <!-- Size -->
            <div class="estimate-card">
              <span class="card-label">Size</span>
              <span class="card-value size-value" style:color={sizeColor(currentEstimate.size)}>
                {currentEstimate.size.toUpperCase()}
              </span>
            </div>
            <!-- Story Points -->
            <div class="estimate-card">
              <span class="card-label">Story Points</span>
              <span class="card-value points-value">
                {currentEstimate.storyPoints}
              </span>
            </div>
            <!-- Confidence -->
            <div class="estimate-card">
              <span class="card-label">Confidence</span>
              <span class="card-value" style:color={confidenceColor(currentEstimate.confidence)}>
                {currentEstimate.confidence.toUpperCase()}
              </span>
              <span class="confidence-score">{currentEstimate.confidenceScore}%</span>
            </div>
          </div>

          {#if currentEstimate.isManualOverride}
            <div class="manual-badge">✎ Manual Override</div>
          {/if}
        </div>

        <!-- Reasoning -->
        <div class="reasoning-section">
          <h4 class="section-label">Reasoning</h4>
          <p class="reasoning-text">{currentEstimate.reasoning}</p>
        </div>

        <!-- Factors -->
        {#if currentEstimate.factors.length > 0}
          <div class="factors-section">
            <h4 class="section-label">Key Factors ({currentEstimate.factors.length})</h4>
            <div class="factors-list">
              {#each currentEstimate.factors as factor}
                <div class="factor-item">
                  <span class="factor-impact" style:color={impactColor(factor.impact)}>
                    {impactIcon(factor.impact)}
                  </span>
                  <span class="factor-text">{factor.factor}</span>
                  <span class="factor-weight">{weightLabel(factor.weight)}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Suggested Breakdown (for large stories) -->
        {#if currentEstimate.suggestedBreakdown && currentEstimate.suggestedBreakdown.length > 0}
          <div class="breakdown-section">
            <h4 class="section-label">※ Suggested Breakdown</h4>
            <p class="breakdown-hint">This story is large. Consider breaking it into:</p>
            <ul class="breakdown-list">
              {#each currentEstimate.suggestedBreakdown as task}
                <li>{task}</li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- Manual Override Form -->
        {#if showManualOverride}
          <div class="override-section">
            <h4 class="section-label">Manual Override</h4>
            <div class="override-form">
              <div class="override-row">
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label class="override-field">
                  <span class="field-label">Size</span>
                  <select bind:value={manualSize}>
                    {#each sizeOptions as opt}
                      <option value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
                    {/each}
                  </select>
                </label>
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label class="override-field">
                  <span class="field-label">Story Points</span>
                  <select bind:value={manualPoints}>
                    {#each pointOptions as pts}
                      <option value={pts}>{pts}</option>
                    {/each}
                  </select>
                </label>
              </div>
              <div class="override-row">
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label class="override-field full">
                  <span class="field-label">Reasoning (optional)</span>
                  <textarea bind:value={manualReasoning} placeholder="Why this estimate?" rows="2"
                  ></textarea>
                </label>
              </div>
              <div class="override-actions">
                <button class="btn-save" onclick={saveManual}>Save Override</button>
                <button class="btn-cancel-override" onclick={() => (showManualOverride = false)}
                  >Cancel</button
                >
              </div>
            </div>
          </div>
        {/if}

        <!-- Error -->
        {#if loopStore.estimationError}
          <div class="error-banner">
            {loopStore.estimationError}
          </div>
        {/if}
      {:else if loopStore.estimationError}
        <div class="error-banner">
          {loopStore.estimationError}
        </div>
      {:else}
        <!-- Story has no estimate yet and we're not loading — show info -->
        <div class="story-info">
          <span class="story-title-text">{story.title}</span>
          {#if story.description}
            <p class="story-desc">{story.description}</p>
          {/if}
        </div>
        <div class="no-estimate">
          <p>No estimate yet. Click "Estimate" to analyze this story's complexity.</p>
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn-close" onclick={close}>
        {currentEstimate ? 'Done' : 'Close'}
      </button>
      {#if story && !loopStore.estimating}
        <button class="btn-reestimate" onclick={startEstimation}>
          {currentEstimate ? 'Re-estimate' : 'Estimate'}
        </button>
        {#if currentEstimate && !showManualOverride}
          <button class="btn-override" onclick={openManualOverride}> Override </button>
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
  .no-estimate {
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

  /* Estimate overview */
  .estimate-overview {
    margin-bottom: 16px;
  }
  .estimate-row {
    display: flex;
    gap: 12px;
  }
  .estimate-card {
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
  .card-label {
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
  }
  .card-value {
    font-size: var(--fs-xl);
    font-weight: 700;
  }
  .size-value {
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .points-value {
    color: var(--accent-primary);
    font-size: var(--fs-2xl);
  }
  .confidence-score {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .manual-badge {
    margin-top: 8px;
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-align: center;
    padding: 2px 8px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    display: inline-block;
  }

  /* Reasoning */
  .reasoning-section {
    margin-bottom: 16px;
  }
  .section-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }
  .reasoning-text {
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

  /* Breakdown */
  .breakdown-section {
    margin-bottom: 16px;
    padding: 10px 12px;
    background: rgba(59, 130, 246, 0.06);
    border: 1px solid rgba(59, 130, 246, 0.15);
    border-radius: var(--radius-sm);
  }
  .breakdown-hint {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    margin: 0 0 6px 0;
  }
  .breakdown-list {
    margin: 0;
    padding-left: 20px;
  }
  .breakdown-list li {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    line-height: 1.5;
    margin-bottom: 2px;
  }

  /* Manual Override */
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
    gap: 8px;
  }
  .override-row {
    display: flex;
    gap: 12px;
  }
  .override-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .override-field.full {
    flex: 1;
  }
  .field-label {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .override-field select,
  .override-field textarea {
    padding: 6px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    font-family: var(--font-sans, inherit);
    resize: vertical;
  }
  .override-field select:focus,
  .override-field textarea:focus {
    border-color: var(--accent-primary);
    outline: none;
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
  .btn-reestimate {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
    font-weight: 600;
  }
  .btn-reestimate:hover {
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
