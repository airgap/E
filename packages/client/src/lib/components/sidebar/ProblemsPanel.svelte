<script lang="ts">
  import { diagnosticsStore, type DiagnosticItem } from '$lib/stores/diagnostics.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';

  type SeverityFilter = 'all' | 'error' | 'warning';

  let severityFilter = $state<SeverityFilter>('all');
  let query = $state('');

  /** Files that are currently expanded — by default expand everything when the list is small. */
  let collapsed = $state<Set<string>>(new Set());

  function toggleCollapse(path: string) {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsed = next;
  }

  function displayPath(path: string): string {
    const ws = settingsStore.workspacePath;
    if (ws && ws !== '.' && path.startsWith(ws + '/')) return path.slice(ws.length + 1);
    return path;
  }

  let grouped = $derived.by(() => {
    const rows = diagnosticsStore.all.filter((d) => {
      if (severityFilter !== 'all' && d.severity !== severityFilter) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        d.message.toLowerCase().includes(q) ||
        d.path.toLowerCase().includes(q) ||
        d.source.toLowerCase().includes(q)
      );
    });
    const byFile = new Map<string, DiagnosticItem[]>();
    for (const d of rows) {
      const arr = byFile.get(d.path) ?? [];
      arr.push(d);
      byFile.set(d.path, arr);
    }
    // Sort files alphabetically, sort diagnostics within a file by line.
    const files = Array.from(byFile.keys()).sort();
    return files.map((path) => ({
      path,
      items: byFile
        .get(path)!
        .slice()
        .sort((a, b) => a.line - b.line || a.character - b.character),
    }));
  });

  function jumpTo(d: DiagnosticItem) {
    editorStore.openFile(d.path, false, { line: d.line + 1, col: d.character + 1 });
  }

  let counts = $derived(diagnosticsStore.counts);
</script>

<div class="problems-panel">
  <div class="panel-header">
    <h3>Problems</h3>
    <div class="severity-badges" aria-label="Diagnostic counts">
      <span class="badge error" class:dim={counts.error === 0} title="Errors">
        <span class="dot" aria-hidden="true"></span>
        {counts.error}
      </span>
      <span class="badge warning" class:dim={counts.warning === 0} title="Warnings">
        <span class="dot" aria-hidden="true"></span>
        {counts.warning}
      </span>
      <span class="badge info" class:dim={counts.info + counts.hint === 0} title="Info / hints">
        <span class="dot" aria-hidden="true"></span>
        {counts.info + counts.hint}
      </span>
    </div>
  </div>

  <div class="panel-controls">
    <input type="text" bind:value={query} class="filter-input" placeholder="Filter problems…" />
    <div class="severity-filter" role="radiogroup" aria-label="Severity filter">
      <button
        class="seg-btn"
        class:active={severityFilter === 'all'}
        onclick={() => (severityFilter = 'all')}
      >
        All
      </button>
      <button
        class="seg-btn"
        class:active={severityFilter === 'error'}
        onclick={() => (severityFilter = 'error')}
      >
        Errors
      </button>
      <button
        class="seg-btn"
        class:active={severityFilter === 'warning'}
        onclick={() => (severityFilter = 'warning')}
      >
        Warnings
      </button>
    </div>
  </div>

  <div class="problem-list">
    {#if grouped.length === 0}
      <div class="empty">
        {#if diagnosticsStore.all.length === 0}
          No problems detected. Open a file with a language server connected to see diagnostics.
        {:else}
          No problems match the current filter.
        {/if}
      </div>
    {:else}
      {#each grouped as group (group.path)}
        {@const isCollapsed = collapsed.has(group.path)}
        <div class="file-group">
          <button class="file-header" onclick={() => toggleCollapse(group.path)}>
            <span class="chevron" class:collapsed={isCollapsed}>▾</span>
            <span class="file-name">{displayPath(group.path)}</span>
            <span class="file-count">{group.items.length}</span>
          </button>
          {#if !isCollapsed}
            <div class="diag-items">
              {#each group.items as d (d.line + ':' + d.character + ':' + d.message)}
                <button
                  class="diag-item severity-{d.severity}"
                  onclick={() => jumpTo(d)}
                  title={d.message}
                >
                  <span class="sev-dot" aria-hidden="true"></span>
                  <span class="diag-message">{d.message}</span>
                  <span class="diag-meta">{d.source}:{d.line + 1}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .problems-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-size: var(--fs-sm);
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-primary);
  }
  .panel-header h3 {
    margin: 0;
    font-size: var(--fs-base);
    font-weight: 600;
  }
  .severity-badges {
    display: flex;
    gap: 6px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border-radius: 10px;
    font-size: var(--fs-xxs);
    font-variant-numeric: tabular-nums;
    background: var(--bg-active);
    color: var(--text-secondary);
  }
  .badge.dim {
    opacity: 0.45;
  }
  .badge .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .badge.error {
    color: var(--diag-error, #f14c4c);
  }
  .badge.warning {
    color: var(--diag-warning, #cca700);
  }
  .badge.info {
    color: var(--diag-info, #5ea0d8);
  }

  .panel-controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-primary);
  }
  .filter-input {
    width: 100%;
    padding: 4px 8px;
    font-size: var(--fs-xs);
    background: var(--bg-input);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    outline: none;
  }
  .filter-input:focus {
    border-color: var(--accent, var(--text-primary));
  }
  .severity-filter {
    display: inline-flex;
    gap: 2px;
  }
  .seg-btn {
    padding: 2px 8px;
    font-size: var(--fs-xxs);
    background: var(--bg-active);
    color: var(--text-secondary);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .seg-btn.active {
    background: var(--accent, var(--text-primary));
    color: var(--bg-primary);
  }

  .problem-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .empty {
    padding: 20px;
    color: var(--text-tertiary);
    text-align: center;
    font-size: var(--fs-sm);
  }

  .file-group {
    padding: 2px 0;
  }
  .file-header {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 6px;
    padding: 4px 10px;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
  }
  .file-header:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .chevron {
    width: 10px;
    font-size: var(--fs-xs);
    transition: transform var(--transition);
  }
  .chevron.collapsed {
    transform: rotate(-90deg);
  }
  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-count {
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    background: var(--bg-active);
    padding: 0 5px;
    border-radius: 8px;
  }

  .diag-items {
    padding: 2px 0;
  }
  .diag-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    padding: 3px 10px 3px 28px;
    background: none;
    border: none;
    text-align: left;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .diag-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .sev-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    align-self: center;
  }
  .severity-error .sev-dot {
    background: var(--diag-error, #f14c4c);
  }
  .severity-warning .sev-dot {
    background: var(--diag-warning, #cca700);
  }
  .severity-info .sev-dot,
  .severity-hint .sev-dot {
    background: var(--diag-info, #5ea0d8);
  }
  .diag-message {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .diag-meta {
    font-family: var(--font-family);
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
</style>
