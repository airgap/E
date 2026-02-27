<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import type { GeneratedStory } from '@e/shared';

  // Input state
  let description = $state(loopStore.selectedPrd?.description || '');
  let context = $state('');
  let storyCount = $state(7);

  // Review state — stories the user is reviewing/editing before accepting
  let reviewStories = $state<GeneratedStory[]>([]);
  let editingIndex = $state<number | null>(null);
  let editTitle = $state('');
  let editDescription = $state('');
  let editCriteria = $state('');
  let editPriority = $state<string>('medium');

  // Phase: 'input' for PRD description, 'review' for generated stories
  let phase = $derived<'input' | 'review'>(
    reviewStories.length > 0 || loopStore.generatedStories.length > 0 ? 'review' : 'input',
  );

  // Keep reviewStories in sync with store
  $effect(() => {
    if (loopStore.generatedStories.length > 0 && reviewStories.length === 0) {
      reviewStories = [...loopStore.generatedStories];
    }
  });

  function close() {
    loopStore.clearGeneration();
    reviewStories = [];
    editingIndex = null;
    uiStore.closeModal();
  }

  async function handleGenerate() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId || !description.trim()) return;

    const result = await loopStore.generateStories(
      prdId,
      description.trim(),
      context.trim() || undefined,
      storyCount,
    );
    if (result.ok) {
      reviewStories = [...loopStore.generatedStories];
    } else {
      uiStore.toast(result.error || 'Generation failed', 'error');
    }
  }

  function startEditing(index: number) {
    const story = reviewStories[index];
    editingIndex = index;
    editTitle = story.title;
    editDescription = story.description;
    editCriteria = story.acceptanceCriteria.join('\n');
    editPriority = story.priority;
  }

  function saveEditing() {
    if (editingIndex === null) return;
    reviewStories = reviewStories.map((s, i) =>
      i === editingIndex
        ? {
            ...s,
            title: editTitle.trim(),
            description: editDescription.trim(),
            acceptanceCriteria: editCriteria
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean),
            priority: editPriority as GeneratedStory['priority'],
          }
        : s,
    );
    editingIndex = null;
  }

  function cancelEditing() {
    editingIndex = null;
  }

  function removeStory(index: number) {
    reviewStories = reviewStories.filter((_, i) => i !== index);
    if (editingIndex === index) editingIndex = null;
  }

  function backToInput() {
    reviewStories = [];
    loopStore.clearGeneration();
    editingIndex = null;
  }

  async function handleAccept() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId || reviewStories.length === 0) return;

    const result = await loopStore.acceptGeneratedStories(prdId, reviewStories);
    if (result.ok) {
      uiStore.toast(`Added ${reviewStories.length} stories to PRD`, 'success');
      reviewStories = [];
      close();
    } else {
      uiStore.toast(result.error || 'Failed to accept stories', 'error');
    }
  }

  function priorityLabel(p: string): string {
    switch (p) {
      case 'critical':
        return 'Critical';
      case 'high':
        return 'High';
      case 'medium':
        return 'Medium';
      case 'low':
        return 'Low';
      default:
        return p;
    }
  }

  function priorityColor(p: string): string {
    switch (p) {
      case 'critical':
        return 'var(--accent-error)';
      case 'high':
        return 'var(--accent-warning, #e6a817)';
      case 'medium':
        return 'var(--accent-primary)';
      case 'low':
        return 'var(--text-tertiary)';
      default:
        return 'var(--text-tertiary)';
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>{phase === 'input' ? 'Generate Stories from PRD' : 'Review Generated Stories'}</h2>
      <button class="close-btn" onclick={close}>
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
      {#if phase === 'input'}
        <!-- INPUT PHASE -->
        <div class="form-section">
          <label class="field-label" for="prd-desc">PRD Description</label>
          <textarea
            id="prd-desc"
            bind:value={description}
            placeholder="Describe the product requirements, features, and goals. Be as detailed as possible — the AI will break this down into implementable user stories."
            rows="8"
          ></textarea>
        </div>

        <div class="form-section">
          <label class="field-label" for="prd-context">Additional Context (optional)</label>
          <textarea
            id="prd-context"
            bind:value={context}
            placeholder="Any constraints, tech stack details, or implementation notes that should inform story scoping..."
            rows="3"
          ></textarea>
        </div>

        <div class="form-section">
          <div class="form-row">
            <label class="field-label" for="story-count">Target number of stories</label>
            <input id="story-count" type="number" bind:value={storyCount} min="3" max="15" />
          </div>
        </div>

        {#if loopStore.generateError}
          <div class="error-banner">
            {loopStore.generateError}
          </div>
        {/if}
      {:else}
        <!-- REVIEW PHASE -->
        <div class="review-header">
          <span class="review-count">{reviewStories.length} stories generated</span>
          <button class="btn-regenerate" onclick={backToInput} disabled={loopStore.generating}>
            Regenerate
          </button>
        </div>

        <div class="story-review-list">
          {#each reviewStories as story, i (i)}
            <div class="review-card" class:editing={editingIndex === i}>
              {#if editingIndex === i}
                <!-- Editing mode -->
                <div class="edit-form">
                  <input class="edit-title" bind:value={editTitle} placeholder="Story title" />
                  <textarea
                    class="edit-desc"
                    bind:value={editDescription}
                    placeholder="Description"
                    rows="2"
                  ></textarea>
                  <div class="edit-priority-row">
                    <label class="field-label-inline">Priority:</label>
                    <select bind:value={editPriority}>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                  <label class="field-label-inline">Acceptance Criteria (one per line):</label>
                  <textarea class="edit-criteria" bind:value={editCriteria} rows="4"></textarea>
                  <div class="edit-actions">
                    <button class="btn-save" onclick={saveEditing}>Save</button>
                    <button class="btn-cancel-edit" onclick={cancelEditing}>Cancel</button>
                  </div>
                </div>
              {:else}
                <!-- View mode -->
                <div class="card-header">
                  <span class="card-index">{i + 1}</span>
                  <span class="card-title">{story.title}</span>
                  <span class="card-priority" style:color={priorityColor(story.priority)}>
                    {priorityLabel(story.priority)}
                  </span>
                  <div class="card-actions">
                    <button class="card-btn" title="Edit story" onclick={() => startEditing(i)}>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                    </button>
                    <button
                      class="card-btn card-btn-danger"
                      title="Remove story"
                      onclick={() => removeStory(i)}
                    >
                      <svg
                        width="12"
                        height="12"
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
                </div>
                {#if story.description}
                  <div class="card-description">{story.description}</div>
                {/if}
                <div class="card-criteria">
                  <span class="criteria-label">Acceptance Criteria:</span>
                  <ul>
                    {#each story.acceptanceCriteria as criterion}
                      <li>{criterion}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      {#if phase === 'input'}
        <button class="btn-cancel" onclick={close}>Cancel</button>
        <button
          class="btn-generate"
          onclick={handleGenerate}
          disabled={loopStore.generating || !description.trim()}
        >
          {#if loopStore.generating}
            <span class="spinner"></span>
            Generating...
          {:else}
            Generate Stories
          {/if}
        </button>
      {:else}
        <button class="btn-cancel" onclick={close}>Cancel</button>
        <button
          class="btn-accept"
          onclick={handleAccept}
          disabled={loopStore.loading || reviewStories.length === 0}
        >
          Accept {reviewStories.length}
          {reviewStories.length === 1 ? 'Story' : 'Stories'}
        </button>
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
    width: 600px;
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

  .form-section {
    margin-bottom: 16px;
  }
  .field-label {
    display: block;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }
  .field-label-inline {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .form-section textarea {
    width: 100%;
    padding: 8px 10px;
    font-size: var(--fs-base);
    font-family: var(--font-sans, inherit);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    resize: vertical;
    line-height: 1.5;
  }
  .form-section textarea:focus {
    border-color: var(--accent-primary);
    outline: none;
  }

  .form-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .form-row input[type='number'] {
    width: 80px;
    padding: 4px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }

  .error-banner {
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--accent-error);
    border-radius: var(--radius-sm);
    color: var(--accent-error);
    font-size: var(--fs-sm);
  }

  /* Review phase */
  .review-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .review-count {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .btn-regenerate {
    font-size: var(--fs-xs);
    padding: 4px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
  }
  .btn-regenerate:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .story-review-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .review-card {
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    overflow: hidden;
  }
  .review-card.editing {
    border-color: var(--accent-primary);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-tertiary);
  }
  .card-index {
    font-size: var(--fs-xxs);
    font-weight: 700;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--accent-primary);
    color: var(--text-on-accent);
    flex-shrink: 0;
  }
  .card-title {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-priority {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    flex-shrink: 0;
  }
  .card-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity var(--transition);
  }
  .review-card:hover .card-actions {
    opacity: 1;
  }
  .card-btn {
    padding: 3px 5px;
    border-radius: 3px;
    color: var(--text-tertiary);
    cursor: pointer;
  }
  .card-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .card-btn-danger:hover {
    color: var(--accent-error);
  }

  .card-description {
    padding: 6px 12px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .card-criteria {
    padding: 6px 12px 10px;
  }
  .criteria-label {
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
  }
  .card-criteria ul {
    margin: 4px 0 0;
    padding-left: 16px;
  }
  .card-criteria li {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  /* Edit form */
  .edit-form {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .edit-title {
    padding: 6px 8px;
    font-size: var(--fs-base);
    font-weight: 600;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .edit-desc,
  .edit-criteria {
    padding: 6px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    font-family: var(--font-sans, inherit);
    resize: vertical;
  }
  .edit-priority-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .edit-priority-row select {
    padding: 3px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .edit-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 4px;
  }
  .btn-save {
    padding: 4px 12px;
    font-size: var(--fs-xs);
    font-weight: 600;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
  }
  .btn-cancel-edit {
    padding: 4px 12px;
    font-size: var(--fs-xs);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    cursor: pointer;
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
  .btn-generate,
  .btn-accept {
    padding: 6px 20px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .btn-generate:hover:not(:disabled),
  .btn-accept:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-generate:disabled,
  .btn-accept:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
