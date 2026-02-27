<script lang="ts">
  import { loopStore } from '$lib/stores/loop.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import type {
    DependencyGraph,
    DependencyNode,
    DependencyEdge,
    DependencyWarning,
  } from '@e/shared';

  let { prdId }: { prdId: string } = $props();

  let viewMode = $state<'list' | 'graph'>('list');
  let addingDep = $state(false);
  let fromStoryId = $state('');
  let toStoryId = $state('');
  let addReason = $state('');

  // Edit state
  let editingEdgeKey = $state<string | null>(null);
  let editReason = $state('');

  let graph = $derived(loopStore.dependencyGraph);
  let stories = $derived(loopStore.selectedPrd?.stories || []);

  // Load dependency graph when component mounts or prdId changes
  $effect(() => {
    if (prdId) {
      loopStore.loadDependencyGraph(prdId);
    }
  });

  async function handleAnalyze() {
    const result = await loopStore.analyzeDependencies(prdId, false);
    if (result.ok) {
      uiStore.toast('Dependencies analyzed successfully', 'success');
    } else {
      uiStore.toast(`Analysis failed: ${result.error}`, 'error');
    }
  }

  async function handleAddDependency() {
    if (!fromStoryId || !toStoryId || fromStoryId === toStoryId) return;
    const result = await loopStore.addDependency(
      prdId,
      fromStoryId,
      toStoryId,
      addReason || undefined,
    );
    if (result.ok) {
      addingDep = false;
      fromStoryId = '';
      toStoryId = '';
      addReason = '';
      uiStore.toast('Dependency added', 'success');
    } else {
      uiStore.toast(`Failed: ${result.error}`, 'error');
    }
  }

  async function handleRemoveDependency(from: string, to: string) {
    const result = await loopStore.removeDependency(prdId, from, to);
    if (result.ok) {
      uiStore.toast('Dependency removed', 'success');
    } else {
      uiStore.toast(`Failed: ${result.error}`, 'error');
    }
  }

  function startEditing(edge: DependencyEdge) {
    editingEdgeKey = `${edge.from}-${edge.to}`;
    editReason = edge.reason || '';
  }

  function cancelEditing() {
    editingEdgeKey = null;
    editReason = '';
  }

  async function handleSaveEdit(edge: DependencyEdge) {
    // edge.from = blocker, edge.to = blocked story (fromStoryId in API = the story that depends on)
    const result = await loopStore.editDependency(prdId, edge.to, edge.from, editReason);
    if (result.ok) {
      editingEdgeKey = null;
      editReason = '';
      uiStore.toast('Dependency updated', 'success');
    } else {
      uiStore.toast(`Failed: ${result.error}`, 'error');
    }
  }

  function storyTitle(id: string): string {
    return (
      graph?.nodes.find((n) => n.storyId === id)?.title ||
      stories.find((s) => s.id === id)?.title ||
      id
    );
  }

  function statusIcon(status: string): string {
    switch (status) {
      case 'completed':
        return '✓';
      case 'qa':
        return '◉';
      case 'in_progress':
        return '●';
      case 'failed':
        return '✗';
      case 'skipped':
        return '⊘';
      default:
        return '○';
    }
  }

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

  function warningIcon(type: string): string {
    switch (type) {
      case 'circular':
        return '⟳';
      case 'missing_dependency':
        return '△';
      case 'unresolved_blocker':
        return '⊘';
      case 'orphan_dependency':
        return '◌';
      default:
        return '△';
    }
  }

  // Group nodes by depth for graph view
  let depthGroups = $derived.by(() => {
    if (!graph) return [];
    const groups: Map<number, DependencyNode[]> = new Map();
    for (const node of graph.nodes) {
      if (!groups.has(node.depth)) groups.set(node.depth, []);
      groups.get(node.depth)!.push(node);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  });
</script>

<div class="dependency-view">
  <!-- Header -->
  <div class="dep-header">
    <div class="dep-title-row">
      <h4>Dependencies</h4>
      <div class="dep-actions">
        <button
          class="btn-sm dep-btn"
          class:active={viewMode === 'list'}
          onclick={() => (viewMode = 'list')}
          title="List view"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg
          >
        </button>
        <button
          class="btn-sm dep-btn"
          class:active={viewMode === 'graph'}
          onclick={() => (viewMode = 'graph')}
          title="Graph view"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><circle cx="12" cy="5" r="3" /><circle cx="5" cy="19" r="3" /><circle
              cx="19"
              cy="19"
              r="3"
            /><path d="M12 8v4M7.5 17.2L10 14M16.5 17.2L14 14" /></svg
          >
        </button>
      </div>
    </div>
    <div class="dep-toolbar">
      <button
        class="btn-sm btn-analyze"
        onclick={handleAnalyze}
        disabled={loopStore.analyzingDependencies || stories.length < 2}
        title="AI-analyze story content to find dependencies"
      >
        {#if loopStore.analyzingDependencies}<svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="dep-spinner"
            ><path
              d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
            /></svg
          > Analyzing...{:else}<svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg
          > Analyze{/if}
      </button>
      <button
        class="btn-sm dep-btn"
        onclick={() => {
          addingDep = !addingDep;
        }}
        title="Manually add dependency"
      >
        + Add
      </button>
    </div>
  </div>

  <!-- Add dependency form -->
  {#if addingDep}
    <div class="add-dep-form">
      <div class="dep-field">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>Story</label>
        <select bind:value={fromStoryId}>
          <option value="">Select story...</option>
          {#each stories as s (s.id)}
            <option value={s.id} disabled={s.id === toStoryId}>{s.title}</option>
          {/each}
        </select>
      </div>
      <span class="dep-arrow">depends on →</span>
      <div class="dep-field">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>Blocker</label>
        <select bind:value={toStoryId}>
          <option value="">Select blocker...</option>
          {#each stories as s (s.id)}
            <option value={s.id} disabled={s.id === fromStoryId}>{s.title}</option>
          {/each}
        </select>
      </div>
      <div class="dep-field">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>Reason (optional)</label>
        <input
          type="text"
          class="dep-reason-input"
          bind:value={addReason}
          placeholder="Why this dependency exists..."
        />
      </div>
      <div class="dep-form-actions">
        <button
          class="btn-sm btn-primary"
          onclick={handleAddDependency}
          disabled={!fromStoryId || !toStoryId || fromStoryId === toStoryId}>Add</button
        >
        <button
          class="btn-sm btn-ghost"
          onclick={() => {
            addingDep = false;
            fromStoryId = '';
            toStoryId = '';
            addReason = '';
          }}>Cancel</button
        >
      </div>
    </div>
  {/if}

  <!-- Warnings -->
  {#if graph && graph.warnings.length > 0}
    <div class="dep-warnings">
      {#each graph.warnings as warning}
        <div class="warning-item">
          <span class="warning-icon">{warningIcon(warning.type)}</span>
          <span class="warning-text">{warning.message}</span>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Loading / Error states -->
  {#if loopStore.dependencyLoading}
    <div class="dep-loading">Loading dependencies...</div>
  {:else if loopStore.dependencyError}
    <div class="dep-error">{loopStore.dependencyError}</div>
  {:else if !graph || graph.edges.length === 0}
    <div class="dep-empty">
      <span class="empty-hint">No dependencies detected yet.</span>
      {#if stories.length >= 2}
        <span class="empty-hint"
          >Click "Analyze" to auto-detect dependencies from story content.</span
        >
      {/if}
    </div>
  {:else if viewMode === 'list'}
    <!-- List View -->
    <div class="dep-list">
      {#each graph.edges as edge (edge.from + '-' + edge.to)}
        {@const edgeKey = `${edge.from}-${edge.to}`}
        <div class="dep-edge-item" class:editing={editingEdgeKey === edgeKey}>
          {#if editingEdgeKey === edgeKey}
            <!-- Edit mode -->
            <div class="dep-edit-form">
              <div class="dep-edge-content">
                <span class="dep-story-name">{storyTitle(edge.to)}</span>
                <span class="dep-arrow-inline">→ blocked by →</span>
                <span class="dep-story-name">{storyTitle(edge.from)}</span>
              </div>
              <div class="dep-edit-reason-row">
                <input
                  type="text"
                  class="dep-reason-input"
                  bind:value={editReason}
                  placeholder="Reason for this dependency..."
                  onkeydown={(e) => {
                    if (e.key === 'Enter') handleSaveEdit(edge);
                    if (e.key === 'Escape') cancelEditing();
                  }}
                />
                <button class="btn-sm btn-primary" onclick={() => handleSaveEdit(edge)} title="Save"
                  >✓</button
                >
                <button class="btn-sm btn-ghost" onclick={cancelEditing} title="Cancel">✗</button>
              </div>
            </div>
          {:else}
            <!-- Display mode -->
            <div class="dep-edge-content">
              <span class="dep-story-name">{storyTitle(edge.to)}</span>
              <span class="dep-arrow-inline">→ blocked by →</span>
              <span class="dep-story-name">{storyTitle(edge.from)}</span>
            </div>
            {#if edge.reason}
              <span class="dep-reason" title={edge.reason}>{edge.reason}</span>
            {/if}
            <button class="dep-edit-btn" onclick={() => startEditing(edge)} title="Edit reason"
              ><svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg
              ></button
            >
            <button
              class="dep-remove-btn"
              onclick={() => handleRemoveDependency(edge.to, edge.from)}
              title="Remove dependency">×</button
            >
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <!-- Graph View (layered by depth) -->
    <div class="dep-graph">
      {#each depthGroups as [depth, nodes] (depth)}
        <div class="dep-layer">
          <div class="dep-layer-label">Layer {depth}</div>
          <div class="dep-layer-nodes">
            {#each nodes as node (node.storyId)}
              <div
                class="dep-node"
                class:ready={node.isReady}
                class:blocked={!node.isReady && node.blockedByCount > 0}
              >
                <span class="node-status" style:color={statusColor(node.status)}>
                  {statusIcon(node.status)}
                </span>
                <span class="node-title" title={node.title}>{node.title}</span>
                <div class="node-badges">
                  {#if node.blocksCount > 0}
                    <span class="node-badge blocks" title="Blocks {node.blocksCount} story(ies)"
                      >↓{node.blocksCount}</span
                    >
                  {/if}
                  {#if node.blockedByCount > 0}
                    <span
                      class="node-badge blocked"
                      title="Blocked by {node.blockedByCount} story(ies)"
                      >↑{node.blockedByCount}</span
                    >
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dependency-view {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .dep-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .dep-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .dep-title-row h4 {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0;
  }

  .dep-actions {
    display: flex;
    gap: 2px;
  }

  .dep-toolbar {
    display: flex;
    gap: 4px;
  }

  .btn-sm {
    padding: 3px 8px;
    font-size: var(--fs-xxs);
    border-radius: var(--radius-sm);
    font-weight: 600;
    cursor: pointer;
  }

  .dep-btn {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }
  .dep-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .dep-btn.active {
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border-color: var(--accent-primary);
  }

  .btn-analyze {
    flex: 1;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
    text-align: center;
  }
  .btn-analyze:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  .btn-analyze:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border: 1px solid var(--accent-primary);
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }

  .add-dep-form {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
  }

  .dep-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .dep-field label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .dep-field select {
    width: 100%;
    padding: 4px 6px;
    font-size: var(--fs-xs);
    background: var(--bg-secondary, var(--bg-primary));
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }

  .dep-reason-input {
    width: 100%;
    padding: 4px 6px;
    font-size: var(--fs-xs);
    background: var(--bg-secondary, var(--bg-primary));
    color: var(--text-primary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
  }
  .dep-reason-input::placeholder {
    color: var(--text-tertiary);
  }

  .dep-arrow {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-align: center;
    padding: 2px 0;
  }

  .dep-form-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }

  .dep-warnings {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .warning-item {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 4px 6px;
    background: rgba(230, 168, 23, 0.1);
    border-radius: var(--radius-sm);
    border-left: 2px solid var(--accent-warning, #e6a817);
  }

  .warning-icon {
    font-size: var(--fs-xs);
    flex-shrink: 0;
  }

  .warning-text {
    font-size: var(--fs-xxs);
    color: var(--text-secondary);
    line-height: 1.3;
  }

  .dep-loading,
  .dep-error {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    padding: 8px;
    text-align: center;
  }

  .dep-error {
    color: var(--accent-error);
  }

  .dep-empty {
    padding: 12px 8px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .empty-hint {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  /* List View */
  .dep-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 200px;
    overflow-y: auto;
  }

  .dep-edge-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }

  .dep-edge-item.editing {
    flex-direction: column;
    align-items: stretch;
    padding: 6px;
    border: 1px solid var(--accent-primary);
  }

  .dep-edit-form {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .dep-edit-reason-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .dep-edit-reason-row .dep-reason-input {
    flex: 1;
  }

  .dep-edge-content {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .dep-story-name {
    font-size: var(--fs-xxs);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100px;
  }

  .dep-arrow-inline {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .dep-reason {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 80px;
  }

  .dep-edit-btn,
  .dep-remove-btn {
    font-size: var(--fs-sm);
    padding: 0 4px;
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity var(--transition);
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
  }
  .dep-edge-item:hover .dep-edit-btn,
  .dep-edge-item:hover .dep-remove-btn {
    opacity: 1;
  }
  .dep-edit-btn {
    font-size: var(--fs-xs);
  }
  .dep-edit-btn:hover {
    color: var(--accent-primary);
  }
  .dep-remove-btn:hover {
    color: var(--accent-error);
  }

  /* Graph View */
  .dep-graph {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 200px;
    overflow-y: auto;
    padding: 4px;
  }

  .dep-layer {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .dep-layer-label {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .dep-layer-nodes {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .dep-node {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    max-width: 200px;
  }

  .dep-node.ready {
    border-left: 2px solid var(--accent-secondary);
  }

  .dep-node.blocked {
    border-left: 2px solid var(--accent-error);
    opacity: 0.8;
  }

  .node-status {
    font-size: var(--fs-xxs);
    flex-shrink: 0;
  }

  .node-title {
    font-size: var(--fs-xxs);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .node-badges {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .node-badge {
    font-size: var(--fs-xxs);
    padding: 1px 3px;
    border-radius: 2px;
    font-weight: 700;
  }

  .node-badge.blocks {
    background: rgba(59, 130, 246, 0.15);
    color: var(--accent-primary);
  }

  .node-badge.blocked {
    background: rgba(239, 68, 68, 0.15);
    color: var(--accent-error);
  }

  @keyframes dep-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .dep-spinner {
    animation: dep-spin 0.8s linear infinite;
  }
</style>
