<script lang="ts">
  /**
   * TestExplorerPanel (LYK-1014) — hierarchical test view powered by the
   * plugin discovery + runner endpoints (LYK-1054 / LYK-1055), with
   * status overlay from testResultsStore so terminal-detected runs and
   * plugin-run results share one tree.
   *
   * Data flow:
   *   1. On mount, GET /api/plugins/tests/discover → groups of tree
   *      roots, each tagged with the contributing plugin (the source
   *      becomes the framework label).
   *   2. testResultsStore.fileResults overlays pass/fail/skip status by
   *      matching (file, line) — the same coordinates plugin discovery
   *      reports for leaf tests.
   *   3. Per-row Run dispatches `api.plugins.runTests(root, [testId])`;
   *      Run All collects every leaf id; Re-run Failed filters to ids
   *      whose current status === 'failed'.
   *
   * Open file routes through editorStore.openFile with goTo so clicking
   * a leaf jumps straight to the test definition. Debug is deferred —
   * spawning a single test under DAP needs framework-specific glue
   * that's not in scope here.
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { testResultsStore } from '$lib/stores/test-results.svelte';
  import { pluginTestDiscoveryStore } from '$lib/stores/pluginTestDiscovery.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';

  interface ServerNode {
    id: string;
    label: string;
    type: 'suite' | 'test';
    file?: string;
    line?: number;
    children?: ServerNode[];
  }

  interface Framework {
    /** Source string from the discovery RPC — e.g. "plugin:vitest". */
    source: string;
    tree: ServerNode[];
  }

  let frameworks = $state<Framework[]>([]);
  let loading = $state(false);
  let discoveryError = $state<string | null>(null);
  let runningIds = $state<Set<string>>(new Set());

  // ── Filters ──
  type FilterMode = 'all' | 'failed' | 'recent';
  let filter = $state<FilterMode>('all');
  // Expand/collapse state, scoped to this mount.
  let expanded = $state<Record<string, boolean>>({});

  function toggle(id: string) {
    expanded = { ...expanded, [id]: !expanded[id] };
  }
  function isOpen(id: string, defaultOpen: boolean): boolean {
    if (id in expanded) return expanded[id];
    return defaultOpen;
  }

  async function discover() {
    loading = true;
    discoveryError = null;
    try {
      const ws = settingsStore.workspacePath;
      if (!ws || ws === '.') {
        discoveryError = 'No workspace selected — set a workspace path in settings first.';
        return;
      }
      const res = await api.plugins.discoverTests(ws);
      const groups = res.data?.results ?? [];
      frameworks = groups.map((g) => ({ source: g.source, tree: g.tree as ServerNode[] }));
      // Cache for the gutter (LYK-1015) so click-to-run resolves
      // (file, line) → test id without re-discovering.
      pluginTestDiscoveryStore.setGroups(
        groups.map((g) => ({ source: g.source, tree: g.tree as ServerNode[] })),
      );
    } catch (e) {
      discoveryError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void discover();
  });

  // ── Status overlay ──
  // testResultsStore tracks markers per file. For each leaf we match
  // by (file, line) — discovery emits 0-indexed lines, the markers are
  // 1-indexed (TestResult.line is 1-based), so the lookup adds one.
  function statusFor(node: ServerNode): 'passed' | 'failed' | 'skipped' | 'pending' | null {
    if (!node.file || node.line == null) return null;
    const markers = testResultsStore.getMarkersForFile(node.file);
    for (const m of markers) {
      if (m.line === node.line + 1 || m.line === node.line) return m.status;
    }
    return null;
  }

  // Recursive "any descendant failed / passed / skipped" for suite badges.
  function rollupStatus(node: ServerNode): 'passed' | 'failed' | 'skipped' | 'pending' | null {
    const own = statusFor(node);
    if (node.type === 'test') return own;
    if (!node.children) return own;
    let hadFail = false;
    let hadPass = false;
    let hadSkip = false;
    for (const c of node.children) {
      const s = rollupStatus(c);
      if (s === 'failed') hadFail = true;
      else if (s === 'passed') hadPass = true;
      else if (s === 'skipped' || s === 'pending') hadSkip = true;
    }
    if (hadFail) return 'failed';
    if (hadPass) return 'passed';
    if (hadSkip) return 'skipped';
    return null;
  }

  function statusIcon(s: ReturnType<typeof statusFor>): string {
    switch (s) {
      case 'passed':
        return '✓';
      case 'failed':
        return '✕';
      case 'skipped':
        return '⊘';
      case 'pending':
        return '◯';
      default:
        return '·';
    }
  }
  function statusClass(s: ReturnType<typeof statusFor>): string {
    if (!s) return '';
    return `status-${s}`;
  }

  // ── Filtering ──
  /** Whether a node (and its subtree) should remain visible under the active filter. */
  function nodeMatchesFilter(node: ServerNode): boolean {
    if (filter === 'all') return true;
    if (filter === 'failed') {
      if (node.type === 'test') return statusFor(node) === 'failed';
      return (node.children ?? []).some(nodeMatchesFilter);
    }
    if (filter === 'recent') {
      // "Recently run" = was in the latest run's results (matched by file).
      const latest = testResultsStore.latestRun;
      if (!latest) return false;
      if (node.type === 'test') {
        if (!node.file) return false;
        return latest.results.some((r) => r.filePath === node.file);
      }
      return (node.children ?? []).some(nodeMatchesFilter);
    }
    return true;
  }

  // ── Running ──
  function collectAllTestIds(nodes: ServerNode[]): string[] {
    const out: string[] = [];
    function walk(n: ServerNode) {
      if (n.type === 'test') out.push(n.id);
      if (n.children) for (const c of n.children) walk(c);
    }
    for (const n of nodes) walk(n);
    return out;
  }
  function collectFailedIds(nodes: ServerNode[]): string[] {
    const out: string[] = [];
    function walk(n: ServerNode) {
      if (n.type === 'test' && statusFor(n) === 'failed') out.push(n.id);
      if (n.children) for (const c of n.children) walk(c);
    }
    for (const n of nodes) walk(n);
    return out;
  }

  async function runIds(ids: string[]) {
    if (ids.length === 0) return;
    const ws = settingsStore.workspacePath;
    if (!ws || ws === '.') {
      uiStore.toast('No workspace selected.', 'warning');
      return;
    }
    const fresh = new Set(runningIds);
    for (const id of ids) fresh.add(id);
    runningIds = fresh;
    try {
      await api.plugins.runTests(ws, ids);
      uiStore.toast(`Ran ${ids.length} test${ids.length === 1 ? '' : 's'}.`, 'success');
      // Discovery doesn't auto-refresh; status overlays will pick up
      // whatever the runner emitted into testResultsStore via terminal
      // events, plus future LYK-1014 follow-ups can push status from
      // the run-result events directly.
    } catch (e) {
      uiStore.toast(`Run failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      const next = new Set(runningIds);
      for (const id of ids) next.delete(id);
      runningIds = next;
    }
  }

  function openFile(node: ServerNode) {
    if (!node.file) return;
    void editorStore.openFile(node.file, false, {
      line: (node.line ?? 0) + 1,
      col: 1,
    });
  }

  const allIds = $derived.by(() => frameworks.flatMap((f) => collectAllTestIds(f.tree)));
  const failedIds = $derived.by(() => frameworks.flatMap((f) => collectFailedIds(f.tree)));
</script>

<div class="test-explorer">
  <header class="te-header">
    <h3>Test Explorer</h3>
    <div class="te-toolbar">
      <button
        type="button"
        class="te-btn"
        disabled={allIds.length === 0 || runningIds.size > 0}
        title="Run all tests"
        onclick={() => runIds(allIds)}
      >
        ▶ Run all
      </button>
      <button
        type="button"
        class="te-btn"
        disabled={failedIds.length === 0 || runningIds.size > 0}
        title="Re-run failed tests"
        onclick={() => runIds(failedIds)}
      >
        ↻ Re-run failed
      </button>
      <button
        type="button"
        class="te-btn"
        title="Refresh discovery"
        onclick={discover}
        disabled={loading}
      >
        ⟳ Refresh
      </button>
    </div>
  </header>

  <div class="te-filters" role="tablist" aria-label="Filter tests">
    <button
      type="button"
      role="tab"
      aria-selected={filter === 'all'}
      class:active={filter === 'all'}
      onclick={() => (filter = 'all')}
    >
      All
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={filter === 'failed'}
      class:active={filter === 'failed'}
      onclick={() => (filter = 'failed')}
    >
      Failed
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={filter === 'recent'}
      class:active={filter === 'recent'}
      onclick={() => (filter = 'recent')}
    >
      Recently run
    </button>
  </div>

  {#if discoveryError}
    <div class="te-error" role="alert">{discoveryError}</div>
  {/if}

  {#if loading}
    <div class="te-empty">Discovering tests…</div>
  {:else if frameworks.length === 0}
    <div class="te-empty">
      No test framework plugins enabled. Install one that contributes
      <code>testDiscovery</code>.
    </div>
  {:else}
    <div class="te-tree">
      {#each frameworks as fw (fw.source)}
        {#if fw.tree.some(nodeMatchesFilter)}
          <div class="te-framework">
            <div class="te-fw-label">{fw.source}</div>
            <ul class="te-tree-root">
              {#each fw.tree as n (n.id)}
                {#if nodeMatchesFilter(n)}
                  {@render row(n, 0)}
                {/if}
              {/each}
            </ul>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

{#snippet row(node: ServerNode, depth: number)}
  {@const hasChildren = !!node.children && node.children.length > 0}
  {@const open = isOpen(node.id, depth < 1)}
  {@const own = node.type === 'test' ? statusFor(node) : rollupStatus(node)}
  {@const running = runningIds.has(node.id)}
  <li class="te-node">
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="te-row {statusClass(own)}"
      class:running
      style:padding-left="{8 + depth * 14}px"
      role="treeitem"
      tabindex="0"
      aria-selected="false"
      aria-expanded={hasChildren ? open : undefined}
      onclick={() => hasChildren && toggle(node.id)}
      onkeydown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && hasChildren) {
          e.preventDefault();
          toggle(node.id);
        }
      }}
    >
      <span class="te-caret" class:visible={hasChildren} class:open>
        {hasChildren ? '▸' : ''}
      </span>
      <span class="te-status">{statusIcon(own)}</span>
      <span class="te-label">{node.label}</span>
      <span class="te-actions">
        {#if node.file && node.type === 'test'}
          <button
            type="button"
            class="te-action"
            title="Open file at test"
            onclick={(e) => {
              e.stopPropagation();
              openFile(node);
            }}
          >
            ↗
          </button>
        {/if}
        {#if node.type === 'test'}
          <button
            type="button"
            class="te-action te-run"
            title="Run this test"
            disabled={running}
            onclick={(e) => {
              e.stopPropagation();
              void runIds([node.id]);
            }}
          >
            ▶
          </button>
        {/if}
      </span>
    </div>
    {#if hasChildren && open}
      <ul class="te-children">
        {#each node.children as c (c.id)}
          {#if nodeMatchesFilter(c)}
            {@render row(c, depth + 1)}
          {/if}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<style>
  .test-explorer {
    padding: 8px 0;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .te-header {
    padding: 0 12px 8px;
  }
  .te-header h3 {
    margin: 0 0 6px;
    font-size: var(--fs-base);
  }
  .te-toolbar {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .te-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--fs-xs);
    padding: 3px 8px;
    cursor: pointer;
  }
  .te-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .te-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .te-filters {
    display: flex;
    gap: 4px;
    padding: 0 12px 8px;
  }
  .te-filters button {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-secondary);
    font-size: var(--fs-xxs);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .te-filters button.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  .te-error,
  .te-empty {
    padding: 16px 12px;
    color: var(--text-tertiary);
    font-size: var(--fs-sm);
  }
  .te-error {
    color: var(--accent-error);
  }
  .te-tree {
    flex: 1;
    overflow-y: auto;
  }
  .te-framework {
    margin-bottom: 8px;
  }
  .te-fw-label {
    padding: 4px 12px 2px;
    font-size: var(--fs-xxs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .te-tree-root,
  .te-children {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .te-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    cursor: pointer;
    font-size: var(--fs-sm);
    border-radius: var(--radius-sm);
  }
  .te-row:hover {
    background: var(--bg-hover);
  }
  .te-row.running {
    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  }
  .te-caret {
    width: 12px;
    color: var(--text-tertiary);
    font-size: var(--fs-xxs);
    visibility: hidden;
  }
  .te-caret.visible {
    visibility: visible;
  }
  .te-caret.open {
    transform: rotate(90deg);
  }
  .te-status {
    width: 14px;
    text-align: center;
    font-weight: 700;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
  }
  .te-row.status-passed .te-status {
    color: var(--accent-secondary, #5ed26b);
  }
  .te-row.status-failed .te-status {
    color: var(--accent-error, #ef4444);
  }
  .te-row.status-skipped .te-status {
    color: var(--accent-warning, #d4a657);
  }
  .te-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .te-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 80ms ease;
  }
  .te-row:hover .te-actions {
    opacity: 1;
  }
  .te-action {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: var(--fs-xs);
    padding: 0 4px;
    border-radius: var(--radius-sm);
  }
  .te-action:hover {
    color: var(--accent-primary);
  }
  .te-action:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
