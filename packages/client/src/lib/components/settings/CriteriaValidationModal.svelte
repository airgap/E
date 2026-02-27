<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import type { ACCriterionValidation } from '@e/shared';

  // The story to validate
  let story = $derived(
    loopStore.selectedPrd?.stories?.find((s) => s.id === loopStore.validatingCriteriaStoryId) ||
      null,
  );

  // Track which suggestions the user has accepted (by criterion index)
  let acceptedSuggestions = $state<Set<number>>(new Set());

  // Track overrides — criterion indices the user wants to keep as-is with justification
  let overrideJustifications = $state<Record<number, string>>({});
  let showOverrideInput = $state<number | null>(null);

  function close() {
    loopStore.clearCriteriaValidation();
    acceptedSuggestions = new Set();
    overrideJustifications = {};
    showOverrideInput = null;
    uiStore.closeModal();
  }

  async function startValidation() {
    const prdId = loopStore.selectedPrdId;
    const storyId = loopStore.validatingCriteriaStoryId;
    if (!prdId || !storyId) return;

    const result = await loopStore.validateCriteria(prdId, storyId);
    if (!result.ok) {
      uiStore.toast(result.error || 'Validation failed', 'error');
    }
  }

  function toggleAcceptSuggestion(index: number) {
    const newSet = new Set(acceptedSuggestions);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
      // Remove any override for this criterion when accepting suggestion
      const newOverrides = { ...overrideJustifications };
      delete newOverrides[index];
      overrideJustifications = newOverrides;
      if (showOverrideInput === index) showOverrideInput = null;
      loopStore.removeCriteriaOverride(index);
    }
    acceptedSuggestions = newSet;
  }

  function startOverride(index: number) {
    showOverrideInput = index;
    // Remove from accepted if it was accepted
    const newSet = new Set(acceptedSuggestions);
    newSet.delete(index);
    acceptedSuggestions = newSet;
  }

  function confirmOverride(index: number) {
    const justification = overrideJustifications[index]?.trim();
    if (!justification) {
      uiStore.toast('Please provide a justification for overriding this warning', 'warning');
      return;
    }
    loopStore.addCriteriaOverride({ criterionIndex: index, justification });
    showOverrideInput = null;
  }

  function cancelOverride(index: number) {
    showOverrideInput = null;
    const newOverrides = { ...overrideJustifications };
    delete newOverrides[index];
    overrideJustifications = newOverrides;
  }

  async function applyChanges() {
    const prdId = loopStore.selectedPrdId;
    const storyId = loopStore.validatingCriteriaStoryId;
    if (!prdId || !storyId) return;

    const indices = Array.from(acceptedSuggestions);
    if (indices.length === 0) {
      uiStore.toast('No suggestions selected to apply', 'warning');
      return;
    }

    const result = await loopStore.applyCriteriaSuggestions(prdId, storyId, indices);
    if (result.ok) {
      uiStore.toast(`Applied ${indices.length} improved criteria`, 'success');
      // Re-validate with updated criteria
      await startValidation();
      acceptedSuggestions = new Set();
    } else {
      uiStore.toast(result.error || 'Failed to apply suggestions', 'error');
    }
  }

  function severityColor(severity: string): string {
    switch (severity) {
      case 'error':
        return 'var(--accent-error)';
      case 'warning':
        return 'var(--accent-warning, #e6a817)';
      case 'info':
        return 'var(--accent-primary)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  // severityIcon is now rendered inline as SVGs in the template

  function categoryLabel(category: string): string {
    switch (category) {
      case 'vague':
        return 'Vague';
      case 'unmeasurable':
        return 'Not Measurable';
      case 'untestable':
        return 'Not Testable';
      case 'too_broad':
        return 'Too Broad';
      case 'ambiguous':
        return 'Ambiguous';
      case 'missing_detail':
        return 'Missing Detail';
      default:
        return category;
    }
  }

  function scoreColor(score: number): string {
    if (score >= 80) return 'var(--accent-secondary)';
    if (score >= 50) return 'var(--accent-warning, #e6a817)';
    return 'var(--accent-error)';
  }

  function scoreLabel(score: number): string {
    if (score >= 90) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Fair';
    if (score >= 30) return 'Needs Work';
    return 'Poor';
  }

  function isOverridden(index: number): boolean {
    return loopStore.criteriaOverrides.some((o) => o.criterionIndex === index);
  }

  let hasIssues = $derived(
    loopStore.criteriaValidationResult?.criteria.some((c) => !c.isValid) || false,
  );

  let hasSuggestions = $derived(
    loopStore.criteriaValidationResult?.criteria.some((c) => c.suggestedReplacement) || false,
  );

  let issueCount = $derived(
    loopStore.criteriaValidationResult?.criteria.reduce((count, c) => count + c.issues.length, 0) ||
      0,
  );

  // Auto-start validation when modal opens
  $effect(() => {
    if (
      loopStore.validatingCriteriaStoryId &&
      !loopStore.validatingCriteria &&
      !loopStore.criteriaValidationResult
    ) {
      startValidation();
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Validate Acceptance Criteria</h2>
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
      {:else if loopStore.validatingCriteria}
        <!-- Loading state -->
        <div class="loading-state">
          <div class="spinner-large"></div>
          <p>Validating acceptance criteria...</p>
          <p class="loading-sub">Checking specificity, measurability, and testability</p>
        </div>
      {:else if loopStore.criteriaValidationResult}
        <!-- Results -->
        <!-- Story Info -->
        <div class="story-info">
          <span class="story-title">{story.title}</span>
          {#if story.description}
            <p class="story-desc">{story.description}</p>
          {/if}
        </div>

        <!-- Overall Score -->
        <div class="score-section">
          <div class="score-header">
            <span class="score-label">Criteria Quality</span>
            <div class="score-row">
              <span
                class="score-value"
                style:color={scoreColor(loopStore.criteriaValidationResult.overallScore)}
              >
                {loopStore.criteriaValidationResult.overallScore}/100
              </span>
              <span
                class="score-tag"
                style:background={scoreColor(loopStore.criteriaValidationResult.overallScore)}
              >
                {scoreLabel(loopStore.criteriaValidationResult.overallScore)}
              </span>
            </div>
          </div>
          <div class="score-bar-container">
            <div
              class="score-bar"
              style:width="{loopStore.criteriaValidationResult.overallScore}%"
              style:background={scoreColor(loopStore.criteriaValidationResult.overallScore)}
            ></div>
          </div>
          <p class="score-summary">{loopStore.criteriaValidationResult.summary}</p>
          {#if issueCount > 0}
            <div class="issue-summary">
              <span class="issue-count">{issueCount} issue{issueCount === 1 ? '' : 's'} found</span>
            </div>
          {/if}
        </div>

        <!-- Criteria List -->
        <div class="criteria-section">
          <h4 class="section-label">
            Criteria ({loopStore.criteriaValidationResult.criteria.length})
          </h4>
          <div class="criteria-list">
            {#each loopStore.criteriaValidationResult.criteria as criterion (criterion.index)}
              <div
                class="criterion-card"
                class:valid={criterion.isValid}
                class:invalid={!criterion.isValid && !isOverridden(criterion.index)}
                class:overridden={isOverridden(criterion.index)}
                class:accepted={acceptedSuggestions.has(criterion.index)}
              >
                <!-- Criterion header -->
                <div class="criterion-header">
                  <span class="criterion-index">{criterion.index + 1}</span>
                  <span
                    class="criterion-status-icon"
                    style:color={criterion.isValid
                      ? 'var(--accent-secondary)'
                      : severityColor(criterion.issues[0]?.severity || 'warning')}
                  >
                    {#if criterion.isValid}<svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                        stroke-linecap="round"
                        stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg
                      >{:else}{@const sev =
                        criterion.issues[0]?.severity || 'warning'}{#if sev === 'error'}<svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="3"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          ><line x1="18" y1="6" x2="6" y2="18" /><line
                            x1="6"
                            y1="6"
                            x2="18"
                            y2="18"
                          /></svg
                        >{:else if sev === 'warning'}<svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          ><path
                            d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                          /><line x1="12" y1="9" x2="12" y2="13" /><line
                            x1="12"
                            y1="17"
                            x2="12.01"
                            y2="17"
                          /></svg
                        >{:else}<svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          ><circle cx="12" cy="12" r="10" /><line
                            x1="12"
                            y1="16"
                            x2="12"
                            y2="12"
                          /><line x1="12" y1="8" x2="12.01" y2="8" /></svg
                        >{/if}{/if}
                  </span>
                  <span class="criterion-text">{criterion.text}</span>
                </div>

                <!-- Issues -->
                {#if criterion.issues.length > 0}
                  <div class="issues-list">
                    {#each criterion.issues as issue}
                      <div
                        class="issue-item"
                        style:border-left-color={severityColor(issue.severity)}
                      >
                        <div class="issue-header-row">
                          <span class="issue-severity" style:color={severityColor(issue.severity)}>
                            {#if issue.severity === 'error'}<svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="3"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                ><line x1="18" y1="6" x2="6" y2="18" /><line
                                  x1="6"
                                  y1="6"
                                  x2="18"
                                  y2="18"
                                /></svg
                              >{:else if issue.severity === 'warning'}<svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                ><path
                                  d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                                /><line x1="12" y1="9" x2="12" y2="13" /><line
                                  x1="12"
                                  y1="17"
                                  x2="12.01"
                                  y2="17"
                                /></svg
                              >{:else}<svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                ><circle cx="12" cy="12" r="10" /><line
                                  x1="12"
                                  y1="16"
                                  x2="12"
                                  y2="12"
                                /><line x1="12" y1="8" x2="12.01" y2="8" /></svg
                              >{/if}
                          </span>
                          <span class="issue-category">{categoryLabel(issue.category)}</span>
                        </div>
                        <p class="issue-message">{issue.message}</p>
                      </div>
                    {/each}
                  </div>
                {/if}

                <!-- Suggested replacement -->
                {#if criterion.suggestedReplacement && !isOverridden(criterion.index)}
                  <div class="suggestion-block">
                    <div class="suggestion-label-row">
                      <span class="suggestion-label">Suggested improvement:</span>
                    </div>
                    <div class="suggestion-text">{criterion.suggestedReplacement}</div>
                    <div class="suggestion-actions">
                      <button
                        class="btn-accept-suggestion"
                        class:active={acceptedSuggestions.has(criterion.index)}
                        onclick={() => toggleAcceptSuggestion(criterion.index)}
                      >
                        {#if acceptedSuggestions.has(criterion.index)}<svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            style="display:inline-block;vertical-align:middle;margin-right:3px"
                            ><polyline points="20 6 9 17 4 12" /></svg
                          >Accepted{:else}Accept{/if}
                      </button>
                      {#if !criterion.isValid}
                        <button class="btn-override" onclick={() => startOverride(criterion.index)}>
                          Override
                        </button>
                      {/if}
                    </div>
                  </div>
                {/if}

                <!-- Override input -->
                {#if showOverrideInput === criterion.index}
                  <div class="override-input-section">
                    <!-- svelte-ignore a11y_label_has_associated_control -->
                    <label class="override-label">Why is this criterion acceptable as-is?</label>
                    <textarea
                      class="override-textarea"
                      bind:value={overrideJustifications[criterion.index]}
                      placeholder="Provide justification for keeping this criterion unchanged..."
                      rows="2"
                    ></textarea>
                    <div class="override-actions">
                      <button
                        class="btn-confirm-override"
                        onclick={() => confirmOverride(criterion.index)}
                      >
                        Confirm Override
                      </button>
                      <button
                        class="btn-cancel-override"
                        onclick={() => cancelOverride(criterion.index)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                {/if}

                <!-- Override confirmed -->
                {#if isOverridden(criterion.index)}
                  <div class="override-confirmed">
                    <span class="override-badge">Overridden</span>
                    <span class="override-justification">
                      {loopStore.criteriaOverrides.find((o) => o.criterionIndex === criterion.index)
                        ?.justification}
                    </span>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- Error -->
        {#if loopStore.criteriaValidationError}
          <div class="error-banner">
            {loopStore.criteriaValidationError}
          </div>
        {/if}
      {:else if loopStore.criteriaValidationError}
        <div class="error-banner">
          {loopStore.criteriaValidationError}
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn-cancel" onclick={close}>
        {loopStore.criteriaValidationResult?.allValid ? 'Done' : 'Close'}
      </button>
      {#if loopStore.criteriaValidationResult && !loopStore.validatingCriteria}
        <button class="btn-revalidate" onclick={startValidation}> Re-validate </button>
        {#if acceptedSuggestions.size > 0}
          <button class="btn-apply" onclick={applyChanges}>
            Apply {acceptedSuggestions.size} Suggestion{acceptedSuggestions.size === 1 ? '' : 's'}
          </button>
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
    width: 680px;
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

  /* Story info */
  .story-info {
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border-primary);
  }
  .story-title {
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

  /* Score section */
  .score-section {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 12px;
    margin-bottom: 16px;
  }
  .score-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .score-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .score-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .score-value {
    font-size: var(--fs-lg);
    font-weight: 700;
  }
  .score-tag {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--text-on-accent);
  }
  .score-bar-container {
    height: 4px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .score-bar {
    height: 100%;
    border-radius: 2px;
    transition: width 0.5s ease;
  }
  .score-summary {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.4;
    margin: 0;
  }
  .issue-summary {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border-primary);
  }
  .issue-count {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--accent-warning, #e6a817);
  }

  /* Criteria section */
  .criteria-section {
    margin-bottom: 12px;
  }
  .section-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .criteria-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Criterion card */
  .criterion-card {
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    background: var(--bg-secondary);
    transition: border-color var(--transition);
  }
  .criterion-card.valid {
    border-left: 3px solid var(--accent-secondary);
  }
  .criterion-card.invalid {
    border-left: 3px solid var(--accent-warning, #e6a817);
  }
  .criterion-card.overridden {
    border-left: 3px solid var(--text-tertiary);
    opacity: 0.7;
  }
  .criterion-card.accepted {
    border-left: 3px solid var(--accent-primary);
  }

  .criterion-header {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-bottom: 4px;
  }
  .criterion-index {
    font-size: var(--fs-xxs);
    font-weight: 700;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .criterion-status-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .criterion-text {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    line-height: 1.4;
    flex: 1;
  }

  /* Issues */
  .issues-list {
    margin: 8px 0 0 24px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .issue-item {
    padding: 6px 8px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    border-left: 2px solid var(--text-tertiary);
  }
  .issue-header-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }
  .issue-severity {
    display: flex;
    align-items: center;
  }
  .issue-category {
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    background: var(--bg-secondary);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .issue-message {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.4;
    margin: 0;
  }

  /* Suggestion */
  .suggestion-block {
    margin: 8px 0 0 24px;
    padding: 8px 10px;
    background: rgba(59, 130, 246, 0.06);
    border: 1px solid rgba(59, 130, 246, 0.15);
    border-radius: var(--radius-sm);
  }
  .suggestion-label-row {
    margin-bottom: 4px;
  }
  .suggestion-label {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--accent-primary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .suggestion-text {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    line-height: 1.4;
    font-style: italic;
    margin-bottom: 8px;
  }
  .suggestion-actions {
    display: flex;
    gap: 6px;
  }
  .btn-accept-suggestion {
    font-size: var(--fs-xxs);
    padding: 3px 10px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
    font-weight: 600;
    transition: all var(--transition);
  }
  .btn-accept-suggestion:hover {
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-color: var(--accent-primary);
  }
  .btn-accept-suggestion.active {
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-color: var(--accent-primary);
  }
  .btn-override {
    font-size: var(--fs-xxs);
    padding: 3px 10px;
    border-radius: 3px;
    background: transparent;
    color: var(--text-tertiary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
  }
  .btn-override:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  /* Override input */
  .override-input-section {
    margin: 8px 0 0 24px;
    padding: 8px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .override-label {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-secondary);
    display: block;
    margin-bottom: 4px;
  }
  .override-textarea {
    width: 100%;
    padding: 6px 8px;
    font-size: var(--fs-xs);
    font-family: var(--font-sans, inherit);
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    resize: vertical;
    line-height: 1.4;
  }
  .override-textarea:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .override-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 6px;
  }
  .btn-confirm-override {
    font-size: var(--fs-xxs);
    padding: 3px 10px;
    border-radius: 3px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
    font-weight: 600;
  }
  .btn-confirm-override:hover {
    background: var(--bg-hover);
  }
  .btn-cancel-override {
    font-size: var(--fs-xxs);
    padding: 3px 10px;
    border-radius: 3px;
    background: transparent;
    color: var(--text-tertiary);
    border: none;
    cursor: pointer;
  }

  /* Override confirmed */
  .override-confirmed {
    margin: 6px 0 0 24px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-xs);
  }
  .override-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 1px 5px;
    border-radius: 2px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
  }
  .override-justification {
    color: var(--text-tertiary);
    font-style: italic;
    line-height: 1.4;
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
  .btn-revalidate {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
  }
  .btn-revalidate:hover {
    background: var(--bg-hover);
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  .btn-apply {
    padding: 6px 20px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
  }
  .btn-apply:hover {
    opacity: 0.9;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
