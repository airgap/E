<script lang="ts">
  import { uiStore } from '$lib/stores/ui.svelte';
  import { editorStore } from '$lib/stores/editor.svelte';
  import { api } from '$lib/api/client';
  import { conversationStore } from '$lib/stores/conversation.svelte';
  import { settingsStore } from '$lib/stores/settings.svelte';
  import { lspStore } from '$lib/stores/lsp.svelte';

  interface FileEntry {
    name: string;
    path: string;
    relativePath: string;
    type: 'file' | 'directory';
    children?: FileEntry[];
  }

  /** Unified result row — files, document symbols, and workspace symbols all render here. */
  interface ResultRow {
    kind: 'file' | 'doc-symbol' | 'workspace-symbol';
    name: string;
    detail: string;
    // File fields
    path?: string;
    // Symbol fields
    uri?: string;
    line?: number;
    character?: number;
    symbolKind?: string;
  }

  type Mode = 'file' | 'doc-symbol' | 'workspace-symbol';

  let query = $state('');
  let results = $state<ResultRow[]>([]);
  let selectedIndex = $state(0);
  let allFiles = $state<FileEntry[]>([]);
  let input: HTMLInputElement;

  // LSP symbol numeric kind → short tag for display.
  const LSP_KIND_TO_TAG: Record<number, string> = {
    5: 'class',
    6: 'method',
    7: 'prop',
    8: 'field',
    9: 'ctor',
    10: 'enum',
    11: 'iface',
    12: 'fn',
    13: 'var',
    14: 'const',
    22: 'enum',
    23: 'struct',
    26: 'type',
  };

  /** Mode is derived from the first character of the query. */
  let mode = $derived.by<Mode>(() => {
    const q = query.trimStart();
    if (q.startsWith('#')) return 'workspace-symbol';
    if (q.startsWith('@')) return 'doc-symbol';
    return 'file';
  });

  let effectiveQuery = $derived.by(() => {
    const q = query.trimStart();
    if (q.startsWith('#') || q.startsWith('@')) return q.slice(1).trim();
    return q.trim();
  });

  function flattenTree(entries: FileEntry[]): FileEntry[] {
    const flat: FileEntry[] = [];
    function walk(items: FileEntry[]) {
      for (const item of items) {
        if (item.type === 'file') flat.push(item);
        if (item.children) walk(item.children);
      }
    }
    walk(entries);
    return flat;
  }

  function fuzzyScore(query: string, text: string): number {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let score = 0;
    let qi = 0;
    let lastMatch = -1;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        score += 1;
        if (lastMatch === ti - 1) score += 2;
        if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '.') score += 3;
        lastMatch = ti;
        qi++;
      }
    }
    return qi === q.length ? score : -1;
  }

  $effect(() => {
    if (uiStore.activeModal === 'quick-open') {
      // Seed the query if a caller (e.g. Ctrl+T) preloaded a prefix like '#' or '@'.
      const seed = uiStore.consumeQuickOpenSeed();
      if (seed) query = seed;
      loadFiles();
      setTimeout(() => {
        input?.focus();
        // Place cursor at end so the prefix stays and the user types the search term.
        if (input && query) input.setSelectionRange(query.length, query.length);
      }, 50);
    }
  });

  /**
   * Reactively rebuild the results list whenever the query (or mode) changes.
   * Symbol lookups are async — we track a ticket id to avoid stale results clobbering fresh ones.
   */
  let searchTicket = 0;
  $effect(() => {
    const q = effectiveQuery;
    const m = mode;
    const ticket = ++searchTicket;

    if (m === 'file') {
      if (q) {
        const scored = allFiles
          .map((f) => ({ file: f, score: fuzzyScore(q, f.relativePath || f.name) }))
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score);
        results = scored.slice(0, 50).map((s) => ({
          kind: 'file' as const,
          name: s.file.name,
          detail: s.file.relativePath || s.file.path,
          path: s.file.path,
        }));
      } else {
        results = allFiles.slice(0, 50).map((f) => ({
          kind: 'file' as const,
          name: f.name,
          detail: f.relativePath || f.path,
          path: f.path,
        }));
      }
      selectedIndex = 0;
      return;
    }

    if (m === 'doc-symbol') {
      const tab = editorStore.activeTab;
      if (!tab || !lspStore.isConnected(tab.language)) {
        results = [];
        return;
      }
      lspStore
        .documentSymbols(tab.language, tab.filePath)
        .then((raw) => {
          if (ticket !== searchTicket) return;
          const flat: ResultRow[] = [];
          const walk = (nodes: any[]) => {
            for (const s of nodes) {
              const range = s.range ?? s.location?.range;
              if (!range) continue;
              flat.push({
                kind: 'doc-symbol',
                name: s.name,
                detail: LSP_KIND_TO_TAG[s.kind] ?? '',
                uri: tab.filePath,
                line: range.start.line,
                character: range.start.character,
                symbolKind: LSP_KIND_TO_TAG[s.kind] ?? '',
              });
              if (Array.isArray(s.children)) walk(s.children);
            }
          };
          walk(raw);
          const filtered = q
            ? flat
                .map((r) => ({ r, score: fuzzyScore(q, r.name) }))
                .filter((x) => x.score > 0)
                .sort((a, b) => b.score - a.score)
                .map((x) => x.r)
            : flat;
          results = filtered.slice(0, 100);
          selectedIndex = 0;
        })
        .catch(() => {
          if (ticket === searchTicket) results = [];
        });
      return;
    }

    if (m === 'workspace-symbol') {
      // workspace/symbol servers typically require at least 1-2 chars to return useful results.
      if (!q || q.length < 1) {
        results = [];
        return;
      }
      lspStore
        .workspaceSymbols(q)
        .then((raw) => {
          if (ticket !== searchTicket) return;
          const mapped: ResultRow[] = raw
            .map((s) => {
              const loc = s.location;
              const range = loc?.range;
              const uri: string = loc?.uri ?? '';
              const path = uri.startsWith('file://') ? uri.slice(7) : uri;
              return {
                kind: 'workspace-symbol' as const,
                name: s.name,
                detail: `${s.containerName ? s.containerName + ' · ' : ''}${path.split('/').slice(-2).join('/')}`,
                uri: path,
                line: range?.start?.line ?? 0,
                character: range?.start?.character ?? 0,
                symbolKind: LSP_KIND_TO_TAG[s.kind] ?? '',
              };
            })
            .slice(0, 100);
          results = mapped;
          selectedIndex = 0;
        })
        .catch(() => {
          if (ticket === searchTicket) results = [];
        });
    }
  });

  async function loadFiles() {
    const path = conversationStore.active?.workspacePath || settingsStore.workspacePath || '.';
    try {
      const res = await api.files.tree(path, 6);
      allFiles = flattenTree(res.data);
    } catch {
      allFiles = [];
    }
  }

  function openSelected() {
    if (results.length === 0) return;
    const row = results[selectedIndex];
    if (!row) return;
    if (row.kind === 'file' && row.path) {
      editorStore.openFile(row.path, false);
    } else if (row.uri != null && row.line != null) {
      editorStore.openFile(row.uri, false, { line: row.line + 1, col: (row.character ?? 0) + 1 });
    }
    close();
  }

  function close() {
    query = '';
    uiStore.closeModal();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openSelected();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  const placeholderFor: Record<Mode, string> = {
    file: 'Search files… (# = workspace symbols, @ = current-file symbols)',
    'doc-symbol': 'Search symbols in this file…',
    'workspace-symbol': 'Search symbols across the workspace…',
  };
</script>

{#if uiStore.activeModal === 'quick-open'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="quick-open-overlay" onclick={close} onkeydown={handleKeydown}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="quick-open" onclick={(e) => e.stopPropagation()}>
      <input
        bind:this={input}
        bind:value={query}
        class="quick-open-input"
        placeholder={placeholderFor[mode]}
        onkeydown={handleKeydown}
      />
      <div class="quick-open-results">
        {#each results as row, i (row.kind + ':' + (row.path ?? row.uri) + ':' + (row.line ?? '') + ':' + row.name)}
          <button
            class="result-item"
            class:selected={i === selectedIndex}
            onclick={() => {
              selectedIndex = i;
              openSelected();
            }}
            onmouseenter={() => (selectedIndex = i)}
          >
            {#if row.kind === 'file'}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              </svg>
            {:else}
              <span class="symbol-tag">{row.symbolKind || '?'}</span>
            {/if}
            <span class="result-name">{row.name}</span>
            <span class="result-path">{row.detail}</span>
          </button>
        {/each}
        {#if results.length === 0 && query}
          <div class="no-results">
            {#if mode === 'file'}
              No files match "{effectiveQuery}"
            {:else if mode === 'doc-symbol'}
              {#if !editorStore.activeTab}
                Open a file to search its symbols
              {:else if !lspStore.isConnected(editorStore.activeTab.language)}
                No language server connected for {editorStore.activeTab.language}
              {:else}
                No symbols match "{effectiveQuery}"
              {/if}
            {:else}
              No workspace symbols match "{effectiveQuery}"
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .quick-open-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    padding-top: 15vh;
    z-index: 100;
  }

  .quick-open {
    width: 520px;
    max-height: 420px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .quick-open-input {
    width: 100%;
    padding: 12px 16px;
    font-size: var(--fs-md);
    font-family: var(--font-family);
    background: var(--bg-input);
    border: none;
    border-bottom: 1px solid var(--border-primary);
    color: var(--text-primary);
    outline: none;
  }
  .quick-open-input::placeholder {
    color: var(--text-tertiary);
  }

  .quick-open-results {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    font-size: var(--fs-base);
    color: var(--text-secondary);
    text-align: left;
    border-radius: var(--radius-sm);
    transition: background var(--transition);
  }
  .result-item:hover,
  .result-item.selected {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .symbol-tag {
    display: inline-block;
    width: 36px;
    padding: 1px 4px;
    font-size: var(--fs-xxs);
    font-weight: 700;
    text-align: center;
    background: var(--bg-active);
    color: var(--syn-function);
    border-radius: 2px;
    flex-shrink: 0;
  }

  .result-name {
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .result-path {
    flex: 1;
    font-size: var(--fs-xs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
  }

  .no-results {
    padding: 20px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--fs-base);
  }
</style>
