<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import { api } from '$lib/api/client';
  import type { StoryPriority, UserStory } from '@e/shared';

  // If editingStoryId is set, we're editing; otherwise creating
  let editingStory = $derived<UserStory | null>(
    loopStore.editingStoryId
      ? (loopStore.selectedPrd?.stories?.find((s) => s.id === loopStore.editingStoryId) ?? null)
      : null,
  );

  let isEditMode = $derived(!!editingStory);

  // Form state
  let title = $state('');
  let description = $state('');
  let priority = $state<StoryPriority>('medium');
  let criteria = $state<string[]>(['']);
  let dependsOn = $state<string[]>([]);
  let researchOnly = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  // New criterion input
  let newCriterionInput = $state('');

  // Populate form when editing
  $effect(() => {
    if (editingStory) {
      title = editingStory.title;
      description = editingStory.description || '';
      priority = editingStory.priority;
      criteria =
        editingStory.acceptanceCriteria.length > 0
          ? editingStory.acceptanceCriteria.map((c) => c.description)
          : [''];
      dependsOn = editingStory.dependsOn || [];
      researchOnly = editingStory.researchOnly || false;
    } else {
      resetForm();
    }
  });

  // Available stories for dependencies (exclude self when editing)
  let availableStories = $derived(
    (loopStore.selectedPrd?.stories || []).filter((s) => s.id !== loopStore.editingStoryId),
  );

  function resetForm() {
    title = '';
    description = '';
    priority = 'medium';
    criteria = [''];
    dependsOn = [];
    researchOnly = false;
    error = null;
    newCriterionInput = '';
  }

  function close() {
    loopStore.setEditingStoryId(null);
    resetForm();
    uiStore.closeModal();
  }

  function addCriterion() {
    criteria = [...criteria, ''];
    // Focus the new input after DOM updates
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll('.criterion-input');
      const lastInput = inputs[inputs.length - 1] as HTMLInputElement;
      lastInput?.focus();
    });
  }

  function removeCriterion(index: number) {
    criteria = criteria.filter((_, i) => i !== index);
    if (criteria.length === 0) {
      criteria = [''];
    }
  }

  function updateCriterion(index: number, value: string) {
    criteria = criteria.map((c, i) => (i === index ? value : c));
  }

  function moveCriterion(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= criteria.length) return;
    const newCriteria = [...criteria];
    [newCriteria[index], newCriteria[newIndex]] = [newCriteria[newIndex], newCriteria[index]];
    criteria = newCriteria;
  }

  function toggleDependency(storyId: string) {
    if (dependsOn.includes(storyId)) {
      dependsOn = dependsOn.filter((id) => id !== storyId);
    } else {
      dependsOn = [...dependsOn, storyId];
    }
  }

  function handleCriterionKeydown(e: KeyboardEvent, index: number) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // If current criterion has content, add a new one
      if (criteria[index]?.trim()) {
        addCriterion();
      }
    } else if (e.key === 'Backspace' && !criteria[index] && criteria.length > 1) {
      e.preventDefault();
      removeCriterion(index);
      // Focus previous input
      requestAnimationFrame(() => {
        const inputs = document.querySelectorAll('.criterion-input');
        const prevInput = inputs[Math.max(0, index - 1)] as HTMLInputElement;
        prevInput?.focus();
      });
    }
  }

  async function handleSubmit() {
    if (!title.trim()) {
      error = 'Title is required';
      return;
    }

    const prdId = loopStore.selectedPrdId;
    if (!prdId) {
      error = 'No PRD selected';
      return;
    }

    saving = true;
    error = null;

    const cleanCriteria = criteria.filter((c) => c.trim());

    try {
      if (isEditMode && editingStory) {
        // Update existing story
        await api.prds.updateStory(prdId, editingStory.id, {
          title: title.trim(),
          description: description.trim(),
          acceptanceCriteria: cleanCriteria,
          priority,
          dependsOn,
          researchOnly,
        });
        await loopStore.loadPrd(prdId);
        uiStore.toast(`Updated story: ${title.trim()}`, 'success');
      } else {
        // Create new story
        await api.prds.addStory(prdId, {
          title: title.trim(),
          description: description.trim(),
          acceptanceCriteria: cleanCriteria,
          priority,
          dependsOn,
          researchOnly,
        });
        await loopStore.loadPrd(prdId);
        uiStore.toast(`Created story: ${title.trim()}`, 'success');
      }
      close();
    } catch (err) {
      error = `Failed to ${isEditMode ? 'update' : 'create'} story: ${err}`;
    } finally {
      saving = false;
    }
  }

  function priorityColor(p: StoryPriority): string {
    switch (p) {
      case 'critical':
        return 'var(--accent-error)';
      case 'high':
        return 'var(--accent-warning, #e6a817)';
      case 'medium':
        return 'var(--accent-primary)';
      case 'low':
        return 'var(--text-tertiary)';
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>{isEditMode ? 'Edit Story' : 'Create Story'}</h2>
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
      <!-- Title -->
      <div class="form-group">
        <label class="form-label" for="story-title">
          Title <span class="required">*</span>
        </label>
        <input
          id="story-title"
          class="form-input"
          type="text"
          bind:value={title}
          placeholder="As a user, I want to..."
          autofocus
        />
      </div>

      <!-- Description -->
      <div class="form-group">
        <label class="form-label" for="story-desc">Description</label>
        <textarea
          id="story-desc"
          class="form-textarea"
          bind:value={description}
          placeholder="Provide additional context, requirements, and implementation notes..."
          rows="4"
        ></textarea>
      </div>

      <!-- Priority + Research Only row -->
      <div class="form-row">
        <div class="form-group form-group-inline">
          <label class="form-label" for="story-priority">Priority</label>
          <div class="priority-select-wrap">
            <select id="story-priority" class="form-select" bind:value={priority}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <span class="priority-indicator" style:background={priorityColor(priority)}></span>
          </div>
        </div>

        <div class="form-group form-group-inline">
          <label class="form-label toggle-label">
            <input type="checkbox" class="form-checkbox" bind:checked={researchOnly} />
            <span class="checkbox-custom"></span>
            Research only
            <span
              class="form-hint-inline"
              title="Research stories are excluded from implementation loops">?</span
            >
          </label>
        </div>
      </div>

      <!-- Acceptance Criteria -->
      <div class="form-group">
        <div class="form-label-row">
          <label class="form-label">Acceptance Criteria</label>
          <button class="add-criterion-btn" onclick={addCriterion} title="Add criterion">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
            >
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add
          </button>
        </div>
        <div class="criteria-list">
          {#each criteria as criterion, i (i)}
            <div class="criterion-row">
              <span class="criterion-number">{i + 1}.</span>
              <input
                class="form-input criterion-input"
                type="text"
                value={criterion}
                oninput={(e) => updateCriterion(i, (e.target as HTMLInputElement).value)}
                onkeydown={(e) => handleCriterionKeydown(e, i)}
                placeholder="Given... When... Then..."
              />
              <div class="criterion-actions">
                {#if criteria.length > 1}
                  <button
                    class="criterion-action-btn"
                    onclick={() => moveCriterion(i, -1)}
                    disabled={i === 0}
                    title="Move up"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="18 15 12 9 6 15"></polyline>
                    </svg>
                  </button>
                  <button
                    class="criterion-action-btn"
                    onclick={() => moveCriterion(i, 1)}
                    disabled={i === criteria.length - 1}
                    title="Move down"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </button>
                  <button
                    class="criterion-action-btn criterion-remove"
                    onclick={() => removeCriterion(i)}
                    title="Remove"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
        <p class="form-hint">Press Enter to add a new criterion. Backspace on empty removes it.</p>
      </div>

      <!-- Dependencies -->
      {#if availableStories.length > 0}
        <div class="form-group">
          <label class="form-label">Dependencies</label>
          <div class="dependencies-list">
            {#each availableStories as story (story.id)}
              <button
                class="dependency-chip"
                class:selected={dependsOn.includes(story.id)}
                onclick={() => toggleDependency(story.id)}
                title={story.description || story.title}
              >
                <span class="dep-check">{dependsOn.includes(story.id) ? '✓' : ''}</span>
                <span class="dep-title">{story.title}</span>
                <span class="dep-priority" style:color={priorityColor(story.priority)}>
                  {story.priority === 'critical'
                    ? '!!!'
                    : story.priority === 'high'
                      ? '!!'
                      : story.priority === 'medium'
                        ? '!'
                        : ''}
                </span>
              </button>
            {/each}
          </div>
          <p class="form-hint">Select stories that must be completed before this one.</p>
        </div>
      {/if}

      <!-- Error -->
      {#if error}
        <div class="error-banner">{error}</div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn-cancel" onclick={close}>Cancel</button>
      <button class="btn-submit" onclick={handleSubmit} disabled={saving || !title.trim()}>
        {#if saving}
          <span class="spinner-sm"></span>
          {isEditMode ? 'Saving...' : 'Creating...'}
        {:else}
          {isEditMode ? 'Save Changes' : 'Create Story'}
        {/if}
      </button>
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
    background: none;
    border: none;
    cursor: pointer;
  }
  .close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .modal-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Form fields */
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .form-group-inline {
    flex: 0 0 auto;
  }
  .form-row {
    display: flex;
    gap: 20px;
    align-items: flex-start;
  }
  .form-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .form-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .required {
    color: var(--accent-error);
  }
  .form-input,
  .form-textarea,
  .form-select {
    width: 100%;
    padding: 8px 10px;
    font-size: var(--fs-sm);
    font-family: var(--font-sans, inherit);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    transition: border-color var(--transition);
  }
  .form-input:focus,
  .form-textarea:focus,
  .form-select:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .form-textarea {
    resize: vertical;
    line-height: 1.5;
    min-height: 80px;
  }

  /* Priority select */
  .priority-select-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .form-select {
    width: auto;
    min-width: 120px;
    cursor: pointer;
  }
  .priority-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background var(--transition);
  }

  /* Checkbox toggle */
  .toggle-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
    font-weight: 500;
    padding-top: 24px;
  }
  .form-checkbox {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .checkbox-custom {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border-primary);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all var(--transition);
    background: var(--bg-tertiary);
  }
  .form-checkbox:checked + .checkbox-custom {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  .form-checkbox:checked + .checkbox-custom::after {
    content: '✓';
    color: var(--text-on-accent);
    font-size: var(--fs-sans-xs);
    font-weight: 700;
  }
  .form-hint-inline {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    font-size: var(--fs-sans-xs);
    font-weight: 700;
    color: var(--text-tertiary);
    cursor: help;
    flex-shrink: 0;
  }

  /* Acceptance Criteria */
  .criteria-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .criterion-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .criterion-number {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    font-weight: 600;
    width: 18px;
    text-align: right;
    flex-shrink: 0;
  }
  .criterion-input {
    flex: 1;
    padding: 6px 8px !important;
    font-size: var(--fs-xs) !important;
  }
  .criterion-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity var(--transition);
  }
  .criterion-row:hover .criterion-actions {
    opacity: 1;
  }
  .criterion-action-btn {
    padding: 2px 4px;
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .criterion-action-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .criterion-action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .criterion-remove:hover:not(:disabled) {
    color: var(--accent-error);
  }

  .add-criterion-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--accent-primary);
    background: none;
    border: none;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .add-criterion-btn:hover {
    background: var(--bg-hover);
  }

  .form-hint {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin: 0;
    line-height: 1.3;
  }

  /* Dependencies */
  .dependencies-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 140px;
    overflow-y: auto;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 4px;
    background: var(--bg-secondary);
  }
  .dependency-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition: all var(--transition);
  }
  .dependency-chip:hover {
    background: var(--bg-hover);
    border-color: var(--border-primary);
  }
  .dependency-chip.selected {
    background: rgba(59, 130, 246, 0.1);
    border-color: var(--accent-primary);
    color: var(--text-primary);
  }
  .dep-check {
    width: 14px;
    height: 14px;
    border: 1.5px solid var(--border-primary);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-sans-xs);
    font-weight: 700;
    flex-shrink: 0;
    transition: all var(--transition);
  }
  .dependency-chip.selected .dep-check {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--text-on-accent);
  }
  .dep-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dep-priority {
    font-weight: 700;
    font-size: var(--fs-xxs);
    flex-shrink: 0;
  }

  /* Error */
  .error-banner {
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--accent-error);
    border-radius: var(--radius-sm);
    color: var(--accent-error);
    font-size: var(--fs-sm);
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
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .btn-submit:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-submit:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .spinner-sm {
    display: inline-block;
    width: 12px;
    height: 12px;
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
