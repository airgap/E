<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';

  // The story to refine — find it from the selected PRD
  let story = $derived(
    loopStore.selectedPrd?.stories?.find((s) => s.id === loopStore.refiningStoryId) || null,
  );

  // Track user answers to questions
  let answers = $state<Record<string, string>>({});

  function close() {
    loopStore.clearRefinement();
    answers = {};
    uiStore.closeModal();
  }

  async function startRefinement() {
    const prdId = loopStore.selectedPrdId;
    const storyId = loopStore.refiningStoryId;
    if (!prdId || !storyId) return;

    const result = await loopStore.refineStory(prdId, storyId);
    if (!result.ok) {
      uiStore.toast(result.error || 'Refinement failed', 'error');
    }
  }

  async function submitAnswers() {
    const prdId = loopStore.selectedPrdId;
    const storyId = loopStore.refiningStoryId;
    if (!prdId || !storyId) return;

    const answersArray = loopStore.refinementQuestions
      .filter((q) => answers[q.id]?.trim())
      .map((q) => ({ questionId: q.id, answer: answers[q.id].trim() }));

    if (answersArray.length === 0) {
      uiStore.toast('Please answer at least one question', 'warning');
      return;
    }

    // Clear answers for the next round
    answers = {};

    const result = await loopStore.refineStory(prdId, storyId, answersArray);
    if (result.ok) {
      if (loopStore.refinementMeetsThreshold) {
        uiStore.toast('Story refined and meets quality threshold!', 'success');
      }
    } else {
      uiStore.toast(result.error || 'Refinement failed', 'error');
    }
  }

  function selectSuggestion(questionId: string, suggestion: string) {
    answers[questionId] = suggestion;
  }

  function qualityColor(score: number): string {
    if (score >= 80) return 'var(--accent-secondary)';
    if (score >= 50) return 'var(--accent-warning, #e6a817)';
    return 'var(--accent-error)';
  }

  function qualityLabel(score: number): string {
    if (score >= 90) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Fair';
    if (score >= 30) return 'Needs Work';
    return 'Very Vague';
  }

  // Auto-start refinement when modal opens with no questions yet
  $effect(() => {
    if (loopStore.refiningStoryId && loopStore.refinementRound === 0 && !loopStore.refining) {
      startRefinement();
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Refine Story</h2>
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
      {:else if loopStore.refining && loopStore.refinementRound === 0}
        <!-- Loading: initial analysis -->
        <div class="loading-state">
          <div class="spinner-large"></div>
          <p>Analyzing story for clarity and completeness...</p>
          <p class="loading-sub">"{story.title}"</p>
        </div>
      {:else if loopStore.refining}
        <!-- Loading: processing answers -->
        <div class="loading-state">
          <div class="spinner-large"></div>
          <p>Refining story with your answers...</p>
        </div>
      {:else}
        <!-- Story Info -->
        <div class="story-info">
          <div class="story-title-row">
            <span class="story-title">{story.title}</span>
            <span class="round-badge">Round {loopStore.refinementRound}</span>
          </div>
          {#if story.description}
            <p class="story-desc">{story.description}</p>
          {/if}
        </div>

        <!-- Quality Score -->
        {#if loopStore.refinementQualityScore !== null}
          <div class="quality-section">
            <div class="quality-header">
              <span class="quality-label">Quality Score</span>
              <div class="quality-score-row">
                <span
                  class="quality-score"
                  style:color={qualityColor(loopStore.refinementQualityScore)}
                >
                  {loopStore.refinementQualityScore}/100
                </span>
                <span
                  class="quality-tag"
                  style:background={qualityColor(loopStore.refinementQualityScore)}
                >
                  {qualityLabel(loopStore.refinementQualityScore)}
                </span>
              </div>
            </div>
            <div class="quality-bar-container">
              <div
                class="quality-bar"
                style:width="{loopStore.refinementQualityScore}%"
                style:background={qualityColor(loopStore.refinementQualityScore)}
              ></div>
            </div>
            <p class="quality-explanation">{loopStore.refinementQualityExplanation}</p>
          </div>
        {/if}

        <!-- Improvements (shown after answers submitted) -->
        {#if loopStore.refinementImprovements.length > 0}
          <div class="improvements-section">
            <h4 class="section-label">Improvements Made</h4>
            <ul class="improvements-list">
              {#each loopStore.refinementImprovements as improvement}
                <li>{improvement}</li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- Updated Story Preview -->
        {#if loopStore.refinementUpdatedStory && loopStore.refinementRound > 1}
          <div class="updated-story-section">
            <h4 class="section-label">Updated Story</h4>
            <div class="updated-card">
              <div class="updated-field">
                <span class="field-label">Title:</span>
                <span>{loopStore.refinementUpdatedStory.title}</span>
              </div>
              <div class="updated-field">
                <span class="field-label">Description:</span>
                <span>{loopStore.refinementUpdatedStory.description}</span>
              </div>
              <div class="updated-field">
                <span class="field-label">Acceptance Criteria:</span>
                <ul>
                  {#each loopStore.refinementUpdatedStory.acceptanceCriteria as criterion}
                    <li>{criterion}</li>
                  {/each}
                </ul>
              </div>
            </div>
          </div>
        {/if}

        <!-- Questions -->
        {#if loopStore.refinementQuestions.length > 0}
          <div class="questions-section">
            <h4 class="section-label">
              Clarifying Questions ({loopStore.refinementQuestions.length})
            </h4>
            <div class="questions-list">
              {#each loopStore.refinementQuestions as question (question.id)}
                <div class="question-card">
                  <div class="question-text">{question.question}</div>
                  <div class="question-context">{question.context}</div>
                  {#if question.suggestedAnswers && question.suggestedAnswers.length > 0}
                    <div class="suggestions">
                      <span class="suggestions-label">Suggestions:</span>
                      <div class="suggestion-chips">
                        {#each question.suggestedAnswers as suggestion}
                          <button
                            class="suggestion-chip"
                            class:selected={answers[question.id] === suggestion}
                            onclick={() => selectSuggestion(question.id, suggestion)}
                          >
                            {suggestion}
                          </button>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  <textarea
                    class="answer-input"
                    bind:value={answers[question.id]}
                    placeholder="Your answer..."
                    rows="2"
                  ></textarea>
                </div>
              {/each}
            </div>
          </div>
        {:else if loopStore.refinementMeetsThreshold}
          <div class="threshold-met">
            <div class="threshold-icon">✓</div>
            <p>This story meets the quality threshold and is ready for implementation!</p>
          </div>
        {/if}

        <!-- Error -->
        {#if loopStore.refineError}
          <div class="error-banner">
            {loopStore.refineError}
          </div>
        {/if}
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn-cancel" onclick={close}>
        {loopStore.refinementMeetsThreshold ? 'Done' : 'Cancel'}
      </button>
      {#if loopStore.refinementQuestions.length > 0 && !loopStore.refining}
        <button
          class="btn-submit"
          onclick={submitAnswers}
          disabled={Object.values(answers).filter((a) => a?.trim()).length === 0}
        >
          Submit Answers & Refine
        </button>
      {:else if loopStore.refinementMeetsThreshold && !loopStore.refining}
        <button class="btn-refine-again" onclick={startRefinement}> Refine Again </button>
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
    width: 640px;
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

  /* Loading state */
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
  .story-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .story-title {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .round-badge {
    font-size: var(--fs-xxs);
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    font-weight: 600;
  }
  .story-desc {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    margin-top: 6px;
    line-height: 1.4;
  }

  /* Quality section */
  .quality-section {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 12px;
    margin-bottom: 16px;
  }
  .quality-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .quality-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .quality-score-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .quality-score {
    font-size: var(--fs-lg);
    font-weight: 700;
  }
  .quality-tag {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--text-on-accent);
  }
  .quality-bar-container {
    height: 4px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .quality-bar {
    height: 100%;
    border-radius: 2px;
    transition: width 0.5s ease;
  }
  .quality-explanation {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.4;
    margin: 0;
  }

  /* Improvements */
  .improvements-section {
    margin-bottom: 16px;
  }
  .section-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .improvements-list {
    padding-left: 16px;
    margin: 0;
  }
  .improvements-list li {
    font-size: var(--fs-sm);
    color: var(--accent-secondary);
    line-height: 1.5;
  }

  /* Updated story preview */
  .updated-story-section {
    margin-bottom: 16px;
  }
  .updated-card {
    background: var(--bg-secondary);
    border: 1px solid var(--accent-secondary);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
  }
  .updated-field {
    margin-bottom: 6px;
    font-size: var(--fs-sm);
    color: var(--text-primary);
    line-height: 1.4;
  }
  .updated-field:last-child {
    margin-bottom: 0;
  }
  .field-label {
    font-weight: 600;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
  }
  .updated-card ul {
    padding-left: 16px;
    margin: 4px 0 0;
  }
  .updated-card li {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  /* Questions section */
  .questions-section {
    margin-bottom: 12px;
  }
  .questions-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .question-card {
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    background: var(--bg-secondary);
  }
  .question-text {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }
  .question-context {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    margin-bottom: 8px;
    font-style: italic;
    line-height: 1.4;
  }
  .suggestions {
    margin-bottom: 6px;
  }
  .suggestions-label {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .suggestion-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .suggestion-chip {
    font-size: var(--fs-xs);
    padding: 3px 8px;
    border-radius: 12px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
    transition: all var(--transition);
  }
  .suggestion-chip:hover {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
  .suggestion-chip.selected {
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-color: var(--accent-primary);
  }
  .answer-input {
    width: 100%;
    padding: 6px 8px;
    font-size: var(--fs-sm);
    font-family: var(--font-sans, inherit);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    resize: vertical;
    line-height: 1.4;
  }
  .answer-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  /* Threshold met */
  .threshold-met {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px 20px;
    gap: 8px;
    text-align: center;
  }
  .threshold-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--accent-secondary);
    color: var(--text-on-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-2xl);
    font-weight: 700;
  }
  .threshold-met p {
    font-size: var(--fs-base);
    color: var(--text-secondary);
    margin: 0;
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
  .btn-submit {
    padding: 6px 20px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
  }
  .btn-submit:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-submit:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn-refine-again {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
  }
  .btn-refine-again:hover {
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
