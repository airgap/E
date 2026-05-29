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
  import { onMount, untrack } from 'svelte';
  import { api } from '$lib/api/client';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { testResultsStore } from '$lib/stores/test-results.svelte';
  import { pluginTestDiscoveryStore } from '$lib/stores/pluginTestDiscovery.svelte';
  import { uiStore } from '$lib/stores/ui.svelte';
  import { fileWatcherStore } from '$lib/stores/fileWatcher.svelte';

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
  // Two sources, in precedence order:
  //   1. liveStatus[testId] — live events from the streaming runner
  //      (LYK-1055), including the transient 'running' state.
  //   2. testResultsStore markers matched by (file, line) — terminal-
  //      detected runs and the final state after a stream completes.
  type TestStatus = 'passed' | 'failed' | 'skipped' | 'pending' | 'running';
  /** Live per-test status keyed by discovery node id, from the SSE stream. */
  let liveStatus = $state<Record<string, TestStatus>>({});

  function statusFor(node: ServerNode): TestStatus | null {
    const live = liveStatus[node.id];
    if (live) return live;
    if (!node.file || node.line == null) return null;
    const markers = testResultsStore.getMarkersForFile(node.file);
    for (const m of markers) {
      if (m.line === node.line + 1 || m.line === node.line) return m.status;
    }
    return null;
  }

  // Recursive rollup for suite badges. 'running' wins so a suite shows
  // in-progress while any descendant is still executing.
  function rollupStatus(node: ServerNode): TestStatus | null {
    const own = statusFor(node);
    if (node.type === 'test') return own;
    if (!node.children) return own;
    let hadRun = false;
    let hadFail = false;
    let hadPass = false;
    let hadSkip = false;
    for (const c of node.children) {
      const s = rollupStatus(c);
      if (s === 'running') hadRun = true;
      else if (s === 'failed') hadFail = true;
      else if (s === 'passed') hadPass = true;
      else if (s === 'skipped' || s === 'pending') hadSkip = true;
    }
    if (hadRun) return 'running';
    if (hadFail) return 'failed';
    if (hadPass) return 'passed';
    if (hadSkip) return 'skipped';
    return null;
  }

  function statusIcon(s: TestStatus | null): string {
    switch (s) {
      case 'passed':
        return '✓';
      case 'failed':
        return '✕';
      case 'skipped':
        return '⊘';
      case 'running':
        return '◌';
      case 'pending':
        return '◯';
      default:
        return '·';
    }
  }
  function statusClass(s: TestStatus | null): string {
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
    // Reset live status for the ids about to run so stale glyphs clear.
    const clearedLive = { ...liveStatus };
    for (const id of ids) delete clearedLive[id];
    liveStatus = clearedLive;
    let sawEvents = false;
    try {
      // Stream live results (LYK-1055): update liveStatus per event so the
      // tree shows running → pass/fail as the runner emits them.
      await api.plugins.runTestsStream(ws, ids, (ev) => {
        if (!ev.testId) return;
        sawEvents = true;
        let next: TestStatus | null = null;
        if (ev.type === 'start') next = 'running';
        else if (ev.type === 'pass') next = 'passed';
        else if (ev.type === 'fail') next = 'failed';
        else if (ev.type === 'skip') next = 'skipped';
        if (next) liveStatus = { ...liveStatus, [ev.testId]: next };
      });
      if (sawEvents) {
        uiStore.toast(`Ran ${ids.length} test${ids.length === 1 ? '' : 's'}.`, 'success');
      } else {
        // No streamed events (e.g. a runner that doesn't emit per-test
        // lines) — fall back to the buffered runner so the run still
        // happens and terminal-detected markers can populate.
        await api.plugins.runTests(ws, ids);
        uiStore.toast(`Ran ${ids.length} test${ids.length === 1 ? '' : 's'}.`, 'success');
      }
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

  // ── Watch mode (LYK-1016) ──
  //
  // Persisted per workspace under `e:test-watch:${workspacePath}`. When
  // ON, every workspace file change schedules a debounced re-run; the
  // re-run is targeted (just the changed file's test ids) when the
  // changed path is itself a known test file in the discovery tree,
  // otherwise full re-run since we have no dep graph.
  function watchStorageKey(): string {
    const ws = settingsStore.workspacePath || '_global_';
    return `e:test-watch:${ws}`;
  }
  let watching = $state(false);
  let watchDebounce: ReturnType<typeof setTimeout> | null = null;
  let lastWatchedChangeAt = 0;

  // Hydrate from localStorage when the workspace changes.
  $effect(() => {
    const key = watchStorageKey();
    if (typeof localStorage === 'undefined') return;
    try {
      const stored = localStorage.getItem(key);
      untrack(() => (watching = stored === '1'));
    } catch {
      // ignore corrupted localStorage
    }
  });

  function toggleWatch() {
    watching = !watching;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(watchStorageKey(), watching ? '1' : '0');
      }
    } catch {
      // ignore quota
    }
    if (watching) {
      uiStore.toast('Watch mode on — re-running tests on file changes.', 'info');
    } else if (watchDebounce) {
      clearTimeout(watchDebounce);
      watchDebounce = null;
    }
  }

  /** Find ids of tests whose file matches the changed path. */
  function impactedTestIds(changedPath: string): string[] {
    const out: string[] = [];
    function walk(n: ServerNode) {
      if (n.type === 'test' && n.file === changedPath) out.push(n.id);
      if (n.children) for (const c of n.children) walk(c);
    }
    for (const f of frameworks) for (const n of f.tree) walk(n);
    return out;
  }

  // Subscribe to fileWatcher.lastChangeAt; debounce 350ms; decide
  // targeted vs full re-run; dispatch.
  $effect(() => {
    if (!watching) return;
    const at = fileWatcherStore.lastChangeAt;
    if (at === 0 || at === lastWatchedChangeAt) return;
    lastWatchedChangeAt = at;
    const path = untrack(() => fileWatcherStore.lastChangedPath);
    if (!path) return;
    if (watchDebounce) clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
      watchDebounce = null;
      untrack(() => {
        const impacted = impactedTestIds(path);
        const toRun = impacted.length > 0 ? impacted : allIds;
        if (toRun.length === 0) return;
        void runIds(toRun);
      });
    }, 350);
  });
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
      <button
        type="button"
        class="te-btn"
        class:active={watching}
        title={watching
          ? 'Watch mode is on — file changes re-run tests automatically. Click to turn off.'
          : 'Watch mode — auto re-run tests when workspace files change.'}
        onclick={toggleWatch}
      >
        {watching ? '👁 Watching' : '👁 Watch'}
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
  .te-btn.active {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: #fff;
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
  .te-row.status-running .te-status {
    color: var(--accent-primary, #4ec1f5);
    animation: te-spin 1s linear infinite;
    display: inline-block;
  }
  @keyframes te-spin {
    to {
      transform: rotate(360deg);
    }
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
