<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { loopStore } from '$lib/stores/loop.svelte';
  import type { MatrixQuadrant, MatrixStoryPosition } from '@e/shared';

  let draggingStory = $state<string | null>(null);
  let dragOffset = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let matrixEl = $state<HTMLDivElement | undefined>(undefined);
  let hoveredStory = $state<string | null>(null);

  const quadrantLabels: Record<
    MatrixQuadrant,
    { label: string; description: string; icon: string }
  > = {
    quick_wins: { label: 'Quick Wins', description: 'High value, low effort', icon: '↯' },
    major_projects: { label: 'Major Projects', description: 'High value, high effort', icon: '▩' },
    fill_ins: { label: 'Fill-ins', description: 'Low value, low effort', icon: '▤' },
    low_priority: { label: 'Low Priority', description: 'Low value, high effort', icon: '◴' },
  };

  const quadrantColors: Record<MatrixQuadrant, string> = {
    quick_wins: 'rgba(34, 197, 94, 0.12)',
    major_projects: 'rgba(59, 130, 246, 0.12)',
    fill_ins: 'rgba(234, 179, 8, 0.12)',
    low_priority: 'rgba(239, 68, 68, 0.08)',
  };

  const quadrantBorderColors: Record<MatrixQuadrant, string> = {
    quick_wins: 'rgba(34, 197, 94, 0.3)',
    major_projects: 'rgba(59, 130, 246, 0.3)',
    fill_ins: 'rgba(234, 179, 8, 0.3)',
    low_priority: 'rgba(239, 68, 68, 0.2)',
  };

  function close() {
    loopStore.clearEffortValueMatrix();
    uiStore.closeModal();
  }

  // Compute matrix on mount
  $effect(() => {
    if (loopStore.selectedPrdId && !loopStore.effortValueMatrix) {
      loopStore.computeEffortValueMatrix(loopStore.selectedPrdId);
    }
  });

  let matrix = $derived(loopStore.effortValueMatrix);
  let filterQuadrant = $derived(loopStore.matrixFilterQuadrant);

  let filteredStories = $derived(
    matrix?.stories.filter((s) => !filterQuadrant || s.quadrant === filterQuadrant) ?? [],
  );

  function toggleFilter(quadrant: MatrixQuadrant) {
    if (loopStore.matrixFilterQuadrant === quadrant) {
      loopStore.setMatrixFilterQuadrant(null);
    } else {
      loopStore.setMatrixFilterQuadrant(quadrant);
    }
  }

  function priorityColor(p: string): string {
    switch (p) {
      case 'critical':
        return '#ef4444';
      case 'high':
        return '#f59e0b';
      case 'medium':
        return '#3b82f6';
      case 'low':
        return '#6b7280';
      default:
        return '#6b7280';
    }
  }

  // statusIcon is now rendered inline as SVGs in the template

  function statusColor(status: string): string {
    switch (status) {
      case 'completed':
        return 'var(--accent-secondary)';
      case 'qa':
        return 'var(--accent-warning, #f0ad4e)';
      case 'in_progress':
        return 'var(--accent-primary)';
      case 'failed':
        return 'var(--accent-error)';
      default:
        return 'var(--text-tertiary)';
    }
  }

  function storyDotColor(story: MatrixStoryPosition): string {
    return priorityColor(story.priority);
  }

  function handleMatrixMouseDown(e: MouseEvent, storyId: string) {
    if (!matrixEl) return;
    e.preventDefault();
    draggingStory = storyId;
    const rect = matrixEl.getBoundingClientRect();
    dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    document.addEventListener('mousemove', handleMatrixMouseMove);
    document.addEventListener('mouseup', handleMatrixMouseUp);
  }

  function handleMatrixMouseMove(e: MouseEvent) {
    if (!draggingStory || !matrixEl) return;
    const rect = matrixEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    // Convert to effort/value scores
    const effortScore = Math.round((x / rect.width) * 100);
    const valueScore = Math.round(((rect.height - y) / rect.height) * 100);

    loopStore.adjustStoryPosition(draggingStory, effortScore, valueScore);
  }

  function handleMatrixMouseUp() {
    draggingStory = null;
    document.removeEventListener('mousemove', handleMatrixMouseMove);
    document.removeEventListener('mouseup', handleMatrixMouseUp);
  }

  function resetPosition(storyId: string) {
    loopStore.resetStoryPosition(storyId);
  }

  function refreshMatrix() {
    if (loopStore.selectedPrdId) {
      loopStore.computeEffortValueMatrix(loopStore.selectedPrdId);
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={close}>
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Effort vs Value Matrix</h2>
      <div class="header-actions">
        <button class="refresh-btn" onclick={refreshMatrix} title="Refresh matrix">↻</button>
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
    </div>

    <div class="modal-body">
      {#if matrix && matrix.totalPlotted > 0}
        <!-- Quadrant Filter Chips -->
        <div class="quadrant-filters">
          {#each Object.entries(quadrantLabels) as [key, quad]}
            {@const q = key as MatrixQuadrant}
            <button
              class="quadrant-chip"
              class:active={filterQuadrant === q}
              style:--chip-bg={quadrantColors[q]}
              style:--chip-border={quadrantBorderColors[q]}
              onclick={() => toggleFilter(q)}
            >
              <span class="chip-icon">{quad.icon}</span>
              <span class="chip-label">{quad.label}</span>
              <span class="chip-count">{matrix.quadrantCounts[q]}</span>
            </button>
          {/each}
        </div>

        <!-- Matrix Visualization -->
        <div class="matrix-container">
          <!-- Y-axis label -->
          <div class="y-axis-label">
            <span>Value →</span>
          </div>

          <div class="matrix-grid" bind:this={matrixEl}>
            <!-- Quadrant backgrounds -->
            <div class="quadrant-bg quick-wins" style:background={quadrantColors.quick_wins}>
              <span class="quadrant-label">↯ Quick Wins</span>
            </div>
            <div
              class="quadrant-bg major-projects"
              style:background={quadrantColors.major_projects}
            >
              <span class="quadrant-label">▩ Major Projects</span>
            </div>
            <div class="quadrant-bg fill-ins" style:background={quadrantColors.fill_ins}>
              <span class="quadrant-label">▤ Fill-ins</span>
            </div>
            <div class="quadrant-bg low-priority" style:background={quadrantColors.low_priority}>
              <span class="quadrant-label">◴ Low Priority</span>
            </div>

            <!-- Axis lines -->
            <div class="axis-line-h"></div>
            <div class="axis-line-v"></div>

            <!-- Story dots -->
            {#each filteredStories as story (story.storyId)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="story-dot"
                class:dragging={draggingStory === story.storyId}
                class:manual={story.isManualPosition}
                class:hovered={hoveredStory === story.storyId}
                style:left="{story.effortScore}%"
                style:bottom="{story.valueScore}%"
                style:--dot-color={storyDotColor(story)}
                onmousedown={(e) => handleMatrixMouseDown(e, story.storyId)}
                onmouseenter={() => {
                  hoveredStory = story.storyId;
                }}
                onmouseleave={() => {
                  hoveredStory = null;
                }}
                title="{story.title} — Effort: {story.effortScore}, Value: {story.valueScore}{story.storyPoints
                  ? ` (${story.storyPoints}pts)`
                  : ''}"
              >
                <span class="dot-label">
                  {story.title.length > 12 ? story.title.slice(0, 12) + '...' : story.title}
                </span>
              </div>
            {/each}
          </div>

          <!-- X-axis label -->
          <div class="x-axis-label">
            <span>Effort →</span>
          </div>
        </div>

        <!-- Story list by quadrant -->
        <div class="stories-by-quadrant">
          <h4 class="section-label">
            {filterQuadrant ? quadrantLabels[filterQuadrant].label : 'All Stories'}
            <span class="story-count">({filteredStories.length})</span>
          </h4>
          <div class="story-list">
            {#each filteredStories as story (story.storyId)}
              <div
                class="story-list-item"
                class:hovered={hoveredStory === story.storyId}
                onmouseenter={() => {
                  hoveredStory = story.storyId;
                }}
                onmouseleave={() => {
                  hoveredStory = null;
                }}
              >
                <span class="story-status-icon" style:color={statusColor(story.status)}>
                  {#if story.status === 'completed'}<svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg
                    >{:else if story.status === 'in_progress'}<svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      stroke="none"><circle cx="12" cy="12" r="6" /></svg
                    >{:else if story.status === 'failed'}<svg
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
                    >{:else if story.status === 'skipped'}<svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><circle cx="12" cy="12" r="10" /><line
                        x1="4.93"
                        y1="4.93"
                        x2="19.07"
                        y2="19.07"
                      /></svg
                    >{:else}<svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"><circle cx="12" cy="12" r="10" /></svg
                    >{/if}
                </span>
                <span class="story-name">{story.title}</span>
                <span class="story-priority-badge" style:color={priorityColor(story.priority)}>
                  {story.priority}
                </span>
                {#if story.storyPoints}
                  <span class="story-points">{story.storyPoints}pts</span>
                {/if}
                <span
                  class="story-quadrant-tag"
                  style:background={quadrantColors[story.quadrant]}
                  style:border-color={quadrantBorderColors[story.quadrant]}
                >
                  {quadrantLabels[story.quadrant].icon}
                  {quadrantLabels[story.quadrant].label}
                </span>
                {#if story.isManualPosition}
                  <button
                    class="reset-btn"
                    onclick={() => resetPosition(story.storyId)}
                    title="Reset to computed position">↺</button
                  >
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- Excluded stories -->
        {#if matrix.excludedStories.length > 0}
          <div class="excluded-section">
            <h4 class="section-label">Not Plotted ({matrix.excludedStories.length})</h4>
            <div class="excluded-list">
              {#each matrix.excludedStories as story}
                <div class="excluded-item">
                  <span class="excluded-title">{story.title}</span>
                  <span class="excluded-reason">{story.reason}</span>
                </div>
              {/each}
            </div>
            <p class="excluded-hint">Use "Estimate All" to generate estimates for these stories.</p>
          </div>
        {/if}
      {:else if matrix && matrix.totalPlotted === 0}
        <div class="empty-state">
          <p>No stories could be plotted on the matrix.</p>
          <p class="empty-hint">
            Stories need estimates to be positioned. Click "Estimate All" in the stories panel
            first.
          </p>
          {#if matrix.excludedStories.length > 0}
            <div class="excluded-section">
              <h4 class="section-label">Excluded ({matrix.excludedStories.length})</h4>
              <div class="excluded-list">
                {#each matrix.excludedStories as story}
                  <div class="excluded-item">
                    <span class="excluded-title">{story.title}</span>
                    <span class="excluded-reason">{story.reason}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="empty-state">
          <p>Select a PRD with stories to generate the effort-value matrix.</p>
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn-close" onclick={close}>
        {matrix && matrix.totalPlotted > 0 ? 'Done' : 'Close'}
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
    width: 800px;
    max-height: 90vh;
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
  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .refresh-btn {
    padding: 4px 8px;
    border-radius: 4px;
    color: var(--text-tertiary);
    font-size: var(--fs-lg);
    background: none;
    border: none;
    cursor: pointer;
  }
  .refresh-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
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

  /* Quadrant Filters */
  .quadrant-filters {
    display: flex;
    gap: 6px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .quadrant-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: var(--fs-xs);
    background: var(--chip-bg);
    border: 1px solid var(--chip-border);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }
  .quadrant-chip:hover {
    opacity: 0.85;
  }
  .quadrant-chip.active {
    border-width: 2px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .chip-icon {
    font-size: var(--fs-sm);
  }
  .chip-count {
    font-weight: 700;
    font-size: var(--fs-xxs);
    opacity: 0.7;
  }

  /* Matrix Container */
  .matrix-container {
    display: grid;
    grid-template-columns: 24px 1fr;
    grid-template-rows: 1fr 24px;
    gap: 4px;
    margin-bottom: 16px;
  }
  .y-axis-label {
    grid-row: 1;
    grid-column: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    writing-mode: vertical-lr;
    transform: rotate(180deg);
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .x-axis-label {
    grid-row: 2;
    grid-column: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  /* Matrix Grid */
  .matrix-grid {
    grid-row: 1;
    grid-column: 2;
    position: relative;
    height: 340px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    overflow: hidden;
    cursor: default;
  }

  /* Quadrant Backgrounds */
  .quadrant-bg {
    position: absolute;
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    padding: 6px 8px;
  }
  .quadrant-bg.quick-wins {
    left: 0;
    top: 0;
    width: 50%;
    height: 50%;
  }
  .quadrant-bg.major-projects {
    left: 50%;
    top: 0;
    width: 50%;
    height: 50%;
  }
  .quadrant-bg.fill-ins {
    left: 0;
    top: 50%;
    width: 50%;
    height: 50%;
  }
  .quadrant-bg.low-priority {
    left: 50%;
    top: 50%;
    width: 50%;
    height: 50%;
  }
  .quadrant-label {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--text-tertiary);
    opacity: 0.8;
    user-select: none;
  }

  /* Axis Lines */
  .axis-line-h {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--border-primary);
    opacity: 0.6;
    pointer-events: none;
  }
  .axis-line-v {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--border-primary);
    opacity: 0.6;
    pointer-events: none;
  }

  /* Story Dots */
  .story-dot {
    position: absolute;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--dot-color, var(--accent-primary));
    border: 2px solid var(--bg-primary);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    transform: translate(-50%, 50%);
    cursor: grab;
    transition:
      transform 0.15s,
      box-shadow 0.15s;
    z-index: 2;
  }
  .story-dot:hover,
  .story-dot.hovered {
    width: 20px;
    height: 20px;
    z-index: 10;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  }
  .story-dot.dragging {
    cursor: grabbing;
    width: 20px;
    height: 20px;
    z-index: 20;
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.5);
  }
  .story-dot.manual {
    border-color: var(--accent-warning, #e6a817);
    border-width: 2px;
  }
  .dot-label {
    position: absolute;
    top: -18px;
    left: 50%;
    transform: translateX(-50%);
    font-size: var(--fs-xxs);
    color: var(--text-secondary);
    white-space: nowrap;
    background: var(--bg-primary);
    padding: 1px 4px;
    border-radius: 2px;
    border: 1px solid var(--border-primary);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
  }
  .story-dot:hover .dot-label,
  .story-dot.hovered .dot-label,
  .story-dot.dragging .dot-label {
    opacity: 1;
  }

  /* Stories List */
  .stories-by-quadrant {
    margin-bottom: 16px;
  }
  .section-label {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .story-count {
    font-weight: 400;
    color: var(--text-tertiary);
  }
  .story-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 180px;
    overflow-y: auto;
  }
  .story-list-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    transition: background 0.15s;
  }
  .story-list-item.hovered {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
  }
  .story-status-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    width: 14px;
    text-align: center;
  }
  .story-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
  }
  .story-priority-badge {
    font-size: var(--fs-xxs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    flex-shrink: 0;
  }
  .story-points {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--accent-primary);
    flex-shrink: 0;
  }
  .story-quadrant-tag {
    font-size: var(--fs-xxs);
    padding: 1px 6px;
    border-radius: 8px;
    border: 1px solid;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .reset-btn {
    font-size: var(--fs-sm);
    padding: 0 4px;
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
  }
  .reset-btn:hover {
    color: var(--accent-primary);
  }

  /* Excluded section */
  .excluded-section {
    margin-top: 12px;
    padding: 10px 12px;
    background: rgba(230, 168, 23, 0.06);
    border: 1px solid rgba(230, 168, 23, 0.15);
    border-radius: var(--radius-sm);
  }
  .excluded-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .excluded-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 6px;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .excluded-title {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .excluded-reason {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-style: italic;
    flex-shrink: 0;
  }
  .excluded-hint {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    margin-top: 6px;
  }

  /* Empty state */
  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--text-secondary);
    font-size: var(--fs-base);
    line-height: 1.6;
  }
  .empty-hint {
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
</style>
