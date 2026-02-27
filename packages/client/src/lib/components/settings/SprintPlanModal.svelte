<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import type { SprintRecommendation, SprintStoryAssignment } from '@e/shared';

  let capacity = $state(loopStore.sprintPlanCapacity);
  let capacityMode = $state<'points' | 'count'>(loopStore.sprintPlanCapacityMode);
  let showRationale = $state<number | null>(null);
  let expandedStoryReason = $state<string | null>(null);
  let dragStoryId = $state<string | null>(null);
  let dragFromSprint = $state<number | null>(null);
  let hasBeenAdjusted = $state(false);
  let saving = $state(false);

  function close() {
    loopStore.clearSprintPlan();
    uiStore.closeModal();
  }

  async function generate() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId || capacity <= 0) return;

    loopStore.setSprintPlanCapacity(capacity);
    loopStore.setSprintPlanCapacityMode(capacityMode);
    hasBeenAdjusted = false;

    const result = await loopStore.generateSprintPlan(prdId, capacity, capacityMode);
    if (!result.ok) {
      uiStore.toast(result.error || 'Sprint planning failed', 'error');
    }
  }

  async function saveAdjustedPlan() {
    const prdId = loopStore.selectedPrdId;
    if (!prdId) return;

    saving = true;
    try {
      const result = await loopStore.saveAdjustedPlan(prdId);
      if (result.ok) {
        hasBeenAdjusted = false;
        uiStore.toast('Sprint plan saved', 'success');
      } else {
        uiStore.toast(result.error || 'Failed to save plan', 'error');
      }
    } finally {
      saving = false;
    }
  }

  function toggleRationale(sprintIndex: number) {
    showRationale = showRationale === sprintIndex ? null : sprintIndex;
  }

  function toggleStoryReason(storyId: string) {
    expandedStoryReason = expandedStoryReason === storyId ? null : storyId;
  }

  function onDragStart(storyId: string, sprintIndex: number) {
    dragStoryId = storyId;
    dragFromSprint = sprintIndex;
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function onDrop(e: DragEvent, toSprintIndex: number) {
    e.preventDefault();
    if (dragStoryId !== null && dragFromSprint !== null && dragFromSprint !== toSprintIndex) {
      loopStore.moveStoryInPlan(dragStoryId, dragFromSprint, toSprintIndex);
      hasBeenAdjusted = true;
    }
    dragStoryId = null;
    dragFromSprint = null;
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

  function priorityLabel(p: string): string {
    return p === 'critical' ? '!!!' : p === 'high' ? '!!' : p === 'medium' ? '!' : '';
  }

  function capacityPercent(sprint: SprintRecommendation): number {
    if (capacityMode === 'count') {
      return Math.round((sprint.stories.length / capacity) * 100);
    }
    return Math.round((sprint.totalPoints / capacity) * 100);
  }

  function capacityBarColor(pct: number): string {
    if (pct > 100) return 'var(--accent-error)';
    if (pct >= 80) return 'var(--accent-warning, #e6a817)';
    return 'var(--accent-primary)';
  }

  let plan = $derived(loopStore.sprintPlanResult);

  // Auto-generate when modal opens if we have a PRD selected
  $effect(() => {
    if (
      loopStore.selectedPrdId &&
      !loopStore.generatingSprintPlan &&
      !loopStore.sprintPlanResult &&
      !loopStore.sprintPlanError
    ) {
      // Don't auto-generate — let the user set capacity first
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Sprint Plan Recommendations</h2>
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
      <!-- Capacity Configuration -->
      <div class="capacity-section">
        <h4 class="section-label">Sprint Capacity</h4>
        <div class="capacity-row">
          <div class="capacity-input-group">
            <input
              type="number"
              bind:value={capacity}
              min="1"
              max="200"
              class="capacity-input"
              placeholder="20"
            />
            <select bind:value={capacityMode} class="capacity-mode-select">
              <option value="points">Story Points</option>
              <option value="count">Stories</option>
            </select>
          </div>
          <button
            class="btn-generate"
            onclick={generate}
            disabled={loopStore.generatingSprintPlan || capacity <= 0}
          >
            {#if loopStore.generatingSprintPlan}
              <span class="spinner-sm"></span> Planning...
            {:else if plan}
              Re-plan
            {:else}
              Generate Plan
            {/if}
          </button>
        </div>
      </div>

      {#if loopStore.generatingSprintPlan}
        <!-- Loading state -->
        <div class="loading-state">
          <div class="spinner-large"></div>
          <p>Analyzing stories, dependencies, and priorities...</p>
          <p class="loading-sub">Generating optimal sprint assignments</p>
        </div>
      {:else if plan}
        <!-- Summary -->
        <div class="summary-section">
          <div class="summary-cards">
            <div class="summary-card">
              <span class="card-label">Sprints</span>
              <span class="card-value">{plan.totalSprints}</span>
            </div>
            <div class="summary-card">
              <span class="card-label">Total Points</span>
              <span class="card-value points">{plan.totalPoints}</span>
            </div>
            <div class="summary-card">
              <span class="card-label">Stories</span>
              <span class="card-value"
                >{plan.sprints.reduce((sum, s) => sum + s.stories.length, 0)}</span
              >
            </div>
          </div>
          <div class="summary-text">{plan.summary}</div>
        </div>

        <!-- Sprint List -->
        <div class="sprints-list">
          {#each plan.sprints as sprint, sprintIdx (sprint.sprintNumber)}
            <div
              class="sprint-card"
              class:drag-over={dragStoryId !== null && dragFromSprint !== sprintIdx}
              ondragover={onDragOver}
              ondrop={(e) => onDrop(e, sprintIdx)}
            >
              <div class="sprint-header">
                <div class="sprint-title-row">
                  <h4 class="sprint-title">Sprint {sprint.sprintNumber}</h4>
                  <span class="sprint-meta">
                    {sprint.totalPoints}pts · {sprint.stories.length}
                    {sprint.stories.length === 1 ? 'story' : 'stories'}
                  </span>
                </div>
                <div class="capacity-bar-container">
                  <div
                    class="capacity-bar"
                    style:width="{Math.min(capacityPercent(sprint), 100)}%"
                    style:background={capacityBarColor(capacityPercent(sprint))}
                  ></div>
                </div>
                <button class="rationale-toggle" onclick={() => toggleRationale(sprintIdx)}>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    stroke="none"
                    style="transform: rotate({showRationale === sprintIdx
                      ? '90deg'
                      : '0deg'}); transition: transform 0.15s ease"
                    ><polygon points="5 3 19 12 5 21 5 3" /></svg
                  > Rationale
                </button>
              </div>

              {#if showRationale === sprintIdx}
                <div class="sprint-rationale">{sprint.rationale}</div>
              {/if}

              <div class="sprint-stories">
                {#each sprint.stories as story (story.storyId)}
                  <div class="sprint-story-wrapper">
                    <div
                      class="sprint-story-item"
                      draggable="true"
                      ondragstart={() => onDragStart(story.storyId, sprintIdx)}
                    >
                      <span class="story-priority" style:color={priorityColor(story.priority)}>
                        {priorityLabel(story.priority) || '·'}
                      </span>
                      <span class="story-name">{story.title}</span>
                      <span class="story-pts">{story.storyPoints}pts</span>
                      <button
                        class="story-reason-btn"
                        class:active={expandedStoryReason === story.storyId}
                        title="View placement rationale"
                        onclick={(e) => {
                          e.stopPropagation();
                          toggleStoryReason(story.storyId);
                        }}>ℹ</button
                      >
                    </div>
                    {#if expandedStoryReason === story.storyId && story.reason}
                      <div class="story-reason-detail">{story.reason}</div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>

        <!-- Unassigned Stories -->
        {#if plan.unassignedStories.length > 0}
          <div class="unassigned-section">
            <h4 class="section-label">Unassigned ({plan.unassignedStories.length})</h4>
            <div class="unassigned-list">
              {#each plan.unassignedStories as story}
                <div class="unassigned-item">
                  <span class="unassigned-title">{story.title}</span>
                  <span class="unassigned-reason">{story.reason}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {:else if loopStore.sprintPlanError}
        <div class="error-banner">
          {loopStore.sprintPlanError}
        </div>
      {:else}
        <!-- Initial state -->
        <div class="initial-state">
          <p>
            Set sprint capacity and click <strong>Generate Plan</strong> to get AI-recommended sprint
            assignments.
          </p>
          <p class="initial-hint">
            Stories must have estimates. Use "Estimate All" first if needed.
          </p>
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      {#if plan && hasBeenAdjusted}
        <button class="btn-save" onclick={saveAdjustedPlan} disabled={saving}>
          {#if saving}
            <span class="spinner-sm"></span> Saving...
          {:else}
            Save Adjusted Plan
          {/if}
        </button>
      {/if}
      <button class="btn-close" onclick={close}>
        {plan ? 'Done' : 'Close'}
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

  /* Capacity Section */
  .capacity-section {
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border-primary);
  }
  .section-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .capacity-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .capacity-input-group {
    display: flex;
    gap: 4px;
    flex: 1;
  }
  .capacity-input {
    width: 80px;
    padding: 6px 8px;
    font-size: var(--fs-base);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono, monospace);
  }
  .capacity-input:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .capacity-mode-select {
    padding: 6px 8px;
    font-size: var(--fs-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .capacity-mode-select:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .btn-generate {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .btn-generate:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-generate:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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
  .spinner-sm {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  /* Summary */
  .summary-section {
    margin-bottom: 16px;
  }
  .summary-cards {
    display: flex;
    gap: 12px;
    margin-bottom: 10px;
  }
  .summary-card {
    flex: 1;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 10px;
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
    font-size: var(--fs-2xl);
    font-weight: 700;
    color: var(--text-primary);
  }
  .card-value.points {
    color: var(--accent-primary);
  }
  .summary-text {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.5;
    padding: 8px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }

  /* Sprint List */
  .sprints-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 16px;
  }
  .sprint-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
    transition: border-color 0.2s;
  }
  .sprint-card.drag-over {
    border-color: var(--accent-primary);
    border-style: dashed;
  }
  .sprint-header {
    margin-bottom: 8px;
  }
  .sprint-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .sprint-title {
    font-size: var(--fs-base);
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
  }
  .sprint-meta {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-weight: 600;
  }
  .capacity-bar-container {
    height: 3px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 4px;
  }
  .capacity-bar {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s ease;
  }
  .rationale-toggle {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    cursor: pointer;
    background: none;
    border: none;
    padding: 2px 4px;
    border-radius: 2px;
  }
  .rationale-toggle:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }
  .sprint-rationale {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    padding: 6px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    margin-bottom: 8px;
    line-height: 1.4;
  }

  /* Sprint Story Items */
  .sprint-stories {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sprint-story-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    cursor: grab;
    transition: background 0.15s;
  }
  .sprint-story-item:hover {
    background: var(--bg-hover);
  }
  .sprint-story-item:active {
    cursor: grabbing;
  }
  .story-priority {
    font-size: var(--fs-xxs);
    font-weight: 700;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }
  .story-name {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .story-pts {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--accent-primary);
    flex-shrink: 0;
  }
  .sprint-story-wrapper {
    display: flex;
    flex-direction: column;
  }
  .story-reason-btn {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 2px 4px;
    border-radius: 2px;
    line-height: 1;
  }
  .story-reason-btn:hover,
  .story-reason-btn.active {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .story-reason-detail {
    font-size: var(--fs-xxs);
    color: var(--text-secondary);
    padding: 4px 8px 4px 28px;
    line-height: 1.4;
    background: var(--bg-tertiary);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    margin-top: -1px;
    border: 1px solid var(--border-primary);
    border-top: none;
  }

  /* Unassigned */
  .unassigned-section {
    margin-bottom: 16px;
    padding: 10px 12px;
    background: rgba(230, 168, 23, 0.06);
    border: 1px solid rgba(230, 168, 23, 0.15);
    border-radius: var(--radius-sm);
  }
  .unassigned-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .unassigned-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 6px;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .unassigned-title {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .unassigned-reason {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-style: italic;
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
    margin-top: 12px;
  }

  /* Initial state */
  .initial-state {
    text-align: center;
    padding: 30px 20px;
    color: var(--text-secondary);
    font-size: var(--fs-base);
    line-height: 1.6;
  }
  .initial-hint {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    margin-top: 8px;
  }

  /* Footer */
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border-primary);
  }
  .btn-save {
    padding: 6px 16px;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
    background: var(--accent-primary);
    color: var(--text-on-accent);
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    border: none;
  }
  .btn-save:hover:not(:disabled) {
    opacity: 0.9;
  }
  .btn-save:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
