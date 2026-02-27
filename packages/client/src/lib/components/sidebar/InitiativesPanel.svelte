<script lang="ts">
  import { api } from '$lib/api/client';
  import { onMount } from 'svelte';

  const PRESET_COLORS = [
    { label: 'Indigo', value: '#6366f1' },
    { label: 'Purple', value: '#a855f7' },
    { label: 'Blue', value: '#3b82f6' },
    { label: 'Green', value: '#22c55e' },
    { label: 'Amber', value: '#f59e0b' },
    { label: 'Red', value: '#ef4444' },
  ];

  interface Initiative {
    id: string;
    name: string;
    description: string;
    status: string;
    workspacePaths: string[];
    prdIds: string[];
    color: string;
    createdAt: number;
    updatedAt: number;
  }

  interface Progress {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
    percentComplete: number;
  }

  let initiatives = $state<Initiative[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let saving = $state(false);

  // New initiative form
  let showNewForm = $state(false);
  let newName = $state('');
  let newDescription = $state('');
  let newColor = $state('#6366f1');

  // Expanded initiative
  let expandedId = $state<string | null>(null);
  let progressMap = $state<Record<string, Progress>>({});
  let progressLoading = $state<Record<string, boolean>>({});

  // Edit state
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editDescription = $state('');
  let editColor = $state('#6366f1');

  // PRD list for linking
  let availablePrds = $state<Array<{ id: string; name: string }>>([]);
  let addWorkspaceInput = $state('');
  let addPrdId = $state('');

  onMount(() => {
    loadInitiatives();
    loadPrds();
  });

  async function loadInitiatives() {
    loading = true;
    error = null;
    try {
      const res = await api.initiatives.list();
      initiatives = (res.data ?? []) as Initiative[];
    } catch (err: any) {
      error = err?.message ?? 'Failed to load initiatives';
    } finally {
      loading = false;
    }
  }

  async function loadPrds() {
    try {
      const res = await api.prds.list();
      availablePrds = (res.data ?? []).map((p: any) => ({ id: p.id, name: p.name }));
    } catch {
      availablePrds = [];
    }
  }

  async function loadProgress(id: string) {
    progressLoading = { ...progressLoading, [id]: true };
    try {
      const res = await api.initiatives.getProgress(id);
      progressMap = { ...progressMap, [id]: res.data as Progress };
    } catch {
      // ignore
    } finally {
      progressLoading = { ...progressLoading, [id]: false };
    }
  }

  function toggleExpand(id: string) {
    if (expandedId === id) {
      expandedId = null;
    } else {
      expandedId = id;
      editingId = null;
      if (!progressMap[id]) {
        loadProgress(id);
      }
    }
  }

  async function createInitiative() {
    if (!newName.trim()) {
      error = 'Name is required';
      return;
    }
    saving = true;
    error = null;
    try {
      await api.initiatives.create({
        name: newName.trim(),
        description: newDescription.trim(),
        color: newColor,
      });
      newName = '';
      newDescription = '';
      newColor = '#6366f1';
      showNewForm = false;
      await loadInitiatives();
    } catch (err: any) {
      error = err?.message ?? 'Failed to create initiative';
    } finally {
      saving = false;
    }
  }

  function startEdit(initiative: Initiative) {
    editingId = initiative.id;
    editName = initiative.name;
    editDescription = initiative.description;
    editColor = initiative.color;
    expandedId = initiative.id;
  }

  function cancelEdit() {
    editingId = null;
  }

  async function saveEdit() {
    if (!editingId) return;
    saving = true;
    error = null;
    try {
      await api.initiatives.update(editingId, {
        name: editName.trim(),
        description: editDescription.trim(),
        color: editColor,
      });
      editingId = null;
      await loadInitiatives();
    } catch (err: any) {
      error = err?.message ?? 'Failed to update initiative';
    } finally {
      saving = false;
    }
  }

  async function deleteInitiative(id: string) {
    if (!confirm('Delete this initiative?')) return;
    try {
      await api.initiatives.delete(id);
      initiatives = initiatives.filter((i) => i.id !== id);
      if (expandedId === id) expandedId = null;
      if (editingId === id) editingId = null;
    } catch (err: any) {
      error = err?.message ?? 'Failed to delete initiative';
    }
  }

  async function setStatus(id: string, status: string) {
    try {
      await api.initiatives.update(id, { status });
      initiatives = initiatives.map((i) => (i.id === id ? { ...i, status } : i));
    } catch (err: any) {
      error = err?.message ?? 'Failed to update status';
    }
  }

  async function addWorkspace(id: string) {
    const path = addWorkspaceInput.trim();
    if (!path) return;
    try {
      await api.initiatives.addWorkspace(id, path);
      addWorkspaceInput = '';
      await loadInitiatives();
    } catch (err: any) {
      error = err?.message ?? 'Failed to add workspace';
    }
  }

  async function removeWorkspace(id: string, path: string) {
    try {
      await api.initiatives.removeWorkspace(id, path);
      await loadInitiatives();
    } catch (err: any) {
      error = err?.message ?? 'Failed to remove workspace';
    }
  }

  async function addPrd(id: string) {
    const prdId = addPrdId.trim();
    if (!prdId) return;
    try {
      await api.initiatives.addPrd(id, prdId);
      addPrdId = '';
      await loadInitiatives();
      // Refresh progress
      delete progressMap[id];
      loadProgress(id);
    } catch (err: any) {
      error = err?.message ?? 'Failed to add PRD';
    }
  }

  async function removePrd(id: string, prdId: string) {
    try {
      await api.initiatives.removePrd(id, prdId);
      await loadInitiatives();
      // Refresh progress
      delete progressMap[id];
      loadProgress(id);
    } catch (err: any) {
      error = err?.message ?? 'Failed to remove PRD';
    }
  }

  function statusLabel(status: string): string {
    if (status === 'active') return 'Active';
    if (status === 'completed') return 'Completed';
    if (status === 'archived') return 'Archived';
    return status;
  }

  function nextStatus(status: string): string {
    if (status === 'active') return 'completed';
    if (status === 'completed') return 'archived';
    return 'active';
  }

  function prdNameForId(prdId: string): string {
    const found = availablePrds.find((p) => p.id === prdId);
    return found?.name ?? prdId;
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">Initiatives</span>
    <button
      class="btn-icon"
      onclick={() => {
        showNewForm = !showNewForm;
        editingId = null;
      }}
      title={showNewForm ? 'Cancel' : 'New Initiative'}
    >
      {showNewForm ? '✕' : '+'}
    </button>
  </div>

  {#if error}
    <div class="error-banner">
      <span>{error}</span>
      <button class="error-dismiss" onclick={() => (error = null)}>✕</button>
    </div>
  {/if}

  <!-- New initiative form -->
  {#if showNewForm}
    <div class="form-card">
      <div class="form-title">New Initiative</div>
      <label class="field-label">
        Name
        <input
          class="field-input"
          type="text"
          bind:value={newName}
          placeholder="Cross-service epic…"
        />
      </label>
      <label class="field-label">
        Description
        <textarea
          class="field-textarea"
          bind:value={newDescription}
          rows="2"
          placeholder="What does this initiative accomplish?"
        ></textarea>
      </label>
      <div class="field-label">
        Color
        <div class="color-picker">
          {#each PRESET_COLORS as color}
            <button
              class="color-swatch"
              class:color-swatch--selected={newColor === color.value}
              style="background: {color.value};"
              title={color.label}
              onclick={() => (newColor = color.value)}
            ></button>
          {/each}
        </div>
      </div>
      <div class="form-actions">
        <button class="btn-secondary" onclick={() => (showNewForm = false)}>Cancel</button>
        <button class="btn-primary" onclick={createInitiative} disabled={saving || !newName.trim()}>
          {saving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  {/if}

  <!-- List -->
  {#if loading}
    <div class="loading-row">
      <div class="spinner"></div>
      <span>Loading…</span>
    </div>
  {:else if initiatives.length === 0 && !showNewForm}
    <div class="empty-state">
      <div class="empty-icon">◈</div>
      <div class="empty-text">No initiatives yet</div>
      <button class="btn-primary" onclick={() => (showNewForm = true)}
        >Create your first initiative</button
      >
    </div>
  {:else}
    <div class="initiatives-list">
      {#each initiatives as initiative (initiative.id)}
        {@const progress = progressMap[initiative.id]}
        {@const isExpanded = expandedId === initiative.id}
        {@const isEditing = editingId === initiative.id}

        <div
          class="initiative-card"
          class:initiative-card--archived={initiative.status === 'archived'}
          style="--initiative-color: {initiative.color};"
        >
          <!-- Colored left border accent -->
          <div class="initiative-accent"></div>

          <div class="initiative-body">
            <!-- Header -->
            <div class="initiative-header">
              <div class="initiative-header-left">
                <span class="initiative-name">{initiative.name}</span>
                <button
                  class="status-badge"
                  class:status-badge--completed={initiative.status === 'completed'}
                  class:status-badge--archived={initiative.status === 'archived'}
                  onclick={() => setStatus(initiative.id, nextStatus(initiative.status))}
                  title="Cycle status"
                >
                  {statusLabel(initiative.status)}
                </button>
              </div>
              <div class="initiative-actions">
                <button
                  class="action-btn"
                  class:action-btn--active={isExpanded}
                  onclick={() => toggleExpand(initiative.id)}
                  title={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? '▲' : '▼'}
                </button>
                <button
                  class="action-btn"
                  onclick={() => startEdit(initiative)}
                  title="Edit"
                  class:action-btn--active={isEditing}
                >
                  ✎
                </button>
                <button
                  class="action-btn action-btn--danger"
                  onclick={() => deleteInitiative(initiative.id)}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>

            {#if initiative.description}
              <div class="initiative-description">{initiative.description}</div>
            {/if}

            <!-- Stats row -->
            <div class="initiative-stats">
              <span class="stat-chip"
                >{initiative.workspacePaths.length} workspace{initiative.workspacePaths.length !== 1
                  ? 's'
                  : ''}</span
              >
              <span class="stat-chip"
                >{initiative.prdIds.length} PRD{initiative.prdIds.length !== 1 ? 's' : ''}</span
              >
              {#if progress}
                <span class="stat-chip">{progress.percentComplete}% done</span>
              {/if}
            </div>

            <!-- Progress bar -->
            {#if progress && progress.total > 0}
              <div class="progress-bar-wrap">
                <div
                  class="progress-bar-fill"
                  style="width: {progress.percentComplete}%; background: {initiative.color};"
                ></div>
              </div>
              <div class="progress-detail">
                <span class="progress-stat progress-stat--done">{progress.completed} done</span>
                {#if progress.in_progress > 0}
                  <span class="progress-stat progress-stat--active"
                    >{progress.in_progress} active</span
                  >
                {/if}
                <span class="progress-stat">{progress.pending} pending</span>
                {#if progress.failed > 0}
                  <span class="progress-stat progress-stat--fail">{progress.failed} failed</span>
                {/if}
                <span class="progress-stat progress-stat--total">/ {progress.total}</span>
              </div>
            {:else if progressLoading[initiative.id]}
              <div class="progress-loading">Loading progress…</div>
            {/if}

            <!-- Edit inline form -->
            {#if isEditing}
              <div class="inline-form">
                <label class="field-label">
                  Name
                  <input class="field-input" type="text" bind:value={editName} />
                </label>
                <label class="field-label">
                  Description
                  <textarea class="field-textarea" bind:value={editDescription} rows="2"></textarea>
                </label>
                <div class="field-label">
                  Color
                  <div class="color-picker">
                    {#each PRESET_COLORS as color}
                      <button
                        class="color-swatch"
                        class:color-swatch--selected={editColor === color.value}
                        style="background: {color.value};"
                        title={color.label}
                        onclick={() => (editColor = color.value)}
                      ></button>
                    {/each}
                  </div>
                </div>
                <div class="form-actions">
                  <button class="btn-secondary" onclick={cancelEdit}>Cancel</button>
                  <button class="btn-primary" onclick={saveEdit} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            {/if}

            <!-- Expanded details -->
            {#if isExpanded && !isEditing}
              <div class="expanded-section">
                <!-- Workspaces -->
                <div class="expanded-subsection">
                  <div class="expanded-subsection-title">Workspaces</div>
                  {#if initiative.workspacePaths.length === 0}
                    <div class="expanded-empty">No workspaces linked</div>
                  {:else}
                    <ul class="link-list">
                      {#each initiative.workspacePaths as path}
                        <li class="link-item">
                          <span class="link-label" title={path}
                            >{path.split('/').filter(Boolean).pop() ?? path}</span
                          >
                          <button
                            class="link-remove"
                            onclick={() => removeWorkspace(initiative.id, path)}
                            title="Remove">✕</button
                          >
                        </li>
                      {/each}
                    </ul>
                  {/if}
                  <div class="add-row">
                    <input
                      class="field-input add-input"
                      type="text"
                      bind:value={addWorkspaceInput}
                      placeholder="/path/to/workspace"
                      onkeydown={(e) => {
                        if (e.key === 'Enter') addWorkspace(initiative.id);
                      }}
                    />
                    <button
                      class="btn-xs"
                      onclick={() => addWorkspace(initiative.id)}
                      disabled={!addWorkspaceInput.trim()}>Add</button
                    >
                  </div>
                </div>

                <!-- PRDs -->
                <div class="expanded-subsection">
                  <div class="expanded-subsection-title">Linked PRDs</div>
                  {#if initiative.prdIds.length === 0}
                    <div class="expanded-empty">No PRDs linked</div>
                  {:else}
                    <ul class="link-list">
                      {#each initiative.prdIds as prdId}
                        <li class="link-item">
                          <span class="link-label" title={prdId}>{prdNameForId(prdId)}</span>
                          <button
                            class="link-remove"
                            onclick={() => removePrd(initiative.id, prdId)}
                            title="Remove">✕</button
                          >
                        </li>
                      {/each}
                    </ul>
                  {/if}
                  <div class="add-row">
                    <select class="field-input add-select" bind:value={addPrdId}>
                      <option value="">— Select PRD —</option>
                      {#each availablePrds.filter((p) => !initiative.prdIds.includes(p.id)) as prd}
                        <option value={prd.id}>{prd.name}</option>
                      {/each}
                    </select>
                    <button
                      class="btn-xs"
                      onclick={() => addPrd(initiative.id)}
                      disabled={!addPrdId}>Add</button
                    >
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-secondary);
    flex-shrink: 0;
  }

  .panel-title {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .btn-icon {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: var(--fs-md);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition);
  }

  .btn-icon:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    background: color-mix(in srgb, var(--accent-error) 12%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--accent-error) 25%, transparent);
    font-size: var(--fs-sm);
    color: var(--accent-error);
    flex-shrink: 0;
  }

  .error-dismiss {
    background: transparent;
    border: none;
    color: var(--accent-error);
    cursor: pointer;
    font-size: var(--fs-sm);
    padding: 0 2px;
  }

  /* Form card */
  .form-card {
    margin: 12px 14px;
    padding: 14px;
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    background: var(--bg-secondary);
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex-shrink: 0;
  }

  .form-title {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-primary);
  }

  .field-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .field-input,
  .field-textarea {
    background: var(--bg-input);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--fs-sm);
    font-family: var(--font-family-sans);
    padding: 6px 8px;
    outline: none;
    transition: border-color var(--transition);
    resize: vertical;
  }

  .field-input:focus,
  .field-textarea:focus {
    border-color: var(--accent-primary);
  }

  /* Color picker */
  .color-picker {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .color-swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: all var(--transition);
    padding: 0;
  }

  .color-swatch--selected {
    border-color: var(--text-primary);
    transform: scale(1.15);
  }

  .color-swatch:hover:not(.color-swatch--selected) {
    transform: scale(1.1);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-primary {
    padding: 5px 14px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid var(--accent-primary);
    background: var(--accent-primary);
    color: var(--bg-primary);
    cursor: pointer;
    transition: all var(--transition);
    letter-spacing: var(--ht-label-spacing);
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .btn-primary:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .btn-secondary {
    padding: 5px 14px;
    font-size: var(--fs-sm);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
    letter-spacing: var(--ht-label-spacing);
  }

  .btn-secondary:hover {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }

  .btn-xs {
    padding: 3px 10px;
    font-size: var(--fs-xs);
    font-weight: 600;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-primary);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .btn-xs:hover:not(:disabled) {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .btn-xs:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* Loading / empty */
  .loading-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 24px;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border-primary);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 40px 24px;
    color: var(--text-tertiary);
    text-align: center;
  }

  .empty-icon {
    font-size: var(--fs-2xl);
    opacity: 0.5;
  }

  .empty-text {
    font-size: var(--fs-base);
  }

  /* Initiatives list */
  .initiatives-list {
    flex: 1;
    overflow-y: auto;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Initiative card */
  .initiative-card {
    display: flex;
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius);
    background: var(--bg-secondary);
    overflow: hidden;
    transition: border-color var(--transition);
  }

  .initiative-card:hover {
    border-color: var(--border-primary);
  }

  .initiative-card--archived {
    opacity: 0.6;
  }

  .initiative-accent {
    width: 3px;
    flex-shrink: 0;
    background: var(--initiative-color, #6366f1);
    border-radius: var(--radius) 0 0 var(--radius);
  }

  .initiative-body {
    flex: 1;
    padding: 10px 12px;
    min-width: 0;
  }

  .initiative-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 4px;
  }

  .initiative-header-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }

  .initiative-name {
    font-size: var(--fs-base);
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border-radius: 10px;
    border: 1px solid var(--border-secondary);
    background: var(--bg-tertiary);
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .status-badge--completed {
    color: #34d399;
    border-color: color-mix(in srgb, #34d399 30%, transparent);
    background: color-mix(in srgb, #34d399 10%, transparent);
  }

  .status-badge--archived {
    color: var(--text-tertiary);
    opacity: 0.7;
  }

  .initiative-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .action-btn {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: var(--fs-xs);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition);
    padding: 0;
  }

  .action-btn:hover {
    color: var(--accent-primary);
    border-color: var(--border-primary);
    background: var(--bg-hover);
  }

  .action-btn--active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .action-btn--danger:hover {
    color: var(--accent-error);
    border-color: var(--accent-error);
  }

  .initiative-description {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    line-height: 1.5;
    margin-bottom: 6px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Stats */
  .initiative-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }

  .stat-chip {
    font-size: var(--fs-xxs);
    font-weight: 600;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: 10px;
    padding: 1px 6px;
  }

  /* Progress bar */
  .progress-bar-wrap {
    height: 4px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .progress-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.4s ease;
  }

  .progress-detail {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 2px;
  }

  .progress-stat {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }

  .progress-stat--done {
    color: #34d399;
  }
  .progress-stat--active {
    color: var(--accent-primary);
  }
  .progress-stat--fail {
    color: var(--accent-error);
  }
  .progress-stat--total {
    color: var(--text-tertiary);
  }

  .progress-loading {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    font-style: italic;
    margin-bottom: 4px;
  }

  /* Inline form */
  .inline-form {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border-secondary);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Expanded section */
  .expanded-section {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border-secondary);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .expanded-subsection {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .expanded-subsection-title {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-tertiary);
  }

  .expanded-empty {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    font-style: italic;
  }

  .link-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .link-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-secondary);
    border-radius: var(--radius-sm);
    padding: 3px 8px;
  }

  .link-label {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .link-remove {
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: var(--fs-xxs);
    padding: 0 2px;
    flex-shrink: 0;
    transition: color var(--transition);
  }

  .link-remove:hover {
    color: var(--accent-error);
  }

  .add-row {
    display: flex;
    gap: 6px;
  }

  .add-input,
  .add-select {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-xs);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
