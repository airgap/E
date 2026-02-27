<script lang="ts">
  import { api } from '$lib/api/client';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { onMount } from 'svelte';

  interface TodoMatch {
    id: string;
    file: string;
    relativePath: string;
    line: number;
    type: string;
    text: string;
    context: string[];
    suggestedTitle: string;
    suggestedDescription: string;
    priority: string;
  }

  interface Prd {
    id: string;
    name: string;
  }

  type FilterType = 'ALL' | 'TODO' | 'FIXME' | 'HACK' | 'BUG';

  let workspacePath = $derived(settingsStore.workspacePath || '');

  // Scan state
  let scanning = $state(false);
  let todos = $state<TodoMatch[]>([]);
  let hasScanned = $state(false);

  // Filter state
  let activeFilter = $state<FilterType>('ALL');

  // Selection state
  let selectedIds = $state<Set<string>>(new Set());

  // Expanded item
  let expandedId = $state<string | null>(null);

  // PRD list for import
  let prds = $state<Prd[]>([]);
  let selectedPrdId = $state<string>('standalone');

  // Import state
  let importing = $state(false);

  const FILTER_TYPES: FilterType[] = ['ALL', 'TODO', 'FIXME', 'HACK', 'BUG'];

  const TYPE_COLORS: Record<string, string> = {
    TODO: '#4a9eff',
    FIXME: '#ef4444',
    BUG: '#ef4444',
    HACK: '#f59e0b',
  };

  function typeColor(type: string): string {
    return TYPE_COLORS[type.toUpperCase()] ?? '#6b7280';
  }

  let filteredTodos = $derived(
    activeFilter === 'ALL' ? todos : todos.filter((t) => t.type.toUpperCase() === activeFilter),
  );

  let selectedCount = $derived(selectedIds.size);

  let selectedTodos = $derived(todos.filter((t) => selectedIds.has(t.id)));

  let typeCounts = $derived(
    todos.reduce<Record<string, number>>((acc, t) => {
      const key = t.type.toUpperCase();
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  );

  onMount(async () => {
    if (workspacePath) {
      try {
        const res = await api.prds.list(workspacePath);
        if (res.ok && res.data) prds = res.data;
      } catch {}
    }
  });

  async function runScan() {
    if (!workspacePath || scanning) return;
    scanning = true;
    selectedIds = new Set();
    expandedId = null;
    try {
      const res = await api.scan.scanTodos(workspacePath);
      if (res.ok && res.data) {
        todos = res.data.todos;
      } else {
        todos = [];
      }
      hasScanned = true;
    } catch {
      todos = [];
      hasScanned = true;
    } finally {
      scanning = false;
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedIds = next;
  }

  function selectAll() {
    selectedIds = new Set(filteredTodos.map((t) => t.id));
  }

  function deselectAll() {
    selectedIds = new Set();
  }

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  async function importSelected() {
    if (!workspacePath || importing || selectedCount === 0) return;
    importing = true;
    try {
      const prdId = selectedPrdId === 'standalone' ? undefined : selectedPrdId;
      const res = await api.scan.importTodos({
        workspacePath,
        todos: selectedTodos,
        prdId,
      });
      const count = res.data?.created ?? selectedCount;
      uiStore.toast(`Created ${count} ${count === 1 ? 'story' : 'stories'}`, 'success');
      selectedIds = new Set();
    } catch {
      uiStore.toast('Import failed', 'error');
    } finally {
      importing = false;
    }
  }
</script>

<div class="todo-panel">
  <!-- Header -->
  <div class="section-header">
    <h3>TODO Scanner</h3>
    {#if hasScanned && todos.length > 0}
      <span class="count-badge">{todos.length} found</span>
    {/if}
  </div>

  <!-- Scan Section -->
  <div class="scan-section">
    <button class="scan-btn" class:scanning disabled={scanning || !workspacePath} onclick={runScan}>
      {#if scanning}
        <span class="spinner"></span>
        Scanning...
      {:else}
        Scan for TODOs
      {/if}
    </button>

    {#if !workspacePath}
      <p class="workspace-hint">Set a workspace path in settings to scan.</p>
    {/if}
  </div>

  <!-- Filter Chips -->
  {#if hasScanned}
    <div class="filter-bar">
      {#each FILTER_TYPES as chip}
        {@const count = chip === 'ALL' ? todos.length : (typeCounts[chip] ?? 0)}
        <button
          class="filter-chip"
          class:active={activeFilter === chip}
          disabled={chip !== 'ALL' && count === 0}
          onclick={() => (activeFilter = chip)}
        >
          {chip}
          {#if count > 0}
            <span class="chip-count">{count}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Results -->
  {#if hasScanned}
    {#if filteredTodos.length === 0}
      <div class="empty-state">
        <div class="empty-icon">&#x2713;</div>
        <p class="empty-title">No TODOs found</p>
        <p class="empty-hint">
          Add <code>// TODO:</code>, <code>// FIXME:</code>, or <code>// HACK:</code> comments in your
          code to track work items.
        </p>
      </div>
    {:else}
      <!-- Select all / deselect all -->
      <div class="list-toolbar">
        <button
          class="toolbar-link"
          onclick={selectAll}
          disabled={selectedCount === filteredTodos.length}
        >
          Select All
        </button>
        <span class="toolbar-sep">/</span>
        <button class="toolbar-link" onclick={deselectAll} disabled={selectedCount === 0}>
          Deselect All
        </button>
        {#if selectedCount > 0}
          <span class="selected-count">{selectedCount} selected</span>
        {/if}
      </div>

      <!-- Results list -->
      <div class="results-list">
        {#each filteredTodos as todo (todo.id)}
          {@const isSelected = selectedIds.has(todo.id)}
          {@const isExpanded = expandedId === todo.id}
          <div class="todo-item" class:selected={isSelected} class:expanded={isExpanded}>
            <!-- Collapsed row -->
            <div class="todo-row" onclick={() => toggleExpand(todo.id)}>
              <input
                type="checkbox"
                class="todo-checkbox"
                checked={isSelected}
                onclick={(e) => {
                  e.stopPropagation();
                  toggleSelect(todo.id);
                }}
              />
              <span
                class="type-badge"
                style="background: {typeColor(todo.type)}22; color: {typeColor(
                  todo.type,
                )}; border-color: {typeColor(todo.type)}55;"
              >
                {todo.type}
              </span>
              <div class="todo-body">
                <div class="todo-location">
                  {todo.relativePath}:{todo.line}
                </div>
                <div class="todo-text" title={todo.text}>
                  {todo.text}
                </div>
              </div>
              <span class="expand-icon" class:rotated={isExpanded}>›</span>
            </div>

            <!-- Expanded detail -->
            {#if isExpanded}
              <div class="todo-detail">
                <div class="detail-label">Suggested title</div>
                <div class="detail-title">{todo.suggestedTitle}</div>

                {#if todo.suggestedDescription}
                  <div class="detail-label">Description</div>
                  <div class="detail-desc">{todo.suggestedDescription}</div>
                {/if}

                {#if todo.context.length > 0}
                  <div class="detail-label">Context</div>
                  <pre class="detail-context">{todo.context.join('\n')}</pre>
                {/if}

                <div class="detail-meta">
                  <span class="priority-pill" data-priority={todo.priority}>
                    {todo.priority}
                  </span>
                  <span class="detail-file">{todo.relativePath}</span>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {:else if !scanning}
    <div class="empty-state">
      <div class="empty-icon">&#x1F50D;</div>
      <p class="empty-title">Scan your workspace</p>
      <p class="empty-hint">
        Find TODO, FIXME, HACK, and BUG comments in your code and import them as user stories.
      </p>
    </div>
  {/if}

  <!-- Import Bar -->
  {#if selectedCount > 0}
    <div class="import-bar">
      <div class="import-row">
        <span class="import-count">{selectedCount} selected</span>
        <select class="prd-select" bind:value={selectedPrdId}>
          <option value="standalone">Standalone</option>
          {#each prds as prd}
            <option value={prd.id}>{prd.name}</option>
          {/each}
        </select>
      </div>
      <button class="import-btn" disabled={importing} onclick={importSelected}>
        {importing ? 'Importing...' : 'Import as Stories'}
      </button>
    </div>
  {/if}
</div>

<style>
  .todo-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    overflow: hidden;
  }

  /* Header */
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px;
    flex-shrink: 0;
  }
  .section-header h3 {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
  }
  .count-badge {
    font-size: var(--fs-xxs);
    padding: 2px 6px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  /* Scan Section */
  .scan-section {
    padding: 0 4px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .scan-btn {
    width: 100%;
    padding: 7px 12px;
    font-size: var(--fs-sm);
    font-weight: 600;
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .scan-btn:hover:not(:disabled) {
    opacity: 0.9;
  }
  .scan-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .scan-btn.scanning {
    opacity: 0.75;
  }

  .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .workspace-hint {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-align: center;
    margin: 0;
  }

  /* Filter Bar */
  .filter-bar {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
    padding: 0 4px;
    flex-shrink: 0;
  }
  .filter-chip {
    font-size: var(--fs-xxs);
    padding: 3px 7px;
    min-height: 22px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-tertiary);
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-weight: 600;
    transition: all var(--transition);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .filter-chip:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--border-secondary);
  }
  .filter-chip.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .filter-chip:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .chip-count {
    font-size: var(--fs-xxs);
    padding: 0 3px;
    background: var(--bg-hover);
    border-radius: 3px;
    line-height: 14px;
  }
  .filter-chip.active .chip-count {
    background: rgba(255, 255, 255, 0.15);
  }

  /* List Toolbar */
  .list-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px;
    flex-shrink: 0;
  }
  .toolbar-link {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: color var(--transition);
  }
  .toolbar-link:hover:not(:disabled) {
    color: var(--accent-primary);
  }
  .toolbar-link:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .toolbar-sep {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
  }
  .selected-count {
    margin-left: auto;
    font-size: var(--fs-xxs);
    color: var(--accent-primary);
    font-weight: 600;
  }

  /* Results List */
  .results-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 4px;
  }

  /* Todo Item */
  .todo-item {
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    transition:
      background var(--transition),
      border-color var(--transition);
    overflow: hidden;
  }
  .todo-item:hover {
    background: var(--bg-hover);
  }
  .todo-item.selected {
    border-color: var(--accent-primary);
    background: var(--bg-active);
  }

  .todo-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    min-height: 36px;
    cursor: pointer;
    user-select: none;
  }

  .todo-checkbox {
    flex-shrink: 0;
    width: 13px;
    height: 13px;
    accent-color: var(--accent-primary);
    cursor: pointer;
  }

  .type-badge {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    flex-shrink: 0;
    line-height: 14px;
  }

  .todo-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .todo-location {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-family: var(--font-family);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .todo-text {
    font-size: var(--fs-xs);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .expand-icon {
    font-size: var(--fs-md);
    color: var(--text-tertiary);
    flex-shrink: 0;
    transition: transform var(--transition);
    line-height: 1;
  }
  .expand-icon.rotated {
    transform: rotate(90deg);
  }

  /* Expanded Detail */
  .todo-detail {
    padding: 8px 10px 10px;
    border-top: 1px solid var(--border-primary);
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: var(--bg-primary);
  }
  .detail-label {
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    margin-top: 4px;
  }
  .detail-label:first-child {
    margin-top: 0;
  }
  .detail-title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.4;
  }
  .detail-desc {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .detail-context {
    font-size: var(--fs-xxs);
    font-family: var(--font-family);
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    overflow-x: auto;
    white-space: pre;
    margin: 0;
    line-height: 1.5;
  }
  .detail-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }
  .priority-pill {
    font-size: var(--fs-xxs);
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-primary);
  }
  .priority-pill[data-priority='high'] {
    color: #ef4444;
    border-color: #ef444455;
    background: #ef444411;
  }
  .priority-pill[data-priority='medium'] {
    color: #f59e0b;
    border-color: #f59e0b55;
    background: #f59e0b11;
  }
  .priority-pill[data-priority='low'] {
    color: var(--text-tertiary);
  }
  .detail-file {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    font-family: var(--font-family);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Empty State */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    text-align: center;
    gap: 6px;
  }
  .empty-icon {
    font-size: var(--fs-2xl);
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }
  .empty-title {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0;
  }
  .empty-hint {
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    line-height: 1.5;
    max-width: 220px;
    margin: 0;
  }
  .empty-hint code {
    font-family: var(--font-family);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: 3px;
    padding: 0 3px;
    font-size: var(--fs-xxs);
    color: var(--text-secondary);
  }

  /* Import Bar */
  .import-bar {
    flex-shrink: 0;
    padding: 8px;
    border-top: 1px solid var(--border-primary);
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--bg-tertiary);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  }
  .import-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .import-count {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--accent-primary);
    flex-shrink: 0;
  }
  .prd-select {
    flex: 1;
    font-size: var(--fs-xs);
    padding: 4px 6px;
    background: var(--bg-primary);
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    font-family: var(--font-family);
    cursor: pointer;
    min-width: 0;
  }
  .prd-select:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
  .import-btn {
    width: 100%;
    padding: 7px 12px;
    font-size: var(--fs-sm);
    font-weight: 600;
    background: var(--accent-primary);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .import-btn:hover:not(:disabled) {
    opacity: 0.9;
  }
  .import-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
